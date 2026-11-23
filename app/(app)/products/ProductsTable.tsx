"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";

import { LayoutGrid, List, Pencil, Trash2 } from "lucide-react";

import { Stagger, StaggerItem } from "@/components/motion";
import { Sheet } from "@/components/ui/Sheet";
import { formatNaira, marginPercent } from "@/lib/money";
import { useBarcodeScanner } from "./useBarcodeScanner";

/**
 * The product table.
 *
 * Three behaviours are load-bearing and everything else is arranged around them:
 *
 * 1. FIRST PAINT IS FREE. The rows arrive as props from the Server Component, so
 *    the table is already full before any JavaScript runs. `initialQuery` is
 *    remembered as "the query I am already showing", and the mount effect skips
 *    the fetch that would otherwise immediately re-request what is on screen.
 *
 * 2. RE-FETCHING NEVER BLANKS THE TABLE. Search, filters and paging swap the
 *    rows in place; the old ones stay visible (dimmed under a thin progress bar)
 *    until the new ones land. A spinner in the middle of a data table is a
 *    promise to throw the shopkeeper's context away for a second, and this
 *    screen is used fifty times a day.
 *
 * 3. EXPLICIT PAGING. There is no infinite scroll. A shopkeeper who needs to
 *    find "the third page of Drinks" relies on the page being a thing that
 *    exists, not a length of scroll string.
 */
export interface ProductRow {
  department?: string;
  id: string;
  name: string;
  sku: string;
  barcode: string | null;
  unit: string;
  sellingPriceKobo: number;
  wholesalePriceKobo: number;
  costPriceKobo?: number;
  minStock: number;
  trackExpiry: boolean;
  expiryDate: string | null;
  entryDate: string | null;
  isActive: boolean;
  version: number;
  imageUrl: string | null;
  category: { id: string; name: string } | null;
  supplier: { id: string; name: string } | null;
  quantity: number;
}

export interface ProductListPage {
  items: ProductRow[];
  page: number;
  perPage: number;
  total: number;
  pages: number;
}

export interface ListQuery {
  q?: string;
  categoryId?: string;
  supplierId?: string;
  department?: "SUPERMARKET" | "PHARMACY";
  stock?: "LOW" | "OUT" | "EXPIRING" | "EXPIRED";
  sort?: "name" | "recent" | "price" | "stock" | "expiry";
  page?: number;
  perPage?: number;
  includeInactive?: boolean;
}

export interface ProductsCounts {
  all: number;
  low: number;
  out: number;
  expiring: number;
  expired: number;
}

export interface ProductsCan {
  edit: boolean;
  delete: boolean;
  cost: boolean;
  barcode: boolean;
}

type StockFilter = ListQuery["stock"];
type SortKey = NonNullable<ListQuery["sort"]>;

/**
 * A stock-health chip. `active` is the class the chip wears when it is the
 * filter in force — the hue *is* the meaning, so "Out" turns red when you are
 * looking at the out-of-stock list and stays neutral when you are not.
 */
interface Chip {
  key: "ALL" | "LOW" | "OUT" | "EXPIRING" | "EXPIRED";
  label: string;
  count: number;
  active: string;
}

// ── The list / cards choice ──────────────────────────────────────────────────
// Kept outside React so it can be read during render without an effect: the
// page opens straight into the view the person used last, with no flicker
// from table to cards after load.
type ProductView = "table" | "grid";
const VIEW_KEY = "cw:products:view";
const viewListeners = new Set<() => void>();
/** Used when the browser refuses storage (private window), so the toggle still works. */
let viewInMemory: ProductView | null = null;

function readView(): ProductView {
  if (viewInMemory) return viewInMemory;
  try {
    const saved = window.localStorage.getItem(VIEW_KEY);
    if (saved === "grid" || saved === "table") return saved;
  } catch {
    // Storage refused: fall through to the screen-size default.
  }
  // Nothing chosen yet: cards on a phone (the table is too wide), table elsewhere.
  return window.matchMedia?.("(max-width: 639px)").matches ? "grid" : "table";
}

function writeView(next: ProductView) {
  viewInMemory = next;
  try {
    window.localStorage.setItem(VIEW_KEY, next);
  } catch {
    // Not remembered after this visit. Nothing else is affected.
  }
  viewListeners.forEach((listener) => listener());
}

function subscribeView(listener: () => void) {
  viewListeners.add(listener);
  return () => {
    viewListeners.delete(listener);
  };
}

