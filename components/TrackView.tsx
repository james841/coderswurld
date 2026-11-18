"use client";

import { useEffect } from "react";

/**
 * Records a visit to a public page for the platform's traffic report.
 *
 * Cookie-free: a random visitor id lives in localStorage, a session id in
 * sessionStorage. Visitors with "Do Not Track" switched on are skipped.
 * The visitor's first source is remembered so a later plan request can say
 * where that customer originally came from.
 */

function rid() {
  const a = new Uint8Array(12);
  crypto.getRandomValues(a);
  return Array.from(a, (b) => b.toString(16).padStart(2, "0")).join("");
}

function store(kind: "local" | "session", key: string, make: () => string): { value: string; created: boolean } {
  try {
    const s = kind === "local" ? localStorage : sessionStorage;
    const existing = s.getItem(key);
    if (existing) return { value: existing, created: false };
    const value = make();
    s.setItem(key, value);
    return { value, created: true };
  } catch {
    return { value: make(), created: true };
  }
}

function send(body: object) {
  const data = JSON.stringify(body);
  try {
    if (navigator.sendBeacon?.("/api/track", new Blob([data], { type: "application/json" }))) return;
  } catch {
    // fall through
  }
  fetch("/api/track", { method: "POST", body: data, keepalive: true, headers: { "content-type": "application/json" } }).catch(() => {});
}

/**
 * The view currently open. Kept outside React so a remount of the same page
 * (React does this on purpose in development, and on fast refreshes) carries
 * on with the same view instead of counting the visit twice.
 */
let active: { path: string; id: string; started: number; maxScroll: number; sent: boolean } | null = null;

function sendLeave() {
  if (!active || active.sent) return;
  active.sent = true;
  send({
    type: "leave",
    id: active.id,
    durationMs: Math.round(performance.now() - active.started),
    scrollDepth: active.maxScroll,
  });
}

export function TrackView() {
  useEffect(() => {
    if (navigator.doNotTrack === "1") return;

    if (active && active.path !== location.pathname) sendLeave();
    if (!active || active.path !== location.pathname || active.sent) {
      const visitor = store("local", "cw-vid", rid);
      const session = store("session", "cw-sid", rid);
      const params = new URLSearchParams(location.search);
      active = { path: location.pathname, id: rid(), started: performance.now(), maxScroll: 0, sent: false };

      send({
        type: "view",
        id: active.id,
        visitorId: visitor.value,
        sessionId: session.value,
        path: location.pathname,
        referrer: document.referrer || null,
        utmSource: params.get("utm_source"),
        utmMedium: params.get("utm_medium"),
        utmCampaign: params.get("utm_campaign"),
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        isNewVisitor: visitor.created,
      });

      // First touch, kept for plan-request attribution.
      try {
        if (!localStorage.getItem("cw-src")) {
          const ref = document.referrer ? new URL(document.referrer).hostname.replace(/^www\./, "") : "";
          const own = location.hostname.replace(/^www\./, "");
          const src = params.get("utm_source") || (ref && ref !== own ? ref : "") || "direct";
          localStorage.setItem("cw-src", src.slice(0, 100));
        }
      } catch {
        // ignore
      }
    }

    function onScroll() {
      const h = document.documentElement.scrollHeight - innerHeight;
      if (active && h > 0) active.maxScroll = Math.max(active.maxScroll, Math.min(100, Math.round((scrollY / h) * 100)));
    }
    function onHide() {
      if (document.visibilityState === "hidden") sendLeave();
    }
    addEventListener("scroll", onScroll, { passive: true });
    addEventListener("pagehide", sendLeave);
    document.addEventListener("visibilitychange", onHide);
    return () => {
      // No leave beacon here: an unmount is not the visitor leaving. Moving to
      // another page sends it from that page's mount (path changes) or pagehide.
      removeEventListener("scroll", onScroll);
      removeEventListener("pagehide", sendLeave);
      document.removeEventListener("visibilitychange", onHide);
    };
  }, []);

  return null;
}

/** The visitor's first source and id, for attaching to a plan request. */
export function readAttribution(): { trafficSource: string | null; visitorId: string | null } {
  try {
    return { trafficSource: localStorage.getItem("cw-src"), visitorId: localStorage.getItem("cw-vid") };
  } catch {
    return { trafficSource: null, visitorId: null };
  }
}
