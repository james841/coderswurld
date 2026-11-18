/**
 * Print just one receipt, on its own.
 *
 * window.print() prints the whole page; on a long page that means blank extra
 * pages after the receipt, which waste a roll of thermal paper. This copies the
 * receipt and the page's styles into a hidden frame and prints only that, so
 * the printer gets exactly one receipt and nothing else.
 *
 * Works with Chrome's --kiosk-printing (silent printing) like a normal print.
 */
export function printReceipt(sheet: HTMLElement | null): void {
  if (!sheet) {
    window.print();
    return;
  }
  const frame = document.createElement("iframe");
  frame.setAttribute("aria-hidden", "true");
  frame.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden";
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
  doc.open();
  doc.write(`<!doctype html><html><head><meta charset="utf-8">${styles}
<style>
  @page { margin: 0; size: auto; }
  html, body { margin: 0; padding: 0; background: #fff; }
  .receipt-sheet { margin: 0 auto; box-shadow: none !important; }
</style></head><body>${sheet.outerHTML}</body></html>`);
  doc.close();

  const go = () => {
    win.focus();
    win.print();
    // Give the print dialog time to take its copy before the frame goes.
    setTimeout(() => frame.remove(), 1500);
  };
  // Wait for the stylesheets (and a logo, if any) to load first.
  if (doc.readyState === "complete") setTimeout(go, 250);
  else frame.addEventListener("load", () => setTimeout(go, 100), { once: true });
}