export function ProductsTable({
  initial,
  initialQuery,
  categories,
  suppliers,
  counts,
  can,
  expiryWarningDays,
  departments,
}: {
  /** Present when the shop runs Supermarket and Pharmacy departments. */
  departments?: { locked: string | null };
  initial: ProductListPage;
  initialQuery: ListQuery;
  categories: { id: string; name: string }[];
  suppliers: { id: string; name: string }[];
  counts: ProductsCounts;
  can: ProductsCan;
  expiryWarningDays: number;
}) {
  const router = useRouter();

  const [rows, setRows] = useState<ProductRow[]>(initial.items);
  const [page, setPage] = useState(initial.page);
  const [pages, setPages] = useState(initial.pages);
  const [total, setTotal] = useState(initial.total);

  const [search, setSearch] = useState(initialQuery.q ?? "");
  const [debouncedQ, setDebouncedQ] = useState(initialQuery.q ?? "");
  const [categoryId, setCategoryId] = useState(initialQuery.categoryId ?? "");
  const [supplierId, setSupplierId] = useState(initialQuery.supplierId ?? "");
  const [department, setDepartment] = useState<string>(initialQuery.department ?? "");
  const [stock, setStock] = useState<StockFilter>(initialQuery.stock);
  const [sort, setSort] = useState<SortKey>(initialQuery.sort ?? "recent");
  const [includeInactive, setIncludeInactive] = useState(
    Boolean(initialQuery.includeInactive),
  );

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  // Table or cards. Remembered on this device only: it is a personal viewing
  // habit, not business data, so it does not belong in the database.
  const view = useSyncExternalStore(subscribeView, readView, () => "table" as const);
  const chooseView = writeView;

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [armedId, setArmedId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  /** "Every product matching these filters" was chosen, for this filter set only. */
  const [allFor, setAllFor] = useState<string | null>(null);
  const [confirmBulk, setConfirmBulk] = useState(false);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  // The query whose result is already on screen. Starts at the server's query so
  // the mount effect below has nothing to do; bumped by every refetch trigger.
  const shownKey = useRef(queryKey(initialQuery));
  // Arm-then-confirm auto-disarms, so a stray click can't sit loaded for minutes.
  const disarmTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Refetching ────────────────────────────────────────────────────────────
  // One effect owns every fetch. Debounced search, each dropdown and the page
  // number all write to state that lands in this effect's key; a change to the
  // key is a change to what should be on screen.
  const key = queryKey({
    q: debouncedQ || undefined,
    categoryId: categoryId || undefined,
    supplierId: supplierId || undefined,
    department: (department || undefined) as ListQuery["department"],
    stock,
    sort,
    page,
    perPage: initial.perPage,
    includeInactive,
  });

  useEffect(() => {
    if (shownKey.current === key) return;
    shownKey.current = key;

    const controller = new AbortController();
    setLoading(true);

    const params = new URLSearchParams();
    if (debouncedQ) params.set("q", debouncedQ);
    if (categoryId) params.set("categoryId", categoryId);
    if (supplierId) params.set("supplierId", supplierId);
    if (department) params.set("department", department);
    if (stock) params.set("stock", stock);
    if (sort !== "recent") params.set("sort", sort);
    if (page > 1) params.set("page", String(page));
    if (includeInactive) params.set("includeInactive", "true");

    fetch(`/api/products?${params.toString()}`, { signal: controller.signal })
      .then(async (res) => {
        if (!res.ok) throw new Error(`Request failed (${res.status})`);
        return (await res.json()) as ProductListPage;
      })
      .then((data) => {
        setRows(data.items);
        setPages(data.pages);
        setTotal(data.total);
        setError(null);
        setLoading(false);
        // Removing the last product on the last page leaves the page number past
        // the end of the list. Fall back to the final page that still has rows
        // rather than showing an empty table that looks like the shop's data
        // vanished. Changing `page` re-runs this effect with the corrected value.
        if (data.items.length === 0 && page > 1 && data.pages >= 1) {
          setPage(data.pages);
        }
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setError("Couldn't load products. Check your connection and try again.");
        setLoading(false);
      });

    return () => controller.abort();
    // The dependency list is the key: any filter change re-runs this. `tick` is
    // the explicit "refresh now" handle used after a mutation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, tick]);

  // Debounce the search box so typing a six-letter name is one request, not six.
  useEffect(() => {
    const id = setTimeout(() => {
      setDebouncedQ(search);
      setPage(1);
    }, 300);
    return () => clearTimeout(id);
  }, [search]);

  const reload = useCallback(() => {
    // Force the effect to run even if the key is unchanged — after a deactivate,
    // the query is identical but the answer is not.
    shownKey.current = "";
    setTick((t) => t + 1);
  }, []);

  // A hardware scanner typing into a search box is the same burst this hook
  // detects; a real scan jumps straight to the one product it names.
  useBarcodeScanner((code) => {
    setSearch(code);
    setDebouncedQ(code);
    setPage(1);
  });

  useEffect(() => {
    return () => {
      if (disarmTimer.current) clearTimeout(disarmTimer.current);
    };
  }, []);

  // ── Derived ───────────────────────────────────────────────────────────────
  const chips: Chip[] = useMemo(
    () => [
      { key: "ALL", label: "All", count: counts.all, active: "chip chip-active-all" },
      { key: "LOW", label: "Low", count: counts.low, active: "chip chip-active-low" },
      { key: "OUT", label: "Out", count: counts.out, active: "chip chip-active-out" },
      {
        key: "EXPIRING",
        label: `Expiring soon`,
        count: counts.expiring,
        active: "chip chip-active-expiring",
      },
      {
        key: "EXPIRED",
        label: "Expired",
        count: counts.expired,
        active: "chip chip-active-out",
      },
    ],
    [counts],
  );

  const filtered =
    Boolean(debouncedQ) ||
    Boolean(categoryId) ||
    Boolean(supplierId) ||
    Boolean(department) ||
    Boolean(stock) ||
    includeInactive;

  const starting = total === 0 ? 0 : (page - 1) * initial.perPage + 1;
  const ending = Math.min(page * initial.perPage, total);

  // ── Actions ───────────────────────────────────────────────────────────────
  function arm(id: string) {
    if (disarmTimer.current) clearTimeout(disarmTimer.current);
    setArmedId(id);
    disarmTimer.current = setTimeout(() => setArmedId(null), 4000);
  }

  async function deactivate(row: ProductRow) {
    setBusyId(row.id);
    try {
      const res = await fetch(`/api/products/${row.id}`, { method: "DELETE" });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setError(body?.error ?? "Couldn't remove that product.");
      } else {
        setError(null);
        setArmedId(null);
        reload();
        router.refresh(); // chip counts live on the server; ask for fresh ones
      }
    } catch {
      setError("Couldn't reach the server. Check your connection.");
    } finally {
      setBusyId(null);
    }
  }

  async function restore(row: ProductRow) {
    setBusyId(row.id);
    try {
      const res = await fetch(`/api/products/${row.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: true }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setError(body?.error ?? "Couldn't put that product back.");
      } else {
        setError(null);
        reload();
        router.refresh();
      }
    } catch {
      setError("Couldn't reach the server. Check your connection.");
    } finally {
      setBusyId(null);
    }
  }

  function toggleSelected(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    setSelected((prev) => {
      if (prev.size === rows.length) return new Set();
      return new Set(rows.map((r) => r.id));
    });
  }

  function clearFilters() {
    setSearch("");
    setDebouncedQ("");
    setCategoryId("");
    setSupplierId("");
    setDepartment("");
    setStock(undefined);
    setIncludeInactive(false);
    setPage(1);
  }

  function changeStock(next: StockFilter) {
    setStock(next === stock ? undefined : next);
    setPage(1);
  }

  const allSelected = rows.length > 0 && rows.every((r) => selected.has(r.id));
  // The filters only (not page or sort): "all matching" means these filters.
  const filterKey = JSON.stringify([debouncedQ, categoryId, supplierId, department, stock ?? "", includeInactive]);
  const allMatching = allFor === filterKey && allSelected;
  const selectedCount = allMatching ? total : selected.size;

  function clearSelection() {
    setSelected(new Set());
    setAllFor(null);
  }

  async function bulkDelete() {
    setBulkBusy(true);
    try {
      const body = allMatching
        ? {
            all: true,
            query: {
              ...(debouncedQ ? { q: debouncedQ } : {}),
              ...(categoryId ? { categoryId } : {}),
              ...(supplierId ? { supplierId } : {}),
              ...(department ? { department } : {}),
              ...(stock ? { stock } : {}),
            },
          }
        : { ids: [...selected] };
      const res = await fetch("/api/products/bulk-delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json().catch(() => null)) as { removed?: number; error?: string } | null;
      if (!res.ok) {
        setError(data?.error ?? "Couldn't delete those products. Try again.");
      } else {
        const n = data?.removed ?? 0;
        setError(null);
        setNotice(
          n === 0
            ? "Those products were already deleted."
            : `Deleted ${n.toLocaleString()} product${n === 1 ? "" : "s"}. Tick "Show removed" to see or restore them.`,
        );
        clearSelection();
        setConfirmBulk(false);
        reload();
        router.refresh();
      }
    } catch {
      setError("Couldn't reach the server. Check your connection.");
    } finally {
      setBulkBusy(false);
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-3">
      {/* Toolbar */}
      <div className="card card-pad">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[16rem] flex-1">
            <input
              type="search"
              className="input"
              placeholder="Search name, SKU or scan a barcode…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              aria-label="Search products"
            />
          </div>

          {departments && !departments.locked ? (
            <select
              className="select w-auto"
              value={department}
              onChange={(e) => {
                setDepartment(e.target.value);
                setPage(1);
              }}
              aria-label="Filter by department"
            >
              <option value="">Supermarket and pharmacy</option>
              <option value="SUPERMARKET">Supermarket only</option>
              <option value="PHARMACY">Pharmacy only</option>
            </select>
          ) : null}

          <select
            className="select w-auto"
            value={categoryId}
            onChange={(e) => {
              setCategoryId(e.target.value);
              setPage(1);
            }}
            aria-label="Filter by category"
          >
            <option value="">All categories</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>

          <select
            className="select w-auto"
            value={supplierId}
            onChange={(e) => {
              setSupplierId(e.target.value);
              setPage(1);
            }}
            aria-label="Filter by supplier"
          >
            <option value="">Wherever bought</option>
            {suppliers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>

          <select
            className="select w-auto"
            value={sort}
            onChange={(e) => {
              setSort(e.target.value as SortKey);
              setPage(1);
            }}
            aria-label="Sort products"
          >
            <option value="recent">Newest first</option>
            <option value="name">Name A–Z</option>
            <option value="price">Price high–low</option>
            <option value="stock">Stock level</option>
            <option value="expiry">Expiry soonest</option>
          </select>

          <label className="ml-auto flex cursor-pointer items-center gap-2 text-sm text-ink-600">
            <input
              type="checkbox"
              className="size-4 accent-brand-700"
              checked={includeInactive}
              onChange={(e) => {
                setIncludeInactive(e.target.checked);
                setPage(1);
              }}
            />
            Show removed
          </label>
        </div>

        {/* Stock-health chips. The counts are whole-catalog, from the server. */}
        <div className="mt-3 flex flex-wrap gap-2">
          {chips.map((chip) => {
            const isActive = chip.key === "ALL" ? !stock : chip.key === stock;
            return (
              <button
                key={chip.key}
                type="button"
                onClick={() =>
                  changeStock(chip.key === "ALL" ? undefined : (chip.key as StockFilter))
                }
                className={isActive ? chip.active : "chip"}
                aria-pressed={isActive}
              >
                {chip.label}
                <span className="chip-count">{chip.count}</span>
              </button>
            );
          })}
        </div>
      </div>

      {error && (
        <div className="card flex items-center justify-between gap-3 border-bad-200 bg-bad-50 px-4 py-2.5 text-sm text-bad-700">
          <span>{error}</span>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setError(null)}>
            Dismiss
          </button>
        </div>
      )}

      {notice && (
        <div className="card flex items-center justify-between gap-3 border-good-200 bg-good-50 px-4 py-2.5 text-sm text-good-700">
          <span>{notice}</span>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setNotice(null)}>
            Dismiss
          </button>
        </div>
      )}

      {/* Bulk actions for the ticked products: print labels, delete. */}
      {(can.barcode || can.delete) && selected.size > 0 && (
        <div className="card flex flex-wrap items-center justify-between gap-x-3 gap-y-2 px-4 py-2.5">
          <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-sm text-ink-600">
            <span className="font-semibold text-ink-900">
              {allMatching
                ? `All ${total.toLocaleString()} products selected`
                : `${selected.size.toLocaleString()} selected`}
            </span>
            {can.delete && allSelected && !allMatching && total > rows.length ? (
              <button
                type="button"
                className="font-semibold text-navy-700 underline underline-offset-2 hover:text-navy-900"
                onClick={() => setAllFor(filterKey)}
              >
                Select all {total.toLocaleString()} products{filtered ? " matching your filters" : ""}
              </button>
            ) : null}
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn btn-ghost btn-sm" onClick={clearSelection}>
              Clear
            </button>
            {can.barcode && !allMatching ? (
              <a href={`/products/labels?ids=${[...selected].join(",")}`} className="btn btn-outline btn-sm">
                Print labels
              </a>
            ) : null}
            {can.delete ? (
              <button type="button" className="btn btn-danger btn-sm" onClick={() => setConfirmBulk(true)}>
                <Trash2 className="size-4" aria-hidden />
                Delete {selectedCount.toLocaleString()}
              </button>
            ) : null}
          </div>
        </div>
      )}

      {confirmBulk && (
        <Sheet
          title={`Delete ${selectedCount.toLocaleString()} product${selectedCount === 1 ? "" : "s"}?`}
          onClose={() => (bulkBusy ? undefined : setConfirmBulk(false))}
          footer={
            <div className="flex justify-end gap-2">
              <button
                type="button"
                className="btn btn-ghost"
                disabled={bulkBusy}
                onClick={() => setConfirmBulk(false)}
              >
                Cancel
              </button>
              <button type="button" className="btn btn-danger" disabled={bulkBusy} onClick={bulkDelete}>
                {bulkBusy ? "Deleting..." : `Yes, delete ${selectedCount.toLocaleString()}`}
              </button>
            </div>
          }
        >
          <div className="space-y-3 p-4 text-sm text-ink-700">
            <p>
              {allMatching
                ? `Every product ${filtered ? "matching your current filters" : "in your shop"} will be removed from the till and the product list.`
                : "The ticked products will be removed from the till and the product list."}
            </p>
            <ul className="list-disc space-y-1 pl-5">
              <li>Past sales, receipts and reports keep them. Nothing in your records is lost.</li>
              <li>Their barcodes become free to use on new products.</li>
              <li>
                Changed your mind? Tick <span className="font-semibold">Show removed</span> and restore any of them.
              </li>
            </ul>
          </div>
        </Sheet>
      )}

      {/* Table or cards: the same rows, two ways of looking at them. */}
      <div className="flex justify-end">
        <div className="inline-flex rounded-lg border border-ink-200 bg-surface p-0.5" role="group" aria-label="View">
          {(
            [
              ["table", "List", List],
              ["grid", "Cards", LayoutGrid],
            ] as const
          ).map(([key, label, Icon]) => (
            <button
              key={key}
              type="button"
              onClick={() => chooseView(key)}
              aria-pressed={view === key}
              className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-bold transition-colors ${
                view === key ? "bg-navy-700 text-white" : "text-ink-600 hover:text-ink-950"
              }`}
            >
              <Icon className="size-3.5" />
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="card overflow-hidden">
        <div className="relative h-0.5">
          {loading && (
            <div className="absolute inset-x-0 top-0 h-0.5 animate-pulse bg-brand-500" />
          )}
        </div>

        {view === "grid" ? (
          <ProductGrid
            // Re-keyed per page so each new page of cards makes its entrance.
            key={`${page}-${rows.length}`}
            rows={rows}
            can={can}
            expiryWarningDays={expiryWarningDays}
            selected={selected}
            onToggle={toggleSelected}
            filtered={filtered}
            onClear={clearFilters}
            showDepartment={Boolean(departments)}
          />
        ) : (
        <div className="overflow-x-auto">
          <table className="data-table">
            <thead>
              <tr>
                <th className="w-10">
                  <input
                    type="checkbox"
                    className="size-4 accent-brand-700"
                    checked={allSelected}
                    onChange={toggleAll}
                    aria-label="Select all on this page"
                  />
                </th>
                <th>Product</th>
                <th className="hidden md:table-cell">Category</th>
                <th className="hidden lg:table-cell">Bought from</th>
                <th data-numeric className="text-right">
                  Price
                </th>
                {can.cost && (
                  <th data-numeric className="hidden md:table-cell text-right">
                    Cost / margin
                  </th>
                )}
                <th data-numeric className="text-right">
                  Stock
                </th>
                <th className="hidden lg:table-cell">Expiry</th>
                <th className="w-px" />
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const stockState = stockStatus(row);
                const expiry = expiryStatus(row, expiryWarningDays);
                const margin =
                  can.cost && typeof row.costPriceKobo === "number"
                    ? marginPercent(row.costPriceKobo, row.sellingPriceKobo)
                    : null;
                const checked = selected.has(row.id);
                const armed = armedId === row.id;
                const busy = busyId === row.id;

                return (
                  <tr key={row.id} className={busy ? "opacity-50" : undefined}>
                    <td>
                      <input
                        type="checkbox"
                        className="size-4 accent-brand-700"
                        checked={checked}
                        onChange={() => toggleSelected(row.id)}
                        aria-label={`Select ${row.name}`}
                      />
                    </td>

                    <td>
                      <div className="flex items-center gap-3">
                        <Thumb src={row.imageUrl} name={row.name} />
                        <div className="min-w-0">
                          <a
                            href={can.edit ? `/products/${row.id}/edit` : "#"}
                            className="block truncate font-medium text-ink-900 hover:text-brand-700"
                          >
                            {row.name}
                          </a>
                          {departments ? <DepartmentTag value={row.department} /> : null}
                          <div className="truncate text-xs text-ink-400">
                            {row.sku}
                            {row.barcode ? ` · ${row.barcode}` : ""}
                            {!row.isActive && " · removed"}
                          </div>
                        </div>
                      </div>
                    </td>

                    <td className="hidden md:table-cell text-ink-600">
                      {row.category?.name ?? <span className="text-ink-300">—</span>}
                    </td>

                    <td className="hidden lg:table-cell text-ink-600">
                      {row.supplier?.name ?? <span className="text-ink-300">—</span>}
                    </td>

                    <td data-numeric className="text-right">
                      <div className="tabular font-medium">
                        {formatNaira(row.sellingPriceKobo)}
                      </div>
                      {row.wholesalePriceKobo > 0 && (
                        <div className="tabular text-xs text-ink-400">
                          {formatNaira(row.wholesalePriceKobo)} wholesale
                        </div>
                      )}
                    </td>

                    {can.cost && (
                      <td data-numeric className="hidden md:table-cell text-right">
                        {typeof row.costPriceKobo === "number" ? (
                          <>
                            <div className="tabular text-ink-600">
                              {formatNaira(row.costPriceKobo)}
                            </div>
                            {margin !== null && (
                              <div
                                className={`tabular text-xs ${
                                  margin < 0 ? "text-bad-600" : "text-ink-400"
                                }`}
                              >
                                {margin.toFixed(0)}%
                              </div>
                            )}
                          </>
                        ) : (
                          <span className="text-ink-300">—</span>
                        )}
                      </td>
                    )}

                    <td data-numeric className="text-right">
                      <span className="tabular font-medium">
                        {formatQty(row.quantity)}
                      </span>
                      <span className="ml-1 text-xs text-ink-400">{row.unit}</span>
                      {stockState && (
                        <div className="mt-0.5">
                          <span className={`badge badge-${stockState.tone}`}>
                            {stockState.label}
                          </span>
                        </div>
                      )}
                    </td>

                    <td className="hidden lg:table-cell">
                      {expiry ? (
                        <span className={`badge badge-${expiry.tone}`}>{expiry.label}</span>
                      ) : row.trackExpiry && row.expiryDate ? (
                        <span className="text-xs text-ink-500">{formatDate(row.expiryDate)}</span>
                      ) : (
                        <span className="text-ink-300">—</span>
                      )}
                    </td>

                    <td className="whitespace-nowrap text-right">
                      {can.edit && (
                        <a
                          href={`/products/${row.id}/edit`}
                          className="btn btn-ghost btn-sm"
                        >
                          Edit
                        </a>
                      )}
                      {row.isActive
                        ? can.delete &&
                          (armed ? (
                            <>
                              <button
                                type="button"
                                className="btn btn-danger btn-sm ml-1"
                                disabled={busy}
                                onClick={() => deactivate(row)}
                              >
                                Confirm
                              </button>
                              <button
                                type="button"
                                className="btn btn-ghost btn-sm"
                                onClick={() => setArmedId(null)}
                              >
                                Cancel
                              </button>
                            </>
                          ) : (
                            <button
                              type="button"
                              className="btn btn-ghost btn-sm"
                              onClick={() => arm(row.id)}
                              title="Remove from the catalog"
                            >
                              Remove
                            </button>
                          ))
                        : can.edit && (
                            <button
                              type="button"
                              className="btn btn-ghost btn-sm"
                              disabled={busy}
                              onClick={() => restore(row)}
                            >
                              Restore
                            </button>
                          )}
                    </td>
                  </tr>
                );
              })}

              {rows.length === 0 && (
                <tr>
                  <td colSpan={can.cost ? 9 : 8}>
                    <div className="py-12 text-center">
                      {filtered ? (
                        <>
                          <p className="font-medium text-ink-700">
                            Nothing matches those filters.
                          </p>
                          <p className="mt-1 text-sm text-ink-500">
                            Try a different search, or clear the filters to see
                            everything.
                          </p>
                          <button
                            type="button"
                            className="btn btn-outline mt-4"
                            onClick={clearFilters}
                          >
                            Clear filters
                          </button>
                        </>
                      ) : (
                        <>
                          <p className="font-medium text-ink-700">
                            No products yet.
                          </p>
                          <p className="mt-1 text-sm text-ink-500">
                            Add your first product, or bring the whole shelf in
                            from a spreadsheet.
                          </p>
                          <div className="mt-4 flex justify-center gap-2">
                            <a href="/products/add" className="btn btn-primary">
                              Add product
                            </a>
                            <a href="/products/import" className="btn btn-outline">
                              Import from Excel
                            </a>
                          </div>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        )}

        {/* Paging */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-ink-100 px-4 py-2.5 text-sm text-ink-500">
          <span>
            {total === 0
              ? "No products"
              : `Showing ${starting}–${ending} of ${total.toLocaleString("en-NG")}`}
          </span>
          <div className="flex items-center gap-1">
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              Previous
            </button>
            <span className="px-2 tabular">
              {page} / {pages}
            </span>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              disabled={page >= pages}
              onClick={() => setPage((p) => Math.min(pages, p + 1))}
            >
              Next
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Card view
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The same products as cards: a picture, a stock badge you can read from across
 * the room, and the two numbers people look for (how many, how much).
 *
 * The table is better for comparing prices down a column; cards are better for
 * finding a product by sight and for a touchscreen. Neither replaces the other,
 * which is why this is a toggle and not a redesign.
 */
function ProductGrid({
  rows,
  can,
  expiryWarningDays,
  selected,
  onToggle,
  filtered,
  onClear,
  showDepartment,
}: {
  showDepartment: boolean;
  rows: ProductRow[];
  can: ProductsCan;
  expiryWarningDays: number;
  selected: Set<string>;
  onToggle: (id: string) => void;
  filtered: boolean;
  onClear: () => void;
}) {
  if (rows.length === 0) {
    return (
      <div className="py-12 text-center">
        <p className="font-medium text-ink-700">
          {filtered ? "Nothing matches those filters." : "No products yet."}
        </p>
        {filtered ? (
          <button type="button" className="btn btn-outline mt-4" onClick={onClear}>
            Clear filters
          </button>
        ) : (
          <a href="/products/add" className="btn btn-primary mt-4">
            Add product
          </a>
        )}
      </div>
    );
  }

  return (
    <Stagger className="grid grid-cols-2 gap-3 bg-canvas p-3 md:grid-cols-3 xl:grid-cols-4" gap={0.03}>
      {rows.map((row) => {
        const stockState = stockStatus(row);
        const expiry = expiryStatus(row, expiryWarningDays);
        const badge = stockState
          ? stockState.tone === "bad"
            ? { label: "Out of stock", className: "bg-ink-700 text-white" }
            : { label: "Low stock", className: "bg-sell-600 text-white" }
          : { label: "In stock", className: "bg-good-700 text-white" };

        return (
          <StaggerItem
            key={row.id}
            lift
            className={`flex flex-col overflow-hidden rounded-2xl border bg-surface shadow-[var(--shadow-card)] ${
              row.isActive ? "border-hairline" : "border-hairline opacity-60"
            }`}
          >
            <div className="relative aspect-[4/3] bg-navy-50">
              {row.imageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={row.imageUrl}
                  alt=""
                  loading="lazy"
                  decoding="async"
                  className="size-full object-contain p-3"
                />
              ) : (
                <span
                  aria-hidden
                  className="grid size-full place-items-center text-4xl font-bold uppercase text-navy-200"
                >
                  {row.name.slice(0, 2)}
                </span>
              )}
              <span
                className={`absolute left-2 top-2 rounded-md px-2 py-1 text-[0.6875rem] font-bold ${badge.className}`}
              >
                {badge.label}
              </span>
              <label className="absolute right-2 top-2 grid size-7 cursor-pointer place-items-center rounded-md bg-surface/90 shadow-[var(--shadow-card)]">
                <input
                  type="checkbox"
                  className="size-4 accent-navy-700"
                  checked={selected.has(row.id)}
                  onChange={() => onToggle(row.id)}
                  aria-label={`Select ${row.name}`}
                />
              </label>
            </div>

            <div className="flex flex-1 flex-col p-3">
              <p className="font-mono text-[0.6875rem] text-ink-500">{row.sku}</p>
              <p className="mt-0.5 line-clamp-2 text-sm font-bold leading-snug text-ink-950">{row.name}</p>
              {showDepartment ? <DepartmentTag value={row.department} /> : null}
              {expiry ? (
                <p
                  className={`mt-1 text-xs font-semibold ${
                    expiry.tone === "bad" ? "text-bad-700" : "text-warn-700"
                  }`}
                >
                  {expiry.label}
                </p>
              ) : null}

              <dl className="mt-auto space-y-1 pt-3 text-xs">
                <div className="flex items-center justify-between rounded-lg border border-hairline px-2.5 py-1.5">
                  <dt className="text-ink-500">Quantity</dt>
                  <dd className="tabular font-bold text-ink-950">
                    {formatQty(row.quantity)} {row.unit}
                  </dd>
                </div>
                <div className="flex items-center justify-between rounded-lg border border-hairline px-2.5 py-1.5">
                  <dt className="text-ink-500">Price</dt>
                  <dd className="tabular font-bold text-ink-950">{formatNaira(row.sellingPriceKobo)}</dd>
                </div>
              </dl>

              {can.edit ? (
                <a
                  href={`/products/${row.id}/edit`}
                  className="btn btn-outline btn-sm mt-2 w-full"
                >
                  <Pencil className="size-3.5" />
                  Edit
                </a>
              ) : null}
            </div>
          </StaggerItem>
        );
      })}
    </Stagger>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Small pieces
// ─────────────────────────────────────────────────────────────────────────────

function Thumb({ src, name }: { src: string | null; name: string }) {
  if (src) {
    // A hosted URL. Plain <img> on purpose: these are arbitrary Supabase/remote
    // URLs that would each need whitelisting in next.config for <Image>, and the
    // list's job is to show a 40px cue, not an optimised render.
    // eslint-disable-next-line @next/next/no-img-element
    return (
      <img
        src={src}
        alt=""
        className="size-9 shrink-0 rounded-md border border-ink-100 object-cover"
        loading="lazy"
      />
    );
  }
  return (
    <span
      aria-hidden
      className="grid size-9 shrink-0 place-items-center rounded-md bg-ink-100 text-xs font-semibold uppercase text-ink-400"
    >
      {name.slice(0, 2)}
    </span>
  );
}

/** The active-chip class already encodes the hue; keep the base when inactive. */

interface Status {
  tone: "good" | "warn" | "bad" | "info" | "neutral";
  label: string;
}

function stockStatus(row: { quantity: number; minStock: number }): Status | null {
  if (row.quantity <= 0) return { tone: "bad", label: "Out" };
  if (row.minStock > 0 && row.quantity <= row.minStock)
    return { tone: "warn", label: "Low" };
  return null;
}

/** Expiry, judged against the shop's own warning window. */
function expiryStatus(
  row: { trackExpiry: boolean; expiryDate: string | null },
  warningDays: number,
): Status | null {
  if (!row.trackExpiry || !row.expiryDate) return null;

  const expiry = new Date(row.expiryDate).getTime();
  const days = Math.floor((expiry - Date.now()) / 86_400_000);

  if (days < 0) return { tone: "bad", label: `Expired ${Math.abs(days)}d ago` };
  if (days === 0) return { tone: "bad", label: "Expires today" };
  if (days <= warningDays) {
    return {
      tone: days <= 14 ? "bad" : "warn",
      label: `${days}d left`,
    };
  }
  return null;
}

/** Whole numbers stay whole; loose goods keep one decimal. */
function formatQty(quantity: number): string {
  return Number.isInteger(quantity) ? quantity.toLocaleString("en-NG") : quantity.toFixed(1);
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-NG", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function queryKey(query: ListQuery): string {
  return [
    query.q ?? "",
    query.categoryId ?? "",
    query.supplierId ?? "",
    query.department ?? "",
    query.stock ?? "",
    query.sort ?? "recent",
    query.page ?? 1,
    query.perPage ?? 25,
    query.includeInactive ? "1" : "0",
  ].join("|");
}

/** "Pharmacy" in green, "Supermarket" in blue: readable at a glance in a long list. */
function DepartmentTag({ value }: { value?: string }) {
  const pharmacy = value === "PHARMACY";
  return (
    <span
      className={`mt-1 inline-block rounded-md px-1.5 py-0.5 text-[0.6875rem] font-bold ${
        pharmacy ? "bg-good-50 text-good-700" : "bg-navy-50 text-navy-700"
      }`}
    >
      {pharmacy ? "Pharmacy" : "Supermarket"}
    </span>
  );
}
