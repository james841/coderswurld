import { requireTenant } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { hasPermission } from "@/lib/permissions";
import { PERMISSIONS } from "@/lib/constants";

import { PageHeader } from "@/components/ui/PageHeader";
import { NoAccess } from "@/components/ui/NoAccess";
import { SuppliersClient, type SupplierRow } from "./SuppliersClient";

/**
 * Suppliers & markets — the "where we buy from" book.
 *
 * Server-rendered on first paint like every other list in the back office: this
 * component runs the query and hands finished rows to the client, which only
 * calls the API for changes afterwards. Suppliers never reach the till, so there
 * is no catalog version to bump and nothing offline to keep in step — this is
 * purely a back-office record that buying and reporting read from.
 */
export const dynamic = "force-dynamic";
export const metadata = { title: "Suppliers" };

export default async function SuppliersPage() {
  const session = await requireTenant();
  const { org, user } = session;

  if (!hasPermission(user, PERMISSIONS.SUPPLIERS_VIEW)) {
    return <NoAccess what="suppliers" />;
  }

  const suppliers = await prisma.supplier.findMany({
    where: { organizationId: org.id },
    orderBy: [{ isActive: "desc" }, { name: "asc" }],
    select: {
      id: true,
      name: true,
      type: true,
      marketName: true,
      location: true,
      address: true,
      contactPerson: true,
      phone: true,
      whatsapp: true,
      email: true,
      notes: true,
      balanceKobo: true,
      isActive: true,
      _count: { select: { products: true, purchases: true } },
    },
  });

  const rows: SupplierRow[] = suppliers.map((s) => ({
    id: s.id,
    name: s.name,
    type: s.type,
    marketName: s.marketName,
    location: s.location,
    address: s.address,
    contactPerson: s.contactPerson,
    phone: s.phone,
    whatsapp: s.whatsapp,
    email: s.email,
    notes: s.notes,
    balanceKobo: s.balanceKobo,
    isActive: s.isActive,
    productCount: s._count.products,
    purchaseCount: s._count.purchases,
  }));

  const activeCount = rows.filter((r) => r.isActive).length;
  const owed = rows.reduce((sum, r) => sum + Math.max(0, r.balanceKobo), 0);

  return (
    <>
      <PageHeader
        title="Suppliers"
        subtitle={
          activeCount === 0
            ? "Where your stock comes from"
            : `${activeCount} active source${activeCount === 1 ? "" : "s"}`
        }
      />
      <SuppliersClient
        initial={rows}
        canManage={hasPermission(user, PERMISSIONS.SUPPLIERS_MANAGE)}
        totalOwedKobo={owed}
      />
    </>
  );
}
