"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
import { useState } from "react";
import {
  CheckCircle2,
  Clock,
  Loader2,
  MinusCircle,
  Send,
  TriangleAlert,
  XCircle,
} from "lucide-react";

/**
 * The end-of-day report, and its live state for today.
 *
 * This is the one reporting feature the brief named outright — "today's sales
 * by cashier to the main admin by email or WhatsApp." The server does the
 * sending (on a nightly timer, or on demand); this card is where the owner sees
 * that it's set up, whether tonight's already gone out, and a button to pull it
 * this instant.
 *
 * "Send now" forces a send regardless of the nightly switch or the once-a-day
 * guard — an owner correcting a mis-rung sale wants the fresh figures again, now.
 * After it lands we refresh the route so the status below reflects the new
 * attempt from the source of truth, not from optimistic client state.
 */

export interface DailyReportStatus {
  /** "NONE" | "EMAIL" | "WHATSAPP" | "BOTH" */
  channel: string;
  enabled: boolean;
  /** "HH:MM", 24-hour. */
  reportTime: string;
  hasEmail: boolean;
  hasWhatsapp: boolean;
  /** Pre-formatted in the shop's timezone by the server. */
  todayLabel: string;
  logs: Array<{
    channel: "EMAIL" | "WHATSAPP";
    status: "SENT" | "FAILED" | "PENDING";
    recipient: string;
    sentAt: string | null;
    errorMessage: string | null;
  }>;
}

/** Mirror of the API's response — declared here so this file pulls in no server code. */
interface SendResult {
  attempted: boolean;
  reason?: string;
  channels: Array<{
    channel: "EMAIL" | "WHATSAPP";
    status: "SENT" | "FAILED" | "SKIPPED";
    recipients: string[];
    reason?: string;
  }>;
}

type SendState =
  | { kind: "idle" }
  | { kind: "sending" }
  | { kind: "error"; message: string }
  | { kind: "result"; data: SendResult };

