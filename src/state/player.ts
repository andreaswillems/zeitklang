/**
 * Player-Store (Plan §5.1 Schicht 3, §5.2; Spec §5, §5.6, §8; Parity zu
 * web/app.js playTrack L447–523, createPlayer L326–380 und logout L236–262).
 * Teil 1: „Play-Engine“ — Signale, Track-Queue (#9), PUT /me/player/play mit
 * 401-Retry, Fehler-Mapping via lib/errors. Teil 2: createPlayer() +
 * SDK-Event-Wiring + Logout-Reaktion auf authStatus.
 *
 * Bewusste Parity-Entscheidung: Das SDK-Event `not_ready` ist NICHT
 * verdrahtet — web/app.js (createPlayer L326–380) registriert dafür keinen
 * Listener; deviceId bleibt nach einem Ready-Wechsel absichtlich stehen und
 * der Render-Kontext läuft ohnehin über player_state_changed. Nicht nachträglich
 * nach SDK-Beispielcode „ergänzen“, sondern erst, wenn die Ziel-App ein
 * dokumentiertes Bedürfnis hat.
 */

import { computed, effect, signal } from "@preact/signals";
import {
  createSpotifyPlayer,
  loadSpotifySdk,
  type SpotifyPlaybackState,
  type SpotifyPlayerEvent,
  type SpotifyPlayerHandle,
} from "../adapters/spotify-sdk.ts";
import { SPOTIFY_CLIENT_ID } from "../lib/config.ts";
import {
  AUTOPLAY_HINT_MSG,
  LOGIN_PREMIUM_MSG,
  LOGIN_STALE_MSG,
  MISSING_SCOPE_MSG,
  playErrorMessage,
} from "../lib/errors.ts";
import { fetchWithTimeout, TimeoutError } from "../lib/http.ts";
import { KEYS as REDIRECT_KEYS } from "../lib/redirect.ts";
import { type Storage, webStorage } from "../lib/storage.ts";
import {
  missingScopesFromGranted,
  resolveGrantedScopes,
  scopesFromScopeField,
  tokenShape,
} from "../lib/token-scopes.ts";
import { getValidToken, KEYS as TOKEN_KEYS, type TokenDeps } from "../lib/tokens.ts";
import { authStatus, login, logout, refreshStorage, setAuthError } from "./auth.ts";

const PLAY_URL = "https://api.spotify.com/v1/me/player/play";
const TOKEN_URL = "https://accounts.spotify.com/api/token";

/** Queue-Texte (Parity web/app.js L275–276). */
export const QUEUE_WAIT_MSG = "Verbinde mit Spotify — der Titel startet in Kürze.";
export const QUEUE_FAIL_MSG =
  "Verbindung zu Spotify fehlgeschlagen — bitte Seite neu laden.";

/** Meldung nach echtem (nicht spurigem) authentication_error (Parity L270). */
export const AUTH_ERROR_MSG = "Authentifizierung fehlgeschlagen — bitte neu anmelden.";

/** Queue-Timeout: bricht erst nach 10 s ohne Verbindung ab (Parity L460, #9). */
const QUEUE_TIMEOUT_MS = 10_000;

/**
 * Timeout für den PUT /me/player/play (Security-Audit A10:2025, Finding F6) —
 * ein hängender Play-Request darf playTrack() nicht ewig offen lassen (über
 * den fire-and-forget-Aufruf in state/scanner.ts sonst unhandled rejection).
 * Gleiche Größenordnung wie QUEUE_TIMEOUT_MS / TOKEN_TIMEOUT_MS (10 s).
 */
export const PLAY_TIMEOUT_MS = 10_000;

/** Spurios-Fenster: AUTH_ERROR_MSG erst nach 3 s zeigen, ready hebt auf (L349–357). */
const AUTH_ERROR_DELAY_MS = 3_000;

