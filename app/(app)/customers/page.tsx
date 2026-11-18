import { requireTenant } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { hasPermission } from "@/lib/permissions";
import { PERMISSIONS } from "@/lib/constants";

import { PageHeader } from "@/components/ui/PageHeader";
import { NoAccess } from "@/components/ui/NoAccess";
import { CustomersClient, type CustomerRow } from "./CustomersClient";

/**
 * Customers & debts — the "who owes us" book.
 *
 * Server-rendered on first paint like every list in the back office: this
 * component runs the query and hands finished rows to the client, which only
 * calls the API for changes afterwards. The one figure that matters most here is
 * the running balance each customer owes, and it's read straight off the row — it
 * was written by their credit sales and repayments, never guessed here.
 */
export const dynamic = "force-dynamic";
export const metadata = { title: "Customers" };

export default async function CustomersPage() {
  const session = await requireTenant();
  const { org, user } = session;

  if (!hasPermission(user, PERMISSIONS.CUSTOMERS_VIEW)) {
    return <NoAccess what="customers" />;
  }

  const customers = await prisma.customer.findMany({
    where: { organizationId: org.id },
    orderBy: [{ isActive: "desc" }, { name: "asc" }],
    select: {
      id: true,
      name: true,
      phone: true,
      whatsapp: true,
      email: true,
      address: true,
      notes: true,
      creditLimitKobo: true,
      balanceKobo: true,
      totalSpentKobo: true,
      purchaseCount: true,
      lastPurchaseAt: true,
      isActive: true,
    },
  });

  const rows: CustomerRow[] = customers.map((c) => ({
    id: c.id,
    name: c.name,
    phone: c.phone,
    whatsapp: c.whatsapp,
    email: c.email,
    address: c.address,
    notes: c.notes,
    creditLimitKobo: c.creditLimitKobo,
    balanceKobo: c.balanceKobo,
    totalSpentKobo: c.totalSpentKobo,
    purchaseCount: c.purchaseCount,
    lastPurchaseAt: c.lastPurchaseAt ? c.lastPurchaseAt.toISOString() : null,
    isActive: c.isActive,
  }));

  const activeCount = rows.filter((r) => r.isActive).length;
  const owed = rows.reduce((sum, r) => sum + Math.max(0, r.balanceKobo), 0);

  return (
    <>
      <PageHeader
        title="Customers"
        subtitle={
          activeCount === 0
            ? "The people you sell to"
            : `${activeCount} customer${activeCount === 1 ? "" : "s"}`
        }
      />
      <CustomersClient
        initial={rows}
        canManage={hasPermission(user, PERMISSIONS.CUSTOMERS_MANAGE)}
        canRecordDebt={hasPermission(user, PERMISSIONS.CUSTOMERS_DEBT)}
        totalOwedKobo={owed}
        timezone={org.timezone}
      />
    </>
  );
}
