"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChangeConfirm, confirmAction } from "@/components/ChangeConfirm";
import type { ReceiptDesign } from "@/lib/receiptDesign";
import { InstallAppButton } from "@/components/InstallAppButton";
import { useRouter } from "next/navigation";
import {
  Keyboard,
  LogOut,
  Minus,
  Moon,
  Sun,
  PauseCircle,
  Plus,
  RefreshCw,
  ScanLine,
  Search,
  ShoppingCart,
  Trash2,
  UserRound,
  WifiOff,
  X,
} from "lucide-react";

import {
  computeTotals,
  resolveUnitPrice,
  type PriceType,
  type SaleResult,
} from "@/lib/pos";
import { formatNaira } from "@/lib/money";
import type { PriceMode } from "@/lib/constants";

import {
  applyStockDeltas,
  dropQueued,
  enqueueSale,
  getDeviceId,
  getPosDb,
  listQueued,
  listStuck,
  loadCatalog,
  markStuck,
  queueCount,
  retryStuck,
  runSync,
  type QueuedSale,
  type StoredProduct,
} from "./catalog";

/** The server said 401: the sign-in has expired. Saved sales wait for the next one. */
class SignInNeeded extends Error {}
import PayDialog, { type PayPayload } from "./PayDialog";
import Receipt, { type ReceiptData } from "./Receipt";

// ─────────────────────────────────────────────────────────────────────────────
// The shape the server hands the till on boot (see app/pos/page.tsx)
// ─────────────────────────────────────────────────────────────────────────────

export interface PosBootstrap {
  org: {
    id: string;
    name: string;
    currency: string;
    timezone: string;
    catalogVersion: number;
    logoUrl: string | null;
    phone: string | null;
    address: string | null;
  };
  branch: { id: string; name: string; code: string };
  cashier: { id: string; name: string; department: "SUPERMARKET" | "PHARMACY" | null };
  permissions: {
    discount: boolean;
    creditSale: boolean;
    priceOverride: boolean;
    reprint: boolean;
  };
  categories: { id: string; name: string; color: string | null }[];
  settings: {
    autoWholesale: boolean;
    allowNegativeStock: boolean;
    defaultPriceMode: PriceMode;
    requireCustomerForCredit: boolean;
    vatEnabled: boolean;
    vatBasisPoints: number;
    vatInclusive: boolean;
    receiptWidth: "80mm" | "58mm";
    receiptHeader: string | null;
    receiptFooter: string;
    receiptShowLogo: boolean;
    receiptShowCashier: boolean;
    receiptAutoPrint: boolean;
    receiptDesign: ReceiptDesign;
  };
}

interface CartLine {
  /** productId + price mode, so one product can sit on two lines: some retail, some wholesale. */
  key: string;
  product: StoredProduct;
  quantity: number;
  discountKobo: number;
  /** Retail or wholesale for this item alone. Missing on baskets saved by the old till. */
  priceMode?: PriceMode;
}

function lineKey(productId: string, mode: PriceMode): string {
  return `${productId}:${mode}`;
}

/**
 * One customer being served. A cashier can have several open at once: while
 * one customer hunts for their purse or runs back for bread, the cashier opens
 * the next customer and keeps the queue moving, then switches back.
 *
 * Tickets are saved on this device, so a refresh, a crash or a power cut does
 * not throw away a half-rung sale.
 */
interface Ticket {
  id: string;
  /** "Customer 3", or a name the cashier typed ("Mama Bisi"). */
  label: string;
  cart: CartLine[];
  priceMode: PriceMode;
  discountInput: string;
  openedAt: number;
}

/** More than this and the tabs stop being readable; it is a queue, not a warehouse. */
const MAX_TICKETS = 8;

