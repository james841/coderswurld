/**
 * Print just one receipt, on its own.
 *
 * window.print() prints the whole page; on a long page that means blank extra
 * pages after the receipt, which waste a roll of thermal paper. This copies the
 * receipt and the page's styles into a separate frame and prints only that, so
 * the printer gets exactly one receipt and nothing else.
 *
 * The frame is real-sized and parked off-screen, not 0x0 or hidden: Chrome can
 * print a zero-size or visibility:hidden frame as a blank page, or not at all.
 * It also always prints, even if a stylesheet or logo is slow or fails to load,
 * and falls back to printing the page if the frame can't be used.
 *
 * Works with Chrome's --kiosk-printing (silent printing) like a normal print.
 */
import { sheetToEscPos } from "./escpos";
import { getDirectPrint, sendToPrinter } from "./directPrint";

/** A short message in the corner, for print results. Plain DOM: works on any page. */
function notice(text: string, tone: "good" | "bad") {
  document.getElementById("cw-print-notice")?.remove();
  const el = document.createElement("div");
  el.id = "cw-print-notice";
  el.setAttribute("role", "status");
  el.textContent = text;
  el.style.cssText = `position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:9999;max-width:min(92vw,520px);
    padding:12px 16px;border-radius:14px;font:600 14px/1.4 system-ui,sans-serif;color:#fff;
    background:${tone === "good" ? "#15803d" : "#b91c1c"};box-shadow:0 10px 30px rgba(0,0,0,.25);
    transition:opacity .3s, transform .3s;opacity:0`;
  document.body.appendChild(el);
  requestAnimationFrame(() => (el.style.opacity = "1"));
  setTimeout(() => {
    el.style.opacity = "0";
    setTimeout(() => el.remove(), 400);
  }, tone === "good" ? 2200 : 7000);
}

/**
 * Print a receipt. With direct printing switched on for this computer, it goes
 * straight to the printer through the Coderswurld Print Helper: no window.
 * Otherwise, or if direct printing fails, the browser's print window opens.
 */
export async function printReceipt(sheet: HTMLElement | null): Promise<void> {
  const direct = getDirectPrint();
  if (direct.enabled && sheet) {
    try {
      const bytes = await sheetToEscPos(sheet, { openDrawer: direct.openDrawer });
      await sendToPrinter(bytes, direct);
      notice("Sent to the printer", "good");
      return;
    } catch (error) {
      notice(
        `Direct printing failed: ${error instanceof Error ? error.message : "unknown error"} Opening the normal print window instead.`,
        "bad",
      );
    }
  }
  browserPrint(sheet);
}

/** The browser's own print window, showing just this receipt. */
function browserPrint(sheet: HTMLElement | null): void {
  if (!sheet) {
    window.print();
    return;
  }

  // Remove a frame left over from an earlier print.
  document.getElementById("cw-print-frame")?.remove();

  const frame = document.createElement("iframe");
  frame.id = "cw-print-frame";
  frame.setAttribute("aria-hidden", "true");
  frame.setAttribute("tabindex", "-1");
  frame.style.cssText =
    "position:fixed;left:-10000px;top:0;width:80mm;height:200mm;border:0;opacity:0;pointer-events:none";
  document.body.appendChild(frame);

  const doc = frame.contentDocument;
  const win = frame.contentWindow;
  if (!doc || !win) {
    frame.remove();
    window.print();
    return;
  }

  const styles = [...document.querySelectorAll('style, link[rel="stylesheet"]')]
    .map((n) => n.outerHTML)
    .join("\n");

  let printed = false;
  const go = () => {
    if (printed) return;
    printed = true;
    try {
      win.focus();
      win.print();
    } catch {
      // Some browsers refuse to print from a frame: print the page instead.
      window.print();
    }
    // Give the print dialog time to take its copy before the frame goes.
    setTimeout(() => frame.remove(), 60_000);
  };

  // Listen before writing, so a fast load is never missed.
  frame.addEventListener("load", () => setTimeout(go, 150), { once: true });

  doc.open();
  doc.write(`<!doctype html><html><head><meta charset="utf-8"><title>Receipt</title>${styles}
<style>
  @page { margin: 0; size: auto; }
  html, body { margin: 0; padding: 0; background: #fff; }
  .receipt-sheet { margin: 0 auto; box-shadow: none !important; }
</style></head><body>${sheet.outerHTML}</body></html>`);
  doc.close();

  // Wait for images (the shop logo) when there are any, but never forever.
  const images = [...doc.images].filter((img) => !img.complete);
  if (images.length) {
    Promise.all(
      images.map(
        (img) =>
          new Promise<void>((resolve) => {
            img.addEventListener("load", () => resolve(), { once: true });
            img.addEventListener("error", () => resolve(), { once: true });
          }),
      ),
    ).then(() => setTimeout(go, 100));
  }
  // A slow stylesheet or a load event that never comes must not block printing.
  setTimeout(go, 1500);
}
