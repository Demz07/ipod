const CACHE_NAME = "ipod-classic-shell-v6";
const SHELL = [
  "./",
  "./index.html",
  "./youtube-library.js",
  "./youtube-stream.js",
  "./playback-queue.js",
  "./web-music.js",
  "./manifest.webmanifest",
  "./Apple-Logo-Png-Download-768x950.png",
  "./icons/icon-32.png",
  "./icons/icon-180.png",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-maskable-512.png",
];

self.addEventListener("install", (event) => {
  // Activate immediately so fresh HTML is never paired with stale cached scripts.
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key.startsWith("ipod-classic-shell-") && key !== CACHE_NAME)
          .map((key) => caches.delete(key)),
      ),
    ).then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET" || new URL(request.url).origin !== self.location.origin) return;

  // Prefer the latest app HTML when online, but allow the app to reopen offline.
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).catch(() => caches.match("./index.html")),
    );
    return;
  }

  // Only serve precached shell files from the cache. Media and APIs are not
  // cached; cross-origin requests (YouTube audio streams) go straight to the network.
  event.respondWith(caches.match(request).then((cached) => cached || fetch(request)));
});
