/* ============================================================
   PauseScroll — service worker (sw.js)
   Versioned precache, cache-first for static assets with
   stale-while-revalidate refresh, offline.html navigation
   fallback, and an "Update available, Reload" toast flow.
   ============================================================ */

const VERSION = "1.0.2";
const CACHE = "pausescroll-" + VERSION;

const PRECACHE_URLS = [
  "./",
  "index.html",
  "app.html",
  "offline.html",
  "styles.css",
  "landing.js",
  "app.js",
  "manifest.webmanifest",
  "manifest.json",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "icons/icon-maskable-512.png",
];

const isNavigationRequest = (request) => request.mode === "navigate";

/** Fetches a URL from the network, or the offline page if the network is unavailable. */
function fromNetworkOrOffline(request) {
  return fetch(request).catch(() => caches.match("offline.html"));
}

/** Installs: precaches every app file, atomically. */
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      .catch(() => {
        /* A failed precache is tolerated: the app still works online. */
      })
  );
});

/** Activates: clears old cache versions and takes control. */
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith("pausescroll-") && key !== CACHE)
            .map((key) => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
  );
});

/** Responds cache-first; refreshes caches in the background; serves offline.html for failed navigations. */
self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  if (isNavigationRequest(request)) {
    event.respondWith(
      caches.match(request).then((cached) => {
        if (cached) return cached;
        return fromNetworkOrOffline(request);
      })
    );
    return;
  }

  if (
    request.destination === "image" ||
    request.destination === "style" ||
    request.destination === "script" ||
    request.destination === "font" ||
    request.url.includes(".webmanifest")
  ) {
    event.respondWith(
      caches.match(request).then((cached) => {
        const fresh = fetch(request)
          .then((response) => {
            if (response && response.ok) {
              const copy = response.clone();
              caches.open(CACHE).then((cache) => cache.put(request, copy));
            }
            return response;
          })
          .catch(() => caches.match("offline.html"));
        if (cached) return cached;
        return fresh;
      })
    );
    return;
  }

  /* Anything else: cache, then network with offline fallback. */
  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fromNetworkOrOffline(request);
    })
  );
});

/** Lets the new worker activate from the "Reload" toast. */
self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "PS_SKIP_WAITING") {
    self.skipWaiting();
  }
});