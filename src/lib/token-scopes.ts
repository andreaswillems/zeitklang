/**
 * Scope-Quellen-Auflösung für Spotify-Access-Tokens (Tickets 71TAZ1B-1,
 * BSF4QZM) — reine Logik in lib/ (Plan §5.1): keine DOM/SDK/fetch-Globals.
 *
 * BSF4QZM: Spotify liefert aktuell OPAKE Access-Tokens (keine JWTs mehr,
 * „BQB…“, 1 Segment — Live-Diagnose Prod 2026-11-23). Die gewährten Scopes
 * kommen daher PRIMÄR aus dem „scope“-Feld der Token-Antwort, das requestToken
 * persistiert (tokens.ts KEYS.scopes); der JWT-„scp“-Dekoder unten ist nur
 * noch FALLBACK für Alt-Sessions. „Nicht als JWT dekodierbar“ (opak/malformed)
 * ist KEINE Aussage über fehlende Scopes → null (unbekannt), nie [] als
 * Fehlend-Meldung (das war der False-Positive-Login-Loop aus BSF4QZM).
 *
 * 71TAZ1B-1 (historisch): das „scp“-Feld im JWT-Payload listet die gewährten
 * Scopes (Leerzeichen-getrennt) — Diagnose-Hilfe für 403 UNKNOWN nach
 * Scan+Play (Spec §5.6; Verdacht: erteilte Scopes sind eine Teilmenge der
 * angeforderten, z. B. fehlendes user-modify-playback-state beim PUT play).
 *
 * BSF4QZM-2: Alle Aufrufer (state/auth.ts, state/player.ts) lösen über
 * resolveGrantedScopes auf — die Alt-Funktionen scopesFromAccessToken /
 * missingScopes (JWT-only, [] bei opak = False Positive) hatten danach keine
 * Aufrufer mehr und wurden entfernt.
 *
 * KEINE Signaturprüfung: Der Token stammt vom eigenen Token-Endpunkt
 * (accounts.spotify.com) — dekodiert wird nur zur Diagnose. Bei malformed
 * Input (kein JWT, kaputtes base64url/JSON-Payload, kein scp-Feld) → null
 * (nicht dekodierbar) bzw. [] (dekodierbar, aber keine Scopes) — die
 * Funktionen werfen nie.
 */

// base64url-Alphabet (RFC 4648 §5) — Gegenstück zum Encoder in pkce.ts
const BASE64URL_ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

/**
 * base64url → Bytes, rein aus dem Alphabet gerechnet (kein atob — kein
 * DOM-Global in lib/, Stil-Referenz pkce.ts). Trailing Padding („=“) wird
 * toleriert; ungültige Zeichen oder eine ungültige Restlänge (len % 4 === 1,
 * Sextett ohne Byte) → null.
 */
function base64urlToBytes(segment: string): Uint8Array | null {
  const clean = segment.replace(/=+$/, "");
  const out = new Uint8Array(Math.floor((clean.length * 6) / 8));
  let acc = 0;
  let bits = 0;
  let pos = 0;
  for (let i = 0; i < clean.length; i++) {
    const value = BASE64URL_ALPHABET.indexOf(clean[i]);
    if (value === -1) return null;
    acc = (acc << 6) | value;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[pos++] = (acc >> bits) & 0xff;
      acc &= (1 << bits) - 1; // verbrauchte Bits verwerfen
    }
  }
  if (bits >= 6) return null;
  return out;
}

// ---------------------------------------------------------------------------
// BSF4QZM-1: Scope-Quellen-Auflösung — scope-Feld der Token-Antwort primär,
// JWT-Dekoder nur Fallback. BSF4QZM-2: Aufrufer-Rewiring auf diese Funktionen
// (state/auth.ts, state/player.ts); die früheren scopesFromAccessToken /
// missingScopes (JWT-only) wurden entfernt — kein Aufrufer mehr.
// ---------------------------------------------------------------------------

