"use client";

import { useCallback, useEffect, useState } from "react";
import { AnimatePresence } from "motion/react";
import { AlertTriangle, CheckCircle2, Download, Loader2, Network, RefreshCw, Zap } from "lucide-react";

import { m, EASE } from "@/components/motion";
import {
  HELPER_DOWNLOAD,
  getDirectPrint,
  helperStatus,
  setDirectPrint,
  type DirectPrintSettings,
  type HelperPrinter,
} from "@/lib/directPrint";
import { printReceipt } from "@/lib/printReceipt";

type Status =
  | { state: "checking" }
  | { state: "missing"; error: string }
  | { state: "ready"; version: string; printers: HelperPrinter[] };

/** Windows printer status codes worth telling someone about. */
function printerProblem(p: HelperPrinter): string | null {
  if (p.offline) return "Windows says this printer is offline";
  if (p.status === 1 || p.status === 2) return null;
  if (p.status === 7) return "Offline";
  if (p.status === 6) return "Stopped";
  if ((p.waitingJobs ?? 0) > 0) return `${p.waitingJobs} document${p.waitingJobs === 1 ? "" : "s"} stuck in its queue`;
  return null;
}

/** Receipt printers usually say so in their name or driver. */
function looksLikeReceiptPrinter(p: HelperPrinter) {
  return /xprinter|xp-|pos|receipt|thermal|80mm|58mm|epson tm|rongta|gprinter|bixolon|star/i.test(
    `${p.name} ${p.driver ?? ""}`,
  );
}

