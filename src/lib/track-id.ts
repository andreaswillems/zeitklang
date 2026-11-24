/**
 * Track-ID aus gescanntem Text extrahieren (Spezifikation §4) — reine Logik,
 * Parity zum Regex in web/app.js trackIdFrom(): nicht verankert, matcht also
 * auch Text um die URL herum (z. B. führende Leerzeichen/Neuelines).
 *
 * Akzeptiert:
 * - https://open.spotify.com/track/<id> (mit und ohne Query-String)
 * - spotify:track:<id>
 * - /play/<id> (künftige Route der PWA, Shortcut §8)
 *
 * Ungültige Eingaben → null.
 */

// 22-stellige Base62-ID (Spotify-Track-IDs), exakt wie in web/app.js.
const TRACK_ID_PATTERN =
  /(?:open\.spotify\.com\/track\/|spotify:track:|\/play\/)([A-Za-z0-9]{22})/;

export function trackIdFrom(text: string): string | null {
  const match = TRACK_ID_PATTERN.exec(text);
  return match ? match[1] : null;
}
