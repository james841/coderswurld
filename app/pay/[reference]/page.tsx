import Link from "next/link";
import { CheckCircle2, Clock, ShieldCheck } from "lucide-react";

import { getPlan } from "@/lib/constants";
import { prisma } from "@/lib/db";
import { formatNaira } from "@/lib/money";
import { checkPayToken, paymentDetails } from "@/lib/payment";
import { Logo } from "@/components/Logo";

import { PaidForm } from "./PaidForm";

/**
 * /pay/CW-0012?t=...: the page behind "I've made the payment" in the email.
 * Shows what to pay and where, and takes the customer's payment notice.
 */

export const dynamic = "force-dynamic";
export const metadata = { title: "Confirm your payment", robots: { index: false, follow: false } };

export default async function PayPage({
  params,
  searchParams,
}: {
  params: Promise<{ reference: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { reference } = await params;
  const sp = await searchParams;
  const token = typeof sp.t === "string" ? sp.t : null;

  const lead = await prisma.lead.findUnique({
    where: { reference: decodeURIComponent(reference) },
    select: {
      id: true,
      reference: true,
      companyName: true,
      contactName: true,
      plan: true,
      quotedKobo: true,
      status: true,
      paymentClaimedAt: true,
      paymentSenderName: true,
      paymentAmountKobo: true,
    },
  });
  const valid = lead && checkPayToken(lead.id, token);
  const bank = paymentDetails();

  return (
    <div className="texture-waves-ink min-h-dvh bg-canvas">
      <header className="texture-waves bg-navy-700">
        <div className="mx-auto flex h-16 max-w-3xl items-center px-4">
          <Logo inverted />
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 py-8 sm:py-12">
        {!valid ? (
          <Card>
            <h1 className="text-2xl font-bold text-ink-950">This link doesn&apos;t work</h1>
            <p className="mt-2 text-ink-600">
              Please use the <strong>I&apos;ve made the payment</strong> button in the email we sent you, or reply to
              that email and we&apos;ll sort it out.
            </p>
            <Link href="/" className="btn btn-outline mt-5">
              Go to the home page
            </Link>
          </Card>
        ) : (
          <Body lead={lead} token={token!} bank={bank} />
        )}
      </main>
    </div>
  );
}

function Body({
  lead,
  token,
  bank,
}: {
  lead: {
    reference: string;
    companyName: string;
    contactName: string;
    plan: string;
    quotedKobo: number;
    status: string;
    paymentClaimedAt: Date | null;
    paymentSenderName: string | null;
    paymentAmountKobo: number | null;
  };
  token: string;
  bank: ReturnType<typeof paymentDetails>;
}) {
  const plan = getPlan(lead.plan);
  const amountKobo = lead.quotedKobo || plan.priceKobo;

  if (lead.status === "PROVISIONED") {
    return (
      <Card>
        <CheckCircle2 className="size-10 text-good-700" />
        <h1 className="mt-3 text-2xl font-bold text-ink-950">Your account is active</h1>
        <p className="mt-2 text-ink-600">
          We&apos;ve emailed your main admin login. Check your inbox (and spam folder) for it.
        </p>
        <Link href="/signin" className="btn btn-primary mt-5">
          Sign in
        </Link>
      </Card>
    );
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
      <div className="space-y-4">
        <Card>
          <p className="text-xs font-bold uppercase tracking-[0.14em] text-brand-700">Plan request {lead.reference}</p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight text-ink-950">{lead.companyName}</h1>
          <div className="mt-4 rounded-2xl border border-brand-200 bg-brand-50 p-4">
            <p className="text-xs font-bold uppercase tracking-wider text-brand-800">Amount to pay</p>
            <p className="tabular mt-1 text-3xl font-extrabold tracking-tight text-ink-950">{formatNaira(amountKobo)}</p>
            <p className="text-sm text-brand-900">{plan.name} plan, 12 months. No monthly charge.</p>
          </div>
        </Card>

        {bank ? (
          <div className="texture-waves rounded-3xl bg-navy-700 p-5 text-white shadow-[var(--shadow-raised)]">
            <p className="text-xs font-bold uppercase tracking-wider text-brand-300">Pay by bank transfer</p>
            <dl className="mt-3 divide-y divide-white/15 text-sm">
              <Row k="Bank" v={bank.bank} />
              <Row k="Account name" v={bank.accountName} />
              <Row k="Account number" v={bank.accountNumber} big />
              <Row k="Narration" v={lead.reference} />
            </dl>
          </div>
        ) : null}

        <p className="flex items-start gap-2 text-xs text-ink-500">
          <ShieldCheck className="mt-0.5 size-4 shrink-0 text-good-700" />
          We only ever take payment by bank transfer to the account above. We will never ask for your card details or PIN.
        </p>
      </div>

      <Card>
        {lead.paymentClaimedAt ? (
          <div className="mb-5 flex items-start gap-3 rounded-2xl bg-good-50 p-4 text-good-700">
            <Clock className="mt-0.5 size-5 shrink-0" />
            <p className="text-sm">
              <strong>We&apos;ve got your payment notice</strong>
              {lead.paymentAmountKobo ? ` for ${formatNaira(lead.paymentAmountKobo)}` : ""}
              {lead.paymentSenderName ? ` from ${lead.paymentSenderName}` : ""}. We&apos;re confirming it now and will email
              your login. You can send it again below if something changed.
            </p>
          </div>
        ) : null}
        <h2 className="text-lg font-bold text-ink-950">Tell us you&apos;ve paid</h2>
        <p className="mt-1 text-sm text-ink-600">
          After your transfer, fill this in so we can find it in our bank quickly. We&apos;ll email your login once
          it&apos;s confirmed.
        </p>
        <PaidForm reference={lead.reference} token={token} defaultAmount={String(amountKobo / 100)} contactName={lead.contactName} />
      </Card>
    </div>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return <section className="card rounded-3xl p-6">{children}</section>;
}

function Row({ k, v, big }: { k: string; v: string; big?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-4 py-2.5">
      <dt className="text-navy-100">{k}</dt>
      <dd className={big ? "font-mono text-xl font-extrabold tracking-[0.12em]" : "font-semibold"}>{v}</dd>
    </div>
  );
}