/**
 * 71TAZ1B-3: Scopes, die Wiedergabe + Play-Steuerung zwingend brauchen
 * (Spec §5.3: PUT /me/player/play benötigt user-modify-playback-state, das
 * Web Playback SDK streaming). Fehlt einer davon im Access-Token, ändert ein
 * Refresh nichts — nur ein Consent-Dialog mit allen Berechtigungen holt ihn.
 */
const PLAYBACK_SCOPES = ["streaming", "user-modify-playback-state"];

export const deviceId = signal<string | null>(null);
export const playerState = signal<SpotifyPlaybackState | null>(null);
/** Mini-Player-Sichtbarkeit etc. — läuft erst, sobald ein SDK-State da ist (#7). */
export const trackLoaded = computed(() => playerState.value !== null);
/** Statustext für die UI — Fachdetails gehen nur in die Konsole (#10). */
export const playerMessage = signal<string | null>(null);

interface PlayerDeps {
  fetch: typeof fetch;
  session: Storage;
  local: Storage;
  now: () => number;
  tokenUrl: string;
  clientId: string;
}

function browserDeps(): PlayerDeps {
  return {
    fetch: (input, init) => fetch(input, init),
    session: webStorage(sessionStorage),
    local: webStorage(localStorage),
    now: () => Date.now(),
    tokenUrl: TOKEN_URL,
    clientId: SPOTIFY_CLIENT_ID,
  };
}

let deps = browserDeps();

/** #9: gequeuete Track-ID (Scan vor SDK-ready) + der zugehörige Timeout. */
let queuedTrackId: string | null = null;
let queueTimer: ReturnType<typeof setTimeout> | null = null;
/** 3-s-Timer für authentication_error — ready hebt ihn auf (Parity L349–357). */
let authErrorTimer: ReturnType<typeof setTimeout> | null = null;
/** Re-Consent nur einmal pro Seitenladung — sonst Endlosschleife (Parity L304). */
let reconsentUsed = false;
/** Player-Handle — intern gehalten (kein global), createPlayer() verwaltet ihn. */
let playerHandle: SpotifyPlayerHandle | null = null;

/**
 * Lese-Seam auf den Player-Handle (Teardown-Tests, spätere Phasen).
 * resetForTests() wirft ihn weg.
 */
export function currentPlayerHandle(): SpotifyPlayerHandle | null {
  return playerHandle;
}

function clearQueuedTrack(): void {
  queuedTrackId = null;
  if (queueTimer !== null) {
    clearTimeout(queueTimer);
    queueTimer = null;
  }
}

function clearAuthErrorTimer(): void {
  if (authErrorTimer !== null) {
    clearTimeout(authErrorTimer);
    authErrorTimer = null;
  }
}

/**
 * Drain-Seam für Subtask 2 (ready-Event): liest die gequeuete Track-ID und
 * räumt sie inkl. Timer. Replay über playTrack(trackId).
 */
export function drainQueuedTrack(): string | null {
  const trackId = queuedTrackId;
  clearQueuedTrack();
  return trackId;
}

function tokenDeps(): TokenDeps {
  return {
    fetch: deps.fetch,
    session: deps.session,
    // Aktiver Refresh-Speicher je nach persistLogin (state/auth.ts,
    // YWEC4VR-2) — als Funktion, damit ein Laufzeit-Wechsel sofort greift.
    refresh: () => refreshStorage(),
    now: deps.now,
    tokenUrl: deps.tokenUrl,
    clientId: deps.clientId,
  };
}

/**
 * F401W08: Steht der persistente Re-Consent-Marker (local-Storage-Dep, ohne
 * web/app.js-Pendant)? Hält über Reload/Logout, geräumt nur der ok-Play.
 */
function reconsentPending(): boolean {
  return deps.local.getItem(REDIRECT_KEYS.reconsentPending) === "1";
}

/**
 * Spielt einen Track über PUT /me/player/play (Spec §5.6, Parity
 * web/app.js playTrack). Ohne deviceId wird die ID nur gequeuet (#9).
 */
