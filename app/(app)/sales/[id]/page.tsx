import { notFound } from "next/navigation";
import { parseReceiptDesign } from "@/lib/receiptDesign";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { requireTenant } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { hasPermission } from "@/lib/permissions";
import { PERMISSIONS } from "@/lib/constants";

import { NoAccess } from "@/components/ui/NoAccess";
import { SaleDetailClient, type SaleDetail } from "./SaleDetailClient";

/**
 * One receipt, in full — the till's record of a single sale.
 *
 * This is where a sale is reprinted, inspected line by line, and, if it was a
 * mistake, voided. The reprint has to match the thermal slip the customer walked
 * out with, so it reads from the same snapshotted line items the POS wrote and
 * reuses the same receipt stylesheet — a receipt pulled up a year later shows
 * what was sold at the price it sold for, not today's catalogue.
 *
 * WHO CAN OPEN IT
 * ---------------
 * A cashier may open their own receipts; `sales.view_all` opens anyone's. A
 * receipt the viewer isn't entitled to is answered with notFound() rather than a
 * 403 — the same response as an id that doesn't exist, so the URL can't be used
 * to probe whether a given sale is real.
 */
export const dynamic = "force-dynamic";
export const metadata = { title: "Receipt" };

export default async function SaleDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await requireTenant();
  const { org, user } = session;

  if (!hasPermission(user, PERMISSIONS.SALES_VIEW)) {
    return <NoAccess what="sales" />;
  }

  const { id } = await params;

  const sale = await prisma.sale.findFirst({
    where: { id, organizationId: org.id },
    select: {
      id: true,
      receiptNo: true,
      soldAt: true,
      status: true,
      priceMode: true,
      paymentMethod: true,
      subtotalKobo: true,
      discountKobo: true,
      taxKobo: true,
      totalKobo: true,
      tenderedKobo: true,
      changeKobo: true,
      paidKobo: true,
      balanceKobo: true,
      note: true,
      voidedReason: true,
      cashierId: true,
      cashier: { select: { name: true } },
      customer: { select: { id: true, name: true, phone: true } },
      branch: { select: { name: true, code: true } },
      items: {
        orderBy: { id: "asc" },
        select: {
          id: true,
          productName: true,
          sku: true,
          unit: true,
          quantity: true,
          unitPriceKobo: true,
          discountKobo: true,
          lineTotalKobo: true,
          priceType: true,
        },
      },
    },
  });

  // Unknown id and "not yours" are answered the same way, on purpose.
  if (!sale) notFound();
  const canViewAll = hasPermission(user, PERMISSIONS.SALES_VIEW_ALL);
  if (!canViewAll && sale.cashierId !== user.id) notFound();

  // The receipt header comes from the business, not the session — the session
  // org carries no phone, and a reprint should show the shop's real contact line.
  const [organization, settings] = await Promise.all([
    prisma.organization.findUnique({
      where: { id: org.id },
      select: { name: true, phone: true, logoUrl: true, address: true, city: true },
    }),
    prisma.orgSettings.findUnique({
      where: { organizationId: org.id },
      select: {
        receiptWidth: true,
        receiptHeader: true,
        receiptFooter: true,
        receiptShowLogo: true,
        receiptShowCashier: true,
        receiptDesign: true,
      },
    }),
  ]);

  const detail: SaleDetail = {
    id: sale.id,
    receiptNo: sale.receiptNo,
    soldAt: sale.soldAt.toISOString(),
    status: sale.status,
    priceMode: sale.priceMode,
    paymentMethod: sale.paymentMethod,
    subtotalKobo: sale.subtotalKobo,
    discountKobo: sale.discountKobo,
    taxKobo: sale.taxKobo,
    totalKobo: sale.totalKobo,
    tenderedKobo: sale.tenderedKobo,
    changeKobo: sale.changeKobo,
    paidKobo: sale.paidKobo,
    balanceKobo: sale.balanceKobo,
    note: sale.note,
    voidedReason: sale.voidedReason,
    cashierName: sale.cashier.name,
    customer: sale.customer,
    branch: sale.branch,
    items: sale.items.map((it) => ({
      id: it.id,
      productName: it.productName,
      sku: it.sku,
      unit: it.unit,
      quantity: it.quantity,
      unitPriceKobo: it.unitPriceKobo,
      discountKobo: it.discountKobo,
      lineTotalKobo: it.lineTotalKobo,
      priceType: it.priceType,
    })),
  };

  const canVoid = hasPermission(user, PERMISSIONS.SALES_VOID) && sale.status === "COMPLETED";

  return (
    <>
      <Link
        href="/sales"
        className="mb-4 inline-flex items-center gap-1.5 text-sm font-medium text-ink-500 transition-colors hover:text-ink-900"
      >
        <ArrowLeft className="size-4" />
        Back to sales
      </Link>

      <SaleDetailClient
        detail={detail}
        org={{
          name: organization?.name ?? org.name,
          phone: organization?.phone ?? null,
          logoUrl: organization?.logoUrl ?? null,
          address: [organization?.address, organization?.city].filter(Boolean).join(", ") || null,
          timezone: org.timezone,
        }}
        design={parseReceiptDesign(settings?.receiptDesign)}
        settings={{
          receiptWidth: (settings?.receiptWidth as "80mm" | "58mm") ?? "80mm",
          receiptHeader: settings?.receiptHeader ?? null,
          receiptFooter: settings?.receiptFooter ?? "Thank you for your patronage!",
          receiptShowLogo: settings?.receiptShowLogo ?? false,
          receiptShowCashier: settings?.receiptShowCashier ?? true,
        }}
        canVoid={canVoid}
      />
    </>
  );
}
