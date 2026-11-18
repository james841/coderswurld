import { requireTenant } from "@/lib/auth";
import { PERMISSIONS } from "@/lib/constants";
import { prisma } from "@/lib/db";
import { isoDateInZone } from "@/lib/dates";
import { hasPermission } from "@/lib/permissions";
import { listReceipts, supplierNameSuggestions } from "@/lib/receipts";

import { NoAccess } from "@/components/ui/NoAccess";
import { PageHeader } from "@/components/ui/PageHeader";
import { ReceiptsClient } from "./ReceiptsClient";

/**
 * Supplier receipts — every piece of paper a vendor has handed over, filed and
 * searchable by supplier name or ID.
 *
 * The first page of results is rendered on the server like every other list in
 * the back office. Searching afterwards goes to /api/receipts, because unlike
 * the supplier list this one grows without limit: a shop files several a day,
 * and loading all of them to filter in the browser would get slower every week.
 *
 * `/receipts?new=1&supplierId=…&purchaseId=…` opens the filing sheet already
 * pointed at a supplier and a delivery — that is the link the purchase screen
 * uses for "attach the receipt".
 */
export const dynamic = "force-dynamic";
export const metadata = { title: "Supplier receipts" };

export default async function ReceiptsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await requireTenant();
  const { org, user } = session;

  if (!hasPermission(user, PERMISSIONS.PURCHASES_VIEW)) {
    return <NoAccess what="supplier receipts" />;
  }

  const params = await searchParams;
  const one = (key: string) => (typeof params[key] === "string" ? (params[key] as string) : null);

  const [first, suppliers, supplierNames] = await Promise.all([
    listReceipts({ organizationId: org.id }),
    prisma.supplier.findMany({
      where: { organizationId: org.id, isActive: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    supplierNameSuggestions(org.id),
  ]);

  // Only trust a preset purchase that really is this business's.
  let presetPurchase: { id: string; reference: string; supplierId: string } | null = null;
  const presetPurchaseId = one("purchaseId");
  if (presetPurchaseId) {
    presetPurchase = await prisma.purchase.findFirst({
      where: { id: presetPurchaseId, organizationId: org.id },
      select: { id: true, reference: true, supplierId: true },
    });
  }

  const canManage = hasPermission(user, PERMISSIONS.RECEIPTS_MANAGE);

  return (
    <>
      <PageHeader
        title="Supplier receipts"
        subtitle="Every receipt and invoice from your vendors, filed and easy to find"
      />
      <ReceiptsClient
        initial={first}
        suppliers={suppliers}
        supplierNames={supplierNames}
        canManage={canManage}
        today={isoDateInZone(new Date(), org.timezone)}
        timezone={org.timezone}
        preset={{
          open: canManage && one("new") === "1",
          supplierId: presetPurchase?.supplierId ?? one("supplierId"),
          purchase: presetPurchase
            ? { id: presetPurchase.id, reference: presetPurchase.reference }
            : null,
        }}
      />
    </>
  );
}