export async function playTrack(trackId: string): Promise<void> {
  if (deviceId.value === null) {
    // #9: Player verbindet noch → Track-ID zwischenspeichern; das ready-
    // Event spielt sie via Drain-Seam automatisch ab. Bricht erst nach
    // 10 s ohne Verbindung mit klarer Meldung ab.
    queuedTrackId = trackId;
    playerMessage.value = QUEUE_WAIT_MSG;
    if (queueTimer !== null) clearTimeout(queueTimer);
    queueTimer = setTimeout(() => {
      if (deviceId.value === null && queuedTrackId === trackId) {
        clearQueuedTrack();
        // Nur ersetzen, wenn nicht inzwischen eine spezifischere SDK-Meldung
        // steht — Queue ist trotzdem weg (Parity L460–467).
        if (playerMessage.value === QUEUE_WAIT_MSG) {
          playerMessage.value = QUEUE_FAIL_MSG;
        }
      }
    }, QUEUE_TIMEOUT_MS);
    return;
  }

  const play = async (): Promise<Response> =>
    fetchWithTimeout(
      deps.fetch,
      `${PLAY_URL}?device_id=${deviceId.value}`,
      {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${await getValidToken(tokenDeps())}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ uris: [`spotify:track:${trackId}`] }),
      },
      PLAY_TIMEOUT_MS,
    );

  let response: Response;
  try {
    response = await play();
    if (response.status === 401) {
      // Token lief unterwegs ab — Access-Token verwerfen, getValidToken greift
      // dann zum Refresh-Token, genau EINMAL wiederholen (§5.6, Parity L479–486).
      // Ein TIMEOUT wird NICHT retried — nur HTTP 401 (§5.6, A10 F6).
      deps.session.removeItem(TOKEN_KEYS.access);
      deps.session.removeItem(TOKEN_KEYS.expiresAt);
      response = await play();
    }
  } catch (err) {
    if (err instanceof TimeoutError) {
      // A10 F6: Timeout des PUT (erster Versuch wie Retry) — INSIDE behandeln,
      // damit der fire-and-forget-Aufruf in scanner.ts keine unhandled rejection
      // sieht: Fachdetails nur Konsole, UI-Meldung kuratiert (QUEUE_FAIL_MSG,
      // Parity-Denke: derselbe Text wie das Queue-Timeout — Verbindung zu
      // Spotify steht nicht). playTrack() resolved normal.
      console.error("Play-Request-Timeout:", err.message);
      playerMessage.value = QUEUE_FAIL_MSG;
      return;
    }
    // Nur Timeouts behandeln — eine generische fetch-Rejection ohne Timeout
    // bleibt unberührt (das ist Finding F7 / 7MXKQ3V, nicht dieser Pfad).
    throw err;
  }

  if (response.ok) {
    playerMessage.value = null;
    reconsentUsed = false;
    // F401W08: Der persistente Re-Consent-Marker überlebt Reload und
    // App-Logout bewusst — geräumt wird er NUR hier (ein erfolgreicher Play
    // beweist eine aktuelle Epoche). Beim Login-Erfolg oder Logout zu räumen
    // würde die Re-Consent-Schleife wiederbeleben: Der Token-Tausch gelingt
    // auch mit veralteter Epoche.
    deps.local.removeItem(REDIRECT_KEYS.reconsentPending);
    return;
  }

  // #10: Fachdetails (HTTP-Status, Spotify-Reason) nur in die Konsole,
  // in der UI steht die handlungsanleitende Meldung (Parity L487–497).
  let reason = "";
  try {
    const body = (await response.json()) as {
      error?: { reason?: string; message?: string };
    };
    reason = body.error?.reason ?? "";
    console.error(
      "Play fehlgeschlagen:",
      response.status,
      reason || body.error?.message || "",
    );
  } catch {
    console.error("Play fehlgeschlagen:", response.status);
  }

  // 71TAZ1B-2/71TAZ1B-3 + BSF4QZM-2: Scope-Diagnose beim 403 — die gewährten
  // Scopes via resolveGrantedScopes auflösen (persistiertes scope-Feld der
  // Token-Antwort primär, JWT-Dekoder nur Fallback; null = unbekannt, z. B.
  // opaker Token ohne Feld — KEINE Aussage über fehlende Scopes, kein False
  // Positive). Scopes, Quelle und Token-Form gehen NUR in die Konsole, nie in
  // die UI und NIEMALS als Token-Werte (#10 + check:secrets); zusätzlich merkt
  // sich der Pfad, ob ein für die Wiedergabe zwingender Scope fehlt (steuert
  // die Meldung beim zweiten 403). getValidToken kann werfen (z. B.
  // Refresh-Endpunkt down) — die Diagnose darf den 403-Pfad nie in eine
  // Rejection verwandeln.
  let playbackScopeMissing = false;
  if (response.status === 403) {
    try {
      const token = await getValidToken(tokenDeps());
      const scopeField = deps.session.getItem(TOKEN_KEYS.scopes);
      const granted = resolveGrantedScopes(scopeField, token ?? "");
      // Quelle bestimmen: scope-Feld gewinnt, sonst JWT, sonst unbekannt.
      const source =
        scopesFromScopeField(scopeField) !== null
          ? "scope-Feld"
          : granted !== null
            ? "JWT"
            : "unbekannt";
      console.error(
        "403 — gewährte Scopes:",
        granted,
        "Quelle:",
        source,
        "Token-Form:",
        token === null ? null : tokenShape(token),
      );
      // 71TAZ1B-3: Fehlt user-modify-playback-state oder streaming, kann ein
      // Refresh die Scopes nicht ändern — nur der Consent-Dialog holt sie.
      // Unbekannt (null) → nichts fehlt (missingScopesFromGranted: null → []).
      playbackScopeMissing =
        missingScopesFromGranted(granted, PLAYBACK_SCOPES).length > 0;
    } catch (err) {
      console.error("403 — Scopes konnten nicht dekodiert werden:", err);
    }
  }

  if (response.status === 403 && reason === "PREMIUM_REQUIRED") {
    // Free-Account: PUT /me/player/play antwortet mit 403 PREMIUM_REQUIRED
    // (nicht 412) — gleiche Behandlung wie account_error (Parität L507–513).
    logout();
    setAuthError(LOGIN_PREMIUM_MSG);
    return;
  }
  if (response.status === 403 && !reconsentUsed && !reconsentPending()) {
    // Token ohne nötigen Scope: Refresh ändert die gewährten Scopes nicht,
    // nur ein erzwungener Consent-Dialog holt sie — einmalig pro
    // Seitenladung, sonst Endlosschleife (Parity L514–522). F401W08: Der
    // persistente Marker (local-Storage-Dep, wie auth.ts) muss VOR
    // logout()/login(true) stehen, sonst erreichte ihn der Redirect nicht.
    reconsentUsed = true;
    deps.local.setItem(REDIRECT_KEYS.reconsentPending, "1");
    logout();
    login(true);
    return;
  }
  if (response.status === 403) {
    // F401W08 + 71TAZ1B-3 (HITL-freigegebene Abweichung, s. redirect.ts
    // KEYS): 403 ohne PREMIUM_REQUIRED, während der Marker schon steht —
    // ZWEITER Re-Consent liefert denselben 403. Scope-aware Aufschlüsselung:
    // Fehlt dem Access-Token user-modify-playback-state oder streaming, hat
    // der erzwungene Consent-Dialog nicht ALLE Berechtigungen geholt →
    // MISSING_SCOPE_MSG (handlungsanleitend: neu anmelden, alle erlauben).
    // Sind alle Playback-Scopes vorhanden, bleibt der Stale-Pfad (veraltete
    // Login-Epoche, z. B. UNKNOWN beim Play-Transfer) mit LOGIN_STALE_MSG.
    // Fachdetails (Status/Reason/Scopes) stehen oben bereits in der Konsole (#10).
    playerMessage.value = playbackScopeMissing ? MISSING_SCOPE_MSG : LOGIN_STALE_MSG;
    return;
  }
  playerMessage.value = playErrorMessage(response.status, reason);
}

