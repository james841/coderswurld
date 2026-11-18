import "server-only";

import { prisma } from "@/lib/db";
import { hasPermission } from "@/lib/permissions";
import { PERMISSIONS, type Permission } from "@/lib/constants";

/**
 * What the bell is allowed to show, and how many are waiting.
 *
 * This lives in `lib/` rather than in the API route because two callers need the
 * same answer: the route that fills the dropdown, and the shell that renders the
 * badge on the server so the first paint already carries a count. If they
 * disagreed, the badge would say 3 and the list would show 2.
 *
 * WHY THE LIST IS FILTERED BY PERMISSION
 * --------------------------------------
 * Every notification exists to be clicked. `linkHref` points at the filtered
 * list of affected records — "8 products expiring within 90 days" opens exactly
 * those eight products. That only works if the person seeing the alert can open
 * the page behind it. Showing a cashier a low-stock alert that lands them on a
 * 403 teaches them to ignore the bell, and then the expiry alerts they *should*
 * act on get ignored too.
 *
 * The pages behind the links keep their own guards regardless. This is a
 * relevance filter, not the security boundary.
 */

/**
 * Which permission a notification type is useless without.
 *
 * `SUBSCRIPTION_EXPIRING` is deliberately ungated: "this shop stops working on
 * Friday" is something the cashier who will be standing at a dead till on
 * Friday is entitled to see, and they cannot fix it by being kept in the dark.
 */
export const NOTIFICATION_TYPE_PERMISSION: Record<string, Permission | null> = {
  EXPIRY_SOON: PERMISSIONS.PRODUCTS_VIEW,
  EXPIRED: PERMISSIONS.PRODUCTS_VIEW,
  LOW_STOCK: PERMISSIONS.STOCK_VIEW,
  OUT_OF_STOCK: PERMISSIONS.STOCK_VIEW,
  DEBT_DUE: PERMISSIONS.CUSTOMERS_DEBT,
  SUBSCRIPTION_EXPIRING: null,
  SYNC_FAILED: PERMISSIONS.POS_SELL,
};

const ALL_TYPES = Object.keys(NOTIFICATION_TYPE_PERMISSION);

interface PermissionHolder {
  role: string;
  permissions: Permission[];
}

/** The notification types this user has any business seeing. */
export function visibleNotificationTypes(user: PermissionHolder): string[] {
  return ALL_TYPES.filter((type) => {
    const required = NOTIFICATION_TYPE_PERMISSION[type];
    return required === null || hasPermission(user, required);
  });
}

/**
 * Unread count for the badge.
 *
 * Returns 0 without a query when the user's permissions map to no types at all
 * — a locked-down cashier shouldn't cost a round trip on every page load.
 */
export async function countUnreadNotifications(
  organizationId: string,
  user: PermissionHolder,
): Promise<number> {
  const types = visibleNotificationTypes(user);
  if (types.length === 0) return 0;

  return prisma.notification.count({
    where: { organizationId, type: { in: types }, isRead: false },
  });
}
