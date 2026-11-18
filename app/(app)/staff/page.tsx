import { requireTenant } from "@/lib/auth";
import { PERMISSIONS } from "@/lib/constants";
import { prisma } from "@/lib/db";
import { hasPermission } from "@/lib/permissions";
import { getSeatSummary, listStaff } from "@/lib/staff";

import { NoAccess } from "@/components/ui/NoAccess";
import { PageHeader } from "@/components/ui/PageHeader";
import { StaffClient } from "./StaffClient";

/**
 * Staff — who can sign in, and what each of them can do.
 *
 * This is the page that lets a business run itself: the owner adds a cashier,
 * hands over a temporary password, and that person is selling a minute later
 * with no call to Coderswurld.
 */
export const dynamic = "force-dynamic";
export const metadata = { title: "Staff" };

export default async function StaffPage() {
  const session = await requireTenant();
  const { org, user } = session;

  if (!hasPermission(user, PERMISSIONS.USERS_VIEW)) {
    return <NoAccess what="staff" />;
  }

  const [staff, seats, branches] = await Promise.all([
    listStaff(org.id),
    getSeatSummary(prisma, org.id, org.plan),
    prisma.branch.findMany({
      where: { organizationId: org.id, isActive: true },
      orderBy: [{ isMain: "desc" }, { name: "asc" }],
      select: { id: true, name: true, isMain: true },
    }),
  ]);

  return (
    <>
      <PageHeader title="Staff" subtitle="Who can sign in, and what each person can do" />
      <StaffClient
        initialStaff={staff}
        initialSeats={seats}
        branches={branches}
        timezone={org.timezone}
        me={{ id: user.id, role: user.role, permissions: user.permissions }}
        canManage={hasPermission(user, PERMISSIONS.USERS_MANAGE)}
        canSetAccess={hasPermission(user, PERMISSIONS.USERS_PERMISSIONS)}
        departmentsOn={Boolean(
          (await prisma.orgSettings.findUnique({
            where: { organizationId: org.id },
            select: { departmentsEnabled: true },
          }))?.departmentsEnabled,
        )}
      />
    </>
  );
}
