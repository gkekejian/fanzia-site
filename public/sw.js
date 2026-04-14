// Neutralizing service worker: if any previous site (e.g. old WordPress
// install) registered a service worker at /sw.js on a visitor's device,
// this replacement worker unregisters itself and clears all cached
// responses so the visitor sees the live site on their next load.
self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      try {
        const keys = await caches.keys();
        await Promise.all(keys.map((k) => caches.delete(k)));
        await self.registration.unregister();
        const clients = await self.clients.matchAll({ type: "window" });
        clients.forEach((client) => client.navigate(client.url));
      } catch (_) {
        // no-op
      }
    })(),
  );
});
