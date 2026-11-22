import { Barcode } from "@/components/Barcode";
import { PAYMENT_METHOD_LABELS, type PaymentMethod } from "@/lib/constants";
import { formatNaira } from "@/lib/money";
import { receiptPhones, type ReceiptDesign, type ReceiptWidth } from "@/lib/receiptDesign";

/**
 * The receipt itself: what prints on the roll and what the designer previews.
 * One component for both, so the preview is never a guess.
 *
 * Styling lives in globals.css under .receipt-sheet, switched by the
 * data-style / data-font / data-size attributes. Everything is black on white,
 * because thermal printers have no grey and no colour.
 */

export interface ReceiptSheetData {
  /** null when the sale was queued offline and has no server receipt number yet. */
  receiptNo: string | null;
  cashierName: string;
  items: { name: string; unit: string; quantity: number; unitPriceKobo: number; lineTotalKobo: number }[];
  subtotalKobo: number;
  discountKobo: number;
  taxKobo: number;
  totalKobo: number;
  paidKobo: number;
  balanceKobo: number;
  tenderedKobo: number;
  changeKobo: number;
  paymentMethod: PaymentMethod;
  offline: boolean;
}

export interface ReceiptSheetSettings {
  receiptWidth: ReceiptWidth;
  receiptHeader: string | null;
  receiptFooter: string;
  receiptShowLogo: boolean;
  receiptShowCashier: boolean;
}

function fmtQty(n: number) {
  return Number.isInteger(n) ? String(n) : n.toFixed(3).replace(/0+$/, "").replace(/\.$/, "");
}

export function ReceiptSheet({
  data,
  org,
  branch,
  settings,
  design,
  stamp,
  banner,
  customerName,
}: {
  /** A loud line under the header, e.g. "VOIDED" on a reprint. */
  banner?: string | null;
  customerName?: string | null;
  data: ReceiptSheetData;
  org: { name: string; phone: string | null; address?: string | null; logoUrl: string | null };
  branch: { name: string };
  settings: ReceiptSheetSettings;
  design: ReceiptDesign;
  /** Date and time already formatted in the shop's time zone. */
  stamp: string;
}) {
  if (settings.receiptWidth === "A4") {
    return (
      <ReceiptA4
        data={data}
        org={org}
        branch={branch}
        settings={settings}
        design={design}
        stamp={stamp}
        banner={banner}
        customerName={customerName}
      />
    );
  }

  const phones = receiptPhones(design, org.phone);
  const itemCount = data.items.reduce((t, i) => t + i.quantity, 0);
  const bold = design.style === "BOLD";

  return (
    <div
      className="receipt-sheet"
      data-width={settings.receiptWidth}
      data-style={design.style}
      data-font={design.font}
      data-size={design.textSize}
    >
      {/* ── Shop ───────────────────────────────────────────────────────── */}
      <header className={design.headerAlign === "LEFT" ? "r-left" : "r-center"}>
        {settings.receiptShowLogo && org.logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- a small stored logo on a printed slip
          <img src={org.logoUrl} alt="" className="r-logo" />
        ) : null}
        <div className="r-shop">{org.name}</div>
        {settings.receiptHeader ? <div className="r-tagline">{settings.receiptHeader}</div> : null}
        {design.showAddress && org.address ? <div className="r-muted">{org.address}</div> : null}
        {phones.length > 0 ? <div className="r-muted">Tel: {phones.join("  ·  ")}</div> : null}
        {design.showBranch ? <div className="r-muted">{branch.name}</div> : null}
        {design.taxId ? <div className="r-muted">{design.taxId}</div> : null}
      </header>

      {banner ? <div className="r-banner">** {banner} **</div> : null}

      <div className="r-rule" />

      {/* ── Sale details ───────────────────────────────────────────────── */}
      <div className="r-meta">
        <div className="r-row">
          <span>Receipt</span>
          <span className="r-strong">{data.receiptNo ?? "Pending sync"}</span>
        </div>
        <div className="r-row">
          <span>Date</span>
          <span>{stamp}</span>
        </div>
        {customerName ? (
          <div className="r-row">
            <span>Customer</span>
            <span>{customerName}</span>
          </div>
        ) : null}
        {settings.receiptShowCashier ? (
          <div className="r-row">
            <span>Served by</span>
            <span>{data.cashierName}</span>
          </div>
        ) : null}
      </div>

      <div className="r-rule" />

      {/* ── Items ──────────────────────────────────────────────────────── */}
      <div className="r-items">
        {data.items.map((it, i) => (
          <div key={i} className="r-item">
            <div className="r-row">
              <span className="r-item-name">
                {design.style === "CLASSIC" ? `${fmtQty(it.quantity)} x ` : ""}
                {it.name}
              </span>
              <span className="r-strong r-nowrap">{formatNaira(it.lineTotalKobo)}</span>
            </div>
            {design.showUnitPrice || design.style !== "CLASSIC" ? (
              <div className="r-sub">
                {design.style !== "CLASSIC" ? `${fmtQty(it.quantity)} ${it.unit}` : ""}
                {design.showUnitPrice ? `${design.style !== "CLASSIC" ? " x " : "@ "}${formatNaira(it.unitPriceKobo)}` : ""}
              </div>
            ) : null}
          </div>
        ))}
      </div>

      {design.showItemCount ? (
        <div className="r-sub r-count">
          {fmtQty(itemCount)} {itemCount === 1 ? "item" : "items"}
        </div>
      ) : null}

      <div className="r-rule" />

      {/* ── Money ──────────────────────────────────────────────────────── */}
      <div className="r-totals">
        {data.discountKobo > 0 || data.taxKobo > 0 ? (
          <div className="r-row">
            <span>Subtotal</span>
            <span>{formatNaira(data.subtotalKobo)}</span>
          </div>
        ) : null}
        {data.discountKobo > 0 ? (
          <div className="r-row">
            <span>Discount</span>
            <span>-{formatNaira(data.discountKobo)}</span>
          </div>
        ) : null}
        {data.taxKobo > 0 ? (
          <div className="r-row">
            <span>VAT</span>
            <span>{formatNaira(data.taxKobo)}</span>
          </div>
        ) : null}
        <div className="r-total">
          <span>{bold ? "TOTAL" : "Total"}</span>
          <span>{formatNaira(data.totalKobo)}</span>
        </div>
        <div className="r-row">
          <span>Paid ({PAYMENT_METHOD_LABELS[data.paymentMethod] ?? data.paymentMethod})</span>
          <span>{formatNaira(data.paidKobo)}</span>
        </div>
        {data.tenderedKobo > 0 && data.changeKobo > 0 ? (
          <div className="r-row">
            <span>Cash given</span>
            <span>{formatNaira(data.tenderedKobo)}</span>
          </div>
        ) : null}
        {data.changeKobo > 0 ? (
          <div className="r-row r-strong">
            <span>Change</span>
            <span>{formatNaira(data.changeKobo)}</span>
          </div>
        ) : null}
        {data.balanceKobo > 0 ? (
          <div className="r-row r-strong">
            <span>Balance owed</span>
            <span>{formatNaira(data.balanceKobo)}</span>
          </div>
        ) : null}
      </div>

      {design.showSavings && data.discountKobo > 0 ? (
        <div className="r-savings">You saved {formatNaira(data.discountKobo)} today</div>
      ) : null}

      <div className="r-rule" />

      {/* ── Footer ─────────────────────────────────────────────────────── */}
      <footer className="r-center">
        {settings.receiptFooter ? <div className="r-footer">{settings.receiptFooter}</div> : null}
        {design.extraLine ? <div className="r-muted">{design.extraLine}</div> : null}
        {design.showBarcode && data.receiptNo ? (
          <div className="r-barcode" data-value={data.receiptNo}>
            <Barcode value={data.receiptNo} symbology="CODE128" moduleWidth={1.6} height={40} fontSize={11} />
          </div>
        ) : null}
        {data.offline ? <div className="r-muted">Saved offline. Will sync when back online.</div> : null}
      </footer>
    </div>
  );
}


