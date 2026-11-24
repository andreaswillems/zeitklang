import { signal } from "@preact/signals";
import { AUTH_SCOPES, redirectUriForHost, SPOTIFY_CLIENT_ID } from "../lib/config.ts";
import { LOGIN_GENERIC_MSG, LOGOUT_HINT_MSG, MISSING_SCOPE_MSG } from "../lib/errors.ts";
import { pkceChallenge, randomString } from "../lib/pkce.ts";
import { handleRedirect, KEYS as REDIRECT_KEYS } from "../lib/redirect.ts";
import { type Storage, webStorage } from "../lib/storage.ts";
import {
  missingScopesFromGranted,
  resolveGrantedScopes,
  tokenShape,
} from "../lib/token-scopes.ts";
import {
  getValidToken,
  moveRefreshToken,
  requestToken,
  KEYS as TOKEN_KEYS,
  type TokenDeps,
} from "../lib/tokens.ts";

const AUTHORIZE_URL = "https://accounts.spotify.com/authorize";
const TOKEN_URL = "https://accounts.spotify.com/api/token";

/**
 * 71TAZ1B-3: sessionStorage-Guard für den proaktiven Scope-Check in
 * initAuth — rein defensiv: Im aktuellen Pfad gibt es bei fehlenden Scopes
 * KEINEN automatischen Redirect (der Nutzer meldet sich selbst über den
 * Login-Button neu an, forceConsent-Flag → show_dialog=true). Der Guard
 * stellt aber sicher, dass initAuth auch bei erneutem Aufruf (z. B. bfcache-
 * Rückkehr) oder in künftigen Auto-Re-Consent-Pfaden nicht erneut
 * redirectet — Endlosschleifen-Schutz. sessionStorage überlebt Reload im
 * selben Tab.
 */
export const SCOPE_CHECK_GUARD_KEY = "zeitklang_scope_check_guard";

type AuthStatus = "loading" | "ready" | "logged-out";

export const authStatus = signal<AuthStatus>("loading");
export const authError = signal<string | null>(null);
export const redirecting = signal(false);
/**
 * Logout-Hinweis (SA8H08W-1): gesetzt von logout() auf LOGOUT_HINT_MSG —
 * lokaler Logout löscht nur die Tokens dieses Geräts; ein Widerruf der
 * App-Verbindung ist nur manuell unter spotify.com/account/apps möglich
 * (Spotify hat keinen Revoke-API-Endpunkt). login()/erfolgreiches initAuth
 * löschen den Hinweis wieder.
 */
export const logoutHint = signal<string | null>(null);

/**
 * "Angemeldet bleiben"-Einstellung (YWEC4VR-2): Der Key liegt in
 * localStorage (die Einstellung selbst ist kein Geheimnis), Werte "1"/"0".
 * Default 1 = angemeldet bleiben → Refresh-Token liegt in localStorage.
 */
export const PERSIST_LOGIN_KEY = "zeitklang_persist_login";

/** true = Refresh-Token dauerhaft in localStorage, false = nur sessionStorage. */
export const persistLogin = signal(true);

/**
 * Liest den Key aus localStorage ins Signal — main.tsx ruft das VOR
 * initAuth(), damit refreshStorage() beim ersten Token-Check stimmt.
 * Fehlender Key → Default true ("angemeldet bleiben").
 */
export function initPersistLogin(): void {
  persistLogin.value = deps.local.getItem(PERSIST_LOGIN_KEY) !== "0";
}

/**
 * Schreibt den Key UND migriert den Refresh-Token per moveRefreshToken
 * (lib/tokens.ts): Beim Wechsel auf session-only darf der Token nicht in
 * localStorage liegen bleiben (und umgekehrt).
 */
export function setPersistLogin(value: boolean): void {
  deps.local.setItem(PERSIST_LOGIN_KEY, value ? "1" : "0");
  if (value) {
    moveRefreshToken(deps.session, deps.local);
  } else {
    moveRefreshToken(deps.local, deps.session);
  }
  persistLogin.value = value;
}

/**
 * Aktiver Refresh-Token-Speicher — tokenDeps in initAuth() und in
 * state/player.ts hängen `refresh: () => refreshStorage()`, damit ein
 * Laufzeit-Wechsel der Einstellung sofort greift.
 */
export function refreshStorage(): Storage {
  return persistLogin.value ? deps.local : deps.session;
}