/**
 * Dekodiert das Payload-Segment eines JWT — null, wenn der Token NICHT als
 * JWT dekodierbar ist (opak/malformed: nicht genau 3 Segmente, kaputtes
 * base64url, kaputtes JSON, Payload kein Objekt). Liefert nur das Payload-
 * Objekt, niemals Werte nach außen. Nie werfen.
 */
function decodeJwtPayload(token: string): Record<string, unknown> | null {
  if (typeof token !== "string") return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const bytes = base64urlToBytes(parts[1]);
  if (bytes === null) return null;
  let payload: unknown;
  try {
    payload = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return null;
  }
  if (typeof payload !== "object" || payload === null) return null;
  return payload as Record<string, unknown>;
}

/**
 * BSF4QZM-1: Scopes aus dem Access-Token dekodieren — null, wenn der Token
 * NICHT als JWT dekodierbar ist (opak z. B. „BQB…“/malformed) = KEINE
 * Aussage möglich; dekodierbar → scp-Liste (scp fehlt/nicht String → [],
 * d. h. dekodierbar aber keine Scopes). Nie werfen, keine Signaturprüfung.
 */
export function tryScopesFromAccessToken(token: string): string[] | null {
  const payload = decodeJwtPayload(token);
  if (payload === null) return null;
  const scp = payload.scp;
  if (typeof scp !== "string") return [];
  return scp.split(" ").filter((scope) => scope.length > 0);
}

/**
 * BSF4QZM-1: Scopes aus dem persistierten rohen scope-Feld der Token-Antwort
 * (tokens.ts KEYS.scopes) — null/unset → null (unbekannt); sonst an
 * Leerzeichen gesplittet (leere Einträge gefiltert). Leer/Whitespace-only
 * ist ebenfalls null (unbekannt): ein leeres granted ([] statt null) würde
 * den JWT-Fallback in resolveGrantedScopes blockieren und über
 * missingScopesFromGranted ALLE required Scopes als fehlend melden
 * (QE-Runde 1 — der False-Positive-Modus, den BSF4QZM beseitigt).
 */
export function scopesFromScopeField(scope: string | null): string[] | null {
  if (typeof scope !== "string") return null;
  const scopes = scope.split(" ").filter((entry) => entry.length > 0);
  return scopes.length > 0 ? scopes : null;
}

/**
 * BSF4QZM-1: Gewährte Scopes auflösen — PRIMÄR das persistierte scope-Feld,
 * Fallback der JWT-Dekoder (Alt-Sessions ohne persistiertes scope-Feld).
 * null = unbekannt (keine Aussage, z. B. opaker Token ohne scope-Feld) —
 * unbekannt ist NICHT „alle fehlen“.
 */
export function resolveGrantedScopes(
  scope: string | null,
  token: string,
): string[] | null {
  const fromField = scopesFromScopeField(scope);
  if (fromField !== null) return fromField;
  return tryScopesFromAccessToken(token);
}

/**
 * BSF4QZM-1: Differenz required \ granted (Reihenfolge aus `required`) —
 * granted null (unbekannt) → [] (unbekannt ist NICHT fehlend!); sonst die
 * Scopes aus `required`, die in `granted` fehlen.
 */
export function missingScopesFromGranted(
  granted: string[] | null,
  required: string[],
): string[] {
  if (granted === null) return [];
  const grantedSet = new Set(granted);
  return required.filter((scope) => !grantedSet.has(scope));
}

/**
 * BSF4QZM-1: Sichere Konsole-Diagnose der Token-Form — NIEMALS Token-String
 * oder Payload-Werte (#10 + check:secrets), nur Segment-Anzahl und die
 * sortierten Key-NAMEN des Payloads. Opak/malformed → payloadKeys: [].
 * Nicht-String-Input → null. Nie werfen.
 */
export function tokenShape(
  token: string,
): { segments: number; payloadKeys: string[] } | null {
  if (typeof token !== "string") return null;
  const payload = decodeJwtPayload(token);
  return {
    segments: token.split(".").length,
    payloadKeys: payload === null ? [] : Object.keys(payload).sort(),
  };
}
