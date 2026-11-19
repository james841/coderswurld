/*
 * Coderswurld Inventory — service worker.
 *
 * WHAT THIS IS FOR
 * ----------------
 * The till already keeps its catalogue and unsent sales in IndexedDB, so it can
 * sell with no network. What it could not do was *open* with no network: close
 * the tab or restart the computer during an outage and the browser had nothing
 * to load. This worker keeps a copy of the till's page and its code on the
 * device, so /pos opens offline exactly as it does online.
 *
 * WHAT IT DELIBERATELY DOES NOT DO
 * --------------------------------
 *  - It never caches /api/*. Money and stock answers must come from the server
 *    or from the till's own local database, never from a stale HTTP cache.
 *  - It never caches back-office pages. A dashboard from yesterday that looks
 *    like today is worse than an honest "you're offline".
 *  - It never serves the cached till while the network works. Online, the page
 *    always comes fresh from the server, so a suspended account or a removed
 *    cashier is locked out on their next load. The copy is only a fallback.
 *
 * Plain JavaScript on purpose: this file is served as-is from /public and is
 * not part of the app bundle.
 */

const VERSION = "v3"; // v3: new logo icons
const STATIC_CACHE = `cw-static-${VERSION}`; // hashed build files: safe forever
const PAGES_CACHE = `cw-pages-${VERSION}`; // the till's HTML: one entry
const TILL_PATH = "/pos";
const MAX_STATIC_ENTRIES = 400;
const NAVIGATION_TIMEOUT_MS = 5000;

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names
          .filter((name) => name.startsWith("cw-") && name !== STATIC_CACHE && name !== PAGES_CACHE)
          .map((name) => caches.delete(name)),
      );
      await self.clients.claim();
    })(),
  );
});

function isStaticAsset(url) {
  return url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/icons/");
}

/** Old build files pile up across deploys; drop the oldest once past the cap. */
async function trimStaticCache() {
  const cache = await caches.open(STATIC_CACHE);
  const keys = await cache.keys();
  const extra = keys.length - MAX_STATIC_ENTRIES;
  for (let i = 0; i < extra; i += 1) await cache.delete(keys[i]);
}

async function cacheStatic(urls) {
  const cache = await caches.open(STATIC_CACHE);
  await Promise.all(
    urls.map(async (url) => {
      try {
        if (await cache.match(url)) return;
        const response = await fetch(url, { credentials: "same-origin" });
        if (response.ok) await cache.put(url, response);
      } catch {
        // One file failing must not stop the rest from being saved.
      }
    }),
  );
  await trimStaticCache();
}

/** Only a real, final till page is worth keeping — not a redirect to sign-in. */
function isKeepableTillPage(response) {
  return (
    response.ok &&
    response.status === 200 &&
    !response.redirected &&
    (response.headers.get("content-type") || "").includes("text/html")
  );
}

/**
 * Fetch the till page and keep it, along with every build file it points at.
 * Called from the back office too, so the till is ready offline before the
 * cashier has even opened it for the first time.
 */
async function warmTill() {
  try {
    const response = await fetch(TILL_PATH, { credentials: "same-origin", cache: "no-store" });
    if (!isKeepableTillPage(response)) return;
    const html = await response.clone().text();
    const pages = await caches.open(PAGES_CACHE);
    await pages.put(TILL_PATH, response);
    const found = html.match(/\/_next\/static\/[^"'\\\s)<>]+/g) || [];
    await cacheStatic([...new Set(found)]);
  } catch {
    // Offline or the server is down: keep whatever copy we already have.
  }
}

self.addEventListener("message", (event) => {
  const data = event.data || {};
  if (data.type === "WARM_TILL") {
    event.waitUntil(warmTill());
  } else if (data.type === "CACHE_STATIC" && Array.isArray(data.urls)) {
    const urls = data.urls.filter((u) => {
      try {
        const url = new URL(u, self.location.origin);
        return url.origin === self.location.origin && isStaticAsset(url);
      } catch {
        return false;
      }
    });
    event.waitUntil(cacheStatic(urls));
  } else if (data.type === "FORGET_USER") {
    // Sign-out: the saved till page carries this person's name and shop
    // settings, so it goes. Build files are not personal and stay.
    event.waitUntil(caches.delete(PAGES_CACHE));
  }
});

function offlinePage(tillSaved) {
  const body = tillSaved
    ? '<p>The back office needs the internet, but the till works without it.</p><a href="/pos">Open the till</a>'
    : "<p>This page needs the internet. Check your connection and try again.</p>";
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>You're offline · Coderswurld Inventory</title><style>body{margin:0;min-height:100dvh;display:grid;place-items:center;background:#f5f7fb;color:#141414;font-family:system-ui,-apple-system,"Segoe UI",sans-serif}main{max-width:22rem;padding:2rem;text-align:center}h1{font-size:1.25rem;margin:0 0 .5rem}p{margin:0 0 1.25rem;color:#4a4a4a;line-height:1.5}a,button{display:inline-block;border:0;border-radius:.75rem;background:#dc2626;color:#fff;font:inherit;font-weight:700;padding:.75rem 1.25rem;text-decoration:none;cursor:pointer}button{background:#fff;color:#1d4ed8;border:1px solid #bfd5fe;margin-top:.5rem}</style></head><body><main><h1>You're offline</h1>${body}<br><button onclick="location.reload()">Try again</button></main></body></html>`;
  return new Response(html, {
    status: 503,
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
  });
}

async function handleTillNavigation(request) {
  const pages = await caches.open(PAGES_CACHE);
  try {
    // A slow, half-dead connection is the common case in a shop — worse than
    // none at all, because nothing fails quickly. Give the network five
    // seconds, then open the saved till instead of leaving a cashier staring
    // at a blank tab.
    const response = await Promise.race([
      fetch(request),
      new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), NAVIGATION_TIMEOUT_MS)),
    ]);
    if (isKeepableTillPage(response)) {
      await pages.put(TILL_PATH, response.clone());
    }
    return response;
  } catch {
    const saved = await pages.match(TILL_PATH);
    return saved || offlinePage(false);
  }
}

async function handleOtherNavigation(request) {
  try {
    return await fetch(request);
  } catch {
    const pages = await caches.open(PAGES_CACHE);
    const tillSaved = Boolean(await pages.match(TILL_PATH));
    // The installed app opens at /launch. With no network, go straight to the
    // saved till rather than an offline notice: selling is what matters then.
    if (tillSaved && new URL(request.url).pathname === "/launch") {
      return Response.redirect(new URL(TILL_PATH, self.location.origin).href, 302);
    }
    return offlinePage(tillSaved);
  }
}

async function handleStatic(request) {
  const cache = await caches.open(STATIC_CACHE);
  const hit = await cache.match(request);
  if (hit) return hit;
  const response = await fetch(request);
  if (response.ok) await cache.put(request, response.clone());
  return response;
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/")) return;

  if (isStaticAsset(url)) {
    event.respondWith(handleStatic(request));
    return;
  }

  if (request.mode === "navigate") {
    event.respondWith(
      url.pathname === TILL_PATH ? handleTillNavigation(request) : handleOtherNavigation(request),
    );
  }
  // Everything else (in-app data requests) goes straight to the network.
});