export function DailyReportCard({ status }: { status: DailyReportStatus }) {
  const router = useRouter();
  const [send, setSend] = useState<SendState>({ kind: "idle" });

  async function sendNow() {
    setSend({ kind: "sending" });
    try {
      const res = await fetch("/api/reports/daily", { method: "POST" });
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        setSend({
          kind: "error",
          message: json?.error ?? "Could not send the report. Please try again.",
        });
        return;
      }
      setSend({ kind: "result", data: json as SendResult });
      router.refresh();
    } catch {
      setSend({
        kind: "error",
        message: "Could not reach the server. Check your connection and try again.",
      });
    }
  }

  const sending = send.kind === "sending";
  const warnings = missingContactWarnings(status);

  return (
    <section className="card card-pad">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <h2 className="text-base font-bold text-ink-900">End-of-day report</h2>
          <p className="mt-0.5 text-sm text-ink-500">{channelSummary(status)}</p>
        </div>
        <button
          type="button"
          onClick={sendNow}
          disabled={sending}
          className="btn btn-dark btn-sm"
        >
          {sending ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Send className="size-4" />
          )}
          {sending ? "Sending…" : "Send now"}
        </button>
      </div>

      {warnings.length > 0 ? (
        <div className="mt-3 flex items-start gap-2 rounded-lg border border-warn-200 bg-warn-50 px-3 py-2 text-sm text-warn-700">
          <TriangleAlert className="mt-0.5 size-4 shrink-0" />
          <div>
            {warnings.map((w) => (
              <p key={w}>{w}</p>
            ))}
            <Link href="/settings" className="font-semibold underline underline-offset-2">
              Add it in Settings
            </Link>
          </div>
        </div>
      ) : null}

      {/* Immediate feedback from a "Send now" click. The log list below is the
          authoritative record once the route refreshes. */}
      {send.kind === "error" ? (
        <p className="mt-3 rounded-lg border border-bad-200 bg-bad-50 px-3 py-2 text-sm text-bad-700">
          {send.message}
        </p>
      ) : null}
      {send.kind === "result" && !send.data.attempted ? (
        <p className="mt-3 rounded-lg border border-warn-200 bg-warn-50 px-3 py-2 text-sm text-warn-700">
          {send.data.reason ?? "Nothing was sent."}
        </p>
      ) : null}
      {send.kind === "result" && send.data.attempted ? (
        <ul className="mt-3 space-y-1.5">
          {send.data.channels.map((c) => (
            <StatusLine
              key={c.channel}
              channel={c.channel}
              status={c.status}
              detail={
                c.status === "SENT"
                  ? `sent to ${c.recipients.join(", ")}`
                  : c.status === "SKIPPED"
                    ? (c.reason ?? "skipped")
                    : `failed: ${c.reason ?? "unknown error"}`
              }
            />
          ))}
        </ul>
      ) : null}

      {/* Today's record, straight from the delivery log. */}
      <div className="mt-4 border-t border-hairline pt-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-ink-400">
          Today, {status.todayLabel}
        </p>
        {status.logs.length === 0 ? (
          <p className="mt-1.5 text-sm text-ink-500">Not sent yet today.</p>
        ) : (
          <ul className="mt-1.5 space-y-1.5">
            {status.logs.map((l) => (
              <StatusLine
                key={l.channel}
                channel={l.channel}
                status={l.status}
                detail={
                  l.status === "SENT"
                    ? `sent to ${l.recipient}`
                    : l.status === "PENDING"
                      ? "queued"
                      : `failed: ${l.errorMessage ?? "unknown error"}`
                }
              />
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

/** One channel's outcome: a coloured icon, the channel, and a plain detail. */
function StatusLine({
  channel,
  status,
  detail,
}: {
  channel: "EMAIL" | "WHATSAPP";
  status: "SENT" | "FAILED" | "SKIPPED" | "PENDING";
  detail: string;
}) {
  const label = channel === "WHATSAPP" ? "WhatsApp" : "Email";
  return (
    <li className="flex items-start gap-2 text-sm">
      {status === "SENT" ? (
        <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-good-700" />
      ) : status === "FAILED" ? (
        <XCircle className="mt-0.5 size-4 shrink-0 text-bad-700" />
      ) : status === "PENDING" ? (
        <Clock className="mt-0.5 size-4 shrink-0 text-ink-400" />
      ) : (
        <MinusCircle className="mt-0.5 size-4 shrink-0 text-ink-400" />
      )}
      <span className="min-w-0">
        <span className="font-medium text-ink-900">{label}</span>{" "}
        <span className="text-ink-500">{detail}</span>
      </span>
    </li>
  );
}

/** "Sent automatically at 9:00 pm by email." — or that it's switched off. */
function channelSummary(status: DailyReportStatus): string {
  if (!status.enabled || status.channel === "NONE") {
    return "Automatic reports are off. Send one now, or switch them on in Settings.";
  }
  const where =
    status.channel === "BOTH"
      ? "by email and on WhatsApp"
      : status.channel === "WHATSAPP"
        ? "on WhatsApp"
        : "by email";
  return `Sent automatically at ${prettyTime(status.reportTime)} ${where}.`;
}

/** Which configured channels have nowhere to send to. */
function missingContactWarnings(status: DailyReportStatus): string[] {
  if (!status.enabled || status.channel === "NONE") return [];
  const out: string[] = [];
  const wantsEmail = status.channel === "EMAIL" || status.channel === "BOTH";
  const wantsWhatsApp = status.channel === "WHATSAPP" || status.channel === "BOTH";
  if (wantsEmail && !status.hasEmail) out.push("No email address is set for reports.");
  if (wantsWhatsApp && !status.hasWhatsapp) out.push("No WhatsApp number is set for reports.");
  return out;
}

/** "21:00" → "9:00 pm". Falls back to the raw value if it isn't a time. */
function prettyTime(hhmm: string): string {
  const match = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  if (!match) return hhmm;
  let hour = Number(match[1]);
  const period = hour >= 12 ? "pm" : "am";
  hour = hour % 12;
  if (hour === 0) hour = 12;
  return `${hour}:${match[2]} ${period}`;
}
