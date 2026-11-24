/**
 * Token-Endpunkt (Spec §3.3/§3.5) — reine Logik in lib/ (Plan §5.1): keine
 * DOM/fetch-Globals, alle Abhängigkeiten werden injiziert (TokenDeps).
 * Nachfolger von requestToken/getValidToken in web/app.js — Storage-Keys und
 * der 30-s-Puffer vor Ablauf sind Parity zu web/app.js (KEYS).
 */

import { fetchWithTimeout } from "./http.ts";
import type { Storage } from "./storage.ts";

/** Storage-Keys — Parity zu web/app.js KEYS (scopes additiv, BSF4QZM). */
export const KEYS = {
  access: "zeitklang_access",
  expiresAt: "zeitklang_expires_at",
  refresh: "zeitklang_refresh",
  /** Roher scope-String aus der Token-Antwort (BSF4QZM-1). */
  scopes: "zeitklang_scopes",
} as const;

/**
 * Timeout für den Token-Endpunkt (Security-Audit A10:2025, Finding F6) —
 * ein hängender Token-Fetch darf die App nicht ewig im „Anmeldung läuft…“
 * hängen lassen (lib/http.ts fetchWithTimeout).
 */
export const TOKEN_TIMEOUT_MS = 10_000;

/**
 * Injizierte Abhängigkeiten (Plan §5.1): fetch, beide Storages, Uhr,
 * Token-Endpoint und Client-ID. Im Produktivcode hängen sessionStorage /
 * localStorage (via webStorage) und Date.now daran, in Tests InMemoryStorage
 * + gemocktes fetch + manuelle Uhr.
 */
export interface TokenDeps {
  fetch: typeof fetch;
  /** Access-Token + expires_at (flüchtig) — sessionStorage im Produktivcode. */
  session: Storage;
  /**
   * Refresh-Token (dauerhaft) — als FUNKTION, damit ein Laufzeit-Wechsel der
   * Speicher-Einstellung sofort greift: requestToken/getValidToken werten
   * refresh() bei jedem Zugriff neu aus. Im Produktivcode bis Subtask 2
   * `refresh: () => deps.local` (localStorage).
   */
  refresh: () => Storage;
  /** Uhr in ms seit Epoch — Date.now im Produktivcode, manuell im Test. */
  now: () => number;
  tokenUrl: string;
  clientId: string;
}

/** Fehler vom Token-Endpunkt trägt den HTTP-Status (Parity web/app.js err.status). */
export type TokenError = Error & { status: number };

/** Antwort des Token-Endpunkts — nur die genutzten Felder. */
interface TokenResponse {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  /** Roher scope-String (Leerzeichen-getrennt) — fehlt bei opaken Tokens ggf. (BSF4QZM). */
  scope?: string;
}

/**
 * Tauscht `body` (z. B. grant_type=authorization_code mit code_verifier oder
 * grant_type=refresh_token) gegen Tokens. POST als
 * application/x-www-form-urlencoded (Parity web/app.js requestToken).
 *
 * ok → access_token + expires_at (now + (expires_in - 30) * 1000, 30 s Puffer
 * damit ein Token kurz vor Ablauf nicht mehr verwendet wird) im
 * Session-Storage; refresh_token nur falls vorhanden im Refresh-Storage
 * (deps.refresh()); scope (BSF4QZM-1) als roher String im Session-Storage —
 * fehlt scope in der Antwort, wird ein alter Wert per removeItem entfernt
 * (kein Stale-Wert aus früherer Session).
 * !ok → wirft Error mit .status, es wird nichts gespeichert.
 * Timeout (TOKEN_TIMEOUT_MS, A10 F6) → wirft TimeoutError (name ===
 * "TimeoutError", KEIN .status), es wird nichts gespeichert.
 */
export async function requestToken(
  body: Record<string, string>,
  deps: TokenDeps,
): Promise<void> {
  const response = await fetchWithTimeout(
    deps.fetch,
    deps.tokenUrl,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(body).toString(),
    },
    TOKEN_TIMEOUT_MS,
  );
  if (!response.ok) {
    const err = new Error(
      `Token-Endpunkt antwortete mit ${response.status}`,
    ) as TokenError;
    err.status = response.status;
    throw err;
  }
  const tokens = (await response.json()) as TokenResponse;
  deps.session.setItem(KEYS.access, tokens.access_token);
  // 30 s Puffer vor Ablauf (Parity web/app.js)
  deps.session.setItem(
    KEYS.expiresAt,
    String(deps.now() + (tokens.expires_in - 30) * 1000),
  );
  // BSF4QZM-1: gewährte Scopes persistieren — Exchange UND Refresh laufen
  // beide über requestToken. Fehlt scope in der Antwort, wird ein vorhandener
  // alter Wert entfernt (removeItem), damit kein Stale-Wert aus einer früheren
  // Session überlebt.
  if (typeof tokens.scope === "string") {
    deps.session.setItem(KEYS.scopes, tokens.scope);
  } else {
    deps.session.removeItem(KEYS.scopes);
  }
  if (tokens.refresh_token) {
    deps.refresh().setItem(KEYS.refresh, tokens.refresh_token);
  }
}

/**
 * Spec §3.5: gültiges Access-Token (now < expires_at, Boundary now ===
 * expires_at gilt als abgelaufen) → Rückgabe ohne fetch; abgelaufen +
 * Refresh-Token → Refresh-Grant, danach neues Access-Token aus dem
 * Session-Storage; HTTP 400 beim Refresh → Refresh-Token verwerfen und
 * Fehler durchreichen; ohne Refresh-Token → null (Login-Button zeigen).
 * Timeout beim Refresh (A10 F6) → TimeoutError ohne .status wird
 * durchgereicht, der Refresh-Token bleibt erhalten.
 */
export async function getValidToken(deps: TokenDeps): Promise<string | null> {
  const access = deps.session.getItem(KEYS.access);
  if (access && deps.now() < Number(deps.session.getItem(KEYS.expiresAt))) {
    return access;
  }
  const refresh = deps.refresh().getItem(KEYS.refresh);
  if (!refresh) return null;
  try {
    await requestToken(
      {
        grant_type: "refresh_token",
        refresh_token: refresh,
        client_id: deps.clientId,
      },
      deps,
    );
  } catch (err) {
    // Ungültiger Refresh-Token (400) verwerfen — sonst retryt jeder Start
    // bis in alle Ewigkeit (Spec §3.5; Spotify-Doku: discard + neu
    // autorisieren; Parity web/app.js).
    if ((err as TokenError).status === 400) {
      deps.refresh().removeItem(KEYS.refresh);
    }
    throw err;
  }
  return deps.session.getItem(KEYS.access);
}

/**
 * Verschiebt den Refresh-Token (KEYS.refresh) von `from` nach `to` und löscht
 * ihn in `from`; no-op, wenn in `from` keiner liegt. Reine Funktion für den
 * Wechsel der Speicher-Einstellung (Subtask 2: beim Wechsel
 * localStorage ↔ sessionStorage wird der Token aus dem alten Storage geräumt,
 * statt dort zu verbleiben). Fasst ausschließlich KEYS.refresh an.
 */
export function moveRefreshToken(from: Storage, to: Storage): void {
  const token = from.getItem(KEYS.refresh);
  if (token === null) return;
  to.setItem(KEYS.refresh, token);
  from.removeItem(KEYS.refresh);
}