function makeTicket(n: number, mode: PriceMode): Ticket {
  return {
    id: `t-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    label: `Customer ${n}`,
    cart: [],
    priceMode: mode,
    discountInput: "",
    openedAt: Date.now(),
  };
}

interface ResolvedLine {
  line: CartLine;
  unitPriceKobo: number;
  priceType: PriceType;
  lineTotalKobo: number;
  available: number;
  over: boolean;
}

/** How many product tiles to paint when nothing is searched — a till is driven
 *  by scanning and typing, not by scrolling a thousand-item wall. */
const BROWSE_LIMIT = 60;

export default function Till({
  bootstrap,
  initialTheme = "light",
}: {
  bootstrap: PosBootstrap;
  initialTheme?: "light" | "dark";
}) {
  const { org, branch, cashier, settings, permissions } = bootstrap;

  // Dark blue mode, shared with the back office through the same cookie.
  const [theme, setTheme] = useState<"light" | "dark">(initialTheme);
  const toggleTheme = useCallback(() => {
    setTheme((current) => {
      const next = current === "dark" ? "light" : "dark";
      document.cookie = `cw-theme=${next}; path=/; max-age=31536000; samesite=lax`;
      return next;
    });
  }, []);
  const router = useRouter();

  // Catalogue, held locally and kept fresh by the sync engine.
  const [allProducts, setProducts] = useState<StoredProduct[]>([]);
  // A cashier assigned to one department sees only its products. The till
  // holds the whole catalogue (see /api/pos/sync), so this is just a view.
  const department = bootstrap.cashier.department;
  const products = useMemo(
    () =>
      department
        ? allProducts.filter((p) => (p.department ?? "SUPERMARKET") === department)
        : allProducts,
    [allProducts, department],
  );
  const [stock, setStock] = useState<Map<string, number>>(new Map());
  const [ready, setReady] = useState(false);
  const [firstLoad, setFirstLoad] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [online, setOnline] = useState(true);
  const [queuedCount, setQueuedCount] = useState(0);
  /** Offline sales the server refused; kept on this device until retried. */
  const [stuck, setStuck] = useState<QueuedSale[]>([]);
  const [signInNeeded, setSignInNeeded] = useState(false);
  /** A big catalogue's first download, page by page. */
  const [download, setDownload] = useState<{ done: number; total: number } | null>(null);

  // Sale in progress.
  const [search, setSearch] = useState("");
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [tickets, setTickets] = useState<Ticket[]>(() => [
    makeTicket(1, settings.defaultPriceMode),
  ]);
  const [activeId, setActiveId] = useState<string>(() => tickets[0].id);
  const ticketSeq = useRef(1);
  /** True once saved customers have been read back. Saving waits for this,
   *  so the blank starting customer can never overwrite the saved ones. */
  const [ticketsReady, setTicketsReady] = useState(false);
  /** The line just scanned, highlighted so the cashier sees what landed. */
  const [lastKey, setLastKey] = useState<string | null>(null);

  const active = tickets.find((t) => t.id === activeId) ?? tickets[0];
  const cart = active.cart;
  const priceMode = active.priceMode;
  const orderDiscountInput = active.discountInput;

  const updateActive = useCallback(
    (fn: (t: Ticket) => Ticket) => {
      setTickets((prev) => prev.map((t) => (t.id === activeId ? fn(t) : t)));
    },
    [activeId],
  );
  const setOrderDiscountInput = useCallback(
    (value: string) => updateActive((t) => ({ ...t, discountInput: value })),
    [updateActive],
  );
  const ticketsKey = `cw:pos:tickets:${org.id}:${branch.id}:${cashier.id}`;

  // Overlays.
  const [payOpen, setPayOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [payError, setPayError] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<ReceiptData | null>(null);
  const [cartOpen, setCartOpen] = useState(false); // small-screen cart sheet
  const [flash, setFlash] = useState<string | null>(null);

  const dbRef = useRef<ReturnType<typeof getPosDb> | null>(null);
  const deviceIdRef = useRef<string>("");
  const scanRef = useRef<HTMLInputElement>(null);

  const focusScan = useCallback(() => {
    requestAnimationFrame(() => scanRef.current?.focus());
  }, []);

  const flashMessage = useCallback((msg: string) => {
    setFlash(msg);
    window.setTimeout(
      () => setFlash((cur) => (cur === msg ? null : cur)),
      2200,
    );
  }, []);

  // ── Boot: load from IndexedDB (instant), then catch up with a sync ──────────
  useEffect(() => {
    let cancelled = false;

    (async () => {
      let db: ReturnType<typeof getPosDb>;
      try {
        db = getPosDb(org.id, branch.id);
      } catch (error) {
        if (!cancelled) {
          setReady(true);
          setSyncError(
            error instanceof Error
              ? error.message
              : "Offline storage unavailable.",
          );
        }
        return;
      }
      dbRef.current = db;
      deviceIdRef.current = getDeviceId();

      // Bring back any customers that were still open when the page closed.
      try {
        const saved = window.localStorage.getItem(ticketsKey);
        const parsed = saved
          ? (JSON.parse(saved) as {
              tickets: Ticket[];
              activeId: string;
              seq: number;
            })
          : null;
        if (
          !cancelled &&
          parsed &&
          Array.isArray(parsed.tickets) &&
          parsed.tickets.length > 0
        ) {
          setTickets(parsed.tickets);
          setActiveId(
            parsed.tickets.some((t) => t.id === parsed.activeId)
              ? parsed.activeId
              : parsed.tickets[0].id,
          );
          ticketSeq.current = Math.max(parsed.seq || 1, parsed.tickets.length);
        }
      } catch {
        // Corrupt or blocked storage: start with one fresh customer.
      }
      if (!cancelled) setTicketsReady(true);
      if (!cancelled)
        setOnline(typeof navigator === "undefined" ? true : navigator.onLine);

      try {
        const existing = await loadCatalog(db);
        if (!cancelled && existing.products.length) {
          setProducts(existing.products);
          setStock(existing.stock);
          setReady(true);
        } else if (!cancelled) {
          setFirstLoad(true);
        }

        const pending = await queueCount(db);
        if (!cancelled) setQueuedCount(pending);
        const setAside = await listStuck(db);
        if (!cancelled) setStuck(setAside);

        // Ask the browser to keep this till's data (products, unsent sales)
        // for good. Without it, Chrome may clear site data to free disk space,
        // which is a real risk over weeks offline. Silently ignored if refused.
        void navigator.storage?.persist?.().catch(() => false);

        await runSync(db, deviceIdRef.current, pending, (done, total) => setDownload({ done, total }));
        const fresh = await loadCatalog(db);
        if (!cancelled) {
          setProducts(fresh.products);
          setStock(fresh.stock);
        }
      } catch (error) {
        if (!cancelled) {
          setSyncError(
            error instanceof Error
              ? error.message
              : "Couldn't reach the server.",
          );
        }
      } finally {
        if (!cancelled) {
          setFirstLoad(false);
          setReady(true);
          focusScan();
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [org.id, branch.id, focusScan, ticketsKey]);

  // ── Save open customers on this device after every change ───────────────────
  useEffect(() => {
    if (!ticketsReady) return;
    try {
      window.localStorage.setItem(
        ticketsKey,
        JSON.stringify({ tickets, activeId, seq: ticketSeq.current }),
      );
    } catch {
      // Storage full or blocked: the sale still works, it just won't survive a reload.
    }
  }, [tickets, activeId, ticketsKey, ticketsReady]);

  // ── Keep the catalogue fresh: delta-poll, flush any queued sales ────────────
  useEffect(() => {
    if (!ready) return;
    const db = dbRef.current;
    if (!db) return;
    let stopped = false;

    const flushQueue = async () => {
      const queued = await listQueued(db);
      for (const item of queued) {
        try {
          // Mark it as an offline sale so the server records it as it happened.
          let body = item.body;
          try {
            body = JSON.stringify({ ...JSON.parse(item.body), queued: true });
          } catch {
            /* send as stored */
          }
          const res = await fetch("/api/pos/sales", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body,
          });
          if (res.ok) {
            const data = (await res.json()) as SaleResult;
            await applyStockDeltas(db, data.stock);
            await dropQueued(db, item.localId);
          } else if (res.status === 409) {
            // Already recorded on the server: safe to let go.
            await dropQueued(db, item.localId);
          } else if (res.status === 401) {
            // Signed out (sign-ins last 12 hours). Keep everything and say so.
            throw new SignInNeeded();
          } else if (res.status >= 400 && res.status < 500) {
            // Refused for a reason a retry won't fix. NEVER delete it: the
            // money was taken. Set it aside, tell the cashier, carry on.
            const data = (await res.json().catch(() => null)) as { error?: string } | null;
            await markStuck(db, item.localId, data?.error ?? `Refused (${res.status})`);
          } else {
            break; // server trouble — try the whole queue again next tick
          }
        } catch (error) {
          if (error instanceof SignInNeeded) throw error;
          break; // still offline
        }
      }
      setStuck(await listStuck(db));
    };

    const tick = async () => {
      if (stopped || (typeof navigator !== "undefined" && !navigator.onLine))
        return;
      if (typeof document !== "undefined" && document.hidden) return;
      try {
        setSyncing(true);
        await flushQueue();
        const pending = await queueCount(db);
        const out = await runSync(db, deviceIdRef.current, pending, (done, total) => setDownload({ done, total }));
        if (!stopped && (out.changed || out.stockChanged)) {
          const fresh = await loadCatalog(db);
          setProducts(fresh.products);
          setStock(fresh.stock);
        }
        if (!stopped) {
          setQueuedCount(pending);
          setSyncError(null);
          setSignInNeeded(false);
        }
      } catch (error) {
        if (!stopped) {
          const signedOut = error instanceof SignInNeeded || (error instanceof Error && error.message.includes("(401)"));
          setSignInNeeded(signedOut);
          setQueuedCount(await queueCount(db));
          setSyncError(signedOut ? "Sign in again to send saved sales." : error instanceof Error ? error.message : "Sync failed.");
        }
      } finally {
        if (!stopped) setSyncing(false);
      }
    };

    const id = window.setInterval(tick, 20000);
    const onFocus = () => void tick();
    const onOnline = () => {
      setOnline(true);
      void tick();
    };
    const onOffline = () => setOnline(false);
    window.addEventListener("focus", onFocus);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      stopped = true;
      window.clearInterval(id);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, [ready]);

  // ── Keep the scanner's cursor home ──────────────────────────────────────────
  // A hardware barcode scanner types into whatever is focused and hits Enter. If
  // focus drifts to the page body (after a tap, after an overlay closes) the next
  // scan goes nowhere. So when nothing else wants the keyboard, the scan field
  // quietly takes it back. It never steals focus from a field the cashier is
  // actually typing in, nor from an open dialog.
  useEffect(() => {
    const id = window.setInterval(() => {
      if (payOpen || receipt || cartOpen) return;
      const active = document.activeElement;
      if (active && active !== document.body) return;
      scanRef.current?.focus();
    }, 600);
    return () => window.clearInterval(id);
  }, [payOpen, receipt, cartOpen]);

  // ── Keyboard: Esc closes, F2 next customer, F8 charge ──────────────────────
  // Function keys because a scanner never sends them, so a scan can't trigger
  // one by accident, and they work whichever field has focus.
  const shortcuts = useRef<{ newCustomer: () => void; charge: () => void }>({
    newCustomer: () => {},
    charge: () => {},
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (receipt) setReceipt(null);
        else if (payOpen) setPayOpen(false);
        else if (cartOpen) setCartOpen(false);
        return;
      }
      if (receipt || payOpen) return;
      if (e.key === "F2") {
        e.preventDefault();
        shortcuts.current.newCustomer();
      } else if (e.key === "F8") {
        e.preventDefault();
        shortcuts.current.charge();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [receipt, payOpen, cartOpen]);

  // ── Lookup indexes for the scanner ──────────────────────────────────────────
  const byBarcode = useMemo(() => {
    const m = new Map<string, StoredProduct>();
    for (const p of products) if (p.barcode) m.set(p.barcode, p);
    return m;
  }, [products]);

  const bySku = useMemo(() => {
    const m = new Map<string, StoredProduct>();
    for (const p of products) m.set(p.sku.toLowerCase(), p);
    return m;
  }, [products]);

  // ── Category chips: only the categories that actually hold stock-list items ──
  const categoryChips = useMemo(() => {
    const present = new Set<string>();
    for (const p of products) if (p.categoryId) present.add(p.categoryId);
    const named = new Map(bootstrap.categories.map((c) => [c.id, c]));
    const chips = bootstrap.categories
      .filter((c) => present.has(c.id))
      .map((c) => ({ id: c.id, name: c.name, color: c.color }));
    // Any category on a product but missing from the bootstrap list (added since
    // boot) still deserves a chip.
    for (const p of products) {
      if (
        p.categoryId &&
        !named.has(p.categoryId) &&
        !chips.some((c) => c.id === p.categoryId)
      ) {
        chips.push({
          id: p.categoryId,
          name: p.categoryName ?? "Other",
          color: null,
        });
      }
    }
    return chips;
  }, [products, bootstrap.categories]);

  // ── The visible product list ────────────────────────────────────────────────
  const query = search.trim().toLowerCase();
  const filtered = useMemo(() => {
    let list = products;
    if (activeCategory)
      list = list.filter((p) => p.categoryId === activeCategory);
    if (query) {
      list = list.filter(
        (p) =>
          p.name.toLowerCase().includes(query) ||
          p.sku.toLowerCase().includes(query) ||
          (p.barcode ? p.barcode.toLowerCase().includes(query) : false),
      );
    }
    const sorted = [...list].sort((a, b) => a.name.localeCompare(b.name));
    return sorted;
  }, [products, activeCategory, query]);

  const browsing = !query; // no search term → cap the paint
  const visible = browsing
    ? filtered.slice(0, BROWSE_LIMIT)
    : filtered.slice(0, 120);

  // ── Cart maths ──────────────────────────────────────────────────────────────
  const orderDiscountKobo = useMemo(() => {
    const n = Number(orderDiscountInput.replace(/[^0-9.]/g, ""));
    return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : 0;
  }, [orderDiscountInput]);

  const productsById = useMemo(
    () => new Map(products.map((p) => [p.id, p])),
    [products],
  );

  const resolved: ResolvedLine[] = useMemo(() => {
    const perProduct = new Map<string, number>();
    for (const l of cart)
      perProduct.set(
        l.product.id,
        (perProduct.get(l.product.id) ?? 0) + l.quantity,
      );
    return cart.map((saved) => {
      // A held sale may be hours old: price it from today's catalogue, not the
      // copy saved when the item was scanned.
      const line = {
        ...saved,
        product: productsById.get(saved.product.id) ?? saved.product,
        priceMode: saved.priceMode ?? priceMode,
      };
      const r = resolveUnitPrice(
        line.product,
        line.quantity,
        line.priceMode,
        settings.autoWholesale,
      );
      const lineTotalKobo = Math.max(
        0,
        Math.round(r.unitPriceKobo * line.quantity) - line.discountKobo,
      );
      const available = stock.get(line.product.id) ?? 0;
      return {
        line,
        unitPriceKobo: r.unitPriceKobo,
        priceType: r.priceType,
        lineTotalKobo,
        available,
        // The same product can be on two lines (retail and wholesale), so check
        // the stock against both together, not each line alone.
        over:
          !settings.allowNegativeStock &&
          (perProduct.get(line.product.id) ?? 0) > available,
      };
    });
  }, [
    cart,
    productsById,
    priceMode,
    settings.autoWholesale,
    settings.allowNegativeStock,
    stock,
  ]);

  const totals = useMemo(() => {
    return computeTotals(
      resolved.map((r) => ({
        unitPriceKobo: r.unitPriceKobo,
        quantity: r.line.quantity,
        discountKobo: r.line.discountKobo,
      })),
      orderDiscountKobo,
      settings.vatEnabled
        ? {
            enabled: true,
            basisPoints: settings.vatBasisPoints,
            inclusive: settings.vatInclusive,
          }
        : undefined,
    );
  }, [
    resolved,
    orderDiscountKobo,
    settings.vatEnabled,
    settings.vatBasisPoints,
    settings.vatInclusive,
  ]);

  const itemCount = round3(cart.reduce((n, l) => n + l.quantity, 0));

  /** How many of each product are already in THIS customer's basket, for the tile badges. */
  const inCart = useMemo(() => {
    const m = new Map<string, number>();
    for (const l of cart)
      m.set(l.product.id, round3((m.get(l.product.id) ?? 0) + l.quantity));
    return m;
  }, [cart]);
  const stockBlocked = resolved.some((r) => r.over);

  // ── Cart operations ─────────────────────────────────────────────────────────
  const addToCart = useCallback(
    (
      product: StoredProduct,
      mode: PriceMode = settings.defaultPriceMode,
      qty = 1,
    ) => {
      // A product with no wholesale price can only be sold at retail.
      const realMode: PriceMode =
        mode === "WHOLESALE" && product.wholesalePriceKobo > 0
          ? "WHOLESALE"
          : "RETAIL";
      const key = lineKey(product.id, realMode);
      updateActive((t) => {
        const i = t.cart.findIndex(
          (l) =>
            l.key === key ||
            (l.key === product.id && (l.priceMode ?? t.priceMode) === realMode),
        );
        if (i >= 0) {
          const next = [...t.cart];
          next[i] = { ...next[i], quantity: round3(next[i].quantity + qty) };
          return { ...t, cart: next };
        }
        // Newest at the top: the cashier's eye is on the top of the list.
        return {
          ...t,
          cart: [
            {
              key,
              product,
              quantity: qty,
              discountKobo: 0,
              priceMode: realMode,
            },
            ...t.cart,
          ],
        };
      });
      setLastKey(key);
      const days = daysToExpiry(product.expiryDate);
      if (days !== null && days < 0) {
        flashMessage(`${product.name}: the stock on record is expired. Check the pack before you sell it.`);
      }
    },
    [updateActive, settings.defaultPriceMode, flashMessage],
  );

  /** Switch one item between retail and wholesale. Joins an existing line of the same kind. */
  const setLineMode = useCallback(
    (key: string, mode: PriceMode) => {
      updateActive((t) => {
        const line = t.cart.find((l) => l.key === key);
        if (!line) return t;
        const newKey = lineKey(line.product.id, mode);
        if (newKey === key) return t;
        const twin = t.cart.find((l) => l.key === newKey);
        if (twin) {
          return {
            ...t,
            cart: t.cart
              .filter((l) => l.key !== key)
              .map((l) =>
                l.key === newKey
                  ? { ...l, quantity: round3(l.quantity + line.quantity) }
                  : l,
              ),
          };
        }
        return {
          ...t,
          cart: t.cart.map((l) =>
            l.key === key ? { ...l, key: newKey, priceMode: mode } : l,
          ),
        };
      });
      setLastKey(lineKey(key.split(":")[0], mode));
    },
    [updateActive],
  );

  const setQty = useCallback(
    (key: string, qty: number) => {
      updateActive((t) => ({
        ...t,
        cart:
          qty <= 0
            ? t.cart.filter((l) => l.key !== key)
            : t.cart.map((l) =>
                l.key === key ? { ...l, quantity: round3(qty) } : l,
              ),
      }));
    },
    [updateActive],
  );

  const removeLine = useCallback(
    (key: string) =>
      updateActive((t) => ({
        ...t,
        cart: t.cart.filter((l) => l.key !== key),
      })),
    [updateActive],
  );

  /** Empty the current customer's basket but keep them open. */
  const clearSale = useCallback(() => {
    updateActive((t) => ({
      ...t,
      cart: [],
      discountInput: "",
      priceMode: settings.defaultPriceMode,
    }));
  }, [updateActive, settings.defaultPriceMode]);

  /** Serve the next person while this one is held. */
  const newCustomer = useCallback(() => {
    if (tickets.length >= MAX_TICKETS) {
      flashMessage(
        `You can hold up to ${MAX_TICKETS} customers. Finish one first.`,
      );
      return;
    }
    // Re-use an empty ticket instead of piling up blank tabs.
    const empty = tickets.find((t) => t.cart.length === 0 && t.id !== activeId);
    if (empty) {
      setActiveId(empty.id);
    } else {
      ticketSeq.current += 1;
      const t = makeTicket(ticketSeq.current, settings.defaultPriceMode);
      setTickets((prev) => [...prev, t]);
      setActiveId(t.id);
    }
    setLastKey(null);
    focusScan();
  }, [tickets, activeId, settings.defaultPriceMode, flashMessage, focusScan]);

  const switchTo = useCallback(
    (id: string) => {
      setActiveId(id);
      setLastKey(null);
      focusScan();
    },
    [focusScan],
  );

  /** Close a customer: after their sale, or because they walked away. */
  const closeTicket = useCallback(
    (id: string) => {
      setTickets((prev) => {
        const rest = prev.filter((t) => t.id !== id);
        if (rest.length === 0) {
          ticketSeq.current += 1;
          const fresh = makeTicket(
            ticketSeq.current,
            settings.defaultPriceMode,
          );
          setActiveId(fresh.id);
          return [fresh];
        }
        if (id === activeId) setActiveId(rest[rest.length - 1].id);
        return rest;
      });
      setLastKey(null);
    },
    [activeId, settings.defaultPriceMode],
  );

  const [scanReady, setScanReady] = useState(false);

  const renameActive = useCallback(
    (label: string) =>
      updateActive((t) => ({ ...t, label: label.slice(0, 40) })),
    [updateActive],
  );

  // ── Scanner / search Enter ──────────────────────────────────────────────────
  const onScanEnter = useCallback(() => {
    const raw = search.trim();
    if (!raw) return;
    const exact = byBarcode.get(raw) ?? bySku.get(raw.toLowerCase());
    if (exact) {
      addToCart(exact);
      setSearch("");
      flashMessage(`Added ${exact.name}`);
      return;
    }
    // One match for a typed query? Take it. Otherwise leave the term as a filter.
    if (filtered.length === 1) {
      addToCart(filtered[0]);
      setSearch("");
      flashMessage(`Added ${filtered[0].name}`);
    } else if (filtered.length === 0) {
      // Scanned something from the other department? Say so, rather than a
      // puzzling "no product".
      const other = department
        ? allProducts.find((p) => p.barcode === raw || p.sku.toLowerCase() === raw.toLowerCase())
        : undefined;
      flashMessage(
        other
          ? `${other.name} is a ${other.department === "PHARMACY" ? "pharmacy" : "supermarket"} product. Send the customer to that counter.`
          : "No product matches that.",
      );
    }
  }, [search, byBarcode, bySku, filtered, addToCart, flashMessage, department, allProducts]);

  const pickProduct = useCallback(
    (product: StoredProduct, mode?: PriceMode) => {
      addToCart(product, mode);
      focusScan();
    },
    [addToCart, focusScan],
  );

  // ── Completing the sale ─────────────────────────────────────────────────────
  const buildReceipt = useCallback(
    (sale: SaleResult["sale"], offline: boolean): ReceiptData => ({
      receiptNo: offline ? null : sale.receiptNo,
      soldAt: sale.soldAt,
      cashierName: cashier.name,
      items: resolved.map((r) => ({
        name:
          r.priceType === "WHOLESALE"
            ? `${r.line.product.name} (wholesale)`
            : r.line.product.name,
        unit: r.line.product.unit,
        quantity: r.line.quantity,
        unitPriceKobo: r.unitPriceKobo,
        lineTotalKobo: r.lineTotalKobo,
      })),
      subtotalKobo: sale.subtotalKobo,
      discountKobo: sale.discountKobo,
      taxKobo: sale.taxKobo,
      totalKobo: sale.totalKobo,
      paidKobo: sale.paidKobo,
      balanceKobo: sale.balanceKobo,
      tenderedKobo: sale.tenderedKobo,
      changeKobo: sale.changeKobo,
      paymentMethod: sale.paymentMethod,
      offline,
    }),
    [resolved, cashier.name],
  );

  const completeSale = useCallback(
    async (pay: PayPayload) => {
      const db = dbRef.current;
      if (!db) return;
      // The customer being charged. Captured now so the right tab closes even
      // if anything else changes while the payment is in flight.
      const saleTicketId = active.id;
      const localId =
        typeof crypto !== "undefined" && crypto.randomUUID
          ? crypto.randomUUID()
          : `cw-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;

      const allWholesale = resolved.every(
        (r) => r.line.priceMode === "WHOLESALE",
      );
      const body = JSON.stringify({
        localId,
        deviceId: deviceIdRef.current,
        // Each line carries its own mode below; this sale-level one is only a
        // summary for reports (wholesale if every item was wholesale).
        priceMode: allWholesale ? "WHOLESALE" : "RETAIL",
        lines: resolved.map(({ line: l }) => ({
          productId: l.product.id,
          quantity: l.quantity,
          discountKobo: l.discountKobo,
          priceMode: l.priceMode,
        })),
        orderDiscountKobo,
        payments: pay.payments,
        tenderedKobo: pay.tenderedKobo,
        customerId: pay.customerId,
        soldAt: new Date().toISOString(),
      });

      setSubmitting(true);
      setPayError(null);
      try {
        const res = await fetch("/api/pos/sales", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body,
        });
        const data = await res.json().catch(() => null);
        if (!res.ok) {
          setPayError(
            (data && data.error) || "Couldn't complete the sale. Try again.",
          );
          setSubmitting(false);
          return;
        }
        const result = data as SaleResult;
        await applyStockDeltas(db, result.stock);
        setStock((prev) => {
          const m = new Map(prev);
          for (const s of result.stock) m.set(s.p, s.q);
          return m;
        });
        setReceipt(buildReceipt(result.sale, false));
        setPayOpen(false);
        setSubmitting(false);
        closeTicket(saleTicketId);
        focusScan();
      } catch {
        // Network dropped mid-sale. Queue it under its localId (safe to replay),
        // move stock locally so the next customer sees the right figure, and give
        // the cashier a receipt marked offline. The queue flushes when back online.
        await enqueueSale(db, localId, body);
        const localStock = cart.map((l) => ({
          p: l.product.id,
          q: round3((stock.get(l.product.id) ?? 0) - l.quantity),
        }));
        await applyStockDeltas(db, localStock);
        setStock((prev) => {
          const m = new Map(prev);
          for (const s of localStock) m.set(s.p, s.q);
          return m;
        });
        setQueuedCount(await queueCount(db));
        setReceipt(
          buildReceipt(
            {
              id: localId,
              receiptNo: "",
              soldAt: new Date().toISOString(),
              subtotalKobo: totals.subtotalKobo,
              discountKobo: totals.discountKobo,
              taxKobo: totals.taxKobo,
              totalKobo: totals.totalKobo,
              paidKobo: pay.paidKobo,
              balanceKobo: pay.balanceKobo,
              tenderedKobo: pay.tenderedKobo,
              changeKobo: pay.changeKobo,
              paymentMethod: pay.method,
              priceMode,
              customerId: pay.customerId,
            },
            true,
          ),
        );
        setPayOpen(false);
        setSubmitting(false);
        closeTicket(saleTicketId);
        focusScan();
      }
    },
    [
      cart,
      resolved,
      priceMode,
      orderDiscountKobo,
      totals,
      stock,
      buildReceipt,
      closeTicket,
      focusScan,
      active.id,
    ],
  );

  const canCharge = cart.length > 0 && !stockBlocked && totals.totalKobo > 0;
  const openCharge = useCallback(() => {
    if (!canCharge) return;
    setPayError(null);
    setPayOpen(true);
    setCartOpen(false);
  }, [canCharge]);
  useEffect(() => {
    shortcuts.current = { newCustomer, charge: openCharge };
  }, [newCustomer, openCharge]);

  const waiting = tickets.filter(
    (t) => t.id !== active.id && t.cart.length > 0,
  ).length;

  // ── First-run splash ─────────────────────────────────────────────────────────
  if (!ready && firstLoad) {
    return (
      <main className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-navy-950 text-white">
        <RefreshCw
          className="h-7 w-7 animate-spin text-brand-400"
          aria-hidden
        />
        <p className="text-sm text-white/70">Setting up your products…</p>
        {download && download.total > 0 && (
          <div className="w-72 text-center">
            <div className="h-2 overflow-hidden rounded-full bg-white/10">
              <div
                className="h-full rounded-full bg-brand-500 transition-[width] duration-300"
                style={{ width: `${Math.min(100, Math.round((download.done / download.total) * 100))}%` }}
              />
            </div>
            <p className="mt-2 text-xs text-white/60">
              {download.done.toLocaleString("en-NG")} of {download.total.toLocaleString("en-NG")} products. Only the
              first time on this computer.
            </p>
          </div>
        )}
      </main>
    );
  }

  // ─────────────────────────────────────────────────────────────────────────────
  return (
    <>
      <div
        data-theme={theme}
        className="flex h-dvh flex-col overflow-hidden bg-canvas text-ink-900"
      >
        {/* ── Top bar ─────────────────────────────────────────────────────────── */}
        <header className="texture-waves flex h-14 shrink-0 items-center gap-3 bg-navy-950 px-3 text-white sm:px-4">
          <div className="flex min-w-0 items-center gap-2.5">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-sell-600 text-sm font-bold">
              {org.name.charAt(0).toUpperCase()}
            </div>
            <div className="min-w-0 leading-tight">
              <p className="truncate text-sm font-bold">{org.name}</p>
              <p className="truncate text-[11px] text-white/60">
                {branch.name} · {cashier.name}
                {department ? (
                  <span
                    className={`ml-1.5 rounded px-1.5 py-0.5 text-[10px] font-bold text-white ${
                      department === "PHARMACY" ? "bg-good-700" : "bg-navy-600"
                    }`}
                  >
                    {department === "PHARMACY" ? "Pharmacy" : "Supermarket"}
                  </span>
                ) : null}
              </p>
            </div>
          </div>

          <div className="ml-auto flex items-center gap-2">
            <SyncPill
              online={online}
              syncing={syncing}
              error={syncError}
              queued={queuedCount}
            />
            <Clock timezone={org.timezone} />
            <InstallAppButton tone="dark" />
            <button
              type="button"
              onClick={toggleTheme}
              className="flex h-9 w-9 items-center justify-center rounded-lg bg-white/10 text-white transition hover:bg-white/20"
              aria-label={
                theme === "dark"
                  ? "Switch to light mode"
                  : "Switch to dark mode"
              }
              title={theme === "dark" ? "Light mode" : "Dark mode"}
            >
              {theme === "dark" ? (
                <Sun className="h-4 w-4" aria-hidden />
              ) : (
                <Moon className="h-4 w-4" aria-hidden />
              )}
            </button>
            <button
              type="button"
              onClick={() => router.push("/dashboard")}
              className="flex h-9 items-center gap-1.5 rounded-lg bg-white/10 px-3 text-xs font-semibold text-white transition hover:bg-white/20"
            >
              <LogOut className="h-4 w-4" aria-hidden />
              <span className="hidden sm:inline">Exit till</span>
            </button>
          </div>
        </header>

        {download && download.done < download.total && (
          <div className="shrink-0 border-b border-navy-100 bg-navy-50 px-3 py-2 text-sm text-navy-800 sm:px-4">
            <div className="flex items-center justify-between gap-3">
              <span className="font-semibold">
                Downloading products to this till: {download.done.toLocaleString("en-NG")} of{" "}
                {download.total.toLocaleString("en-NG")}
              </span>
              <span className="text-xs">Only the first time. After this, only changes come down.</span>
            </div>
            <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-navy-100">
              <div
                className="h-full rounded-full bg-navy-600 transition-[width] duration-300"
                style={{ width: `${Math.round((download.done / download.total) * 100)}%` }}
              />
            </div>
          </div>
        )}

        {(stuck.length > 0 || signInNeeded) && (
          <div className="shrink-0 space-y-1 border-b border-warn-200 bg-warn-50 px-3 py-2 text-sm text-warn-700 sm:px-4">
            {signInNeeded && queuedCount > 0 && (
              <p className="font-semibold">
                Your sign-in has expired. {queuedCount} sale{queuedCount === 1 ? " is" : "s are"} saved on this device
                and will be sent as soon as you sign in again. Keep selling; nothing is lost.
              </p>
            )}
            {stuck.length > 0 && (
              <div className="flex flex-wrap items-center gap-2">
                <p className="min-w-0 flex-1">
                  <span className="font-semibold">
                    {stuck.length} offline sale{stuck.length === 1 ? "" : "s"} couldn&apos;t be sent.
                  </span>{" "}
                  {stuck[0].stuck}
                  {stuck.length > 1 ? " (and others)" : ""} They are kept safe on this device. Ask a manager to fix
                  this, then try again.
                </p>
                <button
                  type="button"
                  className="btn btn-sm btn-outline shrink-0"
                  onClick={async () => {
                    const db = dbRef.current;
                    if (!db) return;
                    await retryStuck(db);
                    setStuck([]);
                    setQueuedCount(await queueCount(db));
                    window.dispatchEvent(new Event("online"));
                  }}
                >
                  Try again
                </button>
              </div>
            )}
          </div>
        )}

        {/* ── Customers being served ──────────────────────────────────────────── */}
        <div className="flex shrink-0 items-center gap-2 border-b border-hairline bg-surface px-3 py-2 sm:px-4">
          <div className="flex min-w-0 flex-1 gap-1.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {tickets.map((t) => {
              const isActive = t.id === active.id;
              const count = round3(t.cart.reduce((n, l) => n + l.quantity, 0));
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => switchTo(t.id)}
                  aria-pressed={isActive}
                  className={`flex shrink-0 items-center gap-2 rounded-xl border px-3 py-1.5 text-left transition ${
                    isActive
                      ? "border-navy-700 bg-navy-700 text-white shadow-[var(--shadow-card)]"
                      : t.cart.length > 0
                        ? "border-brand-300 bg-brand-50 text-ink-900 hover:border-brand-500"
                        : "border-hairline bg-surface text-ink-600 hover:border-ink-300"
                  }`}
                >
                  {isActive ? (
                    <UserRound className="h-4 w-4 shrink-0" aria-hidden />
                  ) : t.cart.length > 0 ? (
                    <PauseCircle
                      className="h-4 w-4 shrink-0 text-brand-700"
                      aria-hidden
                    />
                  ) : (
                    <UserRound className="h-4 w-4 shrink-0" aria-hidden />
                  )}
                  <span className="max-w-[9rem] truncate text-sm font-bold">
                    {t.label || "Customer"}
                  </span>
                  <span
                    className={`rounded-md px-1.5 py-0.5 text-[11px] font-bold tabular-nums ${
                      isActive ? "bg-white/20" : "bg-ink-100 text-ink-700"
                    }`}
                  >
                    {fmtQty(count)}
                  </span>
                </button>
              );
            })}
          </div>
          <button
            type="button"
            onClick={newCustomer}
            className="btn btn-primary btn-sm shrink-0"
            title="Serve the next customer while this one waits (F2)"
          >
            <Plus className="h-4 w-4" aria-hidden />
            <span className="hidden sm:inline">Next customer</span>
            <kbd className="hidden rounded bg-white/20 px-1 text-[10px] font-bold md:inline">
              F2
            </kbd>
          </button>
        </div>

        {/* ── Body ────────────────────────────────────────────────────────────── */}
        <div className="flex min-h-0 flex-1">
          {/* Products */}
          <section className="flex min-w-0 flex-1 flex-col">
            <div className="shrink-0 bg-surface px-3 pt-3 sm:px-4">
              <label className="relative block">
                <ScanLine
                  className="pointer-events-none absolute left-4 top-1/2 h-6 w-6 -translate-y-1/2 text-navy-700"
                  aria-hidden
                />
                <input
                  ref={scanRef}
                  onFocus={() => setScanReady(true)}
                  onBlur={() => setScanReady(false)}
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      onScanEnter();
                    }
                  }}
                  placeholder="Scan a barcode, or type a product name"
                  autoComplete="off"
                  autoCapitalize="off"
                  spellCheck={false}
                  aria-label="Scan or search products"
                  className="h-14 w-full rounded-2xl border-2 border-navy-100 bg-navy-50/50 pl-14 pr-44 text-lg font-medium outline-none transition placeholder:font-normal placeholder:text-ink-400 focus:border-navy-600 focus:bg-surface"
                />
                {/* Is a scan going to land? Green when this box has the keyboard. */}
                {!search ? (
                  <button
                    type="button"
                    onClick={focusScan}
                    className={`absolute right-3 top-1/2 hidden -translate-y-1/2 items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-bold transition sm:inline-flex ${
                      scanReady ? "bg-good-50 text-good-700" : "bg-brand-50 text-brand-800 hover:bg-brand-100"
                    }`}
                    title={scanReady ? "Scan a barcode now" : "Click to get ready to scan"}
                  >
                    <span className="relative flex size-2">
                      {scanReady ? (
                        <span className="absolute inline-flex size-full animate-ping rounded-full bg-good-500 opacity-60" />
                      ) : null}
                      <span className={`relative inline-flex size-2 rounded-full ${scanReady ? "bg-good-700" : "bg-brand-500"}`} />
                    </span>
                    {scanReady ? "Ready to scan" : "Click to scan"}
                  </button>
                ) : null}
                {search && (
                  <button
                    type="button"
                    onClick={() => {
                      setSearch("");
                      focusScan();
                    }}
                    aria-label="Clear search"
                    className="absolute right-3 top-1/2 -translate-y-1/2 rounded-lg p-1.5 text-ink-500 hover:bg-canvas"
                  >
                    <X className="h-5 w-5" aria-hidden />
                  </button>
                )}
              </label>

              <div className="-mx-1 mt-3 flex gap-1.5 overflow-x-auto px-1 pb-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                <CategoryChip
                  label="All products"
                  active={activeCategory === null}
                  onClick={() => setActiveCategory(null)}
                />
                {categoryChips.map((c) => (
                  <CategoryChip
                    key={c.id}
                    label={c.name}
                    color={c.color}
                    active={activeCategory === c.id}
                    onClick={() =>
                      setActiveCategory((cur) => (cur === c.id ? null : c.id))
                    }
                  />
                ))}
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto border-t border-hairline px-3 py-3 sm:px-4">
              {visible.length === 0 ? (
                <EmptyGrid hasProducts={products.length > 0} query={search} />
              ) : (
                <>
                  <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
                    {visible.map((p) => (
                      <ProductTile
                        key={p.id}
                        product={p}
                        available={stock.get(p.id) ?? 0}
                        inCart={inCart.get(p.id) ?? 0}
                        allowNegative={settings.allowNegativeStock}
                        onPick={pickProduct}
                      />
                    ))}
                  </div>
                  {browsing && filtered.length > visible.length && (
                    <p className="mt-4 text-center text-xs text-ink-500">
                      Showing {visible.length} of {filtered.length}. Scan or
                      search to find the rest.
                    </p>
                  )}
                </>
              )}
            </div>

            {/* Shortcuts, always in view on a computer. */}
            <div className="hidden shrink-0 items-center gap-4 border-t border-hairline bg-surface px-4 py-2 text-[11px] text-ink-500 lg:flex">
              <Shortcut k="Scan" label="adds the item" />
              <Shortcut k="Enter" label="adds the only match" />
              <Shortcut k="F2" label="next customer" />
              <Shortcut k="F8" label="charge" />
              <Shortcut k="Esc" label="close" />
              <span className="ml-auto">
                {visible.length} of {filtered.length} products shown
              </span>
            </div>
          </section>

          {/* Basket — tablet and desktop */}
          <aside className="hidden w-[420px] shrink-0 flex-col border-l border-hairline bg-surface lg:flex">
            {renderCartPanel(false)}
          </aside>
        </div>

        {/* Phone: basket bar */}
        <div className="shrink-0 border-t border-hairline bg-surface p-3 lg:hidden">
          <button
            type="button"
            onClick={() => setCartOpen(true)}
            className="btn btn-sell btn-lg flex w-full items-center justify-between"
          >
            <span className="flex items-center gap-2">
              <ShoppingCart className="h-5 w-5" aria-hidden />
              {active.label || "Customer"} · {fmtQty(itemCount)}{" "}
              {itemCount === 1 ? "item" : "items"}
            </span>
            <span className="tabular-nums">
              {formatNaira(totals.totalKobo)}
            </span>
          </button>
        </div>

        {cartOpen && (
          <div className="fixed inset-0 z-40 flex flex-col bg-surface lg:hidden">
            <div className="flex h-14 shrink-0 items-center justify-between border-b border-hairline px-4">
              <p className="font-bold">{active.label || "Customer"}</p>
              <button
                type="button"
                onClick={() => setCartOpen(false)}
                className="rounded-lg p-1.5 text-ink-500 hover:bg-canvas"
                aria-label="Close basket"
              >
                <X className="h-5 w-5" aria-hidden />
              </button>
            </div>
            {renderCartPanel(true)}
          </div>
        )}

        {flash && (
          <div className="pointer-events-none fixed bottom-24 left-1/2 z-30 -translate-x-1/2 lg:bottom-6 lg:left-[calc(50%-210px)]">
            <div className="animate-slide-up rounded-full bg-navy-950 px-4 py-2 text-sm font-semibold text-white shadow-lg">
              {flash}
            </div>
          </div>
        )}

        {payOpen && (
          <PayDialog
            totalKobo={totals.totalKobo}
            canCredit={permissions.creditSale}
            requireCustomerForCredit={settings.requireCustomerForCredit}
            submitting={submitting}
            error={payError}
            onCancel={() => {
              if (submitting) return;
              setPayOpen(false);
              setPayError(null);
              focusScan();
            }}
            onComplete={completeSale}
          />
        )}
      </div>

      {/* Outside the themed area on purpose: a receipt is printed on white paper
          whatever colour the screen is. */}
      <ChangeConfirm />
      {receipt && (
        <Receipt
          data={receipt}
          org={org}
          branch={branch}
          settings={settings}
          design={settings.receiptDesign}
          onClose={() => {
            setReceipt(null);
            focusScan();
          }}
        />
      )}
    </>
  );

  // Rendered inline (not a child component) so inputs keep focus across
  // re-renders and the markup is shared by the desktop column and phone sheet.
  function renderCartPanel(inSheet: boolean) {
    return (
      <>
        {/* Who this basket belongs to */}
        <div className="shrink-0 border-b border-hairline px-4 py-3">
          <div className="flex items-center gap-2">
            <label className="relative min-w-0 flex-1">
              <UserRound
                className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400"
                aria-hidden
              />
              <input
                value={active.label}
                onChange={(e) => renameActive(e.target.value)}
                onFocus={(e) => e.target.select()}
                placeholder="Customer name (optional)"
                aria-label="Customer name"
                className="h-9 w-full rounded-lg border border-transparent bg-canvas pl-8 pr-2 text-sm font-bold outline-none transition hover:border-hairline focus:border-navy-600 focus:bg-surface"
              />
            </label>
            {cart.length > 0 && (
              <button
                type="button"
                onClick={clearSale}
                className="shrink-0 rounded-lg px-2 py-1.5 text-xs font-semibold text-ink-500 transition hover:bg-bad-50 hover:text-bad-700"
              >
                Clear
              </button>
            )}
            {tickets.length > 1 && (
              <button
                type="button"
                onClick={async () => {
                  if (
                    cart.length > 0 &&
                    !(await confirmAction({
                      title: `Remove ${active.label || "this customer"}?`,
                      body: "Their basket will be cleared. Use this when a customer leaves without buying.",
                      confirmLabel: "Remove",
                      danger: true,
                    }))
                  )
                    return;
                  closeTicket(active.id);
                  focusScan();
                }}
                className="shrink-0 rounded-lg p-1.5 text-ink-400 transition hover:bg-bad-50 hover:text-bad-700"
                aria-label="Remove this customer"
                title="Customer left without buying"
              >
                <X className="h-4 w-4" aria-hidden />
              </button>
            )}
          </div>
          <div className="mt-2 flex items-center justify-between gap-2">
            <p className="text-[11px] leading-snug text-ink-500">
              Each item can be <strong className="text-ink-700">Retail</strong>{" "}
              or <strong className="text-brand-800">Wholesale</strong>. Tap to
              switch.
            </p>
            {waiting > 0 && (
              <span className="rounded-full bg-brand-50 px-2.5 py-1 text-[11px] font-bold text-brand-800">
                {waiting} waiting
              </span>
            )}
          </div>
        </div>

        {/* Column labels */}
        {cart.length > 0 && (
          <div className="flex shrink-0 items-center justify-between bg-canvas px-4 py-1.5 text-[11px] font-bold uppercase tracking-wider text-ink-500">
            <span>
              {cart.length} {cart.length === 1 ? "product" : "products"} ·{" "}
              {fmtQty(itemCount)} {itemCount === 1 ? "item" : "items"}
            </span>
            <span>Amount</span>
          </div>
        )}

        <div className="min-h-0 flex-1 overflow-y-auto">
          {cart.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-3 px-8 text-center">
              <div className="grid h-14 w-14 place-items-center rounded-2xl bg-navy-50">
                <ScanLine className="h-7 w-7 text-navy-600" aria-hidden />
              </div>
              <p className="text-base font-bold text-ink-900">
                Ready for {active.label || "the next customer"}
              </p>
              <p className="text-sm leading-relaxed text-ink-500">
                Scan an item or tap a product. If this customer has to step
                away, press{" "}
                <strong className="text-ink-700">Next customer</strong> and
                serve the next person.
              </p>
              <div className="mt-2 flex flex-wrap justify-center gap-2 text-[11px] text-ink-500">
                <span className="inline-flex items-center gap-1">
                  <Keyboard className="h-3.5 w-3.5" aria-hidden />
                  <kbd className="rounded border border-hairline bg-canvas px-1 font-bold">
                    F2
                  </kbd>{" "}
                  next customer
                </span>
                <span className="inline-flex items-center gap-1">
                  <kbd className="rounded border border-hairline bg-canvas px-1 font-bold">
                    F8
                  </kbd>{" "}
                  charge
                </span>
              </div>
            </div>
          ) : (
            <ul className="divide-y divide-hairline">
              {resolved.map((r) => (
                <CartRow
                  key={r.line.key}
                  resolved={r}
                  highlight={r.line.key === lastKey}
                  onInc={() => setQty(r.line.key, r.line.quantity + 1)}
                  onDec={() => setQty(r.line.key, r.line.quantity - 1)}
                  onSet={(q) => setQty(r.line.key, q)}
                  onRemove={() => removeLine(r.line.key)}
                  onMode={(m) => setLineMode(r.line.key, m)}
                  onDone={focusScan}
                />
              ))}
            </ul>
          )}
        </div>

        {/* Totals and charge */}
        <div className="shrink-0 border-t border-hairline bg-surface p-4">
          {permissions.discount && cart.length > 0 && (
            <label className="mb-3 flex items-center justify-between gap-3 text-sm">
              <span className="font-medium text-ink-600">Discount (₦)</span>
              <input
                inputMode="decimal"
                value={orderDiscountInput}
                onChange={(e) => setOrderDiscountInput(e.target.value)}
                placeholder="0"
                className="h-9 w-32 rounded-lg border border-hairline bg-canvas px-3 text-right font-semibold tabular-nums outline-none focus:border-navy-600"
              />
            </label>
          )}

          <dl className="space-y-1 text-sm">
            <div className="flex justify-between">
              <dt className="text-ink-500">Subtotal</dt>
              <dd className="font-semibold tabular-nums">
                {formatNaira(totals.subtotalKobo)}
              </dd>
            </div>
            {totals.discountKobo > 0 && (
              <div className="flex justify-between text-bad-700">
                <dt>Discount</dt>
                <dd className="font-semibold tabular-nums">
                  −{formatNaira(totals.discountKobo)}
                </dd>
              </div>
            )}
            {settings.vatEnabled && totals.taxKobo > 0 && (
              <div className="flex justify-between">
                <dt className="text-ink-500">
                  VAT{" "}
                  {(settings.vatBasisPoints / 100).toFixed(
                    settings.vatBasisPoints % 100 ? 1 : 0,
                  )}
                  %{settings.vatInclusive ? " (incl.)" : ""}
                </dt>
                <dd className="font-semibold tabular-nums">
                  {formatNaira(totals.taxKobo)}
                </dd>
              </div>
            )}
          </dl>

          <div className="texture-waves mt-3 flex items-end justify-between rounded-2xl bg-navy-950 px-4 py-3 text-white [@media(max-height:800px)]:hidden">
            <span className="text-sm font-semibold text-white/70">
              Total to pay
            </span>
            <span className="text-3xl font-bold tabular-nums tracking-tight">
              {formatNaira(totals.totalKobo)}
            </span>
          </div>

          {stockBlocked && (
            <p className="mt-2 text-xs font-medium text-bad-700">
              Not enough stock for one or more items. Reduce the quantity,
              receive stock, or allow selling at zero stock in Settings.
            </p>
          )}

          <button
            type="button"
            onClick={() => {
              openCharge();
              if (inSheet) setCartOpen(false);
            }}
            disabled={!canCharge}
            className="btn btn-sell btn-lg mt-3 h-14 w-full text-lg disabled:opacity-40"
          >
            Charge {formatNaira(totals.totalKobo)}
            <kbd className="ml-1 hidden rounded bg-white/20 px-1.5 text-xs font-bold md:inline">
              F8
            </kbd>
          </button>
        </div>
      </>
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Small presentational pieces
// ─────────────────────────────────────────────────────────────────────────────

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

function SyncPill({
  online,
  syncing,
  error,
  queued,
}: {
  online: boolean;
  syncing: boolean;
  error: string | null;
  queued: number;
}) {
  if (!online) {
    return (
      <span className="flex items-center gap-1.5 rounded-full bg-brand-500 px-2.5 py-1 text-[11px] font-bold text-ink-950">
        <WifiOff className="h-3.5 w-3.5" aria-hidden />
        Offline{queued > 0 ? ` · ${queued} to send` : ""}
      </span>
    );
  }
  if (queued > 0) {
    return (
      <span className="flex items-center gap-1.5 rounded-full bg-white/10 px-2.5 py-1 text-[11px] font-semibold text-white/85">
        <RefreshCw
          className={`h-3.5 w-3.5 ${syncing ? "animate-spin" : ""}`}
          aria-hidden
        />
        Sending {queued}
      </span>
    );
  }
  return (
    <span
      className="flex items-center gap-1.5 rounded-full bg-white/10 px-2.5 py-1 text-[11px] font-semibold text-white/75"
      title={error ?? "Up to date"}
    >
      <span
        className={`h-2 w-2 rounded-full ${error ? "bg-bad-500" : "bg-good-500"}`}
        aria-hidden
      />
      {error ? "Retrying" : "Online"}
    </span>
  );
}

function Clock({ timezone }: { timezone: string }) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    // The time in the page's HTML is the moment the server built it — and when
    // the till opens from its offline copy, that can be hours ago. Correct it
    // as soon as the page is live, then keep it ticking.
    const first = window.setTimeout(() => setNow(new Date()), 0);
    const id = window.setInterval(() => setNow(new Date()), 1000 * 30);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(id);
    };
  }, []);
  const fmt = useMemo(
    () =>
      new Intl.DateTimeFormat("en-NG", {
        timeZone: timezone,
        hour: "2-digit",
        minute: "2-digit",
      }),
    [timezone],
  );
  return (
    // suppressHydrationWarning: the server's minute and the browser's minute
    // are allowed to differ here; the effect above settles it.
    <span
      suppressHydrationWarning
      className="hidden text-xs font-semibold tabular-nums text-white/60 sm:inline"
    >
      {fmt.format(now)}
    </span>
  );
}

