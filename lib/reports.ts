import "server-only";

import { prisma } from "./db";
import { DEFAULT_LOCALE, dayRange, isoDateInZone } from "./dates";
import { formatNaira } from "./money";
import { PAYMENT_METHOD_LABELS, type PaymentMethod } from "./constants";
import {
  emailShell,
  emailTable,
  escapeHtml,
  sendMail,
  type DeliveryResult,
} from "./mail";
import { normalizeNigerianPhone, sendWhatsAppText } from "./whatsapp";

/**
 * The automated end-of-day report.
 *
 * "Send me today's sales by cashier" was the one reporting requirement stated
 * outright in the brief, so this file owns it end to end: gather the day's
 * figures once, render them for whichever channel the owner reads (email,
 * WhatsApp, or both), send, and record that it went — the record doubling as
 * the guard that stops a cron retry sending the same evening's figures twice.
 *
 * WHY THE REPORT IS CUT FOR "NOW"'S LOCAL DAY, NOT YESTERDAY
 * ----------------------------------------------------------
 * Shops run this at close — the default is 21:00 local — and want the takings
 * since they opened this morning, while the day is still fresh in their head.
 * So the day boundary is the shop's own timezone around the instant it's sent,
 * never the server's midnight. Getting that wrong moves an hour of every
 * evening's money into the wrong day, which the owner notices immediately.
 */

export interface DailyReportData {
  orgName: string;
  timezone: string;
  /** "2026-10-14" — the idempotency key and the ReportLog periodKey. */
  dayKey: string;
  /** "Tuesday, 14 Oct 2026" — for the email body. */
  dayLabel: string;
  /** "14 Oct" — for the subject line and WhatsApp header. */
  dayLabelShort: string;

  revenueKobo: number;
  profitKobo: number;
  /** Of the takings, how much went out on credit and is still owed. */
  creditKobo: number;
  discountKobo: number;
  expensesKobo: number;
  /** Profit less expenses — the number an owner actually cares about. */
  netKobo: number;

  salesCount: number;
  voidedCount: number;
  /** Quantity may be fractional (0.75 kg), so this is a float. */
  itemsCount: number;

  byCashier: {
    name: string;
    salesCount: number;
    takenKobo: number;
    profitKobo: number;
  }[];
  byMethod: {
    method: string;
    label: string;
    amountKobo: number;
    count: number;
  }[];
  topProducts: { name: string; qty: number; amountKobo: number }[];
  /** Products at or under their reorder level (or out), lowest first. */
  lowStock: { name: string; qty: number; unit: string }[];
  lowStockCount: number;
  /** Batches expired or expiring within 30 days that are still on the shelf. */
  expiring: { name: string; days: number; qty: number; unit: string }[];
  expiringCount: number;
}

/** What the owner should act on tomorrow morning, alongside the takings. */
async function stockWatch(organizationId: string, now: Date) {
  const today = new Date(now);
  today.setUTCHours(0, 0, 0, 0);
  const in30 = new Date(today.getTime() + 30 * 86_400_000);

  const [low, batches, expiringCount] = await Promise.all([
    prisma.$queryRaw<{ name: string; unit: string; qty: number; total: bigint }[]>`
      SELECT p.name, p.unit, COALESCE(SUM(s.quantity), 0)::float AS qty, COUNT(*) OVER () AS total
      FROM "Product" p
      LEFT JOIN "StockLevel" s ON s."productId" = p.id
      WHERE p."organizationId" = ${organizationId} AND p."isActive" = true
      GROUP BY p.id
      HAVING COALESCE(SUM(s.quantity), 0) <= GREATEST(p."minStock", 0)
      ORDER BY qty ASC, p.name ASC
      LIMIT 8`,
    prisma.stockBatch.findMany({
      where: { organizationId, writtenOffAt: null, quantityLeft: { gt: 0 }, expiryDate: { lte: in30 } },
      orderBy: { expiryDate: "asc" },
      take: 8,
      select: { expiryDate: true, quantityLeft: true, product: { select: { name: true, unit: true } } },
    }),
    prisma.stockBatch.count({
      where: { organizationId, writtenOffAt: null, quantityLeft: { gt: 0 }, expiryDate: { lte: in30 } },
    }),
  ]);

  return {
    lowStock: low.map((r) => ({ name: r.name, qty: Number(r.qty), unit: r.unit })),
    lowStockCount: Number(low[0]?.total ?? 0),
    expiring: batches.map((b) => ({
      name: b.product.name,
      unit: b.product.unit,
      qty: b.quantityLeft,
      days: Math.floor((b.expiryDate!.getTime() - today.getTime()) / 86_400_000),
    })),
    expiringCount,
  };
}