/* ---------- createPlayer + SDK-Event-Wiring (Phase 2d, Teil 2) ---------- */

/**
 * SDK-Event-Verteiler (Parity web/app.js createPlayer L326–380): alle 8
 * SDK-Events laufen über den einen onEvent-Callback des Adapters.
 */
function handleSdkEvent(event: SpotifyPlayerEvent, payload: unknown): void {
  switch (event) {
    case "ready": {
      // payload: { device_id } — Cast nötig, weil der Adapter die typisierte
      // Payload-Map nicht exportiert (kein Payload-Diskriminant im Callback).
      const { device_id } = payload as { device_id: string };
      // Spurige authentication_error sind jetzt endgültig erledigt.
      clearAuthErrorTimer();
      // Nur die eigenen Verbindungstexte räumen — spezifischere
      // SDK-Meldungen (z. B. von autoplay_failed) bleiben stehen (L332–336).
      if (
        playerMessage.value === AUTH_ERROR_MSG ||
        playerMessage.value === QUEUE_FAIL_MSG
      ) {
        playerMessage.value = null;
      }
      deviceId.value = device_id;
      // #9: Scan vor SDK-ready jetzt nachziehen — Drain-Seam liest und
      // räumt die gequeuete ID inkl. 10-s-Timer (L337–341).
      const queued = drainQueuedTrack();
      if (queued !== null) {
        playTrack(queued);
      }
      return;
    }
    case "player_state_changed":
      // trackLoaded (computed) folgt automatisch → Mini-Player (#7).
      playerState.value = payload as SpotifyPlaybackState;
      return;
    case "initialization_error":
      playerMessage.value = `Player-Fehler: ${(payload as { message: string }).message}`;
      return;
    case "authentication_error": {
      // Spurischer Fehler (Connect wird trotzdem fertig) oder echter Tot:
      // Hinweis erst zeigen, wenn nicht binnen 3 s ready nachkommt — ein
      // weiterer Fehler startet die Frist neu (L349–357).
      clearAuthErrorTimer();
      authErrorTimer = setTimeout(() => {
        authErrorTimer = null;
        playerMessage.value = AUTH_ERROR_MSG;
      }, AUTH_ERROR_DELAY_MS);
      return;
    }
    case "account_error":
      // Definitives SDK-Ergebnis (Account ohne Premium — anders als der
      // spurige authentication_error keine Verzögerung nötig): zurück auf den
      // Login mit gezielter Meldung (L360–367).
      logout();
      setAuthError(LOGIN_PREMIUM_MSG);
      return;
    case "playback_error":
      playerMessage.value = `Wiedergabe-Fehler: ${(payload as { message: string }).message}`;
      return;
    case "autoplay_failed":
      // iOS/Safari: Autoplay im SDK-iframe blockiert — aktuellen State
      // nachziehen, damit der Mini-Player mit Play-Button sichtbar wird
      // (§5.5 extra Tap; L372–379).
      if (playerHandle !== null) {
        playerHandle.getCurrentState().then((state) => {
          if (state !== null) {
            playerState.value = state;
          }
        });
      }
      playerMessage.value = AUTOPLAY_HINT_MSG;
      return;
    case "not_ready":
      // Bewusste Parity-Lücke: web/app.js hat keinen Handler — siehe
      // Modulkommentar oben.
      return;
  }
}

