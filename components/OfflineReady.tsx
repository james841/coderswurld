"use client";

import { useEffect } from "react";

/**
 * Registers the service worker (public/sw.js) and tells it what to keep.
 *
 * Renders nothing. It is mounted in two places:
 *
 *   - on the till, where it saves the exact files the page just loaded, and
 *   - in the back-office shell with `warmTill`, where it asks the worker to
 *     fetch and save the till in the background — so a shop is ready for an
 *     outage before the first time it happens, not after.
 *
 * Production only. In development the build files are not hashed and change
 * under you; a worker caching them would serve stale code and waste an
 * afternoon.
 */
export function OfflineReady({ warmTill = false }: { warmTill?: boolean }) {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (!("serviceWorker" in navigator)) return;

    let cancelled = false;

    (async () => {
      try {
        await navigator.serviceWorker.register("/sw.js", { scope: "/" });
        const registration = await navigator.serviceWorker.ready;
        if (cancelled || !registration.active) return;

        // Files this page loaded before the worker was in control were never
        // seen by it, so hand over the list explicitly.
        const urls = performance
          .getEntriesByType("resource")
          .map((entry) => entry.name)
          .filter((name) => name.includes("/_next/static/"));
        registration.active.postMessage({ type: "CACHE_STATIC", urls });

        if (warmTill && navigator.onLine) {
          registration.active.postMessage({ type: "WARM_TILL" });
        } else if (navigator.onLine) {
          // Not a till user: still keep the Offline view ready.
          registration.active.postMessage({ type: "WARM_OFFLINE" });
        }
      } catch {
        // No worker (private window, old browser, blocked by policy). The app
        // works exactly as before; it just can't open with no network.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [warmTill]);

  return null;
}

/**
 * Called on sign-out. The saved till page holds this person's name and their
 * shop's settings; the next person at this computer should not get it.
 */
export async function forgetOfflineUser(): Promise<void> {
  // The Offline view only shows a copy while someone is signed in on this
  // computer. Signing out hides it (the till's unsent sales stay safe).
  try {
    window.localStorage.removeItem(OFFLINE_COPY_KEY);
  } catch {
    /* storage blocked */
  }
  try {
    if (typeof caches !== "undefined") {
      const names = await caches.keys();
      await Promise.all(names.filter((n) => n.startsWith("cw-pages-")).map((n) => caches.delete(n)));
    }
  } catch {
    // Nothing saved, or storage is unavailable — nothing to forget.
  }
}

/** Where this computer's read-only copy lives (a till database name). */
export const OFFLINE_COPY_KEY = "cw:offline-copy";
