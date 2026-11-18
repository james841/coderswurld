import Link from "next/link";
import { siteUrl } from "@/lib/site";
import { TrackView } from "@/components/TrackView";
import {
  ArrowRight,
  BadgeCheck,
  BellRing,
  Check,
  CreditCard,
  FileSpreadsheet,
  FolderOpen,
  Printer,
  ScanBarcode,
  ShieldCheck,
  TrendingUp,
  WifiOff,
} from "lucide-react";

import { Logo } from "@/components/Logo";
import { HeroArc } from "@/components/landing/HeroArc";
import { LandingNav, ScrollToTop } from "@/components/landing/LandingNav";
import { ShopScene } from "@/components/landing/ShopScene";
import { PlanRequestForm } from "@/components/landing/PlanRequestForm";
import { Reveal, Stagger, StaggerItem } from "@/components/motion";
import { PLANS, PLAN_ORDER, UNLIMITED } from "@/lib/constants";
import { formatNaira } from "@/lib/money";

export const metadata = {
  title: "Inventory & POS for Nigerian supermarkets and pharmacies",
  alternates: { canonical: "/" },
};

/**
 * Public landing page.
 *
 * Fully static — no database, no session, nothing to await. It renders at build
 * time and is served from the edge cache, so the first thing a prospective
 * customer sees is instant even on a bad connection.
 *
 * There is not a single image file on this page. Every picture is markup, which
 * is why it stays fast on mobile data. Motion is layered on top (components/
 * motion): the page is complete and readable before any of it loads.
 *
 * THE PAGE HAS ONE JOB
 * --------------------
 * Get a shop owner to the plan form. So the order is: what it is → proof it
 * fits their shop → what it costs → the form. Every button on the page leads to
 * pricing or to the form, and nothing else competes with them.
 */
const FAQS = [
  {
    q: "What happens if the internet goes off while we're selling?",
    a: "Nothing stops. The till holds your whole product list locally, so scanning, selling, calculating change and printing receipts all keep working. Sales queue up and upload themselves when the connection returns, and the system makes sure a queued sale can never be recorded twice.",
  },
  {
    q: "Do I need a special barcode scanner?",
    a: "No. Any USB or Bluetooth scanner works, because scanners simply type the code like a keyboard. If a product has no barcode on the pack, you can generate one in the system and print your own label.",
  },
  {
    q: "Can I stop a cashier from seeing what I paid for goods?",
    a: "Yes. Cost price is a separate permission from viewing products, so cashiers and sub-admins can sell from the catalog without ever seeing your margins. A main admin controls each permission individually.",
  },
  {
    q: "How do I get my existing products in?",
    a: "Import them from Excel. You can upload the list first and attach barcodes afterwards, one scan at a time, so you're not blocked waiting to label everything up front.",
  },
  {
    q: "We run a supermarket and a pharmacy. Can cashiers be kept apart?",
    a: "Yes. Turn on departments in Settings, mark products as Supermarket or Pharmacy, and assign each cashier to one. A pharmacy cashier only sees pharmacy products at the till, and the system refuses to let them sell anything else. Admins and managers see both.",
  },
  {
    q: "Is there really no monthly fee?",
    a: "No monthly fee. You pay once for the year, upfront, by bank transfer. We'll remind you before it runs out.",
  },
  {
    q: "Can I use it on more than one till?",
    a: "Yes. Every plan includes unlimited cashier accounts, and each till stays in sync.",
  },
];


/**
 * Structured data for Google: what the product is, who makes it, what it
 * costs (the real plan prices) and the FAQ. Helps the search listing show
 * prices and questions directly. Nothing here that the page doesn't say.
 */
function StructuredData() {
  const base = siteUrl();
  const data = [
    {
      "@context": "https://schema.org",
      "@type": "SoftwareApplication",
      name: "Coderswurld Inventory",
      url: base,
      applicationCategory: "BusinessApplication",
      operatingSystem: "Web, Windows, Android, iOS",
      description:
        "Inventory management and point of sale for supermarkets, mini marts and pharmacies in Nigeria. Works offline, scans barcodes, tracks expiry dates and shows profit every day.",
      offers: PLAN_ORDER.map((id) => ({
        "@type": "Offer",
        name: `${PLANS[id].name} plan`,
        price: (PLANS[id].priceKobo / 100).toFixed(2),
        priceCurrency: "NGN",
        category: "Yearly subscription",
        url: `${base}/#pricing`,
      })),
    },
    {
      "@context": "https://schema.org",
      "@type": "Organization",
      name: "Coderswurld",
      url: base,
      logo: `${base}/icons/icon-512.png`,
      ...(process.env.SUPPORT_EMAIL || process.env.SUPPORT_PHONE
        ? {
            contactPoint: {
              "@type": "ContactPoint",
              contactType: "sales",
              areaServed: "NG",
              ...(process.env.SUPPORT_EMAIL ? { email: process.env.SUPPORT_EMAIL } : {}),
              ...(process.env.SUPPORT_PHONE ? { telephone: process.env.SUPPORT_PHONE } : {}),
            },
          }
        : {}),
    },
    {
      "@context": "https://schema.org",
      "@type": "FAQPage",
      mainEntity: FAQS.map((f) => ({
        "@type": "Question",
        name: f.q,
        acceptedAnswer: { "@type": "Answer", text: f.a },
      })),
    },
  ];
  return (
    <script
      type="application/ld+json"
      // JSON from our own constants; "<" escaped so it can't close the tag.
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data).replace(/</g, "\\u003c") }}
    />
  );
}

export default function LandingPage() {
  return (
    <>
      <StructuredData />
      <LandingNav />
      <TrackView />
      <main className="bg-white">
        <Hero />
        <ProofStrip />
        <InsideTheApp />
        <Features />
        <Departments />
        <HowItWorks />
        <Poster />
        <Pricing />
        <RequestSection />
        <Faq />
      </main>
      <SiteFooter />
      <ScrollToTop />
    </>
  );
}

const EYEBROW = "text-xs font-bold uppercase tracking-[0.14em] text-brand-700";
const H2 = "mt-2 text-3xl font-bold tracking-tight text-ink-950 sm:text-4xl";
const LEAD = "mt-3 text-base leading-relaxed text-ink-600 sm:text-lg";

/* ═══════════════════════════════════════════════════════════════════════════
   NAV
   ═══════════════════════════════════════════════════════════════════════════ */

/* ═══════════════════════════════════════════════════════════════════════════
   HERO
   ═══════════════════════════════════════════════════════════════════════════ */

function Hero() {
  return (
    <section className="texture-waves relative overflow-hidden bg-navy-700 text-white">
      <div className="mx-auto grid max-w-6xl items-end gap-8 px-4 pb-0 pt-28 sm:pt-32 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)] lg:pt-36">
        <Stagger className="pb-4 text-center lg:self-center lg:pb-24 lg:text-left" gap={0.08}>
          <StaggerItem>
            <span className="inline-flex items-center gap-2 rounded-full bg-white/12 px-3.5 py-1.5 text-xs font-bold text-white ring-1 ring-white/20">
              <span className="size-1.5 rounded-full bg-brand-400" aria-hidden />
              One yearly payment &middot; no monthly fees
            </span>
          </StaggerItem>
          <StaggerItem>
            <h1 className="mt-5 text-4xl font-bold leading-[1.04] tracking-tight sm:text-6xl">
              Sell faster. Count less.{" "}
              <span className="text-brand-300">Know every naira.</span>
            </h1>
          </StaggerItem>
          <StaggerItem>
            <p className="mx-auto mt-5 max-w-xl text-base leading-relaxed text-navy-100 sm:text-lg lg:mx-0">
              Inventory and point of sale for Nigerian supermarkets, mini marts and pharmacies.
              Scan, sell and print a receipt in seconds, even when the network is down.
            </p>
          </StaggerItem>
          <StaggerItem>
            <div className="mt-7 flex flex-wrap items-center justify-center gap-3 lg:justify-start">
              <a href="#pricing" className="btn btn-primary btn-lg rounded-full px-7">
                Choose a plan
                <ArrowRight className="size-4" />
              </a>
              <a
                href="#how"
                className="btn btn-lg rounded-full border border-white/30 bg-transparent px-7 text-white hover:bg-white/10"
              >
                See how it works
              </a>
            </div>
          </StaggerItem>
          <StaggerItem>
            <ul className="mt-7 flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-sm font-semibold text-white/90 lg:justify-start">
              {["Works offline", "Barcode scanning", "Unlimited cashiers"].map((item) => (
                <li key={item} className="inline-flex items-center gap-1.5">
                  <Check className="size-4 text-brand-300" strokeWidth={3} />
                  {item}
                </li>
              ))}
            </ul>
          </StaggerItem>
        </Stagger>

        {/* The picture sits on the bottom edge, so the counter meets the next section. */}
        <ShopScene className="mx-auto -mb-px w-full max-w-xl self-end" />
      </div>
    </section>
  );
}