/**
 * Erzeugt den Web-Playback-Player (Spec §5, Parity web/app.js createPlayer
 * L326–380): SDK laden → Player mit name/volume/getOAuthToken erzeugen →
 * onEvent-Wiring → connect(). Der Handle bleibt intern (kein global);
 * Doppelerzeugung (auch nebenläufig während des SDK-Ladens) ist vermöge der
 * Guards harmlos.
 */
export async function createPlayer(): Promise<void> {
  if (playerHandle !== null) return; // Double-Create-Guard
  await loadSpotifySdk();
  if (playerHandle !== null) return; // nebenläufiger zweiter Aufruf
  playerHandle = createSpotifyPlayer({
    name: "Zeitklang PWA",
    volume: 0.8,
    getOAuthToken: (cb) => {
      // SDK-Signatur (cb: (token) => void) => void — Token aus dem geteilten
      // Token-Cache (web/app.js L329 reicht null ebenfalls durch; das SDK
      // reagiert darauf mit authentication_error, s.o. verzögert).
      // A10 F8 (5WNV447-1): Rejection-Handler — ohne .catch landet eine
      // getValidToken-Rejection (z. B. Token-Endpunkt non-400/non-401 oder
      // Netzwerkfehler) als unhandled rejection, und das SDK sähe nie einen
      // Callback. Parity-Verhalten wie beim null-Token: cb(null) durchreichen,
      // das SDK meldet darauf authentication_error (s.o., 3-s-verzögert);
      // Fachdetails gehen nur in die Konsole (#10).
      getValidToken(tokenDeps())
        .then((token) => cb(token as string))
        .catch((err) => {
          console.error("OAuth-Token konnte nicht geholt werden:", err);
          cb(null as unknown as string);
        });
    },
    onEvent: handleSdkEvent,
  });
  playerHandle.connect();
}

