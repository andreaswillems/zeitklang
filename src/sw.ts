/// <reference lib="webworker" />

// Zeitklang-Service Worker (Phase 4, injectManifest) — Parity web/sw.js,
// Spec §7: Precache aller Build-Assets aus self.__WB_MANIFEST (Hashes vom
// Build, das manuelle CACHE_VERSION-Bumpen entfällt). Navigationen
// network-first und NIE gecacht (?code=… aus dem OAuth-Redirect gehört in
// keinen Cache), offline fällt die Shell auf den Precache zurück.
// Sonstige same-origin GETs: cache-first NUR gegen den Precache.
// Spotify-API/SDK und open.spotify.com (cross-origin) laufen immer vorbei
// (Spec §8). Relative Pfade wegen /zeitklang/ (Spec §11).

declare let self: ServiceWorkerGlobalScope;

declare global {
  interface ServiceWorkerGlobalScope {
    // Injektionspunkt — vite-plugin-pwa ersetzt diesen Ausdruck beim Build.
    __WB_MANIFEST: Array<string | { url: string; revision: string | null }>;
  }
}

// Fester Name: Die Precache-Revisionen kommen aus dem Build-Hash; activate
// löscht alle anderen Caches (inkl. der alten zeitklang-vN-Versionen).
const CACHE_NAME = "zeitklang-precache";

const PRECACHE_URLS = self.__WB_MANIFEST.map((entry) =>
  typeof entry === "string" ? entry : entry.url,
);

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      // Parity web/sw.js (#17): still aktivieren, kein Update-Dialog.
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  // Nur same-origin GET behandeln — API-Calls und das SDK-Script laufen
  // immer am Service Worker vorbei (Spec §8, Parity web/sw.js).
  if (request.method !== "GET" || !request.url.startsWith(self.location.origin)) {
    return;
  }
  if (request.mode === "navigate") {
    // Navigationen: network-first, offline zurück auf die precachte Shell.
    // Bewusst NICHT in den Cache nachziehen: Die Navigation kann ?code=…
    // aus dem OAuth-Redirect tragen, der niemals gecacht gehört.
    event.respondWith(
      fetch(request).catch(() =>
        caches
          .match(request)
          .then((cached) => cached || caches.match("./index.html"))
          .then((shell) => shell || Response.error()),
      ),
    );
    return;
  }
  // Statische Assets: cache-first strikt gegen den Precache; was nicht
  // precacht wurde, läuft normal übers Netz (kein dynamisches Caching).
  event.respondWith(caches.match(request).then((cached) => cached || fetch(request)));
});

export {};
