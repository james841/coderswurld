import { ConsoleHeading } from "../../ConsoleHeading";
import { CheckCircle2, Mail, XCircle, AlertTriangle } from "lucide-react";

import { prisma } from "@/lib/db";
import { emailSetup, explainMailError } from "@/lib/mail";
import { EmailTest } from "./EmailTest";

export const dynamic = "force-dynamic";
export const metadata = { title: "Email" };

function Row({ label, value, state }: { label: string; value: string; state: "good" | "bad" | "warn" | "plain" }) {
  const Icon = state === "good" ? CheckCircle2 : state === "bad" ? XCircle : state === "warn" ? AlertTriangle : null;
  const tone =
    state === "good" ? "text-good-700" : state === "bad" ? "text-bad-700" : state === "warn" ? "text-warn-700" : "text-ink-500";
  return (
    <div className="flex items-start justify-between gap-4 border-b border-ink-100 py-3 last:border-0">
      <span className="text-sm text-ink-600">{label}</span>
      <span className={`flex items-center gap-1.5 text-right text-sm font-semibold ${tone}`}>
        {Icon && <Icon className="size-4 shrink-0" />}
        <span className="break-all">{value || "Not set"}</span>
      </span>
    </div>
  );
}

export default async function EmailPage() {
  const setup = emailSetup();
  const logs = await prisma.emailLog.findMany({ orderBy: { createdAt: "desc" }, take: 30 });
  const failed = logs.filter((l) => !l.ok).length;

  const problems: string[] = [];
  if (!setup.keySet) problems.push("RESEND_API_KEY is empty, so no email can be sent. Add it in Vercel and in .env, then redeploy.");
  else if (!setup.keyLooksRight) problems.push("RESEND_API_KEY does not start with re_. Copy the key again from Resend, API Keys.");
  if (setup.mailFromIsPlaceholder)
    problems.push("MAIL_FROM still says yourdomain.com from the example file. Change it to an address on the domain you verified in Resend.");
  if (setup.usingTestSender)
    problems.push("You are sending from onboarding@resend.dev. Resend only lets that address send to your own Resend sign-up email, so customers get nothing. Verify your domain in Resend and set MAIL_FROM.");
  if (!setup.appUrl) problems.push("NEXT_PUBLIC_APP_URL is empty, so links and the logo in emails point to the wrong site. Set it to your live address.");

  return (
    <div className="space-y-6">
      <ConsoleHeading icon={Mail} title="Email">
          Check your email setup, send yourself a test, and see every email the app sent.
        </ConsoleHeading>

      {problems.length > 0 && (
        <div className="space-y-2 rounded-2xl border border-bad-100 bg-bad-50 p-4">
          <p className="flex items-center gap-2 font-bold text-bad-700">
            <XCircle className="size-5" /> Fix {problems.length === 1 ? "this" : "these"} first
          </p>
          <ul className="list-disc space-y-1 pl-6 text-sm text-bad-700">
            {problems.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="card p-5">
          <h2 className="mb-2 font-bold text-ink-950">Current setup</h2>
          <Row label="Sending with" value={setup.provider} state={setup.keySet ? "good" : "bad"} />
          <Row
            label="Resend API key"
            value={setup.keySet ? setup.keyHint : ""}
            state={!setup.keySet ? "bad" : setup.keyLooksRight ? "good" : "warn"}
          />
          <Row
            label="Sending from (MAIL_FROM)"
            value={setup.from}
            state={setup.usingTestSender || setup.mailFromIsPlaceholder ? "bad" : "good"}
          />
          <Row label="Domain to verify in Resend" value={setup.fromDomain} state="plain" />
          <Row label="Replies go to" value={setup.replyTo} state={setup.replyTo ? "good" : "warn"} />
          <Row label="Your alerts go to" value={setup.salesInbox} state={setup.salesInbox ? "good" : "warn"} />
          <Row label="Site address in emails" value={setup.appUrl} state={setup.appUrl ? "good" : "warn"} />
        </section>

        <section className="card p-5">
          <h2 className="mb-1 font-bold text-ink-950">Send a test email</h2>
          <p className="mb-4 text-sm text-ink-600">
            Use an address that is not your Resend sign-up email. That is the real test: it is what your customers get.
          </p>
          <EmailTest defaultTo={setup.salesInbox} />
        </section>
      </div>

      <section className="card overflow-hidden">
        <div className="flex items-center justify-between border-b border-ink-100 p-5">
          <h2 className="flex items-center gap-2 font-bold text-ink-950">
            <Mail className="size-5" /> Recent emails
          </h2>
          {logs.length > 0 && (
            <span className={`badge ${failed ? "badge-bad" : "badge-good"}`}>
              {failed ? `${failed} of ${logs.length} failed` : "All sent"}
            </span>
          )}
        </div>
        {logs.length === 0 ? (
          <p className="p-5 text-sm text-ink-500">No emails yet. Emails sent from now on show here.</p>
        ) : (
          <ul className="divide-y divide-ink-100">
            {logs.map((l) => {
              const fix = l.ok ? null : explainMailError(l.error);
              return (
                <li key={l.id} className="flex items-start gap-3 px-5 py-3.5">
                  {l.ok ? (
                    <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-good-700" />
                  ) : (
                    <XCircle className="mt-0.5 size-5 shrink-0 text-bad-700" />
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-ink-950">{l.subject}</p>
                    <p className="truncate text-xs text-ink-500">To {l.to}</p>
                    {!l.ok && <p className="mt-1 font-mono text-xs text-bad-700">{l.error}</p>}
                    {fix && <p className="mt-1 text-xs font-semibold text-ink-700">{fix}</p>}
                  </div>
                  <time className="shrink-0 text-xs text-ink-500">
                    {l.createdAt.toLocaleString("en-NG", { timeZone: "Africa/Lagos", dateStyle: "medium", timeStyle: "short" })}
                  </time>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
