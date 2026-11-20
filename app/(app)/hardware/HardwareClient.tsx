"use client";

import { useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import {
  CheckCircle2,
  Copy,
  Loader2,
  PackageSearch,
  Printer,
  ScanLine,
  TriangleAlert,
  Usb,
} from "lucide-react";

import { ReceiptSheet, type ReceiptSheetData, type ReceiptSheetSettings } from "@/components/receipt/ReceiptSheet";
import { printReceipt } from "@/lib/printReceipt";
import type { ReceiptDesign } from "@/lib/receiptDesign";

/**
 * Printer and scanner setup. Two tests the shop can run any time:
 *  - a test receipt in the shop's real design, so width and margins can be
 *    checked on actual paper;
 *  - a scanner test that tells a real scan (fast, ends with Enter) from typing,
 *    and checks the code against the shop's products.
 */

const SAMPLE: ReceiptSheetData = {
  receiptNo: "TEST-0001",
  cashierName: "",
  items: [
    { name: "Test item one", unit: "pcs", quantity: 1, unitPriceKobo: 100000, lineTotalKobo: 100000 },
    { name: "Test item with a much longer name to check wrapping", unit: "pcs", quantity: 2, unitPriceKobo: 25000, lineTotalKobo: 50000 },
  ],
  subtotalKobo: 150000,
  discountKobo: 0,
  taxKobo: 0,
  totalKobo: 150000,
  paidKobo: 150000,
  balanceKobo: 0,
  tenderedKobo: 200000,
  changeKobo: 50000,
  paymentMethod: "CASH",
  offline: false,
};

interface ScanResult {
  code: string;
  avgGapMs: number;
  fromScanner: boolean;
  product: { name: string; price: string } | null | "unknown";
}

export function HardwareClient({
  org,
  branchName,
  cashierName,
  settings,
  design,
  stamp,
  canLookUpProducts,
}: {
  org: { name: string; phone: string | null; address: string | null; logoUrl: string | null };
  branchName: string;
  cashierName: string;
  settings: ReceiptSheetSettings;
  design: ReceiptDesign;
  stamp: string;
  canLookUpProducts: boolean;
}) {
  return (
    <div className="space-y-5">
      <div className="grid gap-5 xl:grid-cols-2 [&>*]:min-w-0">
        <PrinterCard org={org} branchName={branchName} cashierName={cashierName} settings={settings} design={design} stamp={stamp} />
        <ScannerCard canLookUpProducts={canLookUpProducts} />
      </div>
      <Guides paper={settings.receiptWidth} />
    </div>
  );
}

// ── Printer ─────────────────────────────────────────────────────────────────

function PrinterCard({
  org,
  branchName,
  cashierName,
  settings,
  design,
  stamp,
}: {
  org: { name: string; phone: string | null; address: string | null; logoUrl: string | null };
  branchName: string;
  cashierName: string;
  settings: ReceiptSheetSettings;
  design: ReceiptDesign;
  stamp: string;
}) {
  const sheetRef = useRef<HTMLDivElement>(null);
  return (
    <section className="card overflow-hidden rounded-3xl">
      <header className="flex items-start gap-3 border-b border-hairline p-5">
        <span className="texture-waves grid size-11 shrink-0 place-items-center rounded-2xl bg-navy-700 text-white">
          <Printer className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-base font-bold text-ink-950">Receipt printer</h2>
          <p className="text-sm text-ink-500">
            Set for <span className="font-semibold text-ink-800">{settings.receiptWidth}</span> paper.{" "}
            <Link href="/receipt-design" className="font-semibold text-navy-700 hover:underline">
              Change
            </Link>
          </p>
        </div>
        <button
          type="button"
          onClick={() => printReceipt(sheetRef.current?.querySelector(".receipt-sheet") as HTMLElement | null)}
          className="btn btn-primary"
        >
          <Printer className="size-4" />
          Print test receipt
        </button>
      </header>
      <div className="grid gap-4 p-5 sm:grid-cols-[1fr_auto]">
        <ul className="space-y-2 text-sm text-ink-700">
          <Check>Prints the whole receipt, edge to edge, with nothing cut off on the right.</Check>
          <Check>The ₦ signs and the barcode at the bottom are clear.</Check>
          <Check>The paper stops just after the last line and cuts (if your printer has a cutter).</Check>
          <li className="pt-1 text-xs text-ink-500">
            Cut off on the right? You likely have 58mm paper with the 80mm setting. Text very small? Set the
            paper size to 80mm in the printer settings when the print window opens.
          </li>
        </ul>
        <div ref={sheetRef} className="rounded-2xl bg-ink-100 p-3">
          <div className="mx-auto w-fit shadow-[0_6px_20px_rgba(10,20,40,0.12)]">
            <ReceiptSheet
              data={{ ...SAMPLE, cashierName }}
              org={org}
              branch={{ name: branchName }}
              settings={settings}
              design={design}
              stamp={stamp}
              banner="TEST PRINT"
            />
            <div className="receipt-paper-edge" aria-hidden />
          </div>
        </div>
      </div>
    </section>
  );
}

// ── Scanner ─────────────────────────────────────────────────────────────────

function ScannerCard({ canLookUpProducts }: { canLookUpProducts: boolean }) {
  const [value, setValue] = useState("");
  const [result, setResult] = useState<ScanResult | null>(null);
  const [checking, setChecking] = useState(false);
  const [focused, setFocused] = useState(false);
  const times = useRef<number[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  async function finish() {
    const code = value.trim();
    const t = times.current;
    times.current = [];
    setValue("");
    if (!code) return;
    // A scanner "types" a whole code in well under a tenth of a second; a
    // person needs a quarter of a second or more between keys.
    const gaps = t.slice(1).map((x, i) => x - t[i]);
    const avgGapMs = gaps.length ? gaps.reduce((a, b) => a + b, 0) / gaps.length : 999;
    const fromScanner = code.length >= 4 && avgGapMs < 40;
    setResult({ code, avgGapMs, fromScanner, product: canLookUpProducts ? null : "unknown" });
    if (!canLookUpProducts) return;
    setChecking(true);
    try {
      const res = await fetch(`/api/products?${new URLSearchParams({ q: code, perPage: "10" })}`);
      const body = (await res.json()) as { items?: { name: string; barcode: string | null; sku: string; sellingPriceKobo: number }[] };
      const hit = body.items?.find((p) => p.barcode === code || p.sku.toLowerCase() === code.toLowerCase());
      setResult((r) =>
        r
          ? {
              ...r,
              product: hit
                ? { name: hit.name, price: "₦" + (hit.sellingPriceKobo / 100).toLocaleString("en-NG") }
                : null,
            }
          : r,
      );
    } catch {
      setResult((r) => (r ? { ...r, product: "unknown" } : r));
    } finally {
      setChecking(false);
    }
  }

  return (
    <section className="card overflow-hidden rounded-3xl">
      <header className="flex items-start gap-3 border-b border-hairline p-5">
        <span className="texture-waves grid size-11 shrink-0 place-items-center rounded-2xl bg-brand-700 text-white">
          <ScanLine className="size-5" />
        </span>
        <div>
          <h2 className="text-base font-bold text-ink-950">Barcode scanner</h2>
          <p className="text-sm text-ink-500">Click the box, then scan any product.</p>
        </div>
      </header>
      <div className="space-y-4 p-5">
        <label className="relative block">
          <ScanLine className="pointer-events-none absolute left-4 top-1/2 size-6 -translate-y-1/2 text-navy-700" />
          <input
            ref={inputRef}
            value={value}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void finish();
              } else if (e.key.length === 1) {
                times.current.push(performance.now());
              }
            }}
            placeholder={focused ? "Scan now…" : "Click here, then scan"}
            autoComplete="off"
            spellCheck={false}
            aria-label="Scanner test"
            className="h-16 w-full rounded-2xl border-2 border-dashed border-navy-200 bg-navy-50/50 pl-14 pr-4 font-mono text-lg outline-none transition focus:border-solid focus:border-navy-600 focus:bg-surface"
          />
        </label>

        {!result ? (
          <p className="text-sm text-ink-500">
            A working scanner fills the box and presses Enter by itself. You will see the result here.
          </p>
        ) : (
          <div className="space-y-2 rounded-2xl border border-hairline p-4">
            <Row ok label="Code received" value={<span className="font-mono">{result.code}</span>} />
            <Row
              ok={result.fromScanner}
              label={result.fromScanner ? "Came from a scanner" : "Looks typed by hand"}
              value={result.fromScanner ? "Fast and ended with Enter" : "Too slow for a scanner"}
            />
            {result.product === "unknown" ? null : checking ? (
              <p className="flex items-center gap-2 text-sm text-ink-500">
                <Loader2 className="size-4 animate-spin" /> Looking for the product…
              </p>
            ) : result.product ? (
              <Row ok label="Product found" value={`${result.product.name}, ${result.product.price}`} />
            ) : (
              <div className="flex items-start gap-2 text-sm">
                <PackageSearch className="mt-0.5 size-4 shrink-0 text-brand-700" />
                <p className="text-ink-700">
                  No product has this barcode yet. The scanner works; add this code to the product on its edit
                  page (Barcode box) and the till will find it.
                </p>
              </div>
            )}
            {!result.fromScanner ? (
              <p className="pt-1 text-xs text-ink-500">
                If you did scan: the scanner may be set to a different keyboard language, or not send Enter. See
                &quot;Scanner not working?&quot; below.
              </p>
            ) : null}
          </div>
        )}
      </div>
    </section>
  );
}