export function DirectPrintPanel({
  getSheet,
  paper,
}: {
  getSheet: () => HTMLElement | null;
  /** The shop's receipt paper. A4 never prints directly. */
  paper?: string;
}) {
  const [status, setStatus] = useState<Status>({ state: "checking" });
  const [settings, setSettings] = useState<DirectPrintSettings>(() =>
    typeof window === "undefined" ? { enabled: false, printer: null, host: null, openDrawer: false } : getDirectPrint(),
  );
  const [mode, setMode] = useState<"windows" | "network">(settings.host ? "network" : "windows");
  const [testing, setTesting] = useState(false);

  const save = (next: DirectPrintSettings) => {
    setSettings(next);
    setDirectPrint(next);
  };

  const check = useCallback(async () => {
    setStatus({ state: "checking" });
    const res = await helperStatus();
    if (!res.ok) {
      setStatus({ state: "missing", error: res.error });
      return;
    }
    setStatus({ state: "ready", version: res.version, printers: res.printers });
    // First time: pick the printer that looks like a receipt printer.
    const current = getDirectPrint();
    if (!current.printer && !current.host && res.printers.length) {
      const guess = res.printers.find(looksLikeReceiptPrinter) ?? res.printers.find((p) => p.isDefault);
      if (guess) {
        const next = { ...current, printer: guess.name };
        setSettings(next);
        setDirectPrint(next);
      }
    }
  }, []);

  useEffect(() => {
    const id = setTimeout(() => void check(), 0);
    return () => clearTimeout(id);
  }, [check]);

  async function testPrint() {
    setTesting(true);
    // Test with direct printing on, even before it is switched on for good.
    setDirectPrint({ ...settings, enabled: true });
    try {
      await printReceipt(getSheet());
    } finally {
      setDirectPrint(settings);
      setTesting(false);
    }
  }

  const selected = status.state === "ready" ? status.printers.find((p) => p.name === settings.printer) : undefined;
  const problem = selected ? printerProblem(selected) : null;

  return (
    <div className="border-t border-hairline bg-ink-50/60 p-5">
      <div className="flex flex-wrap items-start gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-brand-50 text-brand-700">
          <Zap className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="font-bold text-ink-950">Print straight to the printer (no print window)</h3>
          <p className="text-sm text-ink-600">
            Faster and sharper: the receipt goes directly to your receipt printer using its own font. Needs the free
            Coderswurld Print Helper on this computer.
          </p>
          {paper === "A4" ? (
            <p className="mt-2 rounded-xl bg-warn-50 px-3 py-2 text-sm text-warn-700 ring-1 ring-warn-200">
              Your receipts are set to <strong>A4</strong>. This only works with till printers on 80mm or 58mm rolls, so
              A4 receipts always open the normal print window. You can still set it up here for a till printer, and it
              will be used if you switch back to a roll in Receipt design.
            </p>
          ) : null}
        </div>
        <button type="button" onClick={() => void check()} className="btn btn-ghost btn-sm" disabled={status.state === "checking"}>
          <RefreshCw className={`size-4 ${status.state === "checking" ? "animate-spin" : ""}`} />
          Check again
        </button>
      </div>

      <AnimatePresence mode="wait">
        {status.state === "checking" && (
          <m.p key="checking" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="mt-4 flex items-center gap-2 text-sm text-ink-600">
            <Loader2 className="size-4 animate-spin" /> Looking for the print helper on this computer…
          </m.p>
        )}

        {status.state === "missing" && (
          <m.div key="missing" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.2, ease: EASE }} className="mt-4 space-y-3">
            <p className="text-sm text-ink-700">{status.error}</p>
            <ol className="list-decimal space-y-1.5 pl-5 text-sm text-ink-700">
              <li>
                Download the helper, right-click the zip and choose <b>Extract All</b>.
              </li>
              <li>
                Double-click <b>Install Print Helper.bat</b>. If Windows says it protected your PC, click <b>More info</b>,
                then <b>Run anyway</b>.
              </li>
              <li>
                Come back here and press <b>Check again</b>. If Chrome asks to access devices on your network, click{" "}
                <b>Allow</b>.
              </li>
            </ol>
            <a href={HELPER_DOWNLOAD} download className="btn btn-primary">
              <Download className="size-4" />
              Download the print helper (Windows)
            </a>
          </m.div>
        )}

        {status.state === "ready" && (
          <m.div key="ready" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.2, ease: EASE }} className="mt-4 space-y-4">
            <p className="flex items-center gap-2 text-sm font-semibold text-good-700">
              <CheckCircle2 className="size-4" /> Print helper is running (version {status.version})
            </p>

            <div className="flex gap-2">
              <button type="button" className={`btn btn-sm ${mode === "windows" ? "btn-navy" : "btn-outline"}`} onClick={() => { setMode("windows"); save({ ...settings, host: null }); }}>
                USB printer
              </button>
              <button type="button" className={`btn btn-sm ${mode === "network" ? "btn-navy" : "btn-outline"}`} onClick={() => setMode("network")}>
                <Network className="size-4" /> Network printer
              </button>
            </div>

            {mode === "windows" ? (
              <label className="block">
                <span className="label">Printer</span>
                {status.printers.length === 0 ? (
                  <p className="text-sm text-bad-700">
                    Windows has no printers installed. Install your printer&apos;s driver first (it came on a CD or from the
                    maker&apos;s website), then press Check again.
                  </p>
                ) : (
                  <select className="input" value={settings.printer ?? ""} onChange={(e) => save({ ...settings, printer: e.target.value || null, host: null })}>
                    {status.printers.map((p) => (
                      <option key={p.name} value={p.name}>
                        {p.name}
                        {p.isDefault ? " (default)" : ""}
                        {p.port ? ` · ${p.port}` : ""}
                      </option>
                    ))}
                  </select>
                )}
                {selected?.driver && <span className="mt-1 block text-xs text-ink-500">Driver: {selected.driver}</span>}
              </label>
            ) : (
              <label className="block">
                <span className="label">Printer IP address</span>
                <input
                  className="input"
                  placeholder="192.168.1.100"
                  value={settings.host ?? ""}
                  onChange={(e) => save({ ...settings, host: e.target.value.trim() || null })}
                />
                <span className="mt-1 block text-xs text-ink-500">
                  Hold the feed button while switching the printer on to print its settings page; the IP address is on it.
                </span>
              </label>
            )}

            {problem && (
              <p className="flex items-start gap-2 rounded-lg border border-warn-200 bg-warn-50 px-3 py-2 text-sm text-warn-700">
                <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                <span>
                  {problem}. Open Windows Settings, then Printers, select this printer and clear its queue or turn off
                  &quot;Use printer offline&quot;. This is often why nothing comes out.
                </span>
              </p>
            )}

            <div className="space-y-2">
              <label className="flex items-center gap-3">
                <input type="checkbox" className="size-4" checked={settings.enabled} onChange={(e) => save({ ...settings, enabled: e.target.checked })} />
                <span className="text-sm text-ink-800">
                  <b>Use direct printing on this computer</b> (the till, sales and test prints)
                </span>
              </label>
              <label className="flex items-center gap-3">
                <input type="checkbox" className="size-4" checked={settings.openDrawer} onChange={(e) => save({ ...settings, openDrawer: e.target.checked })} />
                <span className="text-sm text-ink-800">Open the cash drawer with each receipt (drawer plugged into the printer)</span>
              </label>
            </div>

            <button type="button" className="btn btn-primary" onClick={() => void testPrint()} disabled={testing || (mode === "network" ? !settings.host : !settings.printer)}>
              {testing ? <Loader2 className="size-4 animate-spin" /> : <Zap className="size-4" />}
              Print test receipt directly
            </button>
          </m.div>
        )}
      </AnimatePresence>
    </div>
  );
}