interface AuthDeps {
  session: Storage;
  local: Storage;
  randomString: (length: number) => string;
  pkceChallenge: (verifier: string) => Promise<string>;
  fetch: typeof fetch;
  now: () => number;
  redirectUri: () => string;
  currentPath: () => string;
  replaceState: (path: string) => void;
  navigate: (url: string) => void;
}

function browserDeps(): AuthDeps {
  return {
    session: webStorage(sessionStorage),
    local: webStorage(localStorage),
    randomString: (length) =>
      randomString(length, (byteLength) =>
        crypto.getRandomValues(new Uint8Array(byteLength)),
      ),
    pkceChallenge,
    fetch: (input, init) => fetch(input, init),
    now: () => Date.now(),
    redirectUri: () => redirectUriForHost(location.hostname),
    currentPath: () => location.pathname + location.search,
    replaceState: (path) => {
      history.replaceState(null, "", path);
    },
    navigate: (url) => {
      location.href = url;
    },
  };
}

let deps = browserDeps();

/** Startet den Authorization-Code-+PKCE-Flow (Parity zu web/app.js login). */
export async function login(forceConsent = false): Promise<void> {
  // #58: Das Flag vor dem await setzen, damit auch Doppeltaps im PKCE-Fenster
  // keine zweite Weiterleitung auslösen.
  if (redirecting.value) return;
  redirecting.value = true;
  // SA8H08W-1: neuer Login-Versuch — Logout-Hinweis ausblenden.
  logoutHint.value = null;

  const verifier = deps.randomString(64);
  const state = deps.randomString(16);
  deps.session.setItem(REDIRECT_KEYS.verifier, verifier);
  deps.session.setItem(REDIRECT_KEYS.state, state);

  const params = new URLSearchParams({
    client_id: SPOTIFY_CLIENT_ID,
    response_type: "code",
    redirect_uri: deps.redirectUri(),
    scope: AUTH_SCOPES,
    code_challenge_method: "S256",
    code_challenge: await deps.pkceChallenge(verifier),
    state,
  });
  if (forceConsent || deps.local.getItem(REDIRECT_KEYS.forceConsent) === "1") {
    params.set("show_dialog", "true");
  }
  deps.navigate(`${AUTHORIZE_URL}?${params}`);
}

/** Initialisiert den Auth-Status aus Redirect und vorhandenen Tokens. */
export async function initAuth(): Promise<void> {
  const tokenDeps: TokenDeps = {
    fetch: deps.fetch,
    session: deps.session,
    // Aktiver Speicher je nach persistLogin — als Funktion, damit ein
    // Laufzeit-Wechsel der Einstellung sofort greift (YWEC4VR-2).
    refresh: () => refreshStorage(),
    now: deps.now,
    tokenUrl: TOKEN_URL,
    clientId: SPOTIFY_CLIENT_ID,
  };

  try {
    await handleRedirect(deps.currentPath(), {
      session: deps.session,
      local: deps.local,
      requestToken: (body) => requestToken(body, tokenDeps),
      replaceState: deps.replaceState,
      redirectUri: deps.redirectUri(),
      clientId: SPOTIFY_CLIENT_ID,
    });
    const token = await getValidToken(tokenDeps);
    if (token !== null) {
      // SA8H08W-1: Anmeldung (Token vorhanden) — Logout-Hinweis ausblenden.
      logoutHint.value = null;
      // 71TAZ1B-3 + BSF4QZM-2: proaktiver Scope-Check nach dem Login. Die
      // gewährten Scopes kommen PRIMÄR aus dem persistierten scope-Feld der
      // letzten Token-Antwort (KEYS.scopes — Exchange UND Refresh
      // persistieren es, lib/tokens.ts), JWT-Dekoder nur Fallback
      // (Alt-Sessions ohne Feld). Korrektur zum 71TAZ1B-3-Kommentar
      // („ein Refresh ändert die gewährten Scopes nicht“, BSF4QZM): Ein
      // Refresh kann die Scopes zwar nicht erweitern, aber das scope-Feld
      // spiegelt stets die LETZTE Token-Antwort — nach einem Refresh wird
      // es neu persistiert (bzw. geräumt, wenn die Antwort keins enthält);
      // der Check liest also die aktuellste Quelle. Fehlen bekannte
      // erforderliche Scopes (Consent-Dialog nicht mit allen Berechtigungen
      // bestätigt), landet der Nutzer mit MISSING_SCOPE_MSG auf der Login-
      // Seite und meldet sich selbst neu an (forceConsent-Flag →
      // show_dialog beim nächsten Login); es gibt KEINEN automatischen
      // Re-Consent-Redirect in diesem Pfad. Der sessionStorage-Guard
      // (SCOPE_CHECK_GUARD_KEY) ist defensiv: Er hält initAuth bei erneutem
      // Aufruf (z. B. bfcache) oder künftigen Auto-Re-Consent-Pfaden von
      // einem erneuten Redirect ab.
      const granted = resolveGrantedScopes(
        deps.session.getItem(TOKEN_KEYS.scopes),
        token,
      );
      const missing = missingScopesFromGranted(granted, AUTH_SCOPES.split(" "));
      if (granted === null) {
        // BSF4QZM-2: unbekannt (opaker Token ohne persistierte Scopes, z. B.
        // Alt-Session von vor diesem Fix) ist KEINE Aussage über fehlende
        // Scopes → kein False Positive (das war der Prod-Login-Loop).
        // Konsole: tokenShape-basierter Hinweis, NIEMALS Token-Werte
        // (#10 + check:secrets).
        console.error(
          "Gewährte Scopes unbekannt (Quelle: unbekannt) — Token-Form:",
          tokenShape(token),
        );
        authStatus.value = "ready";
      } else if (missing.length > 0) {
        if (deps.session.getItem(SCOPE_CHECK_GUARD_KEY) !== "1") {
          deps.session.setItem(SCOPE_CHECK_GUARD_KEY, "1");
          deps.local.setItem(REDIRECT_KEYS.forceConsent, "1");
          // #10: Fachdetails (fehlende Scopes) nur in die Konsole.
          console.error("Anmeldung ohne alle erforderlichen Scopes — fehlt:", missing);
        }
        authError.value = MISSING_SCOPE_MSG;
        authStatus.value = "logged-out";
      } else {
        authStatus.value = "ready";
      }
    } else {
      authStatus.value = "logged-out";
    }
  } catch (err) {
    // #10/#58: Technische Details nur in der Konsole, gezielter Text in der UI.
    console.error("Login fehlgeschlagen:", err);
    authError.value = (err as { userMsg?: string }).userMsg ?? LOGIN_GENERIC_MSG;
    authStatus.value = "logged-out";
  }
}

