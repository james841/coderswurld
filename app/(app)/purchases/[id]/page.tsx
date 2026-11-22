import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Ban, FolderOpen, History, PencilLine, Plus } from "lucide-react";

import { prisma } from "@/lib/db";
import { requireTenant } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { PERMISSIONS } from "@/lib/constants";

import { NoAccess } from "@/components/ui/NoAccess";
import { PurchaseDetailClient, type PurchaseDetail } from "./PurchaseDetailClient";
import { PurchaseActions } from "./CorrectPurchase";

/**
 * One delivery, in full.
 *
 * Queries Prisma directly rather than going through the API route — a Server
 * Component is already on the server, so there's no reason to make an HTTP round
 * trip to reach the same database. The shape it builds matches the GET route byte
 * for byte, so the client renders the same thing however the data arrived.
 */
export const dynamic = "force-dynamic";
export const metadata = { title: "Delivery" };

export default async function PurchaseDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await requireTenant();
  const { org, user } = session;

  if (!hasPermission(user, PERMISSIONS.PURCHASES_VIEW)) {
    return <NoAccess what="purchases" />;
  }

  const { id } = await params;

  const purchase = await prisma.purchase.findFirst({
    where: { id, organizationId: org.id },
    select: {
      id: true,
      reference: true,
      invoiceNo: true,
      purchaseDate: true,
      subtotalKobo: true,
      transportKobo: true,
      otherCostKobo: true,
      totalKobo: true,
      amountPaidKobo: true,
      balanceKobo: true,
      paymentStatus: true,
      status: true,
      note: true,
      createdAt: true,
      createdBy: { select: { name: true } },
      changes: {
        orderBy: { createdAt: "desc" },
        select: { id: true, action: true, reason: true, details: true, userName: true, createdAt: true },
      },
      supplier: { select: { id: true, name: true, phone: true, whatsapp: true } },
      branch: { select: { name: true, code: true } },
      items: {
        select: {
          id: true,
          quantity: true,
          unitCostKobo: true,
          lineTotalKobo: true,
          batchNo: true,
          expiryDate: true,
          product: { select: { id: true, name: true, sku: true, unit: true } },
        },
      },
      payments: {
        where: { direction: "OUT" },
        orderBy: { paidAt: "desc" },
        select: {
          id: true,
          amountKobo: true,
          method: true,
          reference: true,
          paidAt: true,
        },
      },
    },
  });

  if (!purchase) notFound();

  const detail: PurchaseDetail = {
    id: purchase.id,
    reference: purchase.reference,
    invoiceNo: purchase.invoiceNo,
    purchaseDate: purchase.purchaseDate.toISOString(),
    subtotalKobo: purchase.subtotalKobo,
    transportKobo: purchase.transportKobo,
    otherCostKobo: purchase.otherCostKobo,
    totalKobo: purchase.totalKobo,
    amountPaidKobo: purchase.amountPaidKobo,
    balanceKobo: purchase.balanceKobo,
    paymentStatus: purchase.paymentStatus,
    status: purchase.status,
    note: purchase.note,
    supplier: purchase.supplier,
    branch: purchase.branch,
    multiBranch: false, // filled below
    enteredBy: purchase.createdBy?.name ?? "Unknown",
    enteredAt: purchase.createdAt.toISOString(),
    items: purchase.items.map((it) => ({
      id: it.id,
      quantity: it.quantity,
      unitCostKobo: it.unitCostKobo,
      lineTotalKobo: it.lineTotalKobo,
      batchNo: it.batchNo,
      expiryDate: it.expiryDate ? it.expiryDate.toISOString() : null,
      productId: it.product?.id ?? null,
      productName: it.product?.name ?? "(removed product)",
      sku: it.product?.sku ?? null,
      unit: it.product?.unit ?? "pcs",
    })),
    payments: purchase.payments.map((pay) => ({
      id: pay.id,
      amountKobo: pay.amountKobo,
      method: pay.method,
      reference: pay.reference,
      paidAt: pay.paidAt.toISOString(),
    })),
  };

  // Only name the branch when the shop actually has more than one — a single-site
  // store doesn't need "received at Main" on every delivery.
  detail.multiBranch = (await prisma.branch.count({ where: { organizationId: org.id } })) > 1;

  // The paper that came with this delivery, if anyone has filed it.
  const receipts = await prisma.supplierReceipt.findMany({
    where: { organizationId: org.id, purchaseId: purchase.id },
    orderBy: { createdAt: "asc" },
    select: { id: true, reference: true },
  });
  const canFileReceipt = hasPermission(user, PERMISSIONS.RECEIPTS_MANAGE);

  // Correcting needs the suppliers to pick from (products are searched on the
  // server as they type); only load them for people allowed to correct.
  const canCorrect = hasPermission(user, PERMISSIONS.PURCHASES_MANAGE) && purchase.status !== "CANCELLED";
  const pickSuppliers = canCorrect
    ? await prisma.supplier.findMany({
        where: { organizationId: org.id, isActive: true },
        orderBy: { name: "asc" },
        select: { id: true, name: true },
      })
    : [];

  const fmtWhen = new Intl.DateTimeFormat("en-NG", { timeZone: org.timezone, dateStyle: "medium", timeStyle: "short" });
  const history = purchase.changes.map((c) => {
    let details: string[] = [];
    try {
      details = JSON.parse(c.details) as string[];
    } catch {
      details = [];
    }
    return { ...c, details };
  });

  return (
    <>
      <Link
        href="/purchases"
        className="mb-2 inline-flex items-center gap-1.5 text-sm font-medium text-ink-500 hover:text-ink-800"
      >
        <ArrowLeft className="size-4" />
        Purchases
      </Link>
      <PurchaseDetailClient
        purchase={detail}
        canPay={hasPermission(user, PERMISSIONS.PURCHASES_PAY)}
        timezone={org.timezone}
        actions={
          canCorrect ? (
            <PurchaseActions purchase={detail} suppliers={pickSuppliers} />
          ) : undefined
        }
      />

      {/* Every correction, newest first: who, when, why, and old to new values. */}
      <section className="card mt-4 overflow-hidden">
        <h2 className="section-title flex items-center gap-2 border-b border-hairline px-4 py-3">
          <History className="size-4 text-navy-600" />
          Change history
        </h2>
        <ol className="divide-y divide-hairline">
          {history.map((c) => (
            <li key={c.id} className="flex gap-3 px-4 py-3.5">
              <span
                className={`mt-0.5 grid size-8 shrink-0 place-items-center rounded-full ${
                  c.action === "CANCEL" ? "bg-bad-50 text-bad-700" : "bg-brand-50 text-brand-700"
                }`}
              >
                {c.action === "CANCEL" ? <Ban className="size-4" /> : <PencilLine className="size-4" />}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm text-ink-900">
                  <span className="font-semibold">{c.userName}</span>{" "}
                  {c.action === "CANCEL" ? "cancelled this purchase" : "corrected this purchase"}
                  <span className="text-ink-400"> · {fmtWhen.format(c.createdAt)}</span>
                </p>
                <p className="mt-0.5 text-sm italic text-ink-600">&ldquo;{c.reason}&rdquo;</p>
                {c.details.length > 0 && (
                  <ul className="mt-1.5 list-disc space-y-0.5 pl-5 text-sm text-ink-700">
                    {c.details.map((d, i) => (
                      <li key={i}>{d}</li>
                    ))}
                  </ul>
                )}
              </div>
            </li>
          ))}
          <li className="flex gap-3 px-4 py-3.5">
            <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-full bg-ink-100 text-ink-500">
              <Plus className="size-4" />
            </span>
            <p className="text-sm text-ink-900">
              <span className="font-semibold">{detail.enteredBy}</span> entered this purchase
              <span className="text-ink-400"> · {fmtWhen.format(purchase.createdAt)}</span>
            </p>
          </li>
        </ol>
      </section>

      {/*
        Receipts sit under the delivery they prove. Each chip opens the filed
        photo; the link files a new one already tied to this purchase, so nobody
        has to pick the supplier or remember the PO number.
      */}
      <section className="card card-pad mt-4 flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center gap-1.5 text-sm font-bold text-ink-950">
          <FolderOpen className="size-4 text-navy-600" />
          Supplier receipts
        </span>
        {receipts.length === 0 ? (
          <span className="text-sm text-ink-500">None filed for this delivery yet.</span>
        ) : (
          receipts.map((r) => (
            <a
              key={r.id}
              href={`/api/receipts/${r.id}/file`}
              target="_blank"
              rel="noreferrer"
              className="badge badge-navy hover:bg-navy-800"
            >
              {r.reference}
            </a>
          ))
        )}
        {canFileReceipt ? (
          <Link
            href={`/receipts?new=1&purchaseId=${purchase.id}`}
            className="btn btn-outline btn-sm ml-auto"
          >
            <Plus className="size-4" />
            Attach receipt
          </Link>
        ) : null}
      </section>
    </>
  );
}
