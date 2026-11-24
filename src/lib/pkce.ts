/**
 * PKCE nach RFC 7636 (S256) — reine Logik in lib/ (Plan §5.1): keine
 * DOM/SDK/fetch-Globals. Einzige injizierte Abhängigkeit ist das RNG für
 * randomString (Produkt: crypto.getRandomValues, Test: Stub).
 * crypto.subtle und TextEncoder sind Web-APIs, die Browser und Node ≥ 20
 * global bereitstellen (Plan §12) — daher in pkceChallenge direkt nutzbar.
 * Nachfolger der gleichnamigen Funktionen in web/app.js.
 */

/**
 * Zeichenvorrat nach RFC 7636 §4.1 (unreserved: ALPHA / DIGIT / "-" / "." / "_"
 * / "~") — 66 Zeichen, identisch zu web/app.js (inkl. dessen byte % 66).
 */
const PKCE_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~";

/** Injiziertes RNG: liefert genau `length` zufällige Bytes. */
export type RandomBytes = (length: number) => Uint8Array;

/**
 * Zufälliger String aus unreserved characters (RFC 7636 §4.1) — als
 * code_verifier (64 Zeichen) oder state (16 Zeichen), wie in web/app.js.
 */
export function randomString(length: number, randomBytes: RandomBytes): string {
  const bytes = randomBytes(length);
  return Array.from(bytes, (b) => PKCE_CHARS[b % PKCE_CHARS.length]).join("");
}

/** base64url-Alphabet ohne Padding-Zeichen (RFC 4648 §5). */
const BASE64URL_ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

/**
 * base64url ohne Padding (RFC 7636 §4.2) — rein aus den Bytes gerechnet,
 * ohne btoa (kein DOM-Global in lib/).
 */
export function base64url(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i];
    const b1 = i + 1 < bytes.length ? bytes[i + 1] : 0;
    const b2 = i + 2 < bytes.length ? bytes[i + 2] : 0;
    out += BASE64URL_ALPHABET[b0 >> 2];
    out += BASE64URL_ALPHABET[((b0 & 0x03) << 4) | (b1 >> 4)];
    if (i + 1 < bytes.length) {
      out += BASE64URL_ALPHABET[((b1 & 0x0f) << 2) | (b2 >> 6)];
    }
    if (i + 2 < bytes.length) {
      out += BASE64URL_ALPHABET[b2 & 0x3f];
    }
  }
  return out;
}

/** S256 code_challenge: base64url(SHA-256(verifier)) — RFC 7636 §4.2. */
export async function pkceChallenge(verifier: string): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return base64url(new Uint8Array(hash));
}
