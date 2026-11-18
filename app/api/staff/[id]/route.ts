import { toLoginName } from "@/lib/loginName";
import { NextResponse } from "next/server";
import { z } from "zod";

import { AppError, handle, readJson } from "@/lib/api";
import { requireTenantApi } from "@/lib/auth";
import {
  ALL_PERMISSIONS,
  DEFAULT_ROLE_PERMISSIONS,
  PERMISSIONS,
  ROLES,
  ROLE_LABELS,
  ROLE_SEAT_BUCKET,
  SEES_ALL_DEPARTMENTS,
  type Permission,
  type Role,
} from "@/lib/constants";
import { prisma } from "@/lib/db";
import {
  canManageUser,
  effectivePermissions,
  filterGrantablePermissions,
  hasPermission,
  serializePermissions,
} from "@/lib/permissions";
import {
  STAFF_SELECT,
  getSeatSummary,
  isRole,
  seatFullMessage,
  seatIsFull,
  toStaffRow,
} from "@/lib/staff";

/**
 * Change a member of staff: details, role, access, branch, or whether they can
 * sign in at all.
 *
 * There is no DELETE. Every sale, stock movement and expense carries the name
 * of the person who did it, and a shop's records must still make sense after
 * that person leaves. Deactivating blocks their sign-in at once (the session
 * check reads `isActive` on every request) and gives the seat back.
 */

