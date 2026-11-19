import Dexie, { type Table } from "dexie";

import type { CatalogProduct, CatalogStock, SyncResponse } from "@/lib/pos";

/**
 * The till's local catalogue — IndexedDB, via Dexie.
 *
 * This is the thing that makes product load feel instant: the cashier's whole
 * catalogue lives on the device, so typing a name filters an in-memory list
 * with no network in the loop. The server is consulted only to learn what
 * changed (see runSync), which in steady state is nothing.
 *
 * WHY THE DB IS BUILT LAZILY
 * --------------------------
 * This module is bundled for the browser but, like every "use client" module,
 * is also evaluated on the server during the initial render. `new Dexie()` must
 * not run there — there is no IndexedDB. So the class is only *defined* at module
 * scope and the instance is constructed on first use inside the browser, keyed
 * by org+branch so two shops signed in on one machine never share a catalogue.
 */

export type StoredProduct = CatalogProduct;

export interface StoredStock {
  productId: string;
  quantity: number;
}

interface StoredMeta {
  key: string;
  value: string;
}

/** A sale made while offline, waiting to be replayed. Body is the POST payload. */
export interface QueuedSale {
  localId: string;
  body: string;
  createdAt: number;
  /**
   * Set when the server refused this sale for a reason a retry won't fix
   * (a permission, a missing customer). The sale is KEPT on the device, never
   * thrown away: real money was taken. It is shown to the cashier and can be
   * retried after a manager fixes the cause.
   */
  stuck?: string;
}

class PosDexie extends Dexie {
  products!: Table<StoredProduct, string>;
  stock!: Table<StoredStock, string>;
  meta!: Table<StoredMeta, string>;
  queue!: Table<QueuedSale, string>;

  constructor(name: string) {
    super(name);
    this.version(1).stores({
      // Indexed on the fields the till searches by. barcode is sparse (nulls are
      // simply absent from the index), which is exactly what we want — a scan
      // looks up a present barcode, nothing else.
      products: "id, barcode, sku, name, categoryId",
      stock: "productId",
      meta: "key",
      queue: "localId, createdAt",
    });
  }
}

let instance: PosDexie | null = null;
let instanceName = "";

export function getPosDb(orgId: string, branchId: string): PosDexie {
  if (typeof indexedDB === "undefined") {
    throw new Error("This device has no offline storage, so the till can't run here.");
  }
  const name = `cw-pos:${orgId}:${branchId}`;
  if (!instance || instanceName !== name) {
    instance = new PosDexie(name);
    instanceName = name;
  }
  return instance;
}

// ─────────────────────────────────────────────────────────────────────────────
// Device identity
// ─────────────────────────────────────────────────────────────────────────────

const DEVICE_KEY = "cw.pos.deviceId";

