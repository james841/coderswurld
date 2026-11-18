import { NextResponse } from "next/server";

import { AppError, handle } from "@/lib/api";
import { prisma } from "@/lib/db";
import { sendDailyReport, type DailyReportSendResult } from "@/lib/reports";

/** Big files and many shops take longer than an ordinary request (seconds). */
export const maxDuration = 60;

/**
 * GET /api/cron/daily-reports — the nightly sweep.
 *
 * One scheduler hits this; it fans out to every shop whose local clock has
 * reached its chosen close-of-day time. Call it with:
 *
 *   Authorization: Bearer <CRON_SECRET>
 *
 * CLOSED BY DEFAULT. With no CRON_SECRET set the endpoint answers 503, never an
 * open door. An unauthenticated hit is a flat 401 — this triggers real emails
 * and WhatsApp messages, so it is not something the public internet gets to do.
 *
 * SAFE TO CALL OFTEN. The scheduler can fire this every fifteen minutes all
 * evening; the first run past a shop's report time sends, and every run after it
 * that same day finds the ReportLog already SENT and skips. So the operator
 * tunes frequency for timeliness, not correctness — more frequent just means a
 * report lands closer to the minute the shop actually chose.
 *
 * WHY WALL-CLOCK, NOT A STORED "NEXT RUN". "21:00" is a preference a shop keeps
 * through daylight-saving and timezone moves, not an instant. So each sweep asks
 * Intl what time it is *in that shop's zone* right now and compares strings —
 * no per-org timer to drift, nothing to recompute when a shop changes its hours.
 */

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return handle(async () => {
    const secret = process.env.CRON_SECRET?.trim();
    if (!secret) {
      throw new AppError("Scheduled jobs are not configured.", { status: 503 });
    }

    const header = request.headers.get("authorization") ?? "";
    const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
    if (token !== secret) {
      throw new AppError("Not authorized.", { status: 401 });
    }

    // One instant for the whole sweep, so two shops in the same zone are judged
    // against the same clock.
    const now = new Date();

    const rows = await prisma.orgSettings.findMany({
      where: {
        dailyReportEnabled: true,
        reportChannel: { not: "NONE" },
        organization: { status: "ACTIVE" },
      },
      select: {
        organizationId: true,
        reportTime: true,
        organization: { select: { timezone: true } },
      },
    });

    const results: DailyReportSendResult[] = [];
    let due = 0;
    let delivered = 0;

    for (const row of rows) {
      const localNow = localHHMM(now, row.organization.timezone);
      if (localNow < normalizeTime(row.reportTime)) continue; // not close of day yet

      due++;
      const result = await sendDailyReport(row.organizationId, { now });
      results.push(result);
      if (result.channels.some((c) => c.status === "SENT")) delivered++;
    }

    return NextResponse.json({ ok: true, checked: rows.length, due, delivered, results });
  });
}

/** "HH:MM" in a given zone right now. Midnight renders as "24:00" in some engines. */
function localHHMM(now: Date, timeZone: string): string {
  const hhmm = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(now);
  return hhmm.startsWith("24") ? `00${hhmm.slice(2)}` : hhmm;
}

/** Make a stored report time safe to compare as a string: zero-pad, fall back. */
function normalizeTime(value: string): string {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return "21:00";
  const hour = Math.min(23, Number(match[1]));
  return `${String(hour).padStart(2, "0")}:${match[2]}`;
}
