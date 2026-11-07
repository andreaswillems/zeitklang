// Zeitklang-Service Worker — Issue #17: App-Shell offline verfügbar machen
// und die Android-Installation zuverlässig machen (#18). Spec §7:
// Cache-first NUR für die precachten Dateien; Navigationen bevorzugt
// Netz (frischester Stand), offline fällt die Shell auf den Cache
// zurück (Flugmodus-Test). Spotify-API, das SDK-Script (sdk.scdn.co) und
// open.spotify.com werden nie gecacht — Wiedergabe braucht immer Netz
// (§8). Relative Pfade wegen /zeitklang/ (Spec §11).
//
// WICHTIG bei jeder Änderung an web/-Dateien: CACHE_VERSION bumpen —
// sonst bleibt der alte Stand im Cache hängen (Cleanup in activate
// entsorgt die alten Versionen).

const CACHE_VERSION = "v3"; // README-Aktualisierung: web/-Änderungen → Version bumped (#17-Regel)
const CACHE_NAME = "zeitklang-" + CACHE_VERSION;

const SHELL_URLS = [
    "./",
    "./index.html",
    "./style.css",
    "./app.js",
    "./config.js",
    "./manifest.webmanifest",
    "./icon.png",
    "./icons/icon-192.png",
    "./icons/icon-512.png",
    "./icons/icon-maskable-512.png",
    "./vendor/html5-qrcode.min.js",
];

self.addEventListener("install", (event) => {
    event.waitUntil(
        caches
            .open(CACHE_NAME)
            .then((cache) => cache.addAll(SHELL_URLS))
            // Andreas-Entscheidung zu #17: still aktivieren — die neue
            // Version greift ab dem nächsten App-Öffnen, kein Update-
            // Dialog.
            .then(() => self.skipWaiting()),
    );
});

self.addEventListener("activate", (event) => {
    // Cleanup: alle Caches anderer Versionen löschen — ein Versions-
    // Bump invalidiert den Precache damit atomar (Akzeptanzkriterium
    // „kein alter Cache“).
    event.waitUntil(
        caches
            .keys()
            .then((keys) =>
                Promise.all(
                    keys
                        .filter((k) => k !== CACHE_NAME)
                        .map((k) => caches.delete(k)),
                ),
            )
            .then(() => self.clients.claim()),
    );
});

self.addEventListener("fetch", (event) => {
    const { request } = event;
    // Nur same-origin GET behandeln — API-Calls (accounts/api.spotify.com,
    // open.spotify.com) und das SDK-Script (sdk.scdn.co, cross-origin)
    // laufen immer am Service Worker vorbei (Spec §8).
    if (request.method !== "GET" || !request.url.startsWith(self.location.origin)) {
        return;
    }
    if (request.mode === "navigate") {
        // Navigationen: network-first — online gibt es den frischesten
        // Stand, offline (Flugmodus) fällt die App auf die gecachte Shell
        // zurück. Bewusst NICHT in den Cache nachziehen: Die Navigation
        // kann ?code=… aus dem OAuth-Redirect tragen, der niemals
        // gecacht gehört.
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
    // Statische Shell-Assets: cache-first (Spec §7); was nicht precacht
    // wurde, läuft normal übers Netz.
    event.respondWith(
        caches.match(request).then((cached) => cached || fetch(request)),
    );
});