/** A stable per-browser id, minted once and kept in localStorage. */
export function getDeviceId(): string {
  if (typeof localStorage === "undefined") return "server";
  let id = localStorage.getItem(DEVICE_KEY);
  if (!id) {
    id =
      typeof crypto !== "undefined" && crypto.randomUUID
        ? crypto.randomUUID()
        : `dev-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    localStorage.setItem(DEVICE_KEY, id);
  }
  return id;
}

/** A short, human-ish platform label for the devices list in the back office. */
export function devicePlatform(): string {
  if (typeof navigator === "undefined") return "";
  const ua = navigator.userAgent;
  if (/Android/i.test(ua)) return "Android";
  if (/iPhone|iPad|iPod/i.test(ua)) return "iOS";
  if (/Windows/i.test(ua)) return "Windows";
  if (/Macintosh|Mac OS/i.test(ua)) return "macOS";
  if (/Linux/i.test(ua)) return "Linux";
  return "Web";
}

// ─────────────────────────────────────────────────────────────────────────────
// Sync
// ─────────────────────────────────────────────────────────────────────────────

async function readCursors(
  db: PosDexie,
): Promise<{ catalogVersion: number; stockSince: string | null }> {
  const [version, stockSince] = await Promise.all([
    db.meta.get("catalogVersion"),
    db.meta.get("stockSince"),
  ]);
  return {
    catalogVersion: version ? Number(version.value) || 0 : 0,
    stockSince: stockSince?.value ?? null,
  };
}

export interface SyncOutcome {
  catalogVersion: number;
  changed: number;
  stockChanged: number;
  full: boolean;
}

/**
 * Pull whatever has changed and fold it into the local catalogue.
 *
 * A full response replaces the product table (the client was starting fresh, or
 * had drifted); a delta applies upserts and removes anything that came back
 * deactivated. Stock is folded in the same transaction so the till never shows
 * a product at a quantity from one sync and a price from another.
 */
export async function runSync(
  db: PosDexie,
  deviceId: string,
  pendingCount: number,
): Promise<SyncOutcome> {
  const cursors = await readCursors(db);
  const params = new URLSearchParams();
  params.set("since", String(cursors.catalogVersion));
  if (cursors.stockSince) params.set("stockSince", cursors.stockSince);
  params.set("device", deviceId);
  params.set("pending", String(pendingCount));
  const platform = devicePlatform();
  if (platform) params.set("platform", platform);

  const res = await fetch(`/api/pos/sync?${params.toString()}`, { cache: "no-store" });
  if (!res.ok) {
    throw new Error(`Sync failed (${res.status})`);
  }
  const data = (await res.json()) as SyncResponse;

  const deactivated = data.upserts.filter((p) => !p.isActive).map((p) => p.id);
  const active = data.upserts.filter((p) => p.isActive);

  await db.transaction("rw", db.products, db.stock, db.meta, async () => {
    if (data.full) await db.products.clear();
    if (active.length) await db.products.bulkPut(active);
    if (deactivated.length) await db.products.bulkDelete(deactivated);

    if (data.stockFull) await db.stock.clear();
    if (data.stock.length) {
      await db.stock.bulkPut(data.stock.map((s) => ({ productId: s.p, quantity: s.q })));
    }

    await db.meta.bulkPut([
      { key: "catalogVersion", value: String(data.catalogVersion) },
      { key: "stockSince", value: data.serverTime },
    ]);
  });

  return {
    catalogVersion: data.catalogVersion,
    changed: data.upserts.length,
    stockChanged: data.stock.length,
    full: data.full,
  };
}

export async function loadCatalog(
  db: PosDexie,
): Promise<{ products: StoredProduct[]; stock: Map<string, number> }> {
  const [products, stockRows] = await Promise.all([db.products.toArray(), db.stock.toArray()]);
  const stock = new Map<string, number>();
  for (const row of stockRows) stock.set(row.productId, row.quantity);
  return { products, stock };
}

/** Fold a sale's authoritative post-sale quantities back into the local store. */
export async function applyStockDeltas(db: PosDexie, stock: CatalogStock[]): Promise<void> {
  if (!stock.length) return;
  await db.stock.bulkPut(stock.map((s) => ({ productId: s.p, quantity: s.q })));
}

// ─────────────────────────────────────────────────────────────────────────────
// Offline queue — a safety net; the full replay engine lands with the PWA work
// ─────────────────────────────────────────────────────────────────────────────

export async function enqueueSale(db: PosDexie, localId: string, body: string): Promise<void> {
  await db.queue.put({ localId, body, createdAt: Date.now() });
}

/** Sales still waiting to be sent (not counting stuck ones). */
export async function queueCount(db: PosDexie): Promise<number> {
  return db.queue.filter((q) => !q.stuck).count();
}

/** Waiting sales, oldest first. Stuck ones are left out until retried. */
export async function listQueued(db: PosDexie): Promise<QueuedSale[]> {
  return (await db.queue.orderBy("createdAt").toArray()).filter((q) => !q.stuck);
}

export async function listStuck(db: PosDexie): Promise<QueuedSale[]> {
  return (await db.queue.orderBy("createdAt").toArray()).filter((q) => Boolean(q.stuck));
}

export async function markStuck(db: PosDexie, localId: string, reason: string): Promise<void> {
  await db.queue.update(localId, { stuck: reason });
}

/** Put every stuck sale back in line to be sent. */
export async function retryStuck(db: PosDexie): Promise<void> {
  const stuck = await listStuck(db);
  await Promise.all(stuck.map((q) => db.queue.update(q.localId, { stuck: undefined })));
}

export async function dropQueued(db: PosDexie, localId: string): Promise<void> {
  await db.queue.delete(localId);
}
