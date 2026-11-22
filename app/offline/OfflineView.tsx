"use client";

import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CloudOff,
  Package,
  PackageX,
  Receipt,
  RefreshCw,
  Search,
  ShoppingCart,
  Wifi,
} from "lucide-react";

import { OFFLINE_COPY_KEY } from "@/components/OfflineReady";
import { BrandMark } from "@/components/BrandMark";
import { formatNaira } from "@/lib/money";
import type { RecentSale, StoredProduct } from "@/app/pos/catalog";

type Loaded = {
  orgName: string;
  branchName: string;
  syncedAt: string | null;
  products: StoredProduct[];
  stock: Map<string, number>;
  waiting: number;
  recent: RecentSale[];
};

type State = { kind: "loading" } | { kind: "none" } | { kind: "error"; message: string } | ({ kind: "ready" } & Loaded);

const SHOW = 200;
const fmtQty = new Intl.NumberFormat("en-NG", { maximumFractionDigits: 3 });
const PAY: Record<string, string> = { CASH: "Cash", TRANSFER: "Transfer", POS: "Card/POS", CARD: "Card", CREDIT: "Credit", SPLIT: "Split" };

function statusOf(qty: number, min: number | undefined) {
  if (qty <= 0) return "out" as const;
  if (min && min > 0 && qty <= min) return "low" as const;
  return "ok" as const;
}

