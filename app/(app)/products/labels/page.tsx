import Link from "next/link";
import { ArrowLeft, Tags } from "lucide-react";

import { prisma } from "@/lib/db";
import { requireTenant } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { PERMISSIONS } from "@/lib/constants";
import { formatNaira } from "@/lib/money";

import { PageHeader } from "@/components/ui/PageHeader";
import { NoAccess } from "@/components/ui/NoAccess";
import { EmptyState } from "@/components/ui/EmptyState";
import { LabelSheet, type LabelRow } from "./LabelSheet";

/**
 * Printable shelf-edge / barcode labels.
 *
 * Reached with `?ids=` — the products a person ticked on the list. The rows are
 * fetched and formatted here, on the server, so the sheet is correct on first
 * paint and the price is rendered by the same money formatter the rest of the
 * app uses (no chance of the label and the till disagreeing on a figure).
 *
 * The barcodes themselves are drawn as plain SVG, so a sheet of sixty prints
 * crisply on a 203dpi thermal roll and a 600dpi laser alike with no image
 * requests.
 */
export const dynamic = "force-dynamic";
export const metadata = { title: "Print labels" };

export default async function LabelsPage({
  searchParams,
}: {
  searchParams: Promise<{ ids?: string }>;
}) {
  const { org, user } = await requireTenant();

  if (!hasPermission(user, PERMISSIONS.PRODUCTS_BARCODE)) {
    return <NoAccess what="printing labels" />;
  }

  const { ids } = await searchParams;
  const requested = (ids ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 500); // a sane ceiling — nobody hand-ticks more than a few hundred

  const header = (
    <>
      <Link
        href="/products"
        className="mb-2 inline-flex items-center gap-1.5 text-sm font-medium text-ink-500 hover:text-ink-800"
      >
        <ArrowLeft className="size-4" />
        Products
      </Link>
      <PageHeader
        title="Print labels"
        subtitle="Shelf-edge labels with the price and a scannable barcode."
      />
    </>
  );

  if (requested.length === 0) {
    return (
      <>
        {header}
        <EmptyState
          icon={Tags}
          title="No products chosen"
          body="Go back to the product list, tick the ones you want labels for, then choose Print labels."
          action={
            <Link href="/products" className="btn btn-primary">
              Back to products
            </Link>
          }
        />
      </>
    );
  }

  const products = await prisma.product.findMany({
    where: { organizationId: org.id, id: { in: requested } },
    select: {
      id: true,
      name: true,
      sku: true,
      barcode: true,
      sellingPriceKobo: true,
    },
  });

  // Keep the sheet in the order the person ticked them, not database order.
  const order = new Map(requested.map((id, i) => [id, i]));
  products.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));

  const rows: LabelRow[] = products.map((p) => ({
    id: p.id,
    name: p.name,
    code: p.barcode ?? p.sku,
    sku: p.sku,
    price: formatNaira(p.sellingPriceKobo),
  }));

  return (
    <>
      <div className="no-print">{header}</div>
      <LabelSheet rows={rows} />
    </>
  );
}
