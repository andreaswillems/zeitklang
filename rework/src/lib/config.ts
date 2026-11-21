/**
 * Öffentliche Konfiguration der PWA (Spezifikation §3) — Nachfolger von
 * web/config.js. Bewusst committed: Redirect-URIs sind öffentliche Werte.
 * Das Client Secret bleibt ausschließlich serverseitig in .env (nie hier!).
 */

/** Redirect-URI auf GitHub Pages — Site-Root (Spezifikation §11). */
export const PAGES_REDIRECT_URI = "https://andreaswillems.github.io/zeitklang/";

/**
 * Lokaler OAuth-Callback: Port 8080 mit TLS via mkcert (`zeitklang serve` bzw.
 * `vite preview`, Spezifikation §3) — im Spotify-Dashboard registriert.
 */
export const LOCAL_REDIRECT_URI = "https://127.0.0.1:8080/callback";

/**
 * Redirect-URI anhand des Hostnamens wählen (pure Funktion, Plan §5.1 —
 * Nachfolger von redirectUri() aus web/config.js):
 * lokal (`127.0.0.1`/`localhost`) → https-Callback auf Port 8080,
 * sonst (GitHub Pages) → Site-Root.
 */
export function redirectUriForHost(hostname: string): string {
  return hostname === "127.0.0.1" || hostname === "localhost"
    ? LOCAL_REDIRECT_URI
    : PAGES_REDIRECT_URI;
}