const PatchSchema = z.object({
  name: z.string().trim().min(2, "Enter their name.").max(120).optional(),
  /** Empty or null removes the email; the person then signs in by name. */
  email: z
    .string()
    .trim()
    .toLowerCase()
    .max(160)
    .email("Enter a valid email address, or leave it empty.")
    .or(z.literal(""))
    .nullish()
    .transform((v) => (v === undefined ? undefined : v || null)),
  phone: z
    .string()
    .trim()
    .max(30)
    .nullable()
    .optional()
    .transform((v) => (v === undefined ? undefined : v || null)),
  role: z.enum(ROLES as [Role, ...Role[]]).optional(),
  branchId: z
    .string()
    .trim()
    .max(60)
    .nullable()
    .optional()
    .transform((v) => (v === undefined ? undefined : v || null)),
  permissions: z.array(z.string()).max(200).optional(),
  /** SUPERMARKET | PHARMACY, or null/empty for both. Only kept for cashiers and storekeepers. */
  department: z
    .enum(["SUPERMARKET", "PHARMACY", ""])
    .nullish()
    .transform((v) => (v === undefined ? undefined : v || null)),
  isActive: z.boolean().optional(),
});

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const session = await requireTenantApi();
    const { id } = await params;
    const input = PatchSchema.parse(await readJson(request));

    const target = await prisma.user.findFirst({
      where: { id, organizationId: session.org.id },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        permissions: true,
        isActive: true,
      },
    });
    if (!target) throw new AppError("That person is no longer on your staff.", { status: 404 });

    const verdict = canManageUser(session.user, target);
    if (!verdict.allowed) {
      throw new AppError(verdict.reason ?? "You can't change this person.", { status: 403 });
    }

    const currentRole: Role = isRole(target.role) ? target.role : "CASHIER";
    const nextRole: Role = input.role ?? currentRole;
    const nextActive = input.isActive ?? target.isActive;

    if (nextRole === "MAIN_ADMIN" && currentRole !== "MAIN_ADMIN" && session.user.role !== "MAIN_ADMIN") {
      throw new AppError("Only a main admin can make someone a main admin.", { status: 403 });
    }

    const data: {
      name?: string;
      loginName?: string;
      email?: string | null;
      phone?: string | null;
      role?: Role;
      branchId?: string | null;
      permissions?: string;
      isActive?: boolean;
      department?: string | null;
    } = {};
    const changes: string[] = [];

    if (input.name !== undefined && input.name !== target.name) {
      const loginName = toLoginName(input.name);
      const nameClash = await prisma.user.findFirst({
        where: { organizationId: session.org.id, loginName, isActive: true, id: { not: id } },
        select: { id: true },
      });
      if (nameClash) {
        throw new AppError(
          "Someone on your staff already has that name. Add a surname or initial so they can sign in by name.",
          { status: 409, fields: { name: "Already used in this shop" } },
        );
      }
      data.name = input.name;
      data.loginName = loginName;
      changes.push("name");
    }
    if (input.phone !== undefined) data.phone = input.phone;

    if (input.email !== undefined && input.email !== target.email) {
      if (!input.email && (input.role ?? target.role) === "MAIN_ADMIN") {
        throw new AppError("A main admin needs an email for reports and password recovery.", {
          fields: { email: "Required for a main admin" },
        });
      }
      const clash = !input.email ? null : await prisma.user.findFirst({
        where: { organizationId: session.org.id, email: input.email, id: { not: id } },
        select: { id: true },
      });
      if (clash) {
        throw new AppError("Someone on your staff already uses that email.", {
          status: 409,
          fields: { email: "Already in use" },
        });
      }
      data.email = input.email;
      changes.push("email");
    }

    if (input.branchId !== undefined) {
      if (input.branchId) {
        const branch = await prisma.branch.findFirst({
          where: { id: input.branchId, organizationId: session.org.id, isActive: true },
          select: { id: true },
        });
        if (!branch) {
          throw new AppError("That branch no longer exists.", {
            fields: { branchId: "Not found" },
          });
        }
      }
      data.branchId = input.branchId;
    }

    // ── Role and access ──────────────────────────────────────────────────────
    const roleChanged = nextRole !== currentRole;
    if (roleChanged) {
      data.role = nextRole;
      changes.push(`role to ${ROLE_LABELS[nextRole].toLowerCase()}`);
    }

    if (nextRole === "MAIN_ADMIN") {
      // A main admin's stored list is never read. Clear it so a later demotion
      // starts from the new role's standard access, not a stale list.
      if (roleChanged) data.permissions = "[]";
    } else if (input.permissions !== undefined || roleChanged) {
      const custom = input.permissions !== undefined;
      if (custom && !hasPermission(session.user, PERMISSIONS.USERS_PERMISSIONS)) {
        throw new AppError("You can edit staff, but you can't change their access.", {
          status: 403,
        });
      }
      const valid = new Set<string>(ALL_PERMISSIONS);
      const requested = custom
        ? (input.permissions!.filter((p) => valid.has(p)) as Permission[])
        : DEFAULT_ROLE_PERMISSIONS[nextRole];

      // Only what is being ADDED must be something the admin holds. Access the
      // person already had is left alone — otherwise a sub-admin could not
      // un-tick one box on a manager without stripping everything the
      // sub-admin itself lacks.
      const already = new Set<Permission>(
        roleChanged ? [] : effectivePermissions(target.role, target.permissions),
      );
      const added = requested.filter((p) => !already.has(p));
      const { rejected } = filterGrantablePermissions(session.user, added);
      let finalList = requested;
      if (rejected.length > 0) {
        if (custom) {
          throw new AppError("You can't give someone access that you don't have yourself.", {
            status: 403,
          });
        }
        const blocked = new Set(rejected);
        finalList = requested.filter((p) => !blocked.has(p));
      }
      if (finalList.length === 0) {
        throw new AppError("Choose at least one thing this person can do.", {
          fields: { permissions: "Nothing selected" },
        });
      }
      const serialized = serializePermissions(finalList);
      if (serialized !== serializePermissions(effectivePermissions(target.role, target.permissions)) || roleChanged) {
        data.permissions = serialized;
        if (!roleChanged) changes.push("access");
      }
    }

    // Admins and managers always see both; anyone else may be limited to one.
    if (SEES_ALL_DEPARTMENTS.includes(nextRole)) {
      if (roleChanged) data.department = null;
    } else if (input.department !== undefined) {
      data.department = input.department;
      changes.push("department");
    }

    if (input.isActive === true && !target.isActive) {
      const clash = await prisma.user.findFirst({
        where: {
          organizationId: session.org.id,
          loginName: data.loginName ?? toLoginName(target.name),
          isActive: true,
          id: { not: id },
        },
        select: { id: true },
      });
      if (clash) {
        throw new AppError("Someone active on your staff now has this name. Change one of the names first.", {
          status: 409,
          fields: { name: "Already used in this shop" },
        });
      }
    }
    if (input.isActive !== undefined && input.isActive !== target.isActive) {
      data.isActive = input.isActive;
      changes.push(input.isActive ? "reactivated" : "deactivated");
    }

    const updated = await prisma.$transaction(async (tx) => {
      // A seat is needed when someone becomes active, or moves to a role that
      // draws from a different pool (cashier → manager).
      const needsSeat =
        nextActive &&
        (!target.isActive || ROLE_SEAT_BUCKET[nextRole] !== ROLE_SEAT_BUCKET[currentRole]);
      if (needsSeat) {
        const bucket = ROLE_SEAT_BUCKET[nextRole];
        const seats = await getSeatSummary(tx, session.org.id, session.org.plan, {
          excludeUserId: id,
        });
        if (seatIsFull(seats[bucket])) {
          throw new AppError(seatFullMessage(bucket, seats[bucket]), { status: 409 });
        }
      }

      const user = await tx.user.update({ where: { id }, data, select: STAFF_SELECT });

      if (changes.length > 0) {
        await tx.auditLog.create({
          data: {
            organizationId: session.org.id,
            userId: session.user.id,
            userName: session.user.name,
            action: data.isActive === false ? "STAFF_DEACTIVATED" : "STAFF_EDITED",
            entity: "User",
            entityId: id,
            summary: `Changed ${target.name}: ${changes.join(", ")}.`,
          },
        });
      }
      return user;
    });

    return NextResponse.json({ ok: true, staff: toStaffRow(updated) });
  });
}
