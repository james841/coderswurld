import Link from "next/link";
import { AlertTriangle, CalendarClock, CheckCircle2 } from "lucide-react";

import { requireTenant } from "@/lib/auth";
import { PERMISSIONS } from "@/lib/constants";
import { prisma } from "@/lib/db";
import { formatNaira } from "@/lib/money";
import { hasPermission } from "@/lib/permissions";
import { pinnedBranch } from "@/lib/branchScope";
import { NoAccess } from "@/components/ui/NoAccess";
import { PageHeader } from "@/components/ui/PageHeader";

import { WriteOffButton } from "./WriteOffButton";

/**
 * Expiry: every batch still on the shelf that has expired or will expire
 * within the shop's warning window, soonest first, with what it is worth.
 */

export const dynamic = "force-dynamic";

const DAY = 86_400_000;

export default async function ExpiryPage() {
  const session = await requireTenant();
  const { org, user } = session;
  const branch = pinnedBranch(session);
  if (!hasPermission(user, PERMISSIONS.STOCK_VIEW)) return <NoAccess what="expiry dates" />;
  const canRemove = hasPermission(user, PERMISSIONS.STOCK_ADJUST);

  const settings = await prisma.orgSettings.findUnique({
    where: { organizationId: org.id },
    select: { expiryWarningDays: true },
  });
  const warnDays = settings?.expiryWarningDays ?? 90;

  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const horizon = new Date(today.getTime() + warnDays * DAY);

  const batches = await prisma.stockBatch.findMany({
    where: {
      organizationId: org.id,
      writtenOffAt: null,
      quantityLeft: { gt: 0 },
      expiryDate: { not: null, lte: horizon },
      ...(branch ? { branchId: branch.id } : {}),
      ...(user.department ? { product: { department: user.department } } : {}),
    },
    orderBy: { expiryDate: "asc" },
    take: 500,
    select: {
      id: true,
      batchNo: true,
      expiryDate: true,
      quantityLeft: true,
      unitCostKobo: true,
      product: { select: { id: true, name: true, sku: true, unit: true, costPriceKobo: true } },
      branch: { select: { name: true } },
    },
  });

  const rows = batches.map((b) => {
    const days = Math.floor((b.expiryDate!.getTime() - today.getTime()) / DAY);
    const valueKobo = Math.round(b.quantityLeft * (b.unitCostKobo || b.product.costPriceKobo));
    return { ...b, days, valueKobo };
  });
  const expired = rows.filter((r) => r.days < 0);
  const soon = rows.filter((r) => r.days >= 0 && r.days <= 30);
  const later = rows.filter((r) => r.days > 30);
  const sum = (list: typeof rows) => list.reduce((t, r) => t + r.valueKobo, 0);
  const multiBranch = !branch;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Expiry"
        subtitle={`Batches that have expired or expire within ${warnDays} days. The till sells the batch that expires first.`}
        action={
          <Link href="/settings" className="btn btn-outline btn-sm">
            Change warning days
          </Link>
        }
      />

      <div className="grid gap-3 sm:grid-cols-3">
        <Tile tone="bg-sell-600" icon={AlertTriangle} label="Expired, still on the shelf" count={expired.length} value={sum(expired)} />
        <Tile tone="bg-brand-700" icon={CalendarClock} label="Expiring within 30 days" count={soon.length} value={sum(soon)} />
        <Tile tone="bg-navy-700" icon={CalendarClock} label={`Expiring in 31 to ${warnDays} days`} count={later.length} value={sum(later)} />
      </div>

      {rows.length === 0 ? (
        <div className="card card-pad flex flex-col items-center gap-2 py-12 text-center">
          <CheckCircle2 className="size-8 text-good-700" />
          <p className="font-semibold text-ink-900">Nothing is expiring soon</p>
          <p className="max-w-md text-sm text-ink-500">
            Batches show here once you record an expiry date when you receive goods (on a purchase) or add opening
            stock to a product.
          </p>
        </div>
      ) : (
        <>
          <Group title="Expired" note="Remove these from the shelf and from stock." rows={expired} multiBranch={multiBranch} canRemove={canRemove} />
          <Group title="Within 30 days" note="Sell these first, or ask the supplier about a return." rows={soon} multiBranch={multiBranch} canRemove={canRemove} />
          <Group title={`31 to ${warnDays} days`} rows={later} multiBranch={multiBranch} canRemove={false} />
        </>
      )}
    </div>
  );
}

