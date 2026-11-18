import { NextResponse } from "next/server";
import { z } from "zod";

import { AppError, handle, readJson } from "@/lib/api";
import { requireTenantApi } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { visibleNotificationTypes } from "@/lib/notifications";

/**
 * The notification bell's data.
 *
 * The permission filter lives in `lib/notifications.ts` so that this route and
 * the badge the shell renders on the server can never disagree about what a
 * given user is shown. See that file for why the filter exists at all.
 */

const LIMIT = 12;

export async function GET() {
  return handle(async () => {
    const session = await requireTenantApi();
    const types = visibleNotificationTypes(session.user);

    // A user with no notification-bearing permissions at all (a locked-down
    // cashier) gets an empty bell without touching the database.
    if (types.length === 0) {
      return NextResponse.json({ unread: 0, items: [] });
    }

    const where = { organizationId: session.org.id, type: { in: types } };

    const [unread, items] = await Promise.all([
      prisma.notification.count({ where: { ...where, isRead: false } }),
      prisma.notification.findMany({
        where,
        // Unread first, then newest. Matches the [organizationId, isRead,
        // createdAt] index, so this stays an index scan as the table grows.
        orderBy: [{ isRead: "asc" }, { createdAt: "desc" }],
        take: LIMIT,
        select: {
          id: true,
          type: true,
          severity: true,
          title: true,
          body: true,
          linkHref: true,
          count: true,
          isRead: true,
          createdAt: true,
        },
      }),
    ]);

    return NextResponse.json({ unread, items });
  });
}

const PatchSchema = z.union([
  z.object({ id: z.string().trim().min(1).max(40) }),
  z.object({ all: z.literal(true) }),
]);

/** Mark one notification read, or clear the lot. */
export async function PATCH(request: Request) {
  return handle(async () => {
    const session = await requireTenantApi();
    const payload = PatchSchema.parse(await readJson(request));
    const now = new Date();

    if ("all" in payload) {
      // Scoped to what this user can actually see: clearing the bell must not
      // silently mark a low-stock alert read on behalf of the storekeeper who
      // still needs to act on it.
      const types = visibleNotificationTypes(session.user);
      if (types.length === 0) return NextResponse.json({ ok: true, cleared: 0 });

      const result = await prisma.notification.updateMany({
        where: {
          organizationId: session.org.id,
          type: { in: types },
          isRead: false,
        },
        data: { isRead: true, readAt: now },
      });
      return NextResponse.json({ ok: true, cleared: result.count });
    }

    // updateMany, not update: the organizationId in the WHERE is what stops one
    // tenant marking another tenant's notification read by guessing an id.
    const result = await prisma.notification.updateMany({
      where: { id: payload.id, organizationId: session.org.id },
      data: { isRead: true, readAt: now },
    });
    if (result.count === 0) {
      throw new AppError("That notification no longer exists.", { status: 404 });
    }

    return NextResponse.json({ ok: true, cleared: result.count });
  });
}