/**
 * Verwirft die lokalen Tokens und erzwingt Consent beim nächsten Login.
 * SA8H08W-1: Spotify hat keinen Revoke-API-Endpunkt — der Logout ist nur
 * lokal wirksam; logoutHint weist auf den manuellen Widerruf unter
 * spotify.com/account/apps hin (LOGOUT_HINT_MSG, UI-Block #logout-hint).
 */
export function logout(): void {
  deps.session.removeItem(TOKEN_KEYS.access);
  deps.session.removeItem(TOKEN_KEYS.expiresAt);
  // BSF4QZM-2: persistierte Scopes miträumen — Stale-Scopes dürfen keine
  // Session überdauern (sonst würde der nächste Login mit Alt-Scopes prüfen).
  deps.session.removeItem(TOKEN_KEYS.scopes);
  // Refresh-Token aus dem AKTIVEN Speicher löschen (YWEC4VR-2) — bei
  // persistLogin=false liegt er in der Session, nicht in local.
  refreshStorage().removeItem(TOKEN_KEYS.refresh);
  deps.local.setItem(REDIRECT_KEYS.forceConsent, "1");
  authStatus.value = "logged-out";
  authError.value = null;
  logoutHint.value = LOGOUT_HINT_MSG;
  // Bewusste Naht: player.disconnect/stopScan/closeSheet laufen nicht hier,
  // sondern reagieren in Phase 2d/2e/2f auf authStatus.
}

/** #58: Reset nach bfcache-Rückkehr (pageshow-Verdrahtung folgt in Phase 3a). */
export function resetRedirecting(): void {
  redirecting.value = false;
}

/**
 * Additive Seam (Phase 2d, state/player): Play-Fehler-Pfade, die logout()
 * auslösen (403 PREMIUM_REQUIRED), setzen DANACH den Login-Fehler-Text —
 * logout() nullt authError, daher Reihenfolge logout() → setAuthError()
 * (Parity web/app.js logout(); showLoginError(LOGIN_PREMIUM_MSG), L507–513).
 */
export function setAuthError(message: string): void {
  authError.value = message;
}

/** Stellt Ausgangssignals und Browser-Abhängigkeiten für Test-Isolation wieder her. */
export function resetForTests(): void {
  authStatus.value = "loading";
  authError.value = null;
  redirecting.value = false;
  logoutHint.value = null;
  persistLogin.value = true; // Default: angemeldet bleiben (YWEC4VR-2)
  deps = browserDeps();
}