export function OfflineView() {
  const [state, setState] = useState<State>({ kind: "loading" });
  const [online, setOnline] = useState(true);
  const [tab, setTab] = useState<"stock" | "sales">("stock");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"all" | "low" | "out">("all");
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    const id = setTimeout(update, 0);
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      clearTimeout(id);
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      let name: string | null = null;
      try {
        name = window.localStorage.getItem(OFFLINE_COPY_KEY);
      } catch {
        name = null;
      }
      if (!name) {
        if (!cancelled) setState({ kind: "none" });
        return;
      }
      try {
        const { openPosDbByName } = await import("@/app/pos/catalog");
        const db = openPosDbByName(name);
        const [meta, products, stockRows, waiting, recent] = await Promise.all([
          db.meta.toArray(),
          db.products.toArray(),
          db.stock.toArray(),
          db.queue.count(),
          db.recent.orderBy("soldAt").reverse().limit(500).toArray(),
        ]);
        const m = new Map(meta.map((x) => [x.key, x.value]));
        const stock = new Map(stockRows.map((r) => [r.productId, r.quantity]));
        products.sort((a, b) => a.name.localeCompare(b.name));
        if (!cancelled) {
          setState({
            kind: "ready",
            orgName: m.get("orgName") ?? "Your shop",
            branchName: m.get("branchName") ?? "",
            syncedAt: m.get("syncedAt") ?? m.get("stockSince") ?? null,
            products,
            stock,
            waiting,
            recent,
          });
        }
      } catch (error) {
        if (!cancelled) setState({ kind: "error", message: error instanceof Error ? error.message : "Couldn't read the saved copy." });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const view = useMemo(() => {
    if (state.kind !== "ready") return null;
    let low = 0;
    let out = 0;
    for (const p of state.products) {
      const s = statusOf(state.stock.get(p.id) ?? 0, p.minStock);
      if (s === "out") out++;
      else if (s === "low") low++;
    }
    const q = query.trim().toLowerCase();
    const matches: StoredProduct[] = [];
    let total = 0;
    for (const p of state.products) {
      const s = statusOf(state.stock.get(p.id) ?? 0, p.minStock);
      if (filter !== "all" && s !== filter) continue;
      if (q && !(p.name.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q) || (p.barcode ?? "").includes(q))) continue;
      total++;
      if (matches.length < SHOW) matches.push(p);
    }
    const today = new Date().toDateString();
    const todays = state.recent.filter((r) => new Date(r.soldAt).toDateString() === today);
    return {
      low,
      out,
      matches,
      total,
      todayCount: todays.length,
      todayKobo: todays.reduce((t, r) => t + r.totalKobo, 0),
    };
  }, [state, query, filter]);

  const when = (iso: string | null) =>
    iso
      ? new Intl.DateTimeFormat("en-NG", { dateStyle: "medium", timeStyle: "short" }).format(new Date(iso))
      : "unknown";

  return (
    <div className="min-h-dvh bg-canvas">
      <header className="texture-waves bg-navy-950 text-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-4">
          <div className="flex items-center gap-3">
            <BrandMark size={36} ring />
            <div>
              <p className="font-bold leading-tight">{state.kind === "ready" ? state.orgName : "Coderswurld Inventory"}</p>
              <p className="text-xs text-white/60">
                Offline view{state.kind === "ready" && state.branchName ? ` · ${state.branchName}` : ""}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <a href="/pos" className="btn btn-sm rounded-full bg-sell-600 px-4 text-white hover:bg-sell-700">
              <ShoppingCart className="size-4" />
              Open the till
            </a>
            {online ? (
              <a href="/dashboard" className="btn btn-sm rounded-full bg-white px-4 text-navy-900 hover:bg-navy-50">
                Open the full app
              </a>
            ) : null}
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl space-y-5 px-4 py-6">
        <div
          className={`flex flex-wrap items-center gap-3 rounded-2xl border px-4 py-3 text-sm ${
            online ? "border-good-200 bg-good-50 text-good-700" : "border-warn-200 bg-warn-50 text-warn-700"
          }`}
        >
          {online ? <Wifi className="size-5 shrink-0" /> : <CloudOff className="size-5 shrink-0" />}
          <p className="min-w-0 flex-1">
            {online ? (
              <>
                <b>You&apos;re back online.</b> Open the full app to make changes.
              </>
            ) : (
              <>
                <b>No internet.</b> Showing what this computer saved
                {state.kind === "ready" ? ` on ${when(state.syncedAt)}` : ""}. You can look and search; changes need the
                internet. Selling works as normal on the till.
              </>
            )}
          </p>
        </div>

        {state.kind === "loading" && (
          <p className="flex items-center gap-2 py-16 text-ink-500">
            <RefreshCw className="size-4 animate-spin" /> Opening the saved copy…
          </p>
        )}

        {state.kind === "none" && (
          <div className="card mx-auto max-w-lg rounded-3xl p-8 text-center">
            <CloudOff className="mx-auto size-10 text-ink-300" />
            <h1 className="mt-3 text-lg font-bold text-ink-950">Nothing saved on this computer yet</h1>
            <p className="mt-1 text-sm text-ink-600">
              Sign in and open Coderswurld once while you have internet. It saves a copy of your products and stock in the
              background, and this page shows it next time the internet goes.
            </p>
          </div>
        )}

        {state.kind === "error" && (
          <p className="flex items-center gap-2 rounded-xl border border-bad-200 bg-bad-50 px-4 py-3 text-sm text-bad-700">
            <AlertTriangle className="size-4" /> {state.message}
          </p>
        )}

        {state.kind === "ready" && view && (
          <>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <Tile icon={Package} label="Products saved" value={fmtQty.format(state.products.length)} />
              <Tile icon={PackageX} label="Out of stock" value={fmtQty.format(view.out)} tone="bad" />
              <Tile icon={AlertTriangle} label="Running low" value={fmtQty.format(view.low)} tone="warn" />
              <Tile
                icon={Receipt}
                label="Sold today on this computer"
                value={formatNaira(view.todayKobo)}
                note={`${view.todayCount} sale${view.todayCount === 1 ? "" : "s"}${state.waiting ? ` · ${state.waiting} waiting to send` : ""}`}
              />
            </div>

            <div className="flex gap-1 rounded-full bg-white p-1 shadow-sm ring-1 ring-hairline sm:w-fit">
              {(
                [
                  ["stock", "Products and stock"],
                  ["sales", "Sales on this computer"],
                ] as const
              ).map(([k, label]) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setTab(k)}
                  className={`flex-1 rounded-full px-4 py-2 text-sm font-semibold sm:flex-none ${
                    tab === k ? "bg-navy-700 text-white" : "text-ink-600 hover:text-ink-950"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            {tab === "stock" ? (
              <section className="card overflow-hidden rounded-3xl">
                <div className="flex flex-wrap items-center gap-2 border-b border-hairline p-4">
                  <div className="relative min-w-[min(100%,16rem)] flex-1">
                    <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-400" />
                    <input
                      className="input h-10 w-full pl-9"
                      placeholder="Search by name, SKU or barcode"
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                    />
                  </div>
                  {(["all", "low", "out"] as const).map((f) => (
                    <button
                      key={f}
                      type="button"
                      onClick={() => setFilter(f)}
                      className={`rounded-full px-3 py-1.5 text-sm font-semibold ring-1 ${
                        filter === f ? "bg-navy-700 text-white ring-navy-700" : "text-ink-600 ring-hairline hover:text-ink-950"
                      }`}
                    >
                      {f === "all" ? "All" : f === "low" ? `Low (${view.low})` : `Out (${view.out})`}
                    </button>
                  ))}
                </div>
                <div className="overflow-x-auto">
                  <table className="data-table min-w-[640px]">
                    <thead>
                      <tr>
                        <th>Product</th>
                        <th>Barcode</th>
                        <th data-numeric>Price</th>
                        <th data-numeric>Wholesale</th>
                        <th data-numeric>In stock</th>
                      </tr>
                    </thead>
                    <tbody>
                      {view.matches.map((p) => {
                        const qty = state.stock.get(p.id) ?? 0;
                        const s = statusOf(qty, p.minStock);
                        return (
                          <tr key={p.id}>
                            <td>
                              <span className="font-medium text-ink-900">{p.name}</span>
                              <span className="block text-xs text-ink-400">{p.sku}</span>
                            </td>
                            <td className="text-ink-600">{p.barcode ?? "-"}</td>
                            <td data-numeric className="tabular font-semibold">{formatNaira(p.sellingPriceKobo)}</td>
                            <td data-numeric className="tabular text-ink-600">
                              {p.wholesalePriceKobo ? formatNaira(p.wholesalePriceKobo) : "-"}
                            </td>
                            <td data-numeric>
                              <span
                                className={`tabular font-bold ${s === "out" ? "text-bad-700" : s === "low" ? "text-warn-700" : "text-ink-900"}`}
                              >
                                {fmtQty.format(qty)} {p.unit}
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <p className="border-t border-hairline px-4 py-3 text-xs text-ink-500">
                  {view.total === 0
                    ? "Nothing matches."
                    : view.total > SHOW
                      ? `Showing ${SHOW} of ${fmtQty.format(view.total)}. Search to narrow it down.`
                      : `${fmtQty.format(view.total)} product${view.total === 1 ? "" : "s"}.`}{" "}
                  Stock as of the last save; sales made since on other computers are not included.
                </p>
              </section>
            ) : (
              <section className="card overflow-hidden rounded-3xl">
                {state.recent.length === 0 ? (
                  <p className="px-4 py-12 text-center text-sm text-ink-500">
                    No sales saved on this computer yet. Sales made on this computer&apos;s till show here.
                  </p>
                ) : (
                  <ul className="divide-y divide-hairline">
                    {state.recent.map((r) => (
                      <li key={r.localId}>
                        <button
                          type="button"
                          onClick={() => setOpen(open === r.localId ? null : r.localId)}
                          className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-ink-50"
                        >
                          <span className="min-w-0 flex-1">
                            <span className="block text-sm font-semibold text-ink-950">
                              {r.receiptNo ?? "Waiting to send"}
                              {r.offline ? <span className="badge badge-warn ml-2">Made offline</span> : null}
                            </span>
                            <span className="block text-xs text-ink-500">
                              {when(r.soldAt)} · {r.cashierName} · {r.items.length} item{r.items.length === 1 ? "" : "s"} ·{" "}
                              {PAY[r.paymentMethod] ?? r.paymentMethod}
                            </span>
                          </span>
                          <span className="tabular text-sm font-bold text-ink-950">{formatNaira(r.totalKobo)}</span>
                        </button>
                        {open === r.localId ? (
                          <ul className="bg-ink-50 px-6 py-2 text-sm">
                            {r.items.map((it, i) => (
                              <li key={i} className="flex justify-between py-1">
                                <span className="text-ink-700">
                                  {fmtQty.format(it.quantity)} {it.unit} {it.name}
                                </span>
                                <span className="tabular text-ink-900">{formatNaira(it.lineTotalKobo)}</span>
                              </li>
                            ))}
                          </ul>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            )}
          </>
        )}
      </main>
    </div>
  );
}

function Tile({
  icon: Icon,
  label,
  value,
  note,
  tone,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  note?: string;
  tone?: "bad" | "warn";
}) {
  return (
    <div className="card rounded-2xl p-4">
      <Icon className={`size-5 ${tone === "bad" ? "text-bad-700" : tone === "warn" ? "text-warn-700" : "text-navy-700"}`} />
      <p className="mt-2 text-xs font-bold uppercase leading-tight tracking-wide text-ink-500">{label}</p>
      <p className="tabular mt-0.5 text-xl font-extrabold text-ink-950">{value}</p>
      {note ? <p className="text-xs text-ink-500">{note}</p> : null}
    </div>
  );
}
