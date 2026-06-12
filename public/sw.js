// MES Shop Floor — service worker (Phase 3)
// Strategija:
//   - HTML navigacije: NetworkFirst (uvek probaj mrežu pa fallback na keš)
//   - Statika (/assets/, ikone, manifest): StaleWhileRevalidate
//   - API pozivi (/api/, *.functions, Supabase): NIKAD ne keširamo (offline outbox to radi)

const params = new URL(self.location).searchParams;
const VERSION = `mes-sw-${params.get("v") || "dev"}`;
const STATIC_CACHE = `${VERSION}-static`;
const HTML_CACHE = `${VERSION}-html`;

const PRECACHE_URLS = [
  "/",
  "/icon-192.png",
  "/icon-512.png",
  "/favicon.ico",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(STATIC_CACHE);
      await cache.addAll(PRECACHE_URLS).catch(() => {});
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names
          .filter((n) => !n.startsWith(VERSION))
          .map((n) => caches.delete(n)),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("message", (event) => {
  if (event.data === "SKIP_WAITING") self.skipWaiting();
});

function isHtmlNavigation(request) {
  return (
    request.mode === "navigate" ||
    (request.method === "GET" &&
      request.headers.get("accept")?.includes("text/html"))
  );
}

function isStaticAsset(url) {
  return (
    url.pathname.startsWith("/assets/") ||
    url.pathname.startsWith("/_build/") ||
    /\.(?:js|css|woff2?|ttf|png|jpg|jpeg|svg|webp|ico)$/.test(url.pathname)
  );
}

function isApiCall(url) {
  return (
    url.pathname.startsWith("/api/") ||
    url.pathname.startsWith("/_serverFn/") ||
    url.hostname.endsWith(".supabase.co") ||
    url.hostname.endsWith(".airtable.com")
  );
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin && !isStaticAsset(url)) return;
  if (isApiCall(url)) return;

  if (isHtmlNavigation(request)) {
    event.respondWith(
      (async () => {
        // NetworkFirst sa TIMEOUT-om: na lošem Wi-Fi-ju ne visi do browser
        // timeouta — posle NAV_TIMEOUT_MS pada na keširani HTML. Ako keša
        // nema (prva poseta), ipak sačeka originalni mrežni odgovor.
        const NAV_TIMEOUT_MS = 4000;
        const networkPromise = fetch(request);
        const cache = await caches.open(HTML_CACHE);
        try {
          const fresh = await Promise.race([
            networkPromise,
            new Promise((_, reject) =>
              setTimeout(() => reject(new Error("nav-timeout")), NAV_TIMEOUT_MS),
            ),
          ]);
          cache.put(request, fresh.clone()).catch(() => {});
          return fresh;
        } catch {
          const cached = await cache.match(request);
          if (cached) return cached;
          const fallback = await caches.match("/");
          if (fallback) return fallback;
          // Nema keša: bolje sporo nego ništa — sačekaj mrežu do kraja.
          try {
            const fresh = await networkPromise;
            cache.put(request, fresh.clone()).catch(() => {});
            return fresh;
          } catch {
            return new Response("Offline", { status: 503 });
          }
        }
      })(),
    );
    return;
  }

  if (isStaticAsset(url)) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(STATIC_CACHE);
        const cached = await cache.match(request);
        const networkPromise = fetch(request)
          .then((res) => {
            if (res.ok) cache.put(request, res.clone()).catch(() => {});
            return res;
          })
          .catch(() => cached);
        return cached || networkPromise;
      })(),
    );
  }
});
