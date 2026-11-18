"use client";

import {
  BellRing,
  Check,
  FolderOpen,
  Printer,
  ScanBarcode,
  TrendingUp,
  WifiOff,
} from "lucide-react";

import { EASE, m } from "@/components/motion";

/**
 * The curved row of cards under the landing-page headline.
 *
 * WHY THESE ARE DRAWN IN CODE AND NOT PHOTOS
 * ------------------------------------------
 * Seven photos at this size are 600 KB or more, and they are the first thing a
 * visitor on mobile data would wait for. These seven cards are plain markup:
 * together they weigh less than one small thumbnail, they are sharp on every
 * screen, and each one shows a real part of the product instead of a stock
 * picture of a shop.
 *
 * THE CURVE
 * ---------
 * The row sits inside a `perspective` box. Each card is turned a little toward
 * the centre and pushed toward the viewer the further out it sits, so the row
 * reads as the inside of a gentle arc — the look of a display wall. Solid fills
 * only; the depth comes from geometry, not from gradients.
 */

const ROTATE_PER_STEP = 10; // degrees each card turns toward the centre
const PUSH_PER_STEP = 16; // px toward the viewer, multiplied by distance squared

function Shell({
  tone,
  children,
}: {
  tone: "white" | "navy" | "orange" | "red";
  children: React.ReactNode;
}) {
  const tones = {
    white: "border-ink-200 bg-white text-ink-950",
    navy: "border-navy-800 bg-navy-700 text-white",
    orange: "border-brand-200 bg-brand-50 text-ink-950",
    red: "border-sell-100 bg-sell-50 text-ink-950",
  };
  return (
    <div
      className={`flex h-full flex-col overflow-hidden rounded-2xl border p-3.5 shadow-[var(--shadow-raised)] ${tones[tone]}`}
    >
      {children}
    </div>
  );
}

function Label({ icon: Icon, children, light }: { icon: typeof Check; children: React.ReactNode; light?: boolean }) {
  return (
    <p
      className={`flex items-center gap-1.5 text-[0.625rem] font-bold uppercase tracking-wider ${
        light ? "text-white/70" : "text-ink-500"
      }`}
    >
      <Icon className="size-3.5" />
      {children}
    </p>
  );
}

function StockCard() {
  const rows = [
    ["Sugar 1kg", "3 left"],
    ["Milk tin 400g", "5 left"],
    ["Rice 5kg", "2 left"],
  ];
  return (
    <Shell tone="orange">
      <Label icon={BellRing}>Low stock</Label>
      <p className="mt-2 text-sm font-bold leading-tight">Reorder before you run out</p>
      <ul className="mt-auto space-y-1.5">
        {rows.map(([name, left]) => (
          <li key={name} className="flex items-center justify-between rounded-lg bg-white px-2 py-1.5 text-[0.6875rem]">
            <span className="truncate font-medium">{name}</span>
            <span className="shrink-0 font-bold text-brand-700">{left}</span>
          </li>
        ))}
      </ul>
    </Shell>
  );
}

function BarcodeCard() {
  const bars = [2, 1, 3, 1, 1, 2, 1, 3, 2, 1, 1, 3, 1, 2, 2, 1, 3, 1, 1, 2, 3, 1, 2, 1];
  return (
    <Shell tone="white">
      <Label icon={ScanBarcode}>Scan to sell</Label>
      <div className="mt-auto rounded-lg border border-ink-200 p-2.5">
        <div className="flex h-14 items-stretch justify-center gap-[2px]" aria-hidden>
          {bars.map((w, i) => (
            <span key={i} className="bg-ink-950" style={{ width: w * 1.5 }} />
          ))}
        </div>
        <p className="mt-1.5 text-center font-mono text-[0.625rem] tracking-widest text-ink-600">
          6 151234 567890
        </p>
      </div>
      <p className="mt-2 text-[0.6875rem] leading-snug text-ink-600">
        Any USB or Bluetooth scanner. Print your own labels too.
      </p>
    </Shell>
  );
}

function ReceiptCard() {
  return (
    <Shell tone="white">
      <Label icon={Printer}>Receipt</Label>
      <div className="mt-2 flex-1 rounded-lg bg-ink-50 p-2.5 font-mono text-[0.625rem] leading-relaxed text-ink-800">
        <p className="text-center font-bold">YOUR SHOP NAME</p>
        <p className="my-1 border-t border-dashed border-ink-300" />
        <p className="flex justify-between">
          <span>12 x Noodles</span>
          <span>2,400</span>
        </p>
        <p className="flex justify-between">
          <span>2 x Milk tin</span>
          <span>5,200</span>
        </p>
        <p className="flex justify-between">
          <span>6 x Soft drink</span>
          <span>1,800</span>
        </p>
        <p className="my-1 border-t border-dashed border-ink-300" />
        <p className="flex justify-between font-bold">
          <span>TOTAL</span>
          <span>9,400</span>
        </p>
        <p className="flex justify-between">
          <span>Change</span>
          <span>600</span>
        </p>
      </div>
    </Shell>
  );
}

