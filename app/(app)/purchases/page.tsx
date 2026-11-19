import Link from "next/link";
import { Plus, Truck, Wallet, Store } from "lucide-react";

import { requireTenant } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { hasPermission } from "@/lib/permissions";
import { PERMISSIONS } from "@/lib/constants";
import { formatNaira } from "@/lib/money";

import { PageHeader } from "@/components/ui/PageHeader";
import { NoAccess } from "@/components/ui/NoAccess";
import { EmptyState } from "@/components/ui/EmptyState";
import { StatTile } from "@/components/ui/StatTile";
import { PurchasesClient, type PurchaseListRow } from "./PurchasesClient";

/**
 * Purchases — the record of goods coming in.
 *
 * Server-rendered on first paint like the rest of the back office: this runs the
 * queries and hands finished rows to the client, which only filters and searches
 * what it was given. A delivery moves stock but never the catalogue, so there's
 * nothing here to version or sync — it's a buying record the stock figures and
 * reports read from.
 */
export const dynamic = "force-dynamic";
export const metadata = { title: "Purchases" };

export default async function PurchasesPage() {
  const session = await requireTenant();
  const { org, user } = session;

  if (!hasPermission(user, PERMISSIONS.PURCHASES_VIEW)) {
    return <NoAccess what="purchases" />;
  }

  const canManage = hasPermission(user, PERMISSIONS.PURCHASES_MANAGE);

  const [rows, owedAgg, totalCount, branchCount, activeSupplierCount] = await Promise.all([
    prisma.purchase.findMany({
      where: { organizationId: org.id },
      orderBy: { purchaseDate: "desc" },
      take: 100,
      select: {
        id: true,
        reference: true,
        invoiceNo: true,
        purchaseDate: true,
        totalKobo: true,
        amountPaidKobo: true,
        balanceKobo: true,
        paymentStatus: true,
        status: true,
        supplier: { select: { id: true, name: true } },
        branch: { select: { name: true, code: true } },
        createdAt: true,
        createdBy: { select: { name: true } },
        _count: { select: { items: true, changes: true } },
      },
    }),
    prisma.purchase.aggregate({
      where: { organizationId: org.id, balanceKobo: { gt: 0 } },
      _sum: { balanceKobo: true },
    }),
    prisma.purchase.count({ where: { organizationId: org.id } }),
    prisma.branch.count({ where: { organizationId: org.id } }),
    prisma.supplier.count({ where: { organizationId: org.id, isActive: true } }),
  ]);

  const owedKobo = owedAgg._sum.balanceKobo ?? 0;

  const list: PurchaseListRow[] = rows.map((p) => ({
    id: p.id,
    reference: p.reference,
    invoiceNo: p.invoiceNo,
    purchaseDate: p.purchaseDate.toISOString(),
    totalKobo: p.totalKobo,
    amountPaidKobo: p.amountPaidKobo,
    balanceKobo: p.balanceKobo,
    paymentStatus: p.paymentStatus,
    status: p.status,
    supplierId: p.supplier.id,
    supplierName: p.supplier.name,
    branchName: p.branch.name,
    branchCode: p.branch.code,
    itemCount: p._count.items,
    enteredBy: p.createdBy?.name ?? "Unknown",
    enteredAt: p.createdAt.toISOString(),
    corrections: p._count.changes,
  }));

  return (
    <>
      <PageHeader
        title="Purchases"
        subtitle={
          owedKobo > 0
            ? `You owe ${formatNaira(owedKobo)} across suppliers`
            : "Goods received from suppliers"
        }
      />

      {totalCount === 0 ? (
        canManage && activeSupplierCount === 0 ? (
          <EmptyState
            icon={Store}
            title="Add a supplier first"
            body="Every delivery is booked against who you bought it from. Add a market, distributor or shop, then come back to record what came in."
            action={
              <Link href="/suppliers" className="btn btn-primary">
                <Plus className="size-4" />
                Add a supplier
              </Link>
            }
          />
        ) : (
          <EmptyState
            icon={Truck}
            title="No deliveries recorded yet"
            body="When stock arrives from a supplier, record it here. It books the goods into stock, updates your cost prices and tracks what you still owe."
            action={
              canManage ? (
                <Link href="/purchases/new" className="btn btn-primary">
                  <Plus className="size-4" />
                  Record goods received
                </Link>
              ) : undefined
            }
          />
        )
      ) : (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <StatTile
              icon={Wallet}
              label="Owed to suppliers"
              value={formatNaira(owedKobo)}
              note={owedKobo > 0 ? "Across unpaid deliveries" : "All settled"}
              tone={owedKobo > 0 ? "warn" : "good"}
            />
            <StatTile
              icon={Truck}
              label="Deliveries recorded"
              value={String(totalCount)}
              note={totalCount > 100 ? "Showing the latest 100" : undefined}
            />
          </div>

          <PurchasesClient
            initial={list}
            canManage={canManage}
            timezone={org.timezone}
            multiBranch={branchCount > 1}
          />
        </div>
      )}
    </>
  );
}
