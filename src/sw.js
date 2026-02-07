const CACHE_NAME = "readers-journey-v7";
const OFFLINE_URL = "./offline.html";
const APP_SHELL = [
  "./",
  "./index.html",
  "./offline.html",
  "./styles.css",
  "./app.mjs",
  "./manifest.webmanifest",
  "./lib/constants.mjs",
  "./lib/catalog-loader.mjs",
  "./lib/tables/rules.mjs",
  "./lib/tables/starter-books.mjs",
  "./lib/reward-engine.mjs",
  "./lib/state.mjs",
  "./data/catalog/index.json",
  "./data/category_profiles.json",
  "./data/reward_policies.json",
  "./data/skill_rules.json",
  "./data/achievement_rules.json",
  "./assets/icon.svg",
  "./assets/icon-maskable.svg",
  "./assets/audio/entry-success.wav",
  "./assets/audio/skill-unlock.wav",
  "./assets/audio/level-up.wav",
  "./assets/icons/logic.svg",
  "./assets/icons/insight.svg",
  "./assets/icons/expression.svg",
  "./assets/icons/strategy.svg",
  "./assets/icons/will.svg",
  "./assets/icons/creativity.svg"
];

async function warmCatalogShards(cache) {
  try {
    const response = await fetch("./data/catalog/index.json");
    if (!response.ok) return;
    const payload = await response.json();
    const shards = Array.isArray(payload.shards) ? payload.shards : [];
    for (const shard of shards) {
      const path = shard && shard.path ? shard.path : "";
      if (!path) continue;
      try {
        const shardResponse = await fetch(path);
        if (shardResponse.ok) {
          await cache.put(path, shardResponse.clone());
        }
      } catch {
        // ignore per-shard failures; runtime caching will retry later
      }
    }
  } catch {
    // ignore warm-up failure
  }
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      await cache.addAll(APP_SHELL);
      await warmCatalogShards(cache);
    })
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
