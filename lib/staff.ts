import "server-only";

import type { Prisma } from "@prisma/client";

import {
  ROLES,
  ROLE_SEAT_BUCKET,
  UNLIMITED,
  getPlan,
  type Permission,
  type PlanSeats,
  type Role,
} from "./constants";
import { prisma } from "./db";
import { effectivePermissions } from "./permissions";

/**
 * Staff and seats — shared by the staff page, the staff API and the branches
 * API so all three count the same way.
 *
 * WHERE THE LIMITS COME FROM
 * --------------------------
 * The active subscription row, not the plan table. The plan table is what a new
 * customer starts with; the subscription is what this customer actually paid
 * for, and Coderswurld can sell a shop two extra cashiers without inventing a
 * new plan. The plan is only the fallback for an account with no subscription
 * row yet.
 */

export type SeatKind = keyof PlanSeats;

export interface SeatUsage {
  /** -1 means unlimited. */
  limit: number;
  used: number;
}

export type SeatSummary = Record<SeatKind, SeatUsage>;

type Db = Prisma.TransactionClient | typeof prisma;

export async function getSeatLimits(
  db: Db,
  organizationId: string,
  plan: string,
): Promise<Record<SeatKind, number>> {
  const subscription = await db.subscription.findFirst({
    where: { organizationId, status: "ACTIVE" },
    orderBy: { expiresAt: "desc" },
    select: { seatsMainAdmin: true, seatsSubAdmin: true, seatsCashier: true, maxBranches: true },
  });
  if (subscription) {
    return {
      mainAdmin: subscription.seatsMainAdmin,
      subAdmin: subscription.seatsSubAdmin,
      cashier: subscription.seatsCashier,
      branches: subscription.maxBranches,
    };
  }
  return { ...getPlan(plan).seats };
}

/**
 * Only ACTIVE people take a seat. Deactivating someone who has left frees the
 * seat for their replacement, which is the whole reason deactivate exists
 * instead of delete: the leaver's sales keep their name, the seat comes back.
 */
export async function getSeatSummary(
  db: Db,
  organizationId: string,
  plan: string,
  options?: { excludeUserId?: string },
): Promise<SeatSummary> {
  const [limits, byRole, branches] = await Promise.all([
    getSeatLimits(db, organizationId, plan),
    db.user.groupBy({
      by: ["role"],
      where: {
        organizationId,
        isActive: true,
        ...(options?.excludeUserId ? { id: { not: options.excludeUserId } } : {}),
      },
      _count: { _all: true },
    }),
    db.branch.count({ where: { organizationId, isActive: true } }),
  ]);

  const used: Record<SeatKind, number> = { mainAdmin: 0, subAdmin: 0, cashier: 0, branches };
  for (const row of byRole) {
    const bucket = ROLE_SEAT_BUCKET[row.role as Role];
    if (bucket) used[bucket] += row._count._all;
  }

  return {
    mainAdmin: { limit: limits.mainAdmin, used: used.mainAdmin },
    subAdmin: { limit: limits.subAdmin, used: used.subAdmin },
    cashier: { limit: limits.cashier, used: used.cashier },
    branches: { limit: limits.branches, used: used.branches },
  };
}

export function seatIsFull(seat: SeatUsage): boolean {
  return seat.limit !== UNLIMITED && seat.used >= seat.limit;
}

const SEAT_NOUN: Record<SeatKind, [string, string]> = {
  mainAdmin: ["main admin", "main admins"],
  subAdmin: ["admin or manager", "admins and managers"],
  cashier: ["cashier", "cashiers"],
  branches: ["branch", "branches"],
};

/** "Your plan covers 3 cashiers and all 3 are in use." */
export function seatFullMessage(kind: SeatKind, seat: SeatUsage): string {
  const [one, many] = SEAT_NOUN[kind];
  const noun = seat.limit === 1 ? one : many;
  const fix =
    kind === "branches"
      ? "Close a branch you no longer use, or contact Coderswurld to add more."
      : "Deactivate someone who has left, or contact Coderswurld to add more.";
  return `Your plan covers ${seat.limit} ${noun} and ${seat.limit === 1 ? "it is" : `all ${seat.limit} are`} in use. ${fix}`;
}

export function isRole(value: string): value is Role {
  return (ROLES as string[]).includes(value);
}

// ─────────────────────────────────────────────────────────────────────────────
// Rows for the staff page
// ─────────────────────────────────────────────────────────────────────────────

export interface StaffRow {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  role: Role;
  /** What they can actually do — role defaults already applied. */
  permissions: Permission[];
  branchId: string | null;
  branchName: string | null;
  /** SUPERMARKET | PHARMACY, or null for both. */
  department: string | null;
  isActive: boolean;
  /** Still on the temporary password they were given. */
  mustChangePassword: boolean;
  lastLoginAt: string | null;
  createdAt: string;
}

export const STAFF_SELECT = {
  id: true,
  name: true,
  email: true,
  phone: true,
  role: true,
  permissions: true,
  branchId: true,
  branch: { select: { name: true } },
  department: true,
  isActive: true,
  mustChangePassword: true,
  lastLoginAt: true,
  createdAt: true,
} satisfies Prisma.UserSelect;

type Selected = Prisma.UserGetPayload<{ select: typeof STAFF_SELECT }>;

export function toStaffRow(u: Selected): StaffRow {
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    phone: u.phone,
    role: (isRole(u.role) ? u.role : "CASHIER") as Role,
    permissions: effectivePermissions(u.role, u.permissions),
    branchId: u.branchId,
    branchName: u.branch?.name ?? null,
    department: u.department,
    isActive: u.isActive,
    mustChangePassword: u.mustChangePassword,
    lastLoginAt: u.lastLoginAt ? u.lastLoginAt.toISOString() : null,
    createdAt: u.createdAt.toISOString(),
  };
}

export async function listStaff(organizationId: string): Promise<StaffRow[]> {
  const users = await prisma.user.findMany({
    where: { organizationId },
    // Working staff first, then by seniority, then by name.
    orderBy: [{ isActive: "desc" }, { createdAt: "asc" }],
    select: STAFF_SELECT,
  });
  const rank = (role: Role) => ROLES.indexOf(role);
  return users
    .map(toStaffRow)
    .sort(
      (a, b) =>
        Number(b.isActive) - Number(a.isActive) ||
        rank(a.role) - rank(b.role) ||
        a.name.localeCompare(b.name),
    );
}