/**
 * Logout-Reaktion (Parity web/app.js logout L236–262): reißt die Player-
 * Session komplett ab — Queue + beide Timer, playerState/deviceId (→
 * trackLoaded false: Mini-Player verschwindet mit der Session #7), Handle
 * disconnecten und verwerfen. Bewusst KEIN Scanner-/Sheet-Teardown — das
 * reagieren eigene Stores in den Phasen 2e/2f. playerMessage bleibt stehen
 * (Parity: web/app.js logout fasst die Statuszeile nicht an, sondern zeigt
 * die Login-Ansicht).
 */
function teardownPlayerSession(): void {
  clearQueuedTrack();
  clearAuthErrorTimer();
  playerState.value = null;
  deviceId.value = null;
  if (playerHandle !== null) {
    playerHandle.disconnect();
    playerHandle = null;
  }
}

effect(() => {
  if (authStatus.value === "logged-out") {
    teardownPlayerSession();
  }
});

/**
 * Ready-Reaktion (WH3A1BP-2, Smoke-Test-Fund; Parität web/app.js init
 * L617–619): Sobald die Anmeldung steht, wird der Web-Playback-Player erzeugt
 * — ohne diese Verdrahtung blieb das SDK für immer unready und jeder Scan
 * lief ins 10-s-Queue-Timeout („Verbindung zu Spotify fehlgeschlagen").
 * Fire-and-forget: createPlayer() ist durch den Double-Create-Guard
 * idempotent; ein SDK-Ladefehler geht nur in die Konsole — die UI-Meldung
 * macht dann ohnehin das Queue-Timeout.
 */
effect(() => {
  if (authStatus.value === "ready") {
    createPlayer().catch((err) => console.error("Player-Erzeugung fehlgeschlagen:", err));
  }
});

/** Stellt Signale, Queue, Timer, reconsentUsed, Handle + Deps für Test-Isolation wieder her. */
export function resetForTests(): void {
  deviceId.value = null;
  playerState.value = null;
  playerMessage.value = null;
  clearQueuedTrack();
  clearAuthErrorTimer();
  reconsentUsed = false;
  playerHandle = null;
  deps = browserDeps();
}
