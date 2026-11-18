import Link from "next/link";
import { ArrowLeft, Package, Store } from "lucide-react";

import { prisma } from "@/lib/db";
import { requireTenant } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { PERMISSIONS } from "@/lib/constants";

import { PageHeader } from "@/components/ui/PageHeader";
import { NoAccess } from "@/components/ui/NoAccess";
import { EmptyState } from "@/components/ui/EmptyState";
import { NewPurchaseClient } from "./NewPurchaseClient";

/**
 * Record goods received.
 *
 * Loads everything the receiving form needs up front — suppliers, branches and the
 * full product list — so a storekeeper can scan or search the instant the page
 * paints, with no second request. The product list is deliberately unpaginated:
 * a scan has to resolve against every item on file, so they all travel together
 * (lean columns only — name, code, unit, cost — never the whole row).
 */
export const dynamic = "force-dynamic";
export const metadata = { title: "Record goods received" };

export default async function NewPurchasePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const str = (v: string | string[] | undefined) => (typeof v === "string" ? v : undefined);
  // ?supplier=..&branch=..&items=productId:qty,productId:qty (from What to reorder)
  const prefill = {
    supplierId: str(sp.supplier),
    branchId: str(sp.branch),
    items: (str(sp.items) ?? "")
      .split(",")
      .map((pair) => pair.split(":"))
      .filter(([id, n]) => id && Number(n) > 0)
      .slice(0, 200)
      .map(([id, n]) => ({ productId: id, qty: Number(n) })),
  };
  const session = await requireTenant();
  const { org, user } = session;

  if (!hasPermission(user, PERMISSIONS.PURCHASES_MANAGE)) {
    return <NoAccess what="recording purchases" />;
  }

  const [suppliers, branches, products] = await Promise.all([
    prisma.supplier.findMany({
      where: { organizationId: org.id, isActive: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    prisma.branch.findMany({
      where: { organizationId: org.id, isActive: true },
      orderBy: [{ isMain: "desc" }, { name: "asc" }],
      select: { id: true, name: true, code: true, isMain: true },
    }),
    prisma.product.findMany({
      where: { organizationId: org.id, isActive: true },
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        sku: true,
        barcode: true,
        unit: true,
        costPriceKobo: true,
      },
    }),
  ]);

  const backLink = (
    <Link
      href="/purchases"
      className="mb-2 inline-flex items-center gap-1.5 text-sm font-medium text-ink-500 hover:text-ink-800"
    >
      <ArrowLeft className="size-4" />
      Purchases
    </Link>
  );

  // You can't book a delivery against nobody, so send them to add a supplier
  // first — same destination the list page's empty state points to.
  if (suppliers.length === 0) {
    return (
      <>
        {backLink}
        <PageHeader title="Record goods received" />
        <EmptyState
          icon={Store}
          title="Add a supplier first"
          body="A delivery is always booked against who you bought it from. Add a market, distributor or shop, then come back to record what came in."
          action={
            <Link href="/suppliers" className="btn btn-primary">
              Add a supplier
            </Link>
          }
        />
      </>
    );
  }

  // Nor against goods that aren't on file — a line has to point at a product.
  if (products.length === 0) {
    return (
      <>
        {backLink}
        <PageHeader title="Record goods received" />
        <EmptyState
          icon={Package}
          title="Add a product first"
          body="Every line on a delivery is one of your products. Add what you sell, then record the stock coming in against it."
          action={
            <Link href="/products/add" className="btn btn-primary">
              Add a product
            </Link>
          }
        />
      </>
    );
  }

  const defaultBranchId =
    session.branch?.id ??
    branches.find((b) => b.isMain)?.id ??
    branches[0]?.id ??
    "";

  return (
    <>
      {backLink}
      <PageHeader
        title="Record goods received"
        subtitle="Book a supplier delivery into stock. Scan or search to add each item."
      />
      <NewPurchaseClient
        prefill={prefill}
        suppliers={suppliers}
        branches={branches.map((b) => ({ id: b.id, name: b.name, code: b.code }))}
        products={products}
        defaultBranchId={defaultBranchId}
        multiBranch={branches.length > 1}
        canPay={hasPermission(user, PERMISSIONS.PURCHASES_PAY)}
        timezone={org.timezone}
      />
    </>
  );
}