function CategoryChip({
  label,
  color,
  active,
  onClick,
}: {
  label: string;
  color?: string | null;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-3.5 py-1.5 text-sm font-semibold transition ${
        active
          ? "border-navy-700 bg-navy-700 text-white"
          : "border-hairline bg-surface text-ink-700 hover:border-navy-300"
      }`}
    >
      {color && (
        <span
          className="h-2 w-2 rounded-full"
          style={{ backgroundColor: color }}
          aria-hidden
        />
      )}
      {label}
    </button>
  );
}

/** Tile colours for products with no photo, picked from the name so each product keeps its colour. */
const TILE_TINTS = [
  "bg-navy-50 text-navy-700",
  "bg-brand-50 text-brand-700",
  "bg-sell-50 text-sell-700",
  "bg-good-50 text-good-700",
];

function ProductTile({
  product,
  available,
  inCart,
  allowNegative,
  onPick,
}: {
  product: StoredProduct;
  available: number;
  inCart: number;
  allowNegative: boolean;
  onPick: (p: StoredProduct, mode?: PriceMode) => void;
}) {
  const out = available <= 0 && !allowNegative;
  const low = !out && available <= 5;
  const tint =
    TILE_TINTS[
      [...product.name].reduce((n, c) => n + c.charCodeAt(0), 0) %
        TILE_TINTS.length
    ];
  const unit = product.unit || "pcs";
  const hasWholesale = product.wholesalePriceKobo > 0;
  const days = daysToExpiry(product.expiryDate);

  return (
    <div
      className={`group relative flex flex-col rounded-2xl border bg-surface transition ${
        out ? "opacity-45" : "hover:-translate-y-0.5 hover:shadow-[var(--shadow-raised)]"
      } ${
        inCart > 0
          ? "border-navy-600 shadow-[0_0_0_3px_rgba(29,58,138,0.12)]"
          : "border-hairline shadow-[var(--shadow-card)] hover:border-navy-300"
      }`}
    >
      {/* Most of the tile adds one at RETAIL: a big, easy target. */}
      <button
        type="button"
        onClick={() => onPick(product, "RETAIL")}
        disabled={out}
        className="flex flex-1 flex-col gap-2 rounded-2xl p-2.5 text-left active:scale-[0.98] disabled:cursor-not-allowed"
        aria-label={`Add ${product.name} at retail price`}
      >
        <div className="flex items-start gap-2.5">
          <div className="relative size-12 shrink-0 overflow-hidden rounded-xl">
            {product.imageThumb ? (
              // eslint-disable-next-line @next/next/no-img-element -- tiny inlined data-uri thumb, no network
              <img src={product.imageThumb} alt="" className="h-full w-full object-cover" draggable={false} />
            ) : (
              <div className={`flex h-full w-full items-center justify-center text-sm font-black ${tint}`}>
                {product.name.slice(0, 2).toUpperCase()}
              </div>
            )}
          </div>
          <div className="min-w-0 flex-1">
            <p className="line-clamp-2 text-[13px] font-semibold leading-snug text-ink-900">{product.name}</p>
            <p
              className={`mt-0.5 text-[11px] font-bold tabular-nums ${
                out ? "text-ink-500" : low ? "text-sell-600" : "text-good-700"
              }`}
            >
              {out ? "Out of stock" : `${fmtQty(available)} ${unit} left`}
              {days !== null && days <= 30 ? (
                <span className={days < 0 ? " text-sell-700" : " text-brand-700"}>
                  {" · "}
                  {days < 0 ? "expired" : `exp. ${days}d`}
                </span>
              ) : null}
            </p>
          </div>
        </div>
        <p className="mt-auto text-lg font-extrabold leading-none tabular-nums text-ink-950">
          {formatNaira(product.sellingPriceKobo)}
        </p>
      </button>

      {inCart > 0 && (
        <span className="pointer-events-none absolute -right-1.5 -top-1.5 flex h-6 min-w-6 items-center justify-center rounded-full bg-navy-700 px-1.5 text-[11px] font-bold tabular-nums text-white shadow ring-2 ring-surface">
          {fmtQty(inCart)}
        </span>
      )}

      {/* Wholesale: a small second target in the corner, only when the product has a price for it. */}
      {hasWholesale ? (
        <button
          type="button"
          onClick={() => onPick(product, "WHOLESALE")}
          disabled={out}
          className="absolute bottom-2 right-2 rounded-lg border border-brand-200 bg-brand-50 px-2 py-1 text-[11px] font-bold tabular-nums text-brand-800 transition hover:border-brand-500 hover:bg-brand-100 active:scale-95 disabled:cursor-not-allowed"
          aria-label={`Add ${product.name} at wholesale price`}
          title="Add at wholesale price"
        >
          W {formatNaira(product.wholesalePriceKobo)}
        </button>
      ) : null}
    </div>
  );
}

function CartRow({
  resolved,
  highlight,
  onInc,
  onDec,
  onSet,
  onRemove,
  onMode,
  onDone,
}: {
  resolved: ResolvedLine;
  highlight: boolean;
  onInc: () => void;
  onDec: () => void;
  onSet: (q: number) => void;
  onRemove: () => void;
  onMode: (m: PriceMode) => void;
  onDone: () => void;
}) {
  const { line, unitPriceKobo, priceType, lineTotalKobo, over, available } =
    resolved;
  const hasWholesale = line.product.wholesalePriceKobo > 0;
  const chosen: PriceMode = line.priceMode ?? "RETAIL";
  // What the cashier is typing. Kept apart from the real quantity so clearing
  // the box to type a new number doesn't delete the item halfway through.
  const [draft, setDraft] = useState<string | null>(null);
  const unit = line.product.unit || "pcs";

  function commit() {
    if (draft === null) return;
    const n = Number(draft.replace(/[^0-9.]/g, ""));
    if (Number.isFinite(n) && n > 0) onSet(n);
    setDraft(null);
  }

  return (
    <li
      className={`border-l-4 px-3.5 py-2 transition-colors duration-700 ${
        chosen === "WHOLESALE" ? "border-l-brand-500" : "border-l-navy-600"
      } ${highlight ? "bg-navy-50" : over ? "bg-bad-50" : ""}`}
    >
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold leading-snug text-ink-950">
            {line.product.name}
          </p>
          <ExpiryTag expiryDate={line.product.expiryDate} />
          {/* Retail or wholesale, for this item only. */}
          <div className="mt-1 inline-flex rounded-md border border-hairline bg-canvas p-0.5 text-[10.5px] font-bold">
            <button
              type="button"
              onClick={() => onMode("RETAIL")}
              aria-pressed={chosen === "RETAIL"}
              className={`rounded px-2 py-0.5 tabular-nums transition ${
                chosen === "RETAIL"
                  ? "bg-navy-700 text-white"
                  : "text-ink-500 hover:text-ink-900"
              }`}
            >
              Retail {formatNaira(line.product.sellingPriceKobo)}
            </button>
            <button
              type="button"
              onClick={() => hasWholesale && onMode("WHOLESALE")}
              disabled={!hasWholesale}
              aria-pressed={chosen === "WHOLESALE"}
              title={
                hasWholesale ? undefined : "This product has no wholesale price"
              }
              className={`rounded px-2 py-0.5 tabular-nums transition disabled:cursor-not-allowed disabled:opacity-40 ${
                chosen === "WHOLESALE"
                  ? "bg-brand-700 text-white"
                  : "text-ink-500 hover:text-ink-900"
              }`}
            >
              Wholesale
              {hasWholesale
                ? ` ${formatNaira(line.product.wholesalePriceKobo)}`
                : ""}
            </button>
          </div>
          {(over || (priceType === "WHOLESALE" && chosen === "RETAIL")) && (
            <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-ink-500">
              <span className="tabular-nums">
                Charging {formatNaira(unitPriceKobo)} each
              </span>
              {priceType === "WHOLESALE" && chosen === "RETAIL" && (
                <span className="rounded bg-brand-50 px-1.5 py-0.5 font-bold text-brand-800">
                  Wholesale price (bought in bulk)
                </span>
              )}
              {over && (
                <span className="font-bold text-bad-700">
                  Only {fmtQty(available)} {unit} in stock
                </span>
              )}
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={onRemove}
          className="-mr-1 rounded-md p-1 text-ink-300 transition hover:bg-bad-50 hover:text-bad-700"
          aria-label={`Remove ${line.product.name}`}
        >
          <Trash2 className="h-4 w-4" aria-hidden />
        </button>
      </div>

      <div className="mt-1.5 flex items-center justify-between gap-3">
        <div className="flex items-center rounded-lg border border-hairline bg-canvas p-0.5">
          <button
            type="button"
            onClick={onDec}
            className="flex h-8 w-8 items-center justify-center rounded-md text-ink-700 transition hover:bg-surface active:scale-95"
            aria-label={`One less ${line.product.name}`}
          >
            <Minus className="h-4 w-4" aria-hidden />
          </button>
          <input
            inputMode="decimal"
            value={draft ?? fmtQty(line.quantity)}
            onFocus={(e) => {
              setDraft(fmtQty(line.quantity));
              e.target.select();
            }}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                commit();
                (e.target as HTMLInputElement).blur();
                onDone();
              } else if (e.key === "Escape") {
                setDraft(null);
                (e.target as HTMLInputElement).blur();
              }
            }}
            className="h-8 w-12 bg-transparent text-center text-[15px] font-bold tabular-nums text-ink-950 outline-none"
            aria-label={`Quantity of ${line.product.name}`}
          />
          <button
            type="button"
            onClick={onInc}
            className="flex h-8 w-8 items-center justify-center rounded-md text-ink-700 transition hover:bg-surface active:scale-95"
            aria-label={`One more ${line.product.name}`}
          >
            <Plus className="h-4 w-4" aria-hidden />
          </button>
        </div>
        <span className="text-xs text-ink-500">{unit}</span>
        <span className="ml-auto text-base font-bold tabular-nums text-ink-950">
          {formatNaira(lineTotalKobo)}
        </span>
      </div>
    </li>
  );
}

function EmptyGrid({
  hasProducts,
  query,
}: {
  hasProducts: boolean;
  query: string;
}) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
      <Search className="h-8 w-8 text-ink-300" aria-hidden />
      <p className="text-sm text-ink-500">
        {!hasProducts
          ? "No products yet. Add some in the back office, then they'll appear here."
          : query
            ? `Nothing matches “${query.trim()}”.`
            : "No products in this category."}
      </p>
    </div>
  );
}

function fmtQty(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/\.?0+$/, "");
}


/** Whole days until a product's nearest expiry, or null when it has none. */
function daysToExpiry(expiryDate: string | null | undefined): number | null {
  if (!expiryDate) return null;
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  return Math.floor((new Date(expiryDate).getTime() - today.getTime()) / 86_400_000);
}

/** A small warning on a cart line when the item expires soon or has expired. */
function ExpiryTag({ expiryDate }: { expiryDate: string | null | undefined }) {
  const days = daysToExpiry(expiryDate);
  if (days === null || days > 30) return null;
  return (
    <p
      className={`mt-0.5 text-[11px] font-bold ${days < 0 ? "text-sell-700" : "text-brand-700"}`}
    >
      {days < 0 ? "Expired stock" : days === 0 ? "Expires today" : `Expires in ${days} day${days === 1 ? "" : "s"}`}
    </p>
  );
}

function Shortcut({ k, label }: { k: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <kbd className="rounded-md border border-hairline bg-canvas px-1.5 py-0.5 font-sans text-[10px] font-bold text-ink-700 shadow-[0_1px_0_rgba(0,0,0,0.06)]">
        {k}
      </kbd>
      {label}
    </span>
  );
}