function TillCard() {
  return (
    <Shell tone="navy">
      <Label icon={Check} light>
        New sale
      </Label>
      <p className="mt-3 text-[0.6875rem] font-medium text-white/70">Total</p>
      <p className="tabular text-3xl font-bold tracking-tight">₦9,400</p>
      <div className="mt-3 grid grid-cols-2 gap-1.5 text-[0.6875rem]">
        <div className="rounded-lg bg-white/10 p-2">
          <p className="text-white/60">Cash given</p>
          <p className="tabular font-bold">₦10,000</p>
        </div>
        <div className="rounded-lg bg-white/10 p-2">
          <p className="text-white/60">Change</p>
          <p className="tabular font-bold">₦600</p>
        </div>
      </div>
      <div className="mt-auto rounded-xl bg-sell-600 py-2.5 text-center text-xs font-bold">
        Complete sale
      </div>
    </Shell>
  );
}

function SalesCard() {
  const bars = [38, 52, 44, 70, 58, 86, 64];
  return (
    <Shell tone="white">
      <Label icon={TrendingUp}>This week</Label>
      <p className="mt-2 text-sm font-bold leading-tight">Sales and profit, every day</p>
      <div className="mt-auto flex h-24 items-end gap-1.5" aria-hidden>
        {bars.map((h, i) => (
          <span
            key={i}
            className={`flex-1 rounded-t ${i === 5 ? "bg-brand-500" : "bg-navy-200"}`}
            style={{ height: `${h}%` }}
          />
        ))}
      </div>
      <div className="mt-1 flex justify-between text-[0.5625rem] font-semibold text-ink-400">
        {["M", "T", "W", "T", "F", "S", "S"].map((d, i) => (
          <span key={i} className="flex-1 text-center">
            {d}
          </span>
        ))}
      </div>
    </Shell>
  );
}

function OfflineCard() {
  return (
    <Shell tone="red">
      <Label icon={WifiOff}>No network</Label>
      <p className="mt-2 text-sm font-bold leading-tight">Still selling. Nothing is lost.</p>
      <div className="mt-auto space-y-1.5">
        <div className="flex items-center justify-between rounded-lg bg-white px-2 py-1.5 text-[0.6875rem]">
          <span className="font-medium">Sales waiting to send</span>
          <span className="font-bold text-sell-700">4</span>
        </div>
        <div className="flex items-center gap-1.5 rounded-lg bg-white px-2 py-1.5 text-[0.6875rem] font-medium">
          <Check className="size-3.5 text-good-700" strokeWidth={3} />
          Sent when the network returns
        </div>
      </div>
    </Shell>
  );
}

function ReceiptsCard() {
  return (
    <Shell tone="white">
      <Label icon={FolderOpen}>Supplier receipts</Label>
      <p className="mt-2 text-sm font-bold leading-tight">Every vendor receipt, filed</p>
      <ul className="mt-auto space-y-1.5">
        {["RCT-000014", "RCT-000013", "RCT-000012"].map((ref) => (
          <li key={ref} className="flex items-center gap-2 rounded-lg border border-ink-200 px-2 py-1.5">
            <span className="grid size-6 shrink-0 place-items-center rounded bg-navy-50">
              <FolderOpen className="size-3.5 text-navy-700" />
            </span>
            <span className="font-mono text-[0.625rem] font-bold text-ink-800">{ref}</span>
          </li>
        ))}
      </ul>
    </Shell>
  );
}

const CARDS = [StockCard, BarcodeCard, ReceiptCard, TillCard, SalesCard, OfflineCard, ReceiptsCard];
const CENTRE = (CARDS.length - 1) / 2;

export function HeroArc() {
  return (
    <div
      className="relative mx-auto w-full overflow-hidden pb-10 pt-6"
      style={{ perspective: "1500px" }}
      // Decorative: the same things are described in the Features section.
      aria-hidden
    >
      <div className="flex items-center justify-center gap-3 sm:gap-4" style={{ transformStyle: "preserve-3d" }}>
        {CARDS.map((Card, index) => {
          const step = index - CENTRE; // -3 … 3
          const distance = Math.abs(step);
          return (
            <m.div
              key={index}
              // The outer cards drop away on small screens so the row never
              // squeezes: 3 on a phone, 5 on a tablet, all 7 on a desktop.
              className={`h-60 w-40 shrink-0 sm:h-64 sm:w-44 ${
                distance > 2 ? "hidden lg:block" : distance > 1 ? "hidden sm:block" : ""
              }`}
              style={{
                rotateY: -step * ROTATE_PER_STEP,
                z: distance * distance * PUSH_PER_STEP,
              }}
              initial={{ opacity: 0, y: 48 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.8, ease: EASE, delay: 0.35 + distance * 0.09 }}
            >
              {/* A slow, small float. Each card on its own clock so the row
                  breathes instead of bobbing in step. */}
              <m.div
                className="h-full"
                animate={{ y: [0, -6, 0] }}
                transition={{
                  duration: 5 + (index % 3),
                  repeat: Infinity,
                  ease: "easeInOut",
                  delay: 1.2 + index * 0.25,
                }}
              >
                <Card />
              </m.div>
            </m.div>
          );
        })}
      </div>
    </div>
  );
}
