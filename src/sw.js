const CACHE_NAME = "readers-journey-v2";
const OFFLINE_URL = "./offline.html";
const APP_SHELL = [
  "./",
  "./index.html",
  "./offline.html",
  "./styles.css",
  "./app.mjs",
  "./manifest.webmanifest",
  "./lib/constants.mjs",
  "./lib/reward-engine.mjs",
  "./lib/state.mjs",
  "./assets/icon.svg",
  "./assets/icon-maskable.svg"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
          return Promise.resolve();
        })
      )
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") {
    return;
  }

  const isNavigate = event.request.mode === "navigate";
  const requestUrl = new URL(event.request.url);
  const isSameOrigin = requestUrl.origin === self.location.origin;

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (isSameOrigin && response && response.status === 200 && response.type !== "opaque") {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, clone).catch(() => {});
          });
        }
        return response;
      })
      .catch(async () => {
        const cached = await caches.match(event.request);
        if (cached) {
          return cached;
        }
        if (isNavigate) {
          return (await caches.match(OFFLINE_URL)) || (await caches.match("./index.html"));
        }
        return new Response("Offline", {
          status: 503,
          statusText: "Offline",
          headers: { "content-type": "text/plain; charset=utf-8" }
        });
      })
  );
});