function Tile({
  tone,
  icon: Icon,
  label,
  count,
  value,
}: {
  tone: string;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  count: number;
  value: number;
}) {
  return (
    <div className="card card-pad rounded-2xl">
      <span className={`texture-waves grid size-10 place-items-center rounded-xl text-white ${tone}`}>
        <Icon className="size-5" />
      </span>
      <p className="mt-3 text-xs font-bold uppercase tracking-wider text-ink-500">{label}</p>
      <p className="tabular mt-1 text-2xl font-bold text-ink-950">{count} {count === 1 ? "batch" : "batches"}</p>
      <p className="text-sm text-ink-500">Worth {formatNaira(value)} at cost</p>
    </div>
  );
}

type Row = {
  id: string;
  batchNo: string | null;
  expiryDate: Date | null;
  quantityLeft: number;
  days: number;
  valueKobo: number;
  product: { id: string; name: string; sku: string; unit: string };
  branch: { name: string };
};

function Group({
  title,
  note,
  rows,
  multiBranch,
  canRemove,
}: {
  title: string;
  note?: string;
  rows: Row[];
  multiBranch: boolean;
  canRemove: boolean;
}) {
  if (rows.length === 0) return null;
  return (
    <section className="card overflow-hidden rounded-2xl">
      <header className="flex items-baseline justify-between gap-3 border-b border-hairline px-4 py-3">
        <h2 className="text-sm font-bold text-ink-950">{title}</h2>
        {note ? <p className="text-xs text-ink-500">{note}</p> : null}
      </header>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-sm">
          <thead className="bg-canvas text-left text-xs uppercase tracking-wide text-ink-500">
            <tr>
              <th className="px-4 py-2 font-semibold">Product</th>
              <th className="px-4 py-2 font-semibold">Batch</th>
              {multiBranch ? <th className="px-4 py-2 font-semibold">Branch</th> : null}
              <th className="px-4 py-2 font-semibold">Expires</th>
              <th className="px-4 py-2 text-right font-semibold">Left</th>
              <th className="px-4 py-2 text-right font-semibold">Value</th>
              {canRemove ? <th className="px-4 py-2" /> : null}
            </tr>
          </thead>
          <tbody className="divide-y divide-hairline">
            {rows.map((r) => (
              <tr key={r.id}>
                <td className="px-4 py-2.5">
                  <Link href={`/products/${r.product.id}/edit`} className="font-semibold text-ink-900 hover:text-navy-700">
                    {r.product.name}
                  </Link>
                  <p className="font-mono text-xs text-ink-500">{r.product.sku}</p>
                </td>
                <td className="px-4 py-2.5 text-ink-700">{r.batchNo ?? <span className="text-ink-400">No number</span>}</td>
                {multiBranch ? <td className="px-4 py-2.5 text-ink-700">{r.branch.name}</td> : null}
                <td className="px-4 py-2.5">
                  <p className="text-ink-900">
                    {r.expiryDate!.toLocaleDateString("en-NG", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" })}
                  </p>
                  <span className={`badge ${r.days < 0 ? "badge-bad" : r.days <= 30 ? "badge-warn" : "badge-neutral"}`}>
                    {r.days < 0 ? `${-r.days} days ago` : r.days === 0 ? "Today" : `in ${r.days} days`}
                  </span>
                </td>
                <td className="tabular px-4 py-2.5 text-right font-semibold">
                  {r.quantityLeft} <span className="font-normal text-ink-500">{r.product.unit}</span>
                </td>
                <td className="tabular px-4 py-2.5 text-right text-ink-700">{formatNaira(r.valueKobo)}</td>
                {canRemove ? (
                  <td className="px-4 py-2.5 text-right">
                    <WriteOffButton batchId={r.id} label={`${r.quantityLeft} ${r.product.unit} of ${r.product.name}`} />
                  </td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
