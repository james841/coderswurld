import { redirect } from "next/navigation";

import { requireTenant } from "@/lib/auth";
import { PERMISSIONS } from "@/lib/constants";
import { hasPermission } from "@/lib/permissions";

/**
 * Where the installed app opens. Owners and managers land on the dashboard,
 * cashiers straight at the till; anyone signed out goes to sign in first.
 */
export const dynamic = "force-dynamic";

export default async function LaunchPage() {
  const { user } = await requireTenant();
  if (hasPermission(user, PERMISSIONS.DASHBOARD_VIEW)) redirect("/dashboard");
  if (hasPermission(user, PERMISSIONS.POS_SELL)) redirect("/pos");
  redirect("/products");
}