/**
 * The A4 layout: a full-page receipt for office printers, laid out like an
 * invoice (shop on the left, receipt details on the right, a table of items,
 * totals bottom right). It keeps the .receipt-sheet class and data attributes
 * so printing, the designer and the style options all work the same way.
 *
 * It is fluid on screen (fills its box, up to the printable width of A4), so
 * the till pop-up and the designer preview can show it without scaling.
 */
function ReceiptA4({
  data,
  org,
  branch,
  settings,
  design,
  stamp,
  banner,
  customerName,
}: {
  banner?: string | null;
  customerName?: string | null;
  data: ReceiptSheetData;
  org: { name: string; phone: string | null; address?: string | null; logoUrl: string | null };
  branch: { name: string };
  settings: ReceiptSheetSettings;
  design: ReceiptDesign;
  stamp: string;
}) {
  const phones = receiptPhones(design, org.phone);
  const itemCount = data.items.reduce((t, i) => t + i.quantity, 0);
  const method = PAYMENT_METHOD_LABELS[data.paymentMethod] ?? data.paymentMethod;

  return (
    <div
      className="receipt-sheet"
      data-width="A4"
      data-style={design.style}
      data-font={design.font}
      data-size={design.textSize}
    >
      {/* ── Shop and receipt details ───────────────────────────────────── */}
      <header className="a4-head">
        <div className="a4-shop">
          {settings.receiptShowLogo && org.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- a small stored logo on a printed page
            <img src={org.logoUrl} alt="" className="a4-logo" />
          ) : null}
          <div>
            <div className="r-shop">{org.name}</div>
            {settings.receiptHeader ? <div className="r-tagline">{settings.receiptHeader}</div> : null}
            {design.showAddress && org.address ? <div>{org.address}</div> : null}
            {phones.length > 0 ? <div>Tel: {phones.join("  ·  ")}</div> : null}
            {design.showBranch ? <div>{branch.name}</div> : null}
            {design.taxId ? <div>{design.taxId}</div> : null}
          </div>
        </div>
        <div className="a4-doc">
          <div className="a4-title">Receipt</div>
          <table className="a4-facts">
            <tbody>
              <tr>
                <th>Receipt no.</th>
                <td className="r-strong">{data.receiptNo ?? "Pending sync"}</td>
              </tr>
              <tr>
                <th>Date</th>
                <td>{stamp}</td>
              </tr>
              {settings.receiptShowCashier ? (
                <tr>
                  <th>Served by</th>
                  <td>{data.cashierName}</td>
                </tr>
              ) : null}
              <tr>
                <th>Payment</th>
                <td>{method}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </header>

      {banner ? <div className="r-banner a4-banner">** {banner} **</div> : null}

      {customerName ? (
        <div className="a4-customer">
          <span className="a4-label">Customer</span>
          <span className="r-strong">{customerName}</span>
        </div>
      ) : null}

      {/* ── Items ──────────────────────────────────────────────────────── */}
      <table className="a4-items">
        <thead>
          <tr>
            <th className="a4-num">#</th>
            <th>Item</th>
            <th className="a4-right">Qty</th>
            {design.showUnitPrice ? <th className="a4-right">Unit price</th> : null}
            <th className="a4-right">Amount</th>
          </tr>
        </thead>
        <tbody>
          {data.items.map((it, i) => (
            <tr key={i}>
              <td className="a4-num">{i + 1}</td>
              <td className="a4-name">{it.name}</td>
              <td className="a4-right r-nowrap">
                {fmtQty(it.quantity)} {it.unit}
              </td>
              {design.showUnitPrice ? <td className="a4-right r-nowrap">{formatNaira(it.unitPriceKobo)}</td> : null}
              <td className="a4-right r-nowrap r-strong">{formatNaira(it.lineTotalKobo)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* ── Notes and money ────────────────────────────────────────────── */}
      <div className="a4-bottom">
        <div className="a4-notes">
          {design.showItemCount ? (
            <div>
              {fmtQty(itemCount)} {itemCount === 1 ? "item" : "items"}
            </div>
          ) : null}
          {design.showSavings && data.discountKobo > 0 ? (
            <div className="r-strong">You saved {formatNaira(data.discountKobo)} today</div>
          ) : null}
          {settings.receiptFooter ? <div className="r-footer a4-footer">{settings.receiptFooter}</div> : null}
          {design.extraLine ? <div>{design.extraLine}</div> : null}
        </div>

        <div className="a4-totals">
          {data.discountKobo > 0 || data.taxKobo > 0 ? (
            <div className="r-row">
              <span>Subtotal</span>
              <span>{formatNaira(data.subtotalKobo)}</span>
            </div>
          ) : null}
          {data.discountKobo > 0 ? (
            <div className="r-row">
              <span>Discount</span>
              <span>-{formatNaira(data.discountKobo)}</span>
            </div>
          ) : null}
          {data.taxKobo > 0 ? (
            <div className="r-row">
              <span>VAT</span>
              <span>{formatNaira(data.taxKobo)}</span>
            </div>
          ) : null}
          <div className="r-total">
            <span>{design.style === "BOLD" ? "TOTAL" : "Total"}</span>
            <span>{formatNaira(data.totalKobo)}</span>
          </div>
          <div className="r-row">
            <span>Paid ({method})</span>
            <span>{formatNaira(data.paidKobo)}</span>
          </div>
          {data.tenderedKobo > 0 && data.changeKobo > 0 ? (
            <div className="r-row">
              <span>Cash given</span>
              <span>{formatNaira(data.tenderedKobo)}</span>
            </div>
          ) : null}
          {data.changeKobo > 0 ? (
            <div className="r-row r-strong">
              <span>Change</span>
              <span>{formatNaira(data.changeKobo)}</span>
            </div>
          ) : null}
          {data.balanceKobo > 0 ? (
            <div className="r-row r-strong">
              <span>Balance owed</span>
              <span>{formatNaira(data.balanceKobo)}</span>
            </div>
          ) : null}
        </div>
      </div>

      <footer className="a4-foot">
        {design.showBarcode && data.receiptNo ? (
          <div className="r-barcode" data-value={data.receiptNo}>
            <Barcode value={data.receiptNo} symbology="CODE128" moduleWidth={1.6} height={40} fontSize={11} />
          </div>
        ) : null}
        {data.offline ? <div>Saved offline. Will sync when back online.</div> : null}
      </footer>
    </div>
  );
}
