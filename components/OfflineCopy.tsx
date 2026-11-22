"use client";

import { useEffect } from "react";

import { OFFLINE_COPY_KEY } from "@/components/OfflineReady";

/**
 * Keeps a read-only copy of this shop's products and stock on this computer,
 * so the Offline view (/offline) has something to show when the internet goes.
 *
 * It uses the same saved database as the till, and the same download (pages
 * of 2,500 products, then only what changed), so a computer that also runs
 * the till keeps one copy, not two. It waits until the page has settled,
 * runs at most every 10 minutes, and never gets in the way: any failure is
 * silent and simply leaves the last copy.
 */
export function OfflineCopy({
  orgId,
  branchId,
  orgName,
  branchName,
}: {
  orgId: string;
  branchId: string;
  orgName: string;
  branchName: string;
}) {
  useEffect(() => {
    const name = `cw-pos:${orgId}:${branchId}`;
    try {
      window.localStorage.setItem(OFFLINE_COPY_KEY, name);
    } catch {
      /* storage blocked: no Offline view on this computer */
    }

    const LAST = `cw:offline-copy-at:${name}`;
    const run = async () => {
      if (!navigator.onLine) return;
      try {
        const last = Number(window.localStorage.getItem(LAST) ?? 0);
        if (Date.now() - last < 10 * 60_000) return;
        window.localStorage.setItem(LAST, String(Date.now()));
      } catch {
        return;
      }
      try {
        const { getPosDb, runSync } = await import("@/app/pos/catalog");
        const db = getPosDb(orgId, branchId);
        await db.meta.bulkPut([
          { key: "orgName", value: orgName },
          { key: "branchName", value: branchName },
        ]);
        await runSync(db, "", 0, undefined, true);
        void navigator.storage?.persist?.().catch(() => false);
      } catch {
        // Offline, signed out, or no permission: keep the last copy.
      }
    };
    const id = window.setTimeout(() => void run(), 4000);
    return () => window.clearTimeout(id);
  }, [orgId, branchId, orgName, branchName]);

  return null;
}