function InsideTheApp() {
  return (
    <section className="texture-waves-ink overflow-hidden bg-canvas pt-16 sm:pt-20">
      <Reveal className="mx-auto max-w-2xl px-4 text-center">
        <p className={EYEBROW}>Inside the app</p>
        <h2 className={H2}>Everything the shop floor needs, on one screen.</h2>
      </Reveal>
      <HeroArc />
    </section>
  );
}

function Poster() {
  return (
    <section className="bg-white px-4 py-16 sm:py-20">
      <Reveal className="texture-waves mx-auto grid max-w-6xl items-center gap-8 overflow-hidden rounded-[2rem] bg-brand-500 p-8 text-ink-950 sm:p-12 lg:grid-cols-[1.3fr_1fr]">
        <div>
          <h2 className="text-3xl font-bold leading-tight tracking-tight sm:text-5xl">
            Close the day knowing{" "}
            <span className="italic text-navy-800">where every naira went.</span>
          </h2>
          <p className="mt-4 max-w-lg text-base leading-relaxed text-ink-900/80 sm:text-lg">
            Each cashier&apos;s sales, the cash in the drawer, what sold, what&apos;s running low.
            One report, sent to your WhatsApp or email when you close.
          </p>
          <a href="#pricing" className="btn btn-lg mt-7 rounded-full bg-navy-950 px-7 text-white hover:bg-navy-900">
            See the plans
            <ArrowRight className="size-4" />
          </a>
        </div>
        <ul className="grid gap-2.5">
          {[
            ["Sales today", "₦845,200"],
            ["Cash in drawer", "₦512,000"],
            ["Top seller", "Indomie 70g"],
            ["Running low", "4 products"],
          ].map(([label, value], i) => (
            <li
              key={label}
              className="flex items-center justify-between rounded-2xl bg-white px-5 py-4 shadow-[var(--shadow-raised)]"
              style={{ marginLeft: `${(i % 2) * 1.5}rem` }}
            >
              <span className="text-sm font-semibold text-ink-600">{label}</span>
              <span className="text-lg font-bold tabular text-ink-950">{value}</span>
            </li>
          ))}
        </ul>
      </Reveal>
    </section>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   PROOF STRIP
   ═══════════════════════════════════════════════════════════════════════════ */

function ProofStrip() {
  const items = [
    { value: "0 sec", label: "product search. The catalog is already on the till" },
    { value: "Offline", label: "sales keep working when the network drops" },
    { value: "Every day", label: "sales summary to your email or WhatsApp" },
  ];
  return (
    <section className="texture-waves bg-navy-950">
      <Stagger onView className="mx-auto grid max-w-6xl gap-6 px-4 py-8 sm:grid-cols-3">
        {items.map((item) => (
          <StaggerItem key={item.value} className="text-center sm:text-left">
            <p className="text-2xl font-bold tracking-tight text-white">{item.value}</p>
            <p className="mt-1 text-sm leading-relaxed text-navy-100">{item.label}</p>
          </StaggerItem>
        ))}
      </Stagger>
    </section>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   FEATURES
   ═══════════════════════════════════════════════════════════════════════════ */

function Features() {
  const features = [
    {
      icon: ScanBarcode,
      title: "Barcodes that actually work",
      body: "Scan with any USB or Bluetooth scanner. It just types, so there is nothing to install. No barcode on the pack? Generate and print your own labels.",
    },
    {
      icon: WifiOff,
      title: "Sells with no internet",
      body: "The whole catalog lives on the till. When the network drops, sales keep going and sync themselves the moment it returns, with no duplicated receipts.",
    },
    {
      icon: CreditCard,
      title: "Tender and change, done for you",
      body: "Type what the customer handed over. The change is calculated instantly, so the cashier isn't doing arithmetic under pressure.",
    },
    {
      icon: TrendingUp,
      title: "Cost, retail and wholesale",
      body: "Three prices per product, so bulk buyers get the right rate automatically. Profit is worked out per sale from the real cost, not a guess.",
    },
    {
      icon: BellRing,
      title: "Expiry alerts, three months ahead",
      body: "Every product can carry its expiry date. You get warned in time to discount or return it, and one click shows you exactly which items are affected.",
    },
    {
      icon: FileSpreadsheet,
      title: "Start from your spreadsheet",
      body: "Import your existing product list from Excel in one go. Barcodes can be attached later, product by product, with a scanner.",
    },
    {
      icon: ShieldCheck,
      title: "Staff see only what you allow",
      body: "Main admins control everything, permission by permission. Hide cost prices, block discounts, and give each person only the screens their job needs.",
    },
    {
      icon: FolderOpen,
      title: "Every supplier receipt, filed",
      body: "Snap the receipt when goods arrive, from the market or from a company van. Find it later by the supplier's name or its ID.",
    },
    {
      icon: BadgeCheck,
      title: "Know where every item came from",
      body: "Bought it in the market? Record the market and the trader. Every product from that source stays trackable, so you know who to go back to.",
    },
    {
      icon: Printer,
      title: "Real thermal receipts",
      body: "Prints properly on 80mm and 58mm rolls, with your shop name, the cashier and the change given. Reprint any past receipt in two clicks.",
    },
  ];


  return (
    <section id="features" className="scroll-mt-20 bg-white py-16 sm:py-24">
      <div className="mx-auto max-w-6xl px-4">
        <Reveal className="max-w-2xl">
          <p className={EYEBROW}>What you get</p>
          <h2 className={H2}>Everything a shop needs. Nothing it doesn&apos;t.</h2>
          <p className={LEAD}>
            Desktop inventory software is powerful and nobody uses half of it, because it takes a
            week to learn. This does the same job in a screen a new cashier can run on their first
            shift.
          </p>
        </Reveal>

        {/*
          Two headline features get big poster cards; the rest sit in a tidy
          grid below. A wall of ten equal boxes reads as a list nobody finishes.
        */}
        <Stagger onView gap={0.08} className="mt-10 grid gap-4 lg:grid-cols-2">
          <StaggerItem className="texture-waves relative overflow-hidden rounded-[1.75rem] bg-navy-700 p-7 text-white sm:p-9">
            <WifiOff className="size-9 text-brand-300" strokeWidth={2.25} />
            <h3 className="mt-5 text-2xl font-bold tracking-tight sm:text-3xl">Sells with no internet.</h3>
            <p className="mt-2 max-w-md text-base leading-relaxed text-navy-100">
              The whole catalogue lives on the till. When the network drops, scanning, selling and
              printing keep going, and every sale uploads itself the moment it&apos;s back.
            </p>
            <div className="mt-6 inline-flex items-center gap-2 rounded-full bg-white/12 px-3.5 py-2 text-sm font-semibold ring-1 ring-white/20">
              <span className="size-2 rounded-full bg-brand-400" />
              Offline · 4 sales waiting to send
            </div>
          </StaggerItem>
          <StaggerItem className="texture-waves relative overflow-hidden rounded-[1.75rem] bg-brand-500 p-7 text-ink-950 sm:p-9">
            <ScanBarcode className="size-9 text-navy-800" strokeWidth={2.25} />
            <h3 className="mt-5 text-2xl font-bold tracking-tight sm:text-3xl">Beep, and it&apos;s on the bill.</h3>
            <p className="mt-2 max-w-md text-base leading-relaxed text-ink-900/80">
              Any USB or Bluetooth scanner works, nothing to install. No barcode on the pack? Print
              your own labels. Serve the next customer while one is still finding their money.
            </p>
            <div className="mt-6 flex h-12 max-w-[15rem] items-stretch gap-[3px] rounded-lg bg-white p-2.5" aria-hidden>
              {[2, 1, 3, 1, 1, 2, 1, 3, 2, 1, 1, 3, 1, 2, 2, 1, 3, 1, 1, 2, 3, 1, 2, 1, 1, 2].map((w, i) => (
                <span key={i} className="bg-ink-950" style={{ width: w * 1.6 }} />
              ))}
            </div>
          </StaggerItem>
        </Stagger>

        <Stagger onView gap={0.05} className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {features
            .filter((f) => f.title !== "Sells with no internet" && f.title !== "Barcodes that actually work")
            .map(({ icon: Icon, title, body }, index) => (
              <StaggerItem
                key={title}
                lift
                className="group rounded-3xl border border-hairline bg-white p-5 shadow-[var(--shadow-card)] transition-shadow hover:shadow-[var(--shadow-raised)]"
              >
                <div
                  className={`texture-waves grid size-12 place-items-center rounded-2xl ${
                    ["bg-navy-700", "bg-brand-700", "bg-sell-600"][index % 3]
                  } text-white`}
                >
                  <Icon className="size-5" strokeWidth={2.25} />
                </div>
                <h3 className="mt-4 text-base font-bold leading-snug text-ink-950">{title}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-ink-600">{body}</p>
              </StaggerItem>
            ))}
        </Stagger>
      </div>
    </section>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   DEPARTMENTS
   ═══════════════════════════════════════════════════════════════════════════ */

function Departments() {
  const sides = [
    {
      name: "Supermarket",
      tone: "bg-navy-700 text-white",
      chip: "bg-white/15 ring-white/25",
      items: ["Golden Penny Sugar 1kg", "Indomie Chicken 70g", "Peak Milk Tin 400g"],
      who: "Supermarket cashiers see only these",
    },
    {
      name: "Pharmacy",
      tone: "bg-good-700 text-white",
      chip: "bg-white/15 ring-white/25",
      items: ["Paracetamol 500mg ×10", "Vitamin C 1000mg", "ORS sachet"],
      who: "Pharmacy cashiers see only these",
    },
  ];
  return (
    <section id="departments" className="scroll-mt-24 bg-white pb-16 sm:pb-24">
      <div className="mx-auto max-w-6xl px-4">
        <div className="texture-waves-ink overflow-hidden rounded-[2rem] border border-hairline bg-canvas p-6 sm:p-10">
          <Reveal className="max-w-2xl">
            <p className={EYEBROW}>Supermarket &amp; pharmacy</p>
            <h2 className={H2}>One system. Two counters. No mix-ups.</h2>
            <p className={LEAD}>
              Run your supermarket and your pharmacy from one account. Mark each product as
              Supermarket or Pharmacy, assign each cashier to a counter, and each till only shows
              what that counter sells. You and your managers still see everything.
            </p>
          </Reveal>
          <Stagger onView gap={0.12} className="mt-8 grid gap-4 md:grid-cols-2">
            {sides.map((side) => (
              <StaggerItem key={side.name} lift className={`texture-waves rounded-3xl p-6 ${side.tone}`}>
                <div className="flex items-center justify-between">
                  <p className="text-2xl font-bold tracking-tight">{side.name}</p>
                  <span className={`rounded-full px-3 py-1 text-xs font-bold ring-1 ${side.chip}`}>Till</span>
                </div>
                <ul className="mt-5 space-y-2">
                  {side.items.map((item) => (
                    <li key={item} className="flex items-center justify-between rounded-xl bg-white px-4 py-3 text-sm font-semibold text-ink-900">
                      {item}
                      <Check className="size-4 text-good-700" strokeWidth={3} />
                    </li>
                  ))}
                </ul>
                <p className="mt-4 text-sm font-semibold text-white/85">{side.who}</p>
              </StaggerItem>
            ))}
          </Stagger>
          <Reveal className="mt-4">
            <div className="flex flex-wrap items-center gap-3 rounded-2xl bg-white px-5 py-4 shadow-[var(--shadow-card)]">
              <ShieldCheck className="size-5 text-navy-700" />
              <p className="text-sm font-semibold text-ink-800">
                Admins and managers see both counters, every product and every cashier&apos;s sales.
              </p>
            </div>
          </Reveal>
        </div>
      </div>
    </section>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   HOW IT WORKS
   ═══════════════════════════════════════════════════════════════════════════ */

function HowItWorks() {
  const steps = [
    {
      title: "Pick your plan and send your details",
      body: "Fill in the short form below. It reaches us straight away with your business details and the plan you chose.",
    },
    {
      title: "We send the invoice, you transfer",
      body: "You get an email with the total and our bank details. One payment for the whole year. No card, no monthly deductions.",
    },
    {
      title: "We activate you the same day",
      body: "Once the transfer lands we switch your account on and email your main admin login. You add your products and start selling.",
    },
  ];
  return (
    <section id="how" className="texture-waves-ink scroll-mt-20 bg-canvas py-16 sm:py-24">
      <div className="mx-auto max-w-6xl px-4">
        <Reveal className="max-w-2xl">
          <p className={EYEBROW}>Getting started</p>
          <h2 className={H2}>Three steps, and you&apos;re trading.</h2>
        </Reveal>
        <Stagger onView gap={0.1} className="mt-10 grid gap-4 md:grid-cols-3">
          {steps.map((step, index) => (
            <StaggerItem
              key={step.title}
              className="relative rounded-2xl border border-hairline bg-white p-6 shadow-[var(--shadow-card)]"
            >
              <span className="texture-waves grid size-11 place-items-center rounded-2xl bg-navy-700 text-lg font-bold text-white">
                {index + 1}
              </span>
              <h3 className="mt-4 text-base font-bold text-ink-950">{step.title}</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-ink-600">{step.body}</p>
            </StaggerItem>
          ))}
        </Stagger>
      </div>
    </section>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   PRICING
   ═══════════════════════════════════════════════════════════════════════════ */

function Pricing() {
  return (
    <section id="pricing" className="scroll-mt-20 bg-white py-16 sm:py-24">
      <div className="mx-auto max-w-6xl px-4">
        <Reveal className="mx-auto max-w-2xl text-center">
          <p className={EYEBROW}>Pricing</p>
          <h2 className={H2}>Pay once a year. That&apos;s it.</h2>
          <p className={LEAD}>
            No monthly deductions, no per-transaction cut, no surprise charges when you get busy.
            One upfront payment covers the whole year for your whole shop.
          </p>
        </Reveal>

        <Stagger onView gap={0.1} className="mt-10 grid items-start gap-5 lg:grid-cols-3">
          {PLAN_ORDER.map((id) => {
            const plan = PLANS[id];
            const hot = plan.highlighted;
            return (
              <StaggerItem
                key={id}
                lift
                className={`relative flex h-full flex-col rounded-3xl border p-6 ${
                  hot
                    ? "texture-waves border-navy-700 bg-navy-700 text-white shadow-[var(--shadow-raised)]"
                    : "border-hairline bg-white text-ink-950 shadow-[var(--shadow-card)]"
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-lg font-bold">{plan.name}</h3>
                  {hot ? (
                    <span className="rounded-full bg-brand-500 px-2.5 py-1 text-[0.6875rem] font-bold text-ink-950">
                      Most popular
                    </span>
                  ) : null}
                </div>
                <p className={`mt-1 text-sm leading-relaxed ${hot ? "text-navy-100" : "text-ink-600"}`}>
                  {plan.tagline}
                </p>
                <p className="mt-5 flex items-baseline gap-1">
                  <span className="tabular text-4xl font-bold tracking-tight">
                    {formatNaira(plan.priceKobo)}
                  </span>
                  <span className={`text-sm font-semibold ${hot ? "text-navy-200" : "text-ink-500"}`}>
                    /year
                  </span>
                </p>

                <dl
                  className={`mt-5 grid grid-cols-2 gap-2 rounded-2xl p-3 text-sm ${
                    hot ? "bg-white/10" : "bg-canvas"
                  }`}
                >
                  <SeatStat label="Main admins" value={plan.seats.mainAdmin} hot={hot} />
                  <SeatStat label="Sub-admins" value={plan.seats.subAdmin} hot={hot} />
                  <SeatStat label="Cashiers" value={plan.seats.cashier} hot={hot} />
                  <SeatStat label="Branches" value={plan.seats.branches} hot={hot} />
                </dl>

                <ul className="mt-5 flex-1 space-y-2.5 text-sm">
                  {plan.features.map((feature) => (
                    <li key={feature} className="flex items-start gap-2">
                      <Check
                        className={`mt-0.5 size-4 shrink-0 ${hot ? "text-brand-400" : "text-good-700"}`}
                        strokeWidth={3}
                      />
                      <span className={hot ? "text-white" : "text-ink-700"}>{feature}</span>
                    </li>
                  ))}
                </ul>

                <a
                  href="#request"
                  className={`btn btn-lg mt-6 w-full ${hot ? "btn-primary" : "btn-navy"}`}
                >
                  Choose {plan.name}
                  <ArrowRight className="size-4" />
                </a>
              </StaggerItem>
            );
          })}
        </Stagger>

        <Reveal>
          <p className="mx-auto mt-8 max-w-2xl text-center text-sm leading-relaxed text-ink-600">
            Prices are in Naira and include setup and support. Need more than Enterprise covers, or
            a different arrangement?{" "}
            <a href="#request" className="font-bold text-navy-700 underline-offset-2 hover:underline">
              Tell us in the form
            </a>{" "}
            and we&apos;ll quote you.
          </p>
        </Reveal>
      </div>
    </section>
  );
}

function SeatStat({ label, value, hot }: { label: string; value: number; hot: boolean }) {
  return (
    <div>
      <dt className={`text-xs ${hot ? "text-navy-200" : "text-ink-500"}`}>{label}</dt>
      <dd className="tabular font-bold">{value === UNLIMITED ? "Unlimited" : value}</dd>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   REQUEST
   ═══════════════════════════════════════════════════════════════════════════ */

function RequestSection() {
  return (
    <section id="request" className="texture-waves-ink scroll-mt-20 bg-canvas py-16 sm:py-24">
      <div className="mx-auto grid max-w-6xl gap-10 px-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] lg:items-start">
        <Reveal>
          <p className={EYEBROW}>Get started</p>
          <h2 className={H2}>Tell us about your shop.</h2>
          <p className={LEAD}>
            Send your details and the plan you want. We reply with the total and our bank details,
            and activate your account as soon as payment lands, usually the same day.
          </p>
          <ul className="mt-6 space-y-3 text-sm font-semibold text-ink-800">
            {[
              "No card details, ever.",
              "We set up your first branch and admin for you.",
              "Your data is yours. Export it whenever you want.",
            ].map((item) => (
              <li key={item} className="flex items-start gap-2.5">
                <span className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full bg-good-50">
                  <Check className="size-3.5 text-good-700" strokeWidth={3} />
                </span>
                {item}
              </li>
            ))}
          </ul>
        </Reveal>
        <Reveal delay={0.1}>
          <PlanRequestForm initialPlan="BUSINESS" />
        </Reveal>
      </div>
    </section>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   FAQ
   ═══════════════════════════════════════════════════════════════════════════ */

function Faq() {
  const faqs = FAQS;
  return (
    <section id="faq" className="scroll-mt-24 bg-white py-16 sm:py-24">
      <div className="mx-auto grid max-w-6xl gap-10 px-4 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.4fr)]">
        <Reveal className="lg:sticky lg:top-28 lg:self-start">
          <p className={EYEBROW}>Questions</p>
          <h2 className={H2}>Before you ask.</h2>
          <p className={LEAD}>The things shop owners ask us most, answered plainly.</p>
          <div className="texture-waves mt-6 rounded-3xl bg-navy-950 p-6 text-white">
            <p className="text-lg font-bold">Still not sure?</p>
            <p className="mt-1 text-sm leading-relaxed text-navy-200">
              Send your details in the form and we&apos;ll call you to walk through it for your shop.
            </p>
            <a href="#request" className="btn btn-primary mt-4 rounded-full">
              Talk to us
              <ArrowRight className="size-4" />
            </a>
          </div>
        </Reveal>
        <Stagger onView gap={0.05} className="space-y-3">
          {faqs.map((faq) => (
            <StaggerItem key={faq.q}>
              <details className="group rounded-2xl border border-hairline bg-white px-5 py-4 shadow-[var(--shadow-card)] transition-colors open:border-navy-200 open:bg-navy-50/40">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-base font-bold text-ink-950 [&::-webkit-details-marker]:hidden">
                  {faq.q}
                  <span
                    aria-hidden
                    className="grid size-8 shrink-0 place-items-center rounded-full bg-navy-700 text-lg font-bold leading-none text-white transition-transform duration-200 group-open:rotate-45"
                  >
                    +
                  </span>
                </summary>
                <p className="mt-3 text-sm leading-relaxed text-ink-600">{faq.a}</p>
              </details>
            </StaggerItem>
          ))}
        </Stagger>
      </div>
    </section>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   FOOTER
   ═══════════════════════════════════════════════════════════════════════════ */

function SiteFooter() {
  const link = "text-sm text-navy-100 transition-colors hover:text-white";
  return (
    <footer className="texture-waves bg-navy-950 text-white">
      <div className="mx-auto max-w-6xl px-4 py-12">
        <div className="flex flex-wrap justify-between gap-10">
          <div className="max-w-sm">
            <Logo href={null} inverted />
            <p className="mt-3 text-sm leading-relaxed text-navy-100">
              Inventory management and point of sale for Nigerian supermarkets, mini marts and
              pharmacies.
            </p>
          </div>
          <div className="flex gap-14">
            <div>
              <p className="text-xs font-bold uppercase tracking-wider text-navy-300">Product</p>
              <ul className="mt-3 space-y-2">
                <li>
                  <a href="#features" className={link}>
                    Features
                  </a>
                </li>
                <li>
                  <a href="#pricing" className={link}>
                    Pricing
                  </a>
                </li>
                <li>
                  <a href="#request" className={link}>
                    Get started
                  </a>
                </li>
              </ul>
            </div>
            <div>
              <p className="text-xs font-bold uppercase tracking-wider text-navy-300">Account</p>
              <ul className="mt-3 space-y-2">
                <li>
                  <Link href="/signin" className={link}>
                    Sign in
                  </Link>
                </li>
                <li>
                  <Link href="/pos" className={link}>
                    Open till
                  </Link>
                </li>
              </ul>
            </div>
          </div>
        </div>
        <div className="mt-10 flex flex-wrap justify-between gap-2 border-t border-white/10 pt-6 text-xs text-navy-200">
          <p>&copy; {new Date().getFullYear()} Coderswurld. All rights reserved.</p>
          <p>Made for Nigerian business.</p>
        </div>
      </div>
    </footer>
  );
}
