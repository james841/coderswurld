/**
 * Turn a rendered receipt (.receipt-sheet) into ESC/POS printer commands.
 *
 * Reading the sheet that is already on screen means a direct print and a
 * browser print always say the same thing: one layout (ReceiptSheet), two ways
 * out. The printer then draws the text in its own built-in font, which is the
 * sharpest a thermal printer can do.
 *
 * Thermal printers only know plain letters, so "₦" prints as "N" (as on most
 * Nigerian till slips) and other symbols become their nearest plain letter.
 */

const ESC = 0x1b;
const GS = 0x1d;

/** Characters per line in the printer's normal font (Font A, 12 dots wide). */
function columnsFor(width: string | null): number {
  return width === "58mm" ? 32 : 48;
}

/** Plain letters only: what every receipt printer can draw. */
export function toPrinterText(s: string): string {
  return s
    .replace(/₦/g, "N")
    .replace(/[·•]/g, "-")
    .replace(/[×✕]/g, "x")
    .replace(/[‘’`]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/…/g, "...")
    .replace(/ /g, " ")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^\x20-\x7e\n]/g, "?");
}

function wrap(text: string, width: number): string[] {
  const out: string[] = [];
  for (const para of text.split("\n")) {
    let line = "";
    for (const word of para.split(/\s+/).filter(Boolean)) {
      if (!line) line = word;
      else if (line.length + 1 + word.length <= width) line += " " + word;
      else {
        out.push(line);
        line = word;
      }
      while (line.length > width) {
        out.push(line.slice(0, width));
        line = line.slice(width);
      }
    }
    out.push(line);
  }
  return out;
}

class Receipt {
  private bytes: number[] = [];
  constructor(readonly cols: number) {}
  raw(...b: number[]) {
    this.bytes.push(...b);
    return this;
  }
  text(s: string) {
    for (const ch of toPrinterText(s)) this.bytes.push(ch.charCodeAt(0));
    return this;
  }
  line(s = "") {
    return this.text(s).raw(0x0a);
  }
  align(a: "left" | "center" | "right") {
    return this.raw(ESC, 0x61, a === "left" ? 0 : a === "center" ? 1 : 2);
  }
  bold(on: boolean) {
    return this.raw(ESC, 0x45, on ? 1 : 0);
  }
  /** 1 or 2 times wider / taller. */
  size(w: 1 | 2, h: 1 | 2) {
    return this.raw(GS, 0x21, ((w - 1) << 4) | (h - 1));
  }
  /** Text on the left, amount on the right, on one line when it fits. */
  row(left: string, right: string, width = this.cols) {
    left = toPrinterText(left.trim());
    right = toPrinterText(right.trim());
    if (left.length + 1 + right.length <= width) {
      return this.line(left + " ".repeat(width - left.length - right.length) + right);
    }
    const lines = wrap(left, Math.max(8, width - right.length - 1));
    lines.forEach((l, i) => {
      if (i === lines.length - 1 && l.length + 1 + right.length <= width) {
        this.line(l + " ".repeat(width - l.length - right.length) + right);
      } else {
        this.line(l);
        if (i === lines.length - 1) this.line(" ".repeat(Math.max(0, width - right.length)) + right);
      }
    });
    return this;
  }
  rule(ch = "-") {
    return this.line(ch.repeat(this.cols));
  }
  wrapped(s: string, width = this.cols) {
    wrap(toPrinterText(s), width).forEach((l) => this.line(l));
    return this;
  }
  /** CODE128 barcode with the number printed under it. */
  barcode(value: string) {
    const data = toPrinterText(value);
    const payload = [0x7b, 0x42, ...[...data].map((c) => c.charCodeAt(0))]; // "{B" = code set B
    return this.raw(GS, 0x68, 60) // height in dots
      .raw(GS, 0x77, 2) // bar width
      .raw(GS, 0x48, 2) // number below
      .raw(GS, 0x66, 0) // font A for the number
      .raw(GS, 0x6b, 73, payload.length, ...payload)
      .raw(0x0a);
  }
  /** A black-and-white picture (the shop logo). */
  image(bits: { width: number; height: number; data: Uint8Array }) {
    const bytesPerRow = Math.ceil(bits.width / 8);
    this.raw(GS, 0x76, 0x30, 0, bytesPerRow & 0xff, bytesPerRow >> 8, bits.height & 0xff, bits.height >> 8);
    for (let i = 0; i < bits.data.length; i++) this.bytes.push(bits.data[i]);
    return this.raw(0x0a);
  }
  done() {
    return new Uint8Array(this.bytes);
  }
}

const textOf = (el: Element | null | undefined) => (el?.textContent ?? "").replace(/\s+/g, " ").trim();

/** Two-column row: first and last child text. */
function rowParts(el: Element): [string, string] {
  const spans = [...el.children];
  if (spans.length >= 2) return [textOf(spans[0]), textOf(spans[spans.length - 1])];
  return [textOf(el), ""];
}

/** Draw the logo into black-and-white dots. Null when it can't be read (another site's picture without permission). */
async function logoBits(img: HTMLImageElement, maxDots: number) {
  try {
    if (!img.complete) await new Promise((r) => img.addEventListener("load", r, { once: true }));
    if (!img.naturalWidth) return null;
    const width = Math.min(maxDots, img.naturalWidth);
    const height = Math.min(200, Math.round((img.naturalHeight * width) / img.naturalWidth));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(img, 0, 0, width, height);
    const px = ctx.getImageData(0, 0, width, height).data; // throws if the picture is from a site that didn't allow it
    const bytesPerRow = Math.ceil(width / 8);
    const data = new Uint8Array(bytesPerRow * height);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        const lum = 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
        if (lum < 150 && px[i + 3] > 64) data[y * bytesPerRow + (x >> 3)] |= 0x80 >> (x & 7);
      }
    }
    return { width: bytesPerRow * 8, height, data };
  } catch {
    return null;
  }
}

export async function sheetToEscPos(sheet: HTMLElement, opts: { openDrawer?: boolean } = {}): Promise<Uint8Array> {
  const cols = columnsFor(sheet.getAttribute("data-width"));
  const r = new Receipt(cols);
  const ruleChar = sheet.getAttribute("data-style") === "BOLD" ? "=" : "-";
  r.raw(ESC, 0x40).raw(ESC, 0x74, 0); // reset, plain character set

  for (const block of [...sheet.children]) {
    const cls = block.classList;
    if (block.tagName === "HEADER") {
      r.align(cls.contains("r-left") ? "left" : "center");
      for (const el of [...block.children]) {
        if (el.tagName === "IMG") {
          const bits = await logoBits(el as HTMLImageElement, cols === 32 ? 256 : 384);
          if (bits) r.image(bits);
        } else if (el.classList.contains("r-shop")) {
          r.bold(true).size(2, 2).wrapped(textOf(el), Math.floor(cols / 2)).size(1, 1).bold(false);
        } else if (el.classList.contains("r-tagline")) {
          r.bold(true).wrapped(textOf(el)).bold(false);
        } else {
          r.wrapped(textOf(el));
        }
      }
      r.align("left");
    } else if (cls.contains("r-rule")) {
      r.rule(ruleChar);
    } else if (cls.contains("r-banner")) {
      r.align("center").bold(true).wrapped(textOf(block)).bold(false).align("left");
    } else if (cls.contains("r-meta") || cls.contains("r-totals")) {
      for (const el of [...block.children]) {
        const [left, right] = rowParts(el);
        if (el.classList.contains("r-total")) {
          r.bold(true).size(1, 2).row(left, right).size(1, 1).bold(false);
        } else {
          const strong = el.classList.contains("r-strong");
          if (strong) r.bold(true);
          r.row(left, right);
          if (strong) r.bold(false);
        }
      }
    } else if (cls.contains("r-items")) {
      for (const item of [...block.children]) {
        for (const el of [...item.children]) {
          if (el.classList.contains("r-row")) {
            const [left, right] = rowParts(el);
            r.row(left, right);
          } else {
            // The "2 pcs x N500" line under an item, indented so it reads as part of it.
            wrap(toPrinterText(textOf(el)), cols - 2).forEach((l) => r.line("  " + l));
          }
        }
      }
    } else if (cls.contains("r-savings")) {
      r.align("center").bold(true).wrapped(textOf(block)).bold(false).align("left");
    } else if (block.tagName === "FOOTER") {
      r.align("center");
      for (const el of [...block.children]) {
        if (el.classList.contains("r-barcode")) {
          const value = el.getAttribute("data-value");
          if (value) r.raw(0x0a).barcode(value);
        } else if (el.classList.contains("r-footer")) {
          r.bold(true);
          for (const para of (el.textContent ?? "").split("\n")) r.wrapped(para);
          r.bold(false);
        } else {
          r.wrapped(textOf(el));
        }
      }
      r.align("left");
    } else {
      const t = textOf(block);
      if (t) r.wrapped(t);
    }
  }

  r.raw(ESC, 0x64, 4); // feed past the cutter
  if (opts.openDrawer) r.raw(ESC, 0x70, 0, 25, 250); // kick the cash drawer
  r.raw(GS, 0x56, 66, 0); // cut
  return r.done();
}
