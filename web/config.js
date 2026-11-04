// Öffentliche Konfiguration der PWA — docs/pwa-spezifikation.md §3.
// Bewusst committed: Client-ID und Redirect-URIs sind öffentliche Werte.
// Das Client Secret bleibt ausschließlich serverseitig in .env (nie hier!).
const SPOTIFY_CLIENT_ID = "0bd9132274784897b4653e94e559b01a";
const AUTH_SCOPES =
    "streaming user-read-playback-state user-modify-playback-state user-read-private";

// Eintragen, sobald die PWA auf GitHub Pages liegt (Spezifikation §11).
const PAGES_REDIRECT_URI = "https://<user>.github.io/zeitklang/";

function redirectUri() {
    // Lokal via `zeitklang serve` (TLS durch mkcert): https-Callback auf 127.0.0.1,
    // muss einmalig im Spotify-Dashboard registriert sein. Auf Pages: Root-URL —
    // Pages liefert dort index.html aus, app.js fängt ?code=… ein (§3.3).
    return ["127.0.0.1", "localhost"].includes(location.hostname)
        ? "https://127.0.0.1:8080/callback"
        : PAGES_REDIRECT_URI;
}