/**
 * Gather one day of trading for an organization.
 *
 * Whole-business, not branch-scoped: this lands in the owner's inbox and they
 * want the shop entire. Every figure is one `Promise.all`, for the same reason
 * the dashboard is — one wait, not nine round trips to Postgres.
 */
export async function buildDailyReport(
  organizationId: string,
  day: Date,
  timeZone: string,
): Promise<DailyReportData> {
  const { start, end } = dayRange(day, timeZone);

  // `soldAt`, never `createdAt`: a sale rung up offline and synced later belongs
  // to the moment the customer paid. Only completed sales count as takings.
  const completed = {
    organizationId,
    status: "COMPLETED",
    soldAt: { gte: start, lt: end },
  };

  const [org, totals, byCashierRaw, users, itemAgg, byMethodRaw, topRaw, expenseAgg, voidedCount] =
    await Promise.all([
      prisma.organization.findUnique({
        where: { id: organizationId },
        select: { name: true },
      }),

      prisma.sale.aggregate({
        where: completed,
        _sum: {
          totalKobo: true,
          profitKobo: true,
          balanceKobo: true,
          discountKobo: true,
        },
        _count: { _all: true },
      }),

      // Backed by [organizationId, cashierId, soldAt] — an index scan over the
      // day, not a sweep. This is the table the brief asked for by name.
      prisma.sale.groupBy({
        by: ["cashierId"],
        where: completed,
        _sum: { totalKobo: true, profitKobo: true },
        _count: { _all: true },
        orderBy: { _sum: { totalKobo: "desc" } },
      }),

      // Names joined in memory — a staff list is tens of rows, and a correlated
      // lookup per cashier would be a query per row.
      prisma.user.findMany({
        where: { organizationId },
        select: { id: true, name: true },
      }),

      prisma.saleItem.aggregate({
        where: { organizationId, sale: completed },
        _sum: { quantity: true },
      }),

      prisma.sale.groupBy({
        by: ["paymentMethod"],
        where: completed,
        _sum: { totalKobo: true },
        _count: { _all: true },
      }),

      // SaleItem snapshots the name, so the leaderboard needs no join and still
      // reads correctly for a product renamed or deleted since.
      prisma.saleItem.groupBy({
        by: ["productName"],
        where: { organizationId, sale: completed },
        _sum: { quantity: true, lineTotalKobo: true },
        orderBy: { _sum: { lineTotalKobo: "desc" } },
        take: 5,
      }),

      prisma.expense.aggregate({
        where: { organizationId, expenseDate: { gte: start, lt: end } },
        _sum: { amountKobo: true },
      }),

      prisma.sale.count({
        where: { organizationId, status: "VOIDED", soldAt: { gte: start, lt: end } },
      }),
    ]);

  const revenueKobo = totals._sum.totalKobo ?? 0;
  const profitKobo = totals._sum.profitKobo ?? 0;
  const expensesKobo = expenseAgg._sum.amountKobo ?? 0;

  const nameById = new Map(users.map((u) => [u.id, u.name]));

  const byCashier = byCashierRaw.map((row) => ({
    // A deleted staff account leaves its sales behind.
    name: nameById.get(row.cashierId) ?? "Removed account",
    salesCount: row._count._all,
    takenKobo: row._sum.totalKobo ?? 0,
    profitKobo: row._sum.profitKobo ?? 0,
  }));

  const byMethod = byMethodRaw
    .map((row) => ({
      method: row.paymentMethod,
      label:
        PAYMENT_METHOD_LABELS[row.paymentMethod as PaymentMethod] ?? row.paymentMethod,
      amountKobo: row._sum.totalKobo ?? 0,
      count: row._count._all,
    }))
    .sort((a, b) => b.amountKobo - a.amountKobo);

  const topProducts = topRaw.map((row) => ({
    name: row.productName,
    qty: row._sum.quantity ?? 0,
    amountKobo: row._sum.lineTotalKobo ?? 0,
  }));

  return {
    orgName: org?.name ?? "Your shop",
    timezone: timeZone,
    dayKey: isoDateInZone(day, timeZone),
    dayLabel: new Intl.DateTimeFormat(DEFAULT_LOCALE, {
      timeZone,
      weekday: "long",
      day: "numeric",
      month: "short",
      year: "numeric",
    }).format(day),
    dayLabelShort: new Intl.DateTimeFormat(DEFAULT_LOCALE, {
      timeZone,
      day: "numeric",
      month: "short",
    }).format(day),
    revenueKobo,
    profitKobo,
    creditKobo: totals._sum.balanceKobo ?? 0,
    discountKobo: totals._sum.discountKobo ?? 0,
    expensesKobo,
    netKobo: profitKobo - expensesKobo,
    salesCount: totals._count._all,
    voidedCount,
    itemsCount: itemAgg._sum.quantity ?? 0,
    byCashier,
    byMethod,
    topProducts,
    ...(await stockWatch(organizationId, new Date())),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Rendering
// ─────────────────────────────────────────────────────────────────────────────

/** Fractional-friendly quantity: "12", "3.5". */
function qty(n: number): string {
  return n.toLocaleString(DEFAULT_LOCALE, { maximumFractionDigits: 2 });
}

function sectionHeading(text: string): string {
  return `<p style="margin:18px 0 2px;font-size:13px;font-weight:700;color:#0a0a0a;">${escapeHtml(
    text,
  )}</p>`;
}

/** The email version — a scannable figures grid, by-cashier, and best sellers. */
export function renderDailyReportEmail(data: DailyReportData): {
  subject: string;
  html: string;
  text: string;
} {
  const subject = `${data.orgName}: ${formatNaira(data.revenueKobo)} on ${data.dayLabelShort}`;

  const parts: string[] = [
    `<p style="margin:0 0 4px;">Here's how ${escapeHtml(data.orgName)} traded on ${escapeHtml(
      data.dayLabel,
    )}.</p>`,
  ];

  if (data.salesCount === 0) {
    parts.push(
      `<p style="margin:0 0 8px;color:#6a6a6a;">No sales were rung up on this day.</p>`,
    );
    if (data.expensesKobo > 0) {
      parts.push(emailTable([["Expenses", formatNaira(data.expensesKobo)]]));
    }
  } else {
    const figures: Array<[string, string]> = [
      ["Takings", formatNaira(data.revenueKobo)],
      ["Sales", String(data.salesCount)],
      ["Items sold", qty(data.itemsCount)],
    ];
    if (data.creditKobo > 0) {
      figures.push(["On credit (unpaid)", formatNaira(data.creditKobo)]);
    }
    if (data.discountKobo > 0) {
      figures.push(["Discounts given", formatNaira(data.discountKobo)]);
    }
    figures.push(["Profit", formatNaira(data.profitKobo)]);
    if (data.expensesKobo > 0) {
      figures.push(["Expenses", formatNaira(data.expensesKobo)]);
      figures.push(["Net (profit less expenses)", formatNaira(data.netKobo)]);
    }
    if (data.voidedCount > 0) {
      figures.push(["Voided sales", String(data.voidedCount)]);
    }
    parts.push(emailTable(figures));

    if (data.byCashier.length > 0) {
      parts.push(sectionHeading("By cashier"));
      // The cashier name sits in the label position so emailTable escapes it;
      // the amount+count on the right is trusted HTML we build here.
      parts.push(
        emailTable(
          data.byCashier.map(
            (c) =>
              [
                c.name,
                `${formatNaira(c.takenKobo)} <span style="color:#6a6a6a;font-weight:400;">(${
                  c.salesCount
                } ${c.salesCount === 1 ? "sale" : "sales"})</span>`,
              ] as [string, string],
          ),
        ),
      );
    }

    if (data.topProducts.length > 0) {
      parts.push(sectionHeading("Best sellers"));
      parts.push(
        emailTable(
          data.topProducts.map((p) => [p.name, formatNaira(p.amountKobo)] as [string, string]),
        ),
      );
    }
  }

  if (data.salesCount > 0 && data.byMethod.length > 0) {
    // Inserted after the figures: how the money came in (cash vs transfer vs POS).
    const idx = parts.findIndex((p) => p.includes("By cashier"));
    const block = [
      sectionHeading("How customers paid"),
      emailTable(
        data.byMethod.map(
          (m) => [m.label, `${formatNaira(m.amountKobo)} <span style="color:#6a6a6a;font-weight:400;">(${m.count})</span>`] as [string, string],
        ),
      ),
    ];
    if (idx >= 0) parts.splice(idx, 0, ...block);
    else parts.push(...block);
  }

  if (data.lowStockCount > 0) {
    parts.push(sectionHeading(`Running low (${data.lowStockCount})`));
    parts.push(emailTable(data.lowStock.map((p) => [p.name, `${qty(p.qty)} ${p.unit} left`] as [string, string])));
    if (data.lowStockCount > data.lowStock.length) {
      parts.push(`<p style="margin:4px 0 0;color:#6a6a6a;font-size:12px;">And ${data.lowStockCount - data.lowStock.length} more. Open "What to reorder" in the app for the full list.</p>`);
    }
  }

  if (data.expiringCount > 0) {
    parts.push(sectionHeading(`Expired or expiring within 30 days (${data.expiringCount})`));
    parts.push(
      emailTable(
        data.expiring.map(
          (e) => [e.name, `${qty(e.qty)} ${e.unit}, ${e.days < 0 ? `expired ${-e.days}d ago` : e.days === 0 ? "expires today" : `${e.days}d left`}`] as [string, string],
        ),
      ),
    );
  }

  const html = emailShell({
    heading: `${data.dayLabelShort} sales report`,
    preheader: `${formatNaira(data.revenueKobo)} across ${data.salesCount} ${
      data.salesCount === 1 ? "sale" : "sales"
    }.`,
    body: parts.join("\n"),
    footer:
      "Sent automatically at the close of day. You can change or switch off these reports in Settings.",
  });

  return { subject, html, text: renderDailyReportText(data) };
}

/**
 * The WhatsApp version — plain text, because this is the channel most owners
 * actually read. Bullets and bold are WhatsApp's own markup, not web chrome.
 */
export function renderDailyReportText(data: DailyReportData): string {
  const lines: string[] = [`*${data.orgName}*`, `Sales for ${data.dayLabel}`, ""];

  if (data.salesCount === 0) {
    lines.push("No sales were rung up on this day.");
    if (data.expensesKobo > 0) lines.push(`Expenses: ${formatNaira(data.expensesKobo)}`);
    return [...lines, ...stockLines(data)].join("\n");
  }

  lines.push(`Takings: ${formatNaira(data.revenueKobo)}`);
  lines.push(`Sales: ${data.salesCount}`);
  lines.push(`Items sold: ${qty(data.itemsCount)}`);
  if (data.creditKobo > 0) lines.push(`On credit: ${formatNaira(data.creditKobo)}`);
  if (data.discountKobo > 0) lines.push(`Discounts: ${formatNaira(data.discountKobo)}`);
  lines.push(`Profit: ${formatNaira(data.profitKobo)}`);
  if (data.expensesKobo > 0) {
    lines.push(`Expenses: ${formatNaira(data.expensesKobo)}`);
    lines.push(`Net: ${formatNaira(data.netKobo)}`);
  }
  if (data.voidedCount > 0) lines.push(`Voided: ${data.voidedCount}`);

  if (data.byCashier.length > 0) {
    lines.push("", "By cashier:");
    for (const c of data.byCashier) {
      lines.push(
        `• ${c.name}: ${formatNaira(c.takenKobo)} (${c.salesCount} ${
          c.salesCount === 1 ? "sale" : "sales"
        })`,
      );
    }
  }

  if (data.byMethod.length > 0) {
    lines.push("", "How customers paid:");
    for (const m of data.byMethod) lines.push(`• ${m.label}: ${formatNaira(m.amountKobo)} (${m.count})`);
  }

  if (data.topProducts.length > 0) {
    lines.push("", "Best sellers:");
    for (const p of data.topProducts) {
      lines.push(`• ${p.name}: ${formatNaira(p.amountKobo)}`);
    }
  }

  return [...lines, ...stockLines(data)].join("\n");
}

function stockLines(data: DailyReportData): string[] {
  const out: string[] = [];
  if (data.lowStockCount > 0) {
    out.push("", `*Running low (${data.lowStockCount}):*`);
    for (const p of data.lowStock) out.push(`• ${p.name}: ${qty(p.qty)} ${p.unit} left`);
    if (data.lowStockCount > data.lowStock.length) out.push(`and ${data.lowStockCount - data.lowStock.length} more`);
  }
  if (data.expiringCount > 0) {
    out.push("", `*Expiring soon (${data.expiringCount}):*`);
    for (const e of data.expiring) {
      out.push(`• ${e.name}: ${qty(e.qty)} ${e.unit}, ${e.days < 0 ? `expired ${-e.days}d ago` : e.days === 0 ? "expires today" : `${e.days}d left`}`);
    }
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// Sending
// ─────────────────────────────────────────────────────────────────────────────

export interface DailyReportChannelResult {
  channel: "EMAIL" | "WHATSAPP";
  status: "SENT" | "FAILED" | "SKIPPED";
  recipients: string[];
  reason?: string;
}

export interface DailyReportSendResult {
  dayKey: string;
  /** False when a gate stopped it before any send was attempted. */
  attempted: boolean;
  reason?: string;
  channels: DailyReportChannelResult[];
}

/**
 * Send today's report for one organization.
 *
 * `force` is the "Send now" button in Settings: it ignores both the on/off
 * switch and the idempotency guard, so an owner can pull the current figures on
 * demand and re-pull after a correction. The nightly cron never forces, so it
 * can run as often as it likes without ever double-sending.
 */
export async function sendDailyReport(
  organizationId: string,
  options: { now?: Date; force?: boolean } = {},
): Promise<DailyReportSendResult> {
  const now = options.now ?? new Date();
  const force = options.force ?? false;

  const org = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: {
      name: true,
      timezone: true,
      email: true,
      phone: true,
      whatsapp: true,
      settings: {
        select: {
          dailyReportEnabled: true,
          reportChannel: true,
          reportEmail: true,
          reportWhatsapp: true,
          reportToAllAdmins: true,
        },
      },
    },
  });

  if (!org) {
    return { dayKey: "", attempted: false, reason: "That organization no longer exists.", channels: [] };
  }

  const tz = org.timezone;
  const dayKey = isoDateInZone(now, tz);
  const settings = org.settings;

  if (!force && !(settings?.dailyReportEnabled ?? true)) {
    return {
      dayKey,
      attempted: false,
      reason: "Daily reports are switched off for this shop.",
      channels: [],
    };
  }

  const channelPref = settings?.reportChannel ?? "EMAIL";
  if (channelPref === "NONE") {
    return { dayKey, attempted: false, reason: "No delivery channel is selected.", channels: [] };
  }

  const wantsEmail = channelPref === "EMAIL" || channelPref === "BOTH";
  const wantsWhatsApp = channelPref === "WHATSAPP" || channelPref === "BOTH";

  // Base recipients come from the report-specific fields, falling back to the
  // organization's own contact details. `reportToAllAdmins` then copies in every
  // active main admin on top.
  let adminEmails: string[] = [];
  let adminPhones: string[] = [];
  if (settings?.reportToAllAdmins) {
    const admins = await prisma.user.findMany({
      where: { organizationId, role: "MAIN_ADMIN", isActive: true },
      select: { email: true, phone: true },
    });
    adminEmails = admins.map((a) => a.email ?? "").filter(Boolean);
    adminPhones = admins.map((a) => a.phone ?? "").filter(Boolean);
  }

  const emails = dedupe(
    [
      ...(settings?.reportEmail ? [settings.reportEmail] : org.email ? [org.email] : []),
      ...adminEmails,
    ].filter((e) => e.includes("@")),
  );

  const phones = dedupe(
    [
      ...(settings?.reportWhatsapp ? [settings.reportWhatsapp] : org.whatsapp ? [org.whatsapp] : []),
      ...adminPhones,
    ]
      .map((p) => normalizeNigerianPhone(p))
      .filter((p): p is string => Boolean(p)),
  );

  const data = await buildDailyReport(organizationId, now, tz);
  const channels: DailyReportChannelResult[] = [];

  if (wantsEmail) {
    const { subject, html, text } = renderDailyReportEmail(data);
    channels.push(
      await deliverChannel(organizationId, dayKey, "EMAIL", emails, force, data, now, () =>
        sendMail({ to: emails, subject, html, text }),
      ),
    );
  }

  if (wantsWhatsApp) {
    const text = renderDailyReportText(data);
    channels.push(
      await deliverChannel(organizationId, dayKey, "WHATSAPP", phones, force, data, now, async () => {
        const results = await Promise.all(phones.map((p) => sendWhatsAppText(p, text)));
        const delivered = results.some((r) => r.delivered);
        return {
          delivered,
          channel: "WHATSAPP",
          reason: delivered ? undefined : results.find((r) => r.reason)?.reason ?? "No recipient.",
        };
      }),
    );
  }

  return { dayKey, attempted: true, channels };
}

/**
 * Deliver one channel and record it in ReportLog, which is also the idempotency
 * guard: once a (org, day, channel) is SENT, a non-forced retry skips it. The
 * log is written whether delivery succeeded or failed, so a shop owner looking
 * at Settings can see "WhatsApp failed last night: number not connected" rather
 * than silence.
 */
async function deliverChannel(
  organizationId: string,
  dayKey: string,
  channel: "EMAIL" | "WHATSAPP",
  recipients: string[],
  force: boolean,
  data: DailyReportData,
  sentAt: Date,
  send: () => Promise<DeliveryResult>,
): Promise<DailyReportChannelResult> {
  const key = {
    organizationId_period_periodKey_channel: {
      organizationId,
      period: "DAILY",
      periodKey: dayKey,
      channel,
    },
  };

  if (!force) {
    const existing = await prisma.reportLog.findUnique({
      where: key,
      select: { status: true },
    });
    if (existing?.status === "SENT") {
      return { channel, status: "SKIPPED", recipients, reason: "Already sent today." };
    }
  }

  const result: DeliveryResult =
    recipients.length === 0
      ? {
          delivered: false,
          channel,
          reason:
            channel === "EMAIL"
              ? "No email address configured."
              : "No WhatsApp number configured.",
        }
      : await send();

  const recipient = recipients.join(", ").slice(0, 500) || "—";
  const row = {
    recipient,
    status: result.delivered ? "SENT" : "FAILED",
    errorMessage: result.reason ?? null,
    sentAt: result.delivered ? sentAt : null,
    payloadJson: JSON.stringify(data),
  };

  await prisma.reportLog.upsert({
    where: key,
    create: { organizationId, period: "DAILY", periodKey: dayKey, channel, ...row },
    update: row,
  });

  return {
    channel,
    status: result.delivered ? "SENT" : "FAILED",
    recipients,
    reason: result.reason,
  };
}

function dedupe<T>(values: T[]): T[] {
  return [...new Set(values)];
}