function Row({ ok, label, value }: { ok: boolean; label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2 text-sm">
      {ok ? (
        <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-good-700" />
      ) : (
        <TriangleAlert className="mt-0.5 size-4 shrink-0 text-brand-700" />
      )}
      <span className="w-40 shrink-0 font-semibold text-ink-900">{label}</span>
      <span className="min-w-0 text-ink-700">{value}</span>
    </div>
  );
}

function Check({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex gap-2">
      <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-good-700" />
      <span>{children}</span>
    </li>
  );
}

// ── Setup guides ────────────────────────────────────────────────────────────

const noop = () => () => {};

function Guides({ paper }: { paper: string }) {
  const [copied, setCopied] = useState(false);
  // The site's own address, read in the browser only (the server can't know it).
  const origin = useSyncExternalStore(noop, () => window.location.origin, () => "https://your-site");
  const target = `"C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" --kiosk-printing --app=${origin}/pos`;

  return (
    <div className="grid gap-5 xl:grid-cols-2 [&>*]:min-w-0">
      <Guide
        icon={Usb}
        title="Set up the receipt printer (Xprinter and similar)"
        steps={[
          ["Plug it in", "Connect the printer to the computer with its USB cable, plug in the power and switch it on. Load the paper roll with the shiny side facing the print head."],
          ["Install the driver", "Install the Windows driver that came with the printer (on the CD or from the Xprinter website for your model, for example XP-80C or XP-58). Windows may also find it on its own."],
          ["Set the paper size", `In Windows, open Settings, Bluetooth & devices, Printers & scanners, pick the printer, then Printing preferences. Choose the ${paper} roll size and "No margin" if offered.`],
          ["Make it the default", "On the same screen, choose Set as default, so receipts go to it without picking it each time."],
          ["Print a test", "Click Print test receipt above. In the print window choose the printer, set Margins to None and Scale to 100, untick Headers and footers, then Print."],
        ]}
      />
      <Guide
        icon={ScanLine}
        title="Set up the barcode scanner"
        steps={[
          ["Plug it in", "Most USB scanners need no driver or setup. Plug it into the computer; it beeps when ready. A wireless one comes with a small USB receiver: plug that in."],
          ["Open the till", "Go to Sell at till. The search box shows a green Ready to scan light when a scan will land."],
          ["Scan", "Point at a product's barcode and press the trigger. The item goes straight into the basket."],
          ["Add barcodes to products", "If the till says No product matches, scan into the Barcode box on the product's edit page once. From then on it scans straight in."],
        ]}
      />
      <section className="card rounded-3xl p-5 xl:col-span-2">
        <h2 className="text-base font-bold text-ink-950">Print every receipt without the print window (optional)</h2>
        <p className="mt-1 text-sm text-ink-600">
          Chrome and Edge can skip the print window and send receipts straight to the default printer. Make a desktop
          shortcut for the till with this target, and turn on &quot;Print as soon as a sale is done&quot; in Receipt
          design:
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <code className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap rounded-xl bg-ink-950 px-3 py-2.5 font-mono text-xs text-white">
            {target}
          </code>
          <button
            type="button"
            className="btn btn-outline btn-sm"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(target);
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
              } catch {
                // Clipboard blocked: the text is on screen to copy by hand.
              }
            }}
          >
            <Copy className="size-4" />
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
        <p className="mt-2 text-xs text-ink-500">
          Close every Chrome window first, then open the till from this shortcut. For Edge, use the path to
          msedge.exe instead. Receipts then print on the default printer, so set the receipt printer as default.
        </p>
      </section>
      <section className="card rounded-3xl p-5 xl:col-span-2">
        <h2 className="text-base font-bold text-ink-950">Not working?</h2>
        <div className="mt-3 grid gap-4 text-sm text-ink-700 md:grid-cols-2">
          <Trouble q="Receipt prints blank">The paper is in upside down. Turn the roll so the shiny side faces the print head.</Trouble>
          <Trouble q="Receipt is cut off or tiny">The paper size in the printer settings doesn&apos;t match your roll. Match it ({paper} here) and set Margins to None.</Trouble>
          <Trouble q="A long empty strip after each receipt">In the printer&apos;s Printing preferences, set the paper length to follow the content (often called &quot;Receipt&quot; or 3276mm), not a fixed page.</Trouble>
          <Trouble q="Cash drawer won&apos;t open">The drawer plugs into the printer (the phone-style RJ11 socket). In Printing preferences, turn on &quot;Open cash drawer&quot; for each print.</Trouble>
          <Trouble q="Scanner beeps but nothing appears">Click into the till&apos;s search box first, or click the orange Click to scan light. A scan only lands where the cursor is.</Trouble>
          <Trouble q="Scanner types wrong characters">It is set to another keyboard language. Scan the &quot;USA keyboard&quot; setup code in the scanner&apos;s manual.</Trouble>
          <Trouble q="Scanner fills the box but doesn't add the item">It is not sending Enter at the end. Scan the &quot;Add CR suffix&quot; or &quot;Enter&quot; code in its manual.</Trouble>
          <Trouble q="Some products don't scan">Those barcodes are not saved on the products yet. Add them on each product&apos;s edit page.</Trouble>
        </div>
      </section>
    </div>
  );
}

function Guide({
  icon: Icon,
  title,
  steps,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  steps: [string, string][];
}) {
  return (
    <section className="card rounded-3xl p-5">
      <h2 className="flex items-center gap-2 text-base font-bold text-ink-950">
        <Icon className="size-5 text-navy-700" />
        {title}
      </h2>
      <ol className="mt-4 space-y-4">
        {steps.map(([head, body], i) => (
          <li key={head} className="flex gap-3">
            <span className="grid size-7 shrink-0 place-items-center rounded-full bg-navy-50 text-sm font-bold text-navy-700">
              {i + 1}
            </span>
            <div>
              <p className="text-sm font-bold text-ink-900">{head}</p>
              <p className="text-sm text-ink-600">{body}</p>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}

function Trouble({ q, children }: { q: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="font-semibold text-ink-900">{q}</p>
      <p className="text-ink-600">{children}</p>
    </div>
  );
}
