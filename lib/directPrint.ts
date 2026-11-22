/**
 * Direct printing: send receipts to the printer through the Coderswurld Print
 * Helper running on this computer, with no print window. The choice is per
 * computer (a till PC has a printer; the owner's laptop may not), so it lives
 * in this browser, not in the shop's settings.
 */

export const HELPER_URL = "http://127.0.0.1:17777";
export const HELPER_DOWNLOAD = "/print-helper/coderswurld-print-helper.zip";

export interface DirectPrintSettings {
  enabled: boolean;
  /** Windows printer name; null means the computer's default printer. */
  printer: string | null;
  /** A network printer's IP address, used instead of a Windows printer. */
  host: string | null;
  /** Pop the cash drawer open with each receipt (drawer plugged into the printer). */
  openDrawer: boolean;
}

export interface HelperPrinter {
  name: string;
  port?: string;
  driver?: string;
  offline?: boolean;
  status?: number;
  waitingJobs?: number;
  isDefault?: boolean;
}

const KEY = "cw:print:direct";
const DEFAULTS: DirectPrintSettings = { enabled: false, printer: null, host: null, openDrawer: false };

export function getDirectPrint(): DirectPrintSettings {
  try {
    const raw = window.localStorage.getItem(KEY);
    return raw ? { ...DEFAULTS, ...(JSON.parse(raw) as Partial<DirectPrintSettings>) } : DEFAULTS;
  } catch {
    return DEFAULTS;
  }
}

export function setDirectPrint(next: DirectPrintSettings) {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // Private window: works for this visit only.
  }
}

async function call(path: string, init: RequestInit & { timeoutMs: number }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), init.timeoutMs);
  try {
    return await fetch(HELPER_URL + path, { ...init, signal: controller.signal, cache: "no-store" });
  } finally {
    clearTimeout(timer);
  }
}

/** Is the helper running here, and which printers can it see? */
export async function helperStatus(): Promise<
  { ok: true; version: string; printers: HelperPrinter[] } | { ok: false; error: string }
> {
  try {
    const res = await call("/status", { method: "GET", timeoutMs: 3000 });
    const body = (await res.json()) as { ok?: boolean; version?: string; printers?: HelperPrinter[]; error?: string };
    if (!res.ok || !body.ok) return { ok: false, error: body.error ?? `The helper answered ${res.status}.` };
    return { ok: true, version: body.version ?? "?", printers: body.printers ?? [] };
  } catch {
    return {
      ok: false,
      error: "The print helper isn't running on this computer, or Chrome was not allowed to reach it.",
    };
  }
}

/** Send printer commands. Throws with a plain message when it doesn't print. */
export async function sendToPrinter(bytes: Uint8Array, s: DirectPrintSettings): Promise<void> {
  const q = new URLSearchParams();
  if (s.host) {
    const [host, port] = s.host.split(":");
    q.set("host", host);
    if (port) q.set("port", port);
  } else if (s.printer) {
    q.set("printer", s.printer);
  }
  let res: Response;
  try {
    res = await call(`/print?${q}`, {
      method: "POST",
      headers: { "content-type": "application/octet-stream" },
      body: bytes as unknown as BodyInit,
      timeoutMs: 15000,
    });
  } catch {
    throw new Error("The print helper isn't running on this computer.");
  }
  const body = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
  if (!res.ok || !body.ok) throw new Error(body.error ?? `The print helper answered ${res.status}.`);
}
