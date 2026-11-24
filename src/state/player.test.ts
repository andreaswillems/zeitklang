import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import type {
  CreateSpotifyPlayerOptions,
  OnSpotifyPlayerEvent,
  SpotifyPlaybackState,
  SpotifyPlayerEvent,
  SpotifyPlayerHandle,
} from "../adapters/spotify-sdk.ts";
import { AUTH_SCOPES } from "../lib/config.ts";
import {
  AUTOPLAY_HINT_MSG,
  LOGIN_PREMIUM_MSG,
  LOGIN_STALE_MSG,
  MISSING_SCOPE_MSG,
  playErrorMessage,
} from "../lib/errors.ts";
import { base64url } from "../lib/pkce.ts";
import { KEYS as REDIRECT_KEYS } from "../lib/redirect.ts";
import { InMemoryStorage, type Storage } from "../lib/storage.ts";
import { KEYS as TOKEN_KEYS } from "../lib/tokens.ts";
import { authStatus } from "./auth.ts";
import {
  AUTH_ERROR_MSG,
  createPlayer,
  currentPlayerHandle,
  deviceId,
  drainQueuedTrack,
  PLAY_TIMEOUT_MS,
  playerMessage,
  playerState,
  playTrack,
  QUEUE_FAIL_MSG,
  QUEUE_WAIT_MSG,
  resetForTests,
  trackLoaded,
} from "./player.ts";

// state/auth bleibt Subjekt von auth.test.ts — hier wird nur die Verdrahtung
// geprüft: playTrack/createPlayer rufen logout()/login(true)/setAuthError()
// auf; die Logout-Reaktion reagiert auf das authStatus-Signal (Fake unten),
// damit player.test.ts keinen echten Auth-Store braucht.
const {
  createSpotifyPlayerMock,
  loadSpotifySdkMock,
  loginMock,
  logoutMock,
  refreshStorageMock,
  setAuthErrorMock,
} = vi.hoisted(() => ({
  createSpotifyPlayerMock:
    vi.fn<(options: CreateSpotifyPlayerOptions) => SpotifyPlayerHandle>(),
  loadSpotifySdkMock: vi.fn<() => Promise<void>>(),
  loginMock: vi.fn<(forceConsent?: boolean) => Promise<void>>(),
  logoutMock: vi.fn<() => void>(),
  // YWEC4VR-2: player.ts hängt tokenDeps.refresh an refreshStorage() aus
  // state/auth — hier gesteuert, welcher Speicher aktiv ist (Default: local).
  refreshStorageMock: vi.fn<() => Storage>(),
  setAuthErrorMock: vi.fn<(message: string) => void>(),
}));

vi.mock("./auth.ts", async () => {
  // Echtes Signal als Fake — die Logout-Reaktion des Player-Store abonniert
  // authStatus; Tests setzen es einfach auf den gewünschten Status.
  const { signal } = await import("@preact/signals");
  return {
    authStatus: signal<"loading" | "ready" | "logged-out">("loading"),
    login: loginMock,
    logout: logoutMock,
    refreshStorage: refreshStorageMock,
    setAuthError: setAuthErrorMock,
  };
});

vi.mock("../adapters/spotify-sdk.ts", () => ({
  createSpotifyPlayer: createSpotifyPlayerMock,
  loadSpotifySdk: loadSpotifySdkMock,
}));

const PLAY_URL = "https://api.spotify.com/v1/me/player/play";
const TOKEN_URL = "https://accounts.spotify.com/api/token";
const NOW = 1_000_000;

let session: InMemoryStorage;
let local: InMemoryStorage;
let playCalls: Array<{ url: string; init: RequestInit }>;
let tokenCalls: number;
let fetchMock: Mock<typeof fetch>;
let onEventCapture: OnSpotifyPlayerEvent | null;
let handleMock: HandleMock;

beforeEach(() => {
  session = new InMemoryStorage();
  local = new InMemoryStorage();
  playCalls = [];
  tokenCalls = 0;
  fetchMock = vi.fn<typeof fetch>();
  vi.stubGlobal("sessionStorage", session);
  vi.stubGlobal("localStorage", local);
  vi.stubGlobal("fetch", fetchMock);
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  vi.spyOn(console, "error").mockImplementation(() => {});
  authStatus.value = "loading";
  loadSpotifySdkMock.mockReset();
  loadSpotifySdkMock.mockResolvedValue(undefined);
  createSpotifyPlayerMock.mockReset();
  loginMock.mockReset();
  logoutMock.mockReset();
  refreshStorageMock.mockReset();
  refreshStorageMock.mockImplementation(() => local); // Default persistLogin=true
  setAuthErrorMock.mockReset();
  onEventCapture = null;
  createSpotifyPlayerMock.mockImplementation((options) => {
    onEventCapture = options.onEvent;
    handleMock = makeHandle(); // pro createPlayer() ein frischer Handle
    return handleMock;
  });
  resetForTests();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function response(status: number, body?: unknown, jsonThrows = false): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => {
      if (jsonThrows) throw new SyntaxError("Kein JSON-Body");
      return body;
    },
  } as Response;
}

interface ScriptStep {
  status: number;
  body?: unknown;
  jsonThrows?: boolean;
}

/** fetch-Mock: PUT /play konsumiert die Steps der Reihe nach, POST tokenUrl refresht. */
function scriptPlay(steps: ScriptStep[]): void {
  let i = 0;
  fetchMock.mockImplementation(async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    if (url === TOKEN_URL) {
      tokenCalls++;
      return response(200, {
        access_token: "at-refreshed",
        expires_in: 3600,
      });
    }
    const step = steps[i] ?? steps[steps.length - 1];
    i++;
    playCalls.push({ url, init: init ?? {} });
    return response(step.status, step.body, step.jsonThrows);
  });
}

function seedValidToken(): void {
  session.setItem(TOKEN_KEYS.access, "at-valid");
  session.setItem(TOKEN_KEYS.expiresAt, String(NOW + 3_600_000));
}

async function playReady(trackId = "track-1"): Promise<void> {
  deviceId.value = "dev-1";
  await playTrack(trackId);
}

/** SDK-Handle-Mock: reine Delegates als spies. */
interface HandleMock extends SpotifyPlayerHandle {
  connect: Mock;
  disconnect: Mock;
  togglePlay: Mock;
  activateElement: Mock;
  getCurrentState: Mock<() => Promise<SpotifyPlaybackState | null>>;
  pause: Mock; // #51: additive Seam (JKA8RDZ-1) — Interface verlangt das Mitglied
}

function makeHandle(): HandleMock {
  return {
    connect: vi.fn(),
    disconnect: vi.fn(),
    togglePlay: vi.fn(),
    activateElement: vi.fn(),
    getCurrentState: vi.fn<() => Promise<SpotifyPlaybackState | null>>(),
    pause: vi.fn(),
  };
}

/** Feuert ein SDK-Event in das via createPlayer() erzeugte onEvent. */
function emit(event: SpotifyPlayerEvent, payload?: unknown): void {
  if (!onEventCapture) throw new Error("Vorher createPlayer() aufrufen");
  (onEventCapture as (event: SpotifyPlayerEvent, payload?: unknown) => void)(
    event,
    payload,
  );
}

/** Spült die Microtask-Warteschlange (fake-timer-sicher, kein echtes setTimeout). */
async function flushPromises(ticks = 10): Promise<void> {
  for (let i = 0; i < ticks; i++) {
    await Promise.resolve();
  }
}

const SDK_STATE: SpotifyPlaybackState = {
  paused: false,
  track_window: {
    current_track: {
      name: "Song A",
      artists: [{ name: "Artist A" }],
      album: { images: [{ url: "https://img/a" }] },
    },
  },
};

const SDK_STATE_OTHER: SpotifyPlaybackState = {
  paused: true,
  track_window: {
    current_track: {
      name: "Song B",
      artists: [{ name: "Artist B" }],
      album: { images: [{ url: "https://img/b" }] },
    },
  },
};

// Craft-JWTs wie in lib/token-scopes.test.ts (Encoder als Stil-Referenz aus pkce.ts)
const JWT_HEADER = base64url(new TextEncoder().encode('{"alg":"RS256","typ":"JWT"}'));
const JWT_SIGNATURE = base64url(new TextEncoder().encode("test-signature"));
const jwtWithScp = (scp: string): string =>
  `${JWT_HEADER}.${base64url(new TextEncoder().encode(JSON.stringify({ scp })))}.${JWT_SIGNATURE}`;

function seedValidJwt(scp: string): void {
  session.setItem(TOKEN_KEYS.access, jwtWithScp(scp));
  session.setItem(TOKEN_KEYS.expiresAt, String(NOW + 3_600_000));
}

describe("playTrack — Queue vor SDK-ready (#9)", () => {
  it("ohne deviceId: Track-ID landet in der Queue, WAIT-Meldung, kein fetch; Drain-Seam räumt Queue + Timer", async () => {
    expect(deviceId.value).toBeNull();
    expect(playerState.value).toBeNull();
    expect(trackLoaded.value).toBe(false);
    expect(playerMessage.value).toBeNull();

    await playTrack("track-1");

    expect(playerMessage.value).toBe(QUEUE_WAIT_MSG);
    expect(fetchMock).not.toHaveBeenCalled();

    expect(drainQueuedTrack()).toBe("track-1");
    vi.advanceTimersByTime(10_000);
    expect(playerMessage.value).toBe(QUEUE_WAIT_MSG);
    expect(drainQueuedTrack()).toBeNull();
  });

  it("10-s-Timeout: noch kein deviceId → Queue verwerfen, Meldung → QUEUE_FAIL_MSG", async () => {
    await playTrack("track-1");

    vi.advanceTimersByTime(9_999);
    expect(playerMessage.value).toBe(QUEUE_WAIT_MSG);

    vi.advanceTimersByTime(1);
    expect(playerMessage.value).toBe(QUEUE_FAIL_MSG);
    expect(drainQueuedTrack()).toBeNull();
  });

  it("ersetzt eine spezifischere Meldung nicht mit QUEUE_FAIL_MSG, verwirft die Queue aber", async () => {
    await playTrack("track-1");
    playerMessage.value = "Spezifischere SDK-Meldung";

    vi.advanceTimersByTime(10_000);

    expect(playerMessage.value).toBe("Spezifischere SDK-Meldung");
    expect(drainQueuedTrack()).toBeNull();
  });

  it("Neuer Scan ersetzt die Queue und startet den 10-s-Timer neu", async () => {
    await playTrack("track-1");
    vi.advanceTimersByTime(9_000);
    await playTrack("track-2");

    vi.advanceTimersByTime(9_999);
    expect(playerMessage.value).toBe(QUEUE_WAIT_MSG);

    vi.advanceTimersByTime(1);
    expect(playerMessage.value).toBe(QUEUE_FAIL_MSG);
    expect(drainQueuedTrack()).toBeNull();
  });
});

describe("playTrack — PUT /me/player/play", () => {
  it("ok: PUT an /play mit device_id, Bearer-Token und Track-URI; playerMessage → null", async () => {
    seedValidToken();
    scriptPlay([{ status: 200, body: {} }]);
    playerMessage.value = "alte Meldung";

    await playReady("track-1");

    expect(playCalls).toHaveLength(1);
    expect(playCalls[0].url).toBe(`${PLAY_URL}?device_id=dev-1`);
    expect(playCalls[0].init.method).toBe("PUT");
    expect(playCalls[0].init.headers).toEqual({
      Authorization: "Bearer at-valid",
      "Content-Type": "application/json",
    });
    expect(JSON.parse(playCalls[0].init.body as string)).toEqual({
      uris: ["spotify:track:track-1"],
    });
    expect(playerMessage.value).toBeNull();
    expect(tokenCalls).toBe(0);
  });

  it("401: Access + expiresAt verwerfen, Refresh über getValidToken, PUT genau EINMAL wiederholen — zweiter 401 → Mapping", async () => {
    seedValidToken();
    local.setItem(TOKEN_KEYS.refresh, "rt-1");
    scriptPlay([
      { status: 401, body: { error: { message: "Token expired" } } },
      { status: 401, body: { error: { message: "Token expired" } } },
    ]);

    await playReady("track-1");

    expect(playCalls).toHaveLength(2);
    expect(tokenCalls).toBe(1);
    expect(session.getItem(TOKEN_KEYS.access)).toBe("at-refreshed");
    expect(playCalls[1].init.headers).toEqual({
      Authorization: "Bearer at-refreshed",
      "Content-Type": "application/json",
    });
    expect(playerMessage.value).toBe(playErrorMessage(401));
  });

  it("403 PREMIUM_REQUIRED: console.error mit Fachdetails, logout() + setAuthError(LOGIN_PREMIUM_MSG), kein playerMessage", async () => {
    seedValidToken();
    scriptPlay([
      {
        status: 403,
        body: { error: { reason: "PREMIUM_REQUIRED", message: "Requires premium" } },
      },
    ]);

    await playReady("track-1");

    expect(console.error).toHaveBeenCalledWith(
      "Play fehlgeschlagen:",
      403,
      "PREMIUM_REQUIRED",
    );
    expect(logoutMock).toHaveBeenCalledExactlyOnceWith();
    expect(setAuthErrorMock).toHaveBeenCalledExactlyOnceWith(LOGIN_PREMIUM_MSG);
    expect(loginMock).not.toHaveBeenCalled();
    expect(playerMessage.value).toBeNull();
    // F401W08: PREMIUM-Short-Circuit bleibt vor der Marker-Logik —
    // kein Re-Consent-Marker gesetzt.
    expect(local.getItem(REDIRECT_KEYS.reconsentPending)).toBeNull();
  });

  it("403 ohne Premium-Reason + alle Playback-Scopes vorhanden: Titel-Meldung statt Re-Consent — wiederholtes 403 gleiche Meldung, kein logout/login/Marker (R52EEYK)", async () => {
    // R52EEYK (HITL): Nur ein NACHWEISLICH fehlender Playback-Scope darf die
    // Re-Consent-Leiter auslösen. Token mit ALLEN Scopes → track-spezifischer
    // 403 (z. B. ungültige Track-ID): Nutzer-Meldung, kein Logout/Consent.
    seedValidJwt(AUTH_SCOPES);
    scriptPlay([
      {
        status: 403,
        body: { error: { reason: "UNKNOWN", message: "Restriction violated" } },
      },
      {
        status: 403,
        body: { error: { reason: "UNKNOWN", message: "Restriction violated" } },
      },
    ]);

    await playReady("track-1");

    expect(playerMessage.value).toBe(playErrorMessage(403, "UNKNOWN"));
    expect(loginMock).not.toHaveBeenCalled();
    expect(logoutMock).not.toHaveBeenCalled();
    expect(setAuthErrorMock).not.toHaveBeenCalled();
    expect(local.getItem(REDIRECT_KEYS.reconsentPending)).toBeNull();

    await playReady("track-2");

    expect(playerMessage.value).toBe(playErrorMessage(403, "UNKNOWN"));
    expect(loginMock).not.toHaveBeenCalled();
    expect(logoutMock).not.toHaveBeenCalled();
    expect(local.getItem(REDIRECT_KEYS.reconsentPending)).toBeNull();
  });

  it("ok-PUT setzt reconsentUsed zurück: nach ok löst ein weiteres 403 erneut Re-Consent aus", async () => {
    // R52EEYK: Leiter nur bei nachweislich fehlendem Scope — JWT ohne
    // user-modify-playback-state, damit beide 403 den Missing-Scope-Pfad nehmen.
    seedValidJwt("streaming");
    scriptPlay([
      { status: 403, body: { error: { message: "Insufficient scope" } } },
      { status: 200, body: {} },
      { status: 403, body: { error: { message: "Insufficient scope" } } },
    ]);

    await playReady("track-1");
    expect(loginMock).toHaveBeenCalledTimes(1);

    await playReady("track-2");
    expect(playerMessage.value).toBeNull();

    await playReady("track-3");
    expect(loginMock).toHaveBeenCalledTimes(2);
    expect(loginMock).toHaveBeenLastCalledWith(true);
  });

  it.each([
    {
      label: "404 ohne aktives Gerät",
      status: 404,
      body: { error: { message: "Device not found" } },
      jsonThrows: false,
    },
    {
      label: "412 (Reason egal) → Premium-Text",
      status: 412,
      body: { error: { reason: "SOMETHING_ELSE" } },
      jsonThrows: false,
    },
    {
      label: "unbekannter Status ohne JSON-Body",
      status: 500,
      body: undefined,
      jsonThrows: true,
    },
  ])(
    "Fehlerpfad $label via playErrorMessage (#10: Fachdetails nur console.error)",
    async ({ status, body, jsonThrows }) => {
      seedValidToken();
      scriptPlay([{ status, body, jsonThrows }]);

      await playReady("track-1");

      expect(playerMessage.value).toBe(playErrorMessage(status));
      expect(logoutMock).not.toHaveBeenCalled();
      expect(loginMock).not.toHaveBeenCalled();
      if (jsonThrows) {
        expect(console.error).toHaveBeenCalledExactlyOnceWith(
          "Play fehlgeschlagen:",
          500,
        );
      }
    },
  );
});

describe("tokenDeps — refresh: () => refreshStorage() (YWEC4VR-2)", () => {
  it("401-Retry liest den Refresh-Token aus dem von refreshStorage() gelieferten Speicher — Laufzeit-Wechsel greift sofort (hier: session)", async () => {
    seedValidToken();
    session.setItem(TOKEN_KEYS.refresh, "rt-session");
    refreshStorageMock.mockImplementation(() => session);
    scriptPlay([
      { status: 401, body: { error: { message: "Token expired" } } },
      { status: 200, body: {} },
    ]);

    await playReady("track-1");

    expect(tokenCalls).toBe(1);
    expect(playCalls).toHaveLength(2);
    expect(playCalls[1].init.headers).toEqual({
      Authorization: "Bearer at-refreshed",
      "Content-Type": "application/json",
    });
    expect(session.getItem(TOKEN_KEYS.access)).toBe("at-refreshed");
    expect(local.getItem(TOKEN_KEYS.access)).toBeNull();
  });
});

describe("playTrack — PUT-Timeout (Security-Audit A10:2025, Finding F6)", () => {
  /**
   * fetch-Mock: PUT /play hängt ab Call `hangFromCall` ewig (never-resolving
   * Promise), davor kommen 401-Antworten; Token-Endpunkt antwortet normal.
   */
  function scriptPlayHanging(hangFromCall: number): void {
    let i = 0;
    fetchMock.mockImplementation(async (input: unknown, init?: RequestInit) => {
      const url = String(input);
      if (url === TOKEN_URL) {
        tokenCalls++;
        return response(200, {
          access_token: "at-refreshed",
          expires_in: 3600,
        });
      }
      i++;
      playCalls.push({ url, init: init ?? {} });
      if (i < hangFromCall) {
        return response(401, { error: { message: "Token expired" } });
      }
      // hängt ewig — nur der Timeout (fetchWithTimeout) beendet den Request
      return new Promise<Response>(() => {});
    });
  }

  it("Timeout des PUT: hängender fetch + PLAY_TIMEOUT_MS → playTrack settled (kein Hängen, keine Rejection), playerMessage = QUEUE_FAIL_MSG, console.error mit Fachdetails, genau EIN PUT (Timeout wird nicht retried)", async () => {
    seedValidToken();
    scriptPlayHanging(1);

    deviceId.value = "dev-1";
    const p = playTrack("track-1");
    await flushPromises(); // bis fetchWithTimeout den Timeout-Timer registriert
    await vi.advanceTimersByTimeAsync(PLAY_TIMEOUT_MS + 1);
    await expect(p).resolves.toBeUndefined();

    expect(playCalls).toHaveLength(1); // nur HTTP 401 retried — ein Timeout nicht
    expect(tokenCalls).toBe(0);
    expect(playerMessage.value).toBe(QUEUE_FAIL_MSG);
    expect(console.error).toHaveBeenCalledWith(
      "Play-Request-Timeout:",
      expect.stringContaining(`${PLAY_TIMEOUT_MS}`),
    );
  });

  it("Timeout erst beim 401-Retry: erster PUT 401 → Refresh → zweiter PUT hängt → derselbe Timeout-Pfad, genau ZWEI PUTs", async () => {
    seedValidToken();
    local.setItem(TOKEN_KEYS.refresh, "rt-1");
    scriptPlayHanging(2); // erster PUT 401, Retry-PUT hängt

    deviceId.value = "dev-1";
    const p = playTrack("track-1");
    await flushPromises();
    await vi.advanceTimersByTimeAsync(PLAY_TIMEOUT_MS + 1);
    await expect(p).resolves.toBeUndefined();

    expect(playCalls).toHaveLength(2); // genau eine 401-Wiederholung, Timeout selbst kein Retry
    expect(tokenCalls).toBe(1);
    expect(session.getItem(TOKEN_KEYS.access)).toBe("at-refreshed");
    expect(playCalls[1].init.headers).toEqual({
      Authorization: "Bearer at-refreshed",
      "Content-Type": "application/json",
    });
    expect(playerMessage.value).toBe(QUEUE_FAIL_MSG);
  });

  it("Grenze zu F7 (7MXKQ3V): generische fetch-Rejection OHNE Timeout bleibt unberührt — playTrack rejected weiterhin, playerMessage unverändert", async () => {
    seedValidToken();
    fetchMock.mockImplementation(async (input: unknown, init?: RequestInit) => {
      const url = String(input);
      if (url === TOKEN_URL) {
        tokenCalls++;
        return response(200, {
          access_token: "at-refreshed",
          expires_in: 3600,
        });
      }
      playCalls.push({ url, init: init ?? {} });
      throw new TypeError("fetch failed"); // Netzwerkfehler, KEIN TimeoutError
    });

    deviceId.value = "dev-1";
    await expect(playTrack("track-1")).rejects.toBeInstanceOf(TypeError);

    expect(playCalls).toHaveLength(1);
    expect(playerMessage.value).toBeNull();
  });
});

describe("Re-Consent-Marker (F401W08 — persistenter Marker bei veralteter Login-Epoche)", () => {
  it("(a) erster 403 mit fehlendem Playback-Scope: Marker über die local-Storage-Dep setzen — VOR logout() + login(true) (Force-Consent-Redirect bleibt)", async () => {
    // R52EEYK: Leiter nur bei nachweislich fehlendem Scope —
    // user-modify-playback-state fehlt im JWT.
    seedValidJwt("streaming");
    const setItemSpy = vi.spyOn(local, "setItem");
    scriptPlay([
      { status: 403, body: { error: { reason: "UNKNOWN", message: "Stale epoch" } } },
    ]);

    await playReady("track-1");

    expect(local.getItem(REDIRECT_KEYS.reconsentPending)).toBe("1");
    expect(logoutMock).toHaveBeenCalledExactlyOnceWith();
    expect(loginMock).toHaveBeenCalledExactlyOnceWith(true);
    // Marker lag VOR logout()/login(true) — sonst würde der Redirect den
    // Marker nicht mehr erreichen (F401W08).
    const markerOrder =
      setItemSpy.mock.invocationCallOrder[
        setItemSpy.mock.calls.findIndex(([key]) => key === REDIRECT_KEYS.reconsentPending)
      ];
    expect(markerOrder).toBeLessThan(logoutMock.mock.invocationCallOrder[0]);
  });

  it("(b) Marker gesetzt + erneut else-403: gezielter Hinweis statt Re-Consent — KEIN zweites login(true)/logout", async () => {
    // 71TAZ1B-3: alle Playback-Scopes vorhanden → Stale-Pfad (F401W08).
    seedValidJwt(AUTH_SCOPES);
    // Simuliert den Zustand nach dem Redirect-Reload: Marker persistent,
    // Token-Epoche weiter veraltet (z. B. 403 UNKNOWN beim Play-Transfer).
    local.setItem(REDIRECT_KEYS.reconsentPending, "1");
    scriptPlay([
      { status: 403, body: { error: { reason: "UNKNOWN", message: "Still stale" } } },
    ]);

    await playReady("track-1");

    expect(playerMessage.value).toBe(LOGIN_STALE_MSG);
    expect(loginMock).not.toHaveBeenCalled();
    expect(logoutMock).not.toHaveBeenCalled();
    // Fachdetails (403, Reason) weiterhin nur Konsole (#10)
    expect(console.error).toHaveBeenCalledWith("Play fehlgeschlagen:", 403, "UNKNOWN");
  });

  it("(c) erfolgreicher Play räumt den Marker — sonst überlebt er Reload und App-Logout", async () => {
    seedValidToken();
    local.setItem(REDIRECT_KEYS.reconsentPending, "1");
    scriptPlay([{ status: 200, body: {} }]);

    await playReady("track-1");

    expect(playerMessage.value).toBeNull();
    expect(local.getItem(REDIRECT_KEYS.reconsentPending)).toBeNull();
  });
});

describe("playTrack — 403 Scope-Logging (71TAZ1B-2; lib/token-scopes.ts; BSF4QZM-2: Quelle + tokenShape im Log; #10: nur Konsole, nie UI)", () => {
  // JWT-Helfer (jwtWithScp/seedValidJwt) liegen oben auf Modulebene.
  const SCOPE_LOG_LABEL = "403 — gewährte Scopes:";
  const scopeLogs = (): unknown[][] =>
    vi.mocked(console.error).mock.calls.filter((call) => call[0] === SCOPE_LOG_LABEL);
  // tokenShape eines per jwtWithScp gebauten JWT: 3 Segmente, Payload-Keys ["scp"]
  const JWT_SHAPE = { segments: 3, payloadKeys: ["scp"] };

  it("403 (else): aufgelöste Scopes des gültigen Access-Tokens gehen in die Konsole (Quelle JWT via Fallback — kein scope-Feld persistiert) — kein extra Refresh; vollständige Scopes → Titel-Meldung statt Re-Consent (R52EEYK)", async () => {
    seedValidJwt("streaming user-modify-playback-state");
    scriptPlay([
      { status: 403, body: { error: { reason: "UNKNOWN", message: "Stale epoch" } } },
    ]);

    await playReady("track-1");

    expect(console.error).toHaveBeenCalledWith("Play fehlgeschlagen:", 403, "UNKNOWN");
    expect(scopeLogs()).toEqual([
      [
        SCOPE_LOG_LABEL,
        ["streaming", "user-modify-playback-state"],
        "Quelle:",
        "JWT",
        "Token-Form:",
        JWT_SHAPE,
      ],
    ]);
    expect(tokenCalls).toBe(0); // gültiger Token → Diagnose ohne Refresh
    // R52EEYK: alle Playback-Scopes vorhanden → kein Re-Consent, Titel-Meldung.
    expect(logoutMock).not.toHaveBeenCalled();
    expect(loginMock).not.toHaveBeenCalled();
    expect(playerMessage.value).toBe(playErrorMessage(403, "UNKNOWN"));
  });

  it("403 PREMIUM_REQUIRED: Scope-Log feuert ebenfalls, dann Premium-Handling (logout + setAuthError)", async () => {
    seedValidJwt("streaming");
    scriptPlay([
      {
        status: 403,
        body: { error: { reason: "PREMIUM_REQUIRED", message: "Requires premium" } },
      },
    ]);

    await playReady("track-1");

    expect(scopeLogs()).toEqual([
      [SCOPE_LOG_LABEL, ["streaming"], "Quelle:", "JWT", "Token-Form:", JWT_SHAPE],
    ]);
    expect(logoutMock).toHaveBeenCalledExactlyOnceWith();
    expect(setAuthErrorMock).toHaveBeenCalledExactlyOnceWith(LOGIN_PREMIUM_MSG);
    expect(loginMock).not.toHaveBeenCalled();
  });

  it("zweites 403 (Marker gesetzt): Scope-Log trotzdem — playerMessage bleibt der kuratierte Text, keine Scopes in der UI", async () => {
    seedValidJwt("streaming user-modify-playback-state");
    local.setItem(REDIRECT_KEYS.reconsentPending, "1");
    scriptPlay([{ status: 403, body: { error: { reason: "UNKNOWN" } } }]);

    await playReady("track-1");

    expect(scopeLogs()).toHaveLength(1);
    expect(playerMessage.value).toBe(LOGIN_STALE_MSG);
    expect(playerMessage.value).not.toContain("user-modify-playback-state");
    expect(loginMock).not.toHaveBeenCalled();
  });

  it("401-Retry: Scope-Log feuert genau EINMAL — nur für die 403-Antwort des Retries; geloggt wird der aktuelle Token (nach Refresh das neue JWT)", async () => {
    seedValidJwt("streaming"); // wird beim 401-Retry verworfen
    local.setItem(TOKEN_KEYS.refresh, "rt-1");
    const refreshedJwt = jwtWithScp("streaming user-read-email");
    let i = 0;
    fetchMock.mockImplementation(async (input: unknown, init?: RequestInit) => {
      const url = String(input);
      if (url === TOKEN_URL) {
        tokenCalls++;
        return response(200, { access_token: refreshedJwt, expires_in: 3600 });
      }
      i++;
      playCalls.push({ url, init: init ?? {} });
      return i === 1
        ? response(401, { error: { message: "Token expired" } })
        : response(403, { error: { reason: "UNKNOWN" } });
    });

    await playReady("track-1");

    expect(playCalls).toHaveLength(2);
    // BSF4QZM-2: Refresh-Antwort ohne scope-Feld → KEYS.scopes geräumt →
    // JWT-Fallback greift (Quelle JWT), geloggt wird das neue JWT.
    expect(scopeLogs()).toEqual([
      [
        SCOPE_LOG_LABEL,
        ["streaming", "user-read-email"],
        "Quelle:",
        "JWT",
        "Token-Form:",
        JWT_SHAPE,
      ],
    ]);
  });

  it("kein Token vorhanden (getValidToken → null): granted null (Quelle „unbekannt“, Token-Form null) in der Konsole, playTrack resolved normal (R52EEYK: Titel-Meldung, kein Re-Consent bei unbekannten Scopes)", async () => {
    // weder Access- noch Refresh-Token geseeded
    scriptPlay([{ status: 403, body: { error: { reason: "UNKNOWN" } } }]);

    await playReady("track-1");

    expect(scopeLogs()).toEqual([
      [SCOPE_LOG_LABEL, null, "Quelle:", "unbekannt", "Token-Form:", null],
    ]);
    expect(tokenCalls).toBe(0);
    // R52EEYK: granted null = unbekannt → konservativ Titel-Meldung, keine Leiter.
    expect(loginMock).not.toHaveBeenCalled();
    expect(logoutMock).not.toHaveBeenCalled();
    expect(playerMessage.value).toBe(playErrorMessage(403, "UNKNOWN"));
    expect(local.getItem(REDIRECT_KEYS.reconsentPending)).toBeNull();
  });

  it("getValidToken wirft beim Scope-Log (Refresh-Endpunkt 500): Fehler nur Konsole, playTrack resolved weiter mit Titel-Meldung (R52EEYK: Diagnose-Fehler = unbekannt, kein Re-Consent) — keine Rejection", async () => {
    session.setItem(TOKEN_KEYS.access, "at-valid");
    session.setItem(TOKEN_KEYS.expiresAt, String(NOW + 10_000));
    local.setItem(TOKEN_KEYS.refresh, "rt-1");
    fetchMock.mockImplementation(async (input: unknown, init?: RequestInit) => {
      const url = String(input);
      if (url === TOKEN_URL) {
        tokenCalls++;
        return response(500, { error: { message: "Token-Endpunkt kaputt" } });
      }
      playCalls.push({ url, init: init ?? {} });
      // Uhr tickt beim PUT weiter → Access-Token ist beim Scope-Log abgelaufen
      vi.setSystemTime(NOW + 60_000);
      return response(403, { error: { reason: "UNKNOWN" } });
    });

    deviceId.value = "dev-1";
    await expect(playTrack("track-1")).resolves.toBeUndefined();

    expect(tokenCalls).toBe(1); // nur der Scope-Log refresht (der PUT hatte noch den gültigen Token)
    expect(console.error).toHaveBeenCalledWith(
      "403 — Scopes konnten nicht dekodiert werden:",
      expect.any(Error),
    );
    expect(scopeLogs()).toEqual([]); // Happy-Path-Log feuert nicht
    // R52EEYK: Diagnose wirft → Scopes unbekannt → Titel-Meldung, keine Leiter.
    expect(loginMock).not.toHaveBeenCalled();
    expect(logoutMock).not.toHaveBeenCalled();
    expect(playerMessage.value).toBe(playErrorMessage(403, "UNKNOWN"));
  });
});

describe("playTrack — 403 scope-aware Diagnose (71TAZ1B-3: MISSING_SCOPE_MSG vs LOGIN_STALE_MSG)", () => {
  it("403 + Scope fehlt (kein streaming) + Marker frei → Re-Consent wie heute: reconsentPending=1, logout() + login(true) einmalig, kein playerMessage", async () => {
    seedValidJwt("user-modify-playback-state user-read-playback-state user-read-private");
    scriptPlay([{ status: 403, body: { error: { reason: "UNKNOWN" } } }]);

    await playReady("track-1");

    expect(local.getItem(REDIRECT_KEYS.reconsentPending)).toBe("1");
    expect(logoutMock).toHaveBeenCalledExactlyOnceWith();
    expect(loginMock).toHaveBeenCalledExactlyOnceWith(true);
    expect(playerMessage.value).toBeNull(); // Re-Consent-Redirect, keine Statusmeldung
  });

  it("403 + Marker gesetzt + Token ohne user-modify-playback-state → MISSING_SCOPE_MSG, KEIN zweites login(true)/logout", async () => {
    seedValidJwt("streaming user-read-playback-state user-read-private");
    local.setItem(REDIRECT_KEYS.reconsentPending, "1");
    scriptPlay([{ status: 403, body: { error: { reason: "UNKNOWN" } } }]);

    await playReady("track-1");

    expect(playerMessage.value).toBe(MISSING_SCOPE_MSG);
    expect(loginMock).not.toHaveBeenCalled();
    expect(logoutMock).not.toHaveBeenCalled();
    // #10: Fachdetails (Scope-Namen) nie in der UI
    expect(playerMessage.value).not.toContain("user-modify-playback-state");
  });

  it("403 + Marker gesetzt + Token ohne streaming → MISSING_SCOPE_MSG", async () => {
    seedValidJwt("user-modify-playback-state");
    local.setItem(REDIRECT_KEYS.reconsentPending, "1");
    scriptPlay([{ status: 403, body: { error: { reason: "UNKNOWN" } } }]);

    await playReady("track-1");

    expect(playerMessage.value).toBe(MISSING_SCOPE_MSG);
    expect(loginMock).not.toHaveBeenCalled();
    expect(logoutMock).not.toHaveBeenCalled();
  });

  it("403 + Marker gesetzt + alle Playback-Scopes vorhanden (volle AUTH_SCOPES) → LOGIN_STALE_MSG unverändert (Stale-Epoche-Pfad F401W08 bleibt)", async () => {
    seedValidJwt(AUTH_SCOPES);
    local.setItem(REDIRECT_KEYS.reconsentPending, "1");
    scriptPlay([
      { status: 403, body: { error: { reason: "UNKNOWN", message: "Stale epoch" } } },
    ]);

    await playReady("track-1");

    expect(playerMessage.value).toBe(LOGIN_STALE_MSG);
    expect(loginMock).not.toHaveBeenCalled();
    expect(logoutMock).not.toHaveBeenCalled();
  });

  it("Ablauf: erster 403 mit fehlendem Scope → Re-Consent; zweiter 403 (Marker steht nun) → MISSING_SCOPE_MSG statt zweitem login(true)", async () => {
    seedValidJwt("streaming"); // user-modify-playback-state fehlt
    scriptPlay([
      { status: 403, body: { error: { reason: "UNKNOWN" } } },
      { status: 403, body: { error: { reason: "UNKNOWN" } } },
    ]);

    await playReady("track-1");
    expect(loginMock).toHaveBeenCalledExactlyOnceWith(true);
    expect(logoutMock).toHaveBeenCalledTimes(1);

    await playReady("track-2");
    expect(loginMock).toHaveBeenCalledTimes(1); // KEIN zweites login(true)
    expect(logoutMock).toHaveBeenCalledTimes(1); // KEIN zweites logout()
    expect(playerMessage.value).toBe(MISSING_SCOPE_MSG);
  });

  it("403 PREMIUM_REQUIRED + Token ohne Playback-Scopes → Premium-Pfad unverändert (logout + setAuthError(LOGIN_PREMIUM_MSG), kein playerMessage, kein Re-Consent-Marker)", async () => {
    seedValidJwt("user-read-private");
    scriptPlay([
      {
        status: 403,
        body: { error: { reason: "PREMIUM_REQUIRED", message: "Requires premium" } },
      },
    ]);

    await playReady("track-1");

    expect(logoutMock).toHaveBeenCalledExactlyOnceWith();
    expect(setAuthErrorMock).toHaveBeenCalledExactlyOnceWith(LOGIN_PREMIUM_MSG);
    expect(loginMock).not.toHaveBeenCalled();
    expect(playerMessage.value).toBeNull();
    expect(local.getItem(REDIRECT_KEYS.reconsentPending)).toBeNull();
  });
});

describe("playTrack — 403 Quellen-Auflösung (BSF4QZM-2: scope-Feld primär, JWT-Fallback, unbekannt = keine Aussage)", () => {
  // Opaker Access-Token wie in Prod (kein JWT, 1 Segment, z. B. „BQB…“)
  const OPAQUE_TOKEN = "BQB1opaker-access-token-ohne-jwt-segmente";
  const SCOPE_LOG_LABEL = "403 — gewährte Scopes:";
  const scopeLogs = (): unknown[][] =>
    vi.mocked(console.error).mock.calls.filter((call) => call[0] === SCOPE_LOG_LABEL);

  /** Opaken Access-Token seeden; optional das persistierte scope-Feld (KEYS.scopes). */
  function seedOpaqueValidToken(scopeField?: string): void {
    session.setItem(TOKEN_KEYS.access, OPAQUE_TOKEN);
    session.setItem(TOKEN_KEYS.expiresAt, String(NOW + 3_600_000));
    if (scopeField !== undefined) session.setItem(TOKEN_KEYS.scopes, scopeField);
  }

  it("403 + persistierte Scopes ohne user-modify-playback-state + Marker gesetzt → MISSING_SCOPE_MSG (bekannt + fehlend), KEIN zweites login/logout", async () => {
    seedOpaqueValidToken("streaming user-read-playback-state user-read-private");
    local.setItem(REDIRECT_KEYS.reconsentPending, "1");
    scriptPlay([{ status: 403, body: { error: { reason: "UNKNOWN" } } }]);

    await playReady("track-1");

    expect(playerMessage.value).toBe(MISSING_SCOPE_MSG);
    expect(playerMessage.value).not.toContain("user-modify-playback-state"); // #10
    expect(loginMock).not.toHaveBeenCalled();
    expect(logoutMock).not.toHaveBeenCalled();
  });

  it("scope-Feld gewinnt vor JWT: JWT mit ALLEN Scopes + scope-Feld ohne user-modify-playback-state + Marker → MISSING_SCOPE_MSG", async () => {
    seedValidJwt(AUTH_SCOPES); // Alt-Logik (reiner JWT-Dekoder) würde LOGIN_STALE_MSG liefern
    session.setItem(
      TOKEN_KEYS.scopes,
      "streaming user-read-playback-state user-read-private",
    );
    local.setItem(REDIRECT_KEYS.reconsentPending, "1");
    scriptPlay([{ status: 403, body: { error: { reason: "UNKNOWN" } } }]);

    await playReady("track-1");

    expect(playerMessage.value).toBe(MISSING_SCOPE_MSG);
    expect(loginMock).not.toHaveBeenCalled();
    expect(logoutMock).not.toHaveBeenCalled();
  });

  it("403 + Scopes UNBEKANNT (opaker Token, kein persistiertes scope-Feld) + Marker gesetzt → LOGIN_STALE_MSG (kein False Positive); Konsole-Log mit Quelle „unbekannt“ + tokenShape, NIEMALS Token-Werte (#10 + check:secrets)", async () => {
    seedOpaqueValidToken(); // kein scope-Feld
    local.setItem(REDIRECT_KEYS.reconsentPending, "1");
    scriptPlay([{ status: 403, body: { error: { reason: "UNKNOWN" } } }]);

    await playReady("track-1");

    expect(playerMessage.value).toBe(LOGIN_STALE_MSG);
    expect(loginMock).not.toHaveBeenCalled();
    expect(logoutMock).not.toHaveBeenCalled();
    expect(scopeLogs()).toEqual([
      [
        SCOPE_LOG_LABEL,
        null,
        "Quelle:",
        "unbekannt",
        "Token-Form:",
        { segments: 1, payloadKeys: [] },
      ],
    ]);
    // #10 + check:secrets: der Token-String taucht nirgends in der Konsole auf
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain(
      OPAQUE_TOKEN,
    );
  });

  it("403 erster ohne Marker + opaker Token + vollständige persistierte Scopes → Titel-Meldung, KEIN Re-Consent (R52EEYK: bekannt + vollständig)", async () => {
    seedOpaqueValidToken(AUTH_SCOPES);
    scriptPlay([{ status: 403, body: { error: { reason: "UNKNOWN" } } }]);

    await playReady("track-1");

    expect(playerMessage.value).toBe(playErrorMessage(403, "UNKNOWN"));
    expect(local.getItem(REDIRECT_KEYS.reconsentPending)).toBeNull();
    expect(logoutMock).not.toHaveBeenCalled();
    expect(loginMock).not.toHaveBeenCalled();
  });

  it("403 + Scopes UNBEKANNT (opaker Token, kein scope-Feld) + Marker frei → Titel-Meldung statt Re-Consent; wiederholtes 403 gleiche Meldung, weiterhin keine Leiter (R52EEYK)", async () => {
    seedOpaqueValidToken(); // kein scope-Feld, opak → granted null
    scriptPlay([
      { status: 403, body: { error: { reason: "UNKNOWN" } } },
      { status: 403, body: { error: { reason: "UNKNOWN" } } },
    ]);

    await playReady("track-1");

    expect(playerMessage.value).toBe(playErrorMessage(403, "UNKNOWN"));
    expect(loginMock).not.toHaveBeenCalled();
    expect(logoutMock).not.toHaveBeenCalled();
    expect(local.getItem(REDIRECT_KEYS.reconsentPending)).toBeNull();

    await playReady("track-2");

    expect(playerMessage.value).toBe(playErrorMessage(403, "UNKNOWN"));
    expect(loginMock).not.toHaveBeenCalled();
    expect(logoutMock).not.toHaveBeenCalled();
    expect(local.getItem(REDIRECT_KEYS.reconsentPending)).toBeNull();
  });
});

describe("resetForTests", () => {
  it("stellt Signale, Queue, Timer und reconsentUsed wieder her", async () => {
    // R52EEYK: Leiter nur bei nachweislich fehlendem Scope — JWT ohne
    // user-modify-playback-state (sonst Titel-Meldung statt Re-Consent).
    seedValidJwt("streaming");
    scriptPlay([{ status: 403, body: { error: {} } }]);
    await playReady("track-1");
    expect(loginMock).toHaveBeenCalledTimes(1);

    deviceId.value = null;
    await playTrack("track-2");
    playerMessage.value = "alte Meldung";
    playerState.value = {
      paused: false,
      track_window: {
        current_track: {
          name: "Song",
          artists: [{ name: "Artist" }],
          album: { images: [{ url: "https://img" }] },
        },
      },
    };

    resetForTests();

    expect(deviceId.value).toBeNull();
    expect(playerState.value).toBeNull();
    expect(trackLoaded.value).toBe(false);
    expect(playerMessage.value).toBeNull();
    expect(drainQueuedTrack()).toBeNull();
    vi.advanceTimersByTime(10_000);
    expect(playerMessage.value).toBeNull();

    seedValidJwt("streaming"); // R52EEYK: Missing-Scope-Pfad für die Leiter
    // F401W08: Der persistente Re-Consent-Marker überlebt resetForTests wie
    // einen echten Reload — nur ein erfolgreicher Play räumt ihn; danach ist
    // Re-Consent wieder möglich (reconsentUsed wurde mit geräumt).
    scriptPlay([
      { status: 200, body: {} },
      { status: 403, body: { error: {} } },
    ]);
    deviceId.value = "dev-1";
    await playTrack("track-ok");
    expect(local.getItem(REDIRECT_KEYS.reconsentPending)).toBeNull();
    await playTrack("track-2");
    expect(loginMock).toHaveBeenCalledTimes(2);
  });

  it("entsorgt außerdem den Player-Handle + den 3-s-Auth-Timer und erlaubt einen neuen Player", async () => {
    await createPlayer();
    expect(currentPlayerHandle()).not.toBeNull();
    emit("authentication_error", { message: "SDK spurig" });
    emit("player_state_changed", SDK_STATE);

    resetForTests();

    expect(currentPlayerHandle()).toBeNull();
    expect(playerState.value).toBeNull();
    vi.advanceTimersByTime(3_000);
    expect(playerMessage.value).toBeNull();

    await createPlayer();
    expect(createSpotifyPlayerMock).toHaveBeenCalledTimes(2);
    expect(handleMock.connect).toHaveBeenCalledTimes(1);
  });
});

describe("createPlayer — SDK-Loader + Wiring (Parity web/app.js L326–380)", () => {
  it("wired: loadSpotifySdk → createSpotifyPlayer(name/volume/getOAuthToken/onEvent) → connect", async () => {
    await createPlayer();

    expect(loadSpotifySdkMock).toHaveBeenCalledTimes(1);
    expect(createSpotifyPlayerMock).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        name: "Zeitklang PWA",
        volume: 0.8,
      }),
    );
    expect(handleMock.connect).toHaveBeenCalledTimes(1);

    // getOAuthToken reicht getValidToken (Session-Storage via deps) durch
    seedValidToken();
    const options = createSpotifyPlayerMock.mock.calls[0][0];
    const tokens: string[] = [];
    options.getOAuthToken((token) => tokens.push(token));
    await flushPromises();
    expect(tokens).toEqual(["at-valid"]);
  });

  it("Double-Create-Guard: zweiter und paralleler Aufruf erzeugen keinen zweiten Player", async () => {
    await createPlayer();
    await createPlayer();
    await Promise.all([createPlayer(), createPlayer()]);

    expect(loadSpotifySdkMock).toHaveBeenCalledTimes(1);
    expect(createSpotifyPlayerMock).toHaveBeenCalledTimes(1);
    expect(handleMock.connect).toHaveBeenCalledTimes(1);
  });
});

describe("createPlayer — getOAuthToken: Rejection-Handler (Security-Audit A10:2025, Finding F8 / 5WNV447-1)", () => {
  /** Holt die an createSpotifyPlayer durchgereichte getOAuthToken-Funktion. */
  function getOAuthTokenFn(): (cb: (token: string) => void) => void {
    expect(createSpotifyPlayerMock).toHaveBeenCalledTimes(1);
    return createSpotifyPlayerMock.mock.calls[0][0].getOAuthToken;
  }

  it("Happy Path: getValidToken resolved → cb(token) mit dem Token-String, kein console.error", async () => {
    await createPlayer();
    seedValidToken();

    const tokens: unknown[] = [];
    getOAuthTokenFn()((token) => tokens.push(token));
    await flushPromises();

    expect(tokens).toEqual(["at-valid"]);
    expect(console.error).not.toHaveBeenCalled();
  });

  it.each([
    {
      label: "Refresh-Endpoint antwortet 500 (non-400 → getValidToken rethrowt)",
      setup: () => {
        // Kein gültiger Access-Token, aber Refresh-Token → getValidToken geht
        // zum Refresh; HTTP 500 verwirft den Refresh-Token NICHT (nur 400),
        // sondern rethrowt (lib/tokens.ts).
        local.setItem(TOKEN_KEYS.refresh, "rt-1");
        fetchMock.mockImplementation(async (input: unknown) => {
          if (String(input) === TOKEN_URL) {
            tokenCalls++;
            return response(500, { error: { message: "Token-Endpunkt kaputt" } });
          }
          throw new Error(`unerwarteter fetch: ${String(input)}`);
        });
      },
    },
    {
      label: "fetch rejects (Netzwerkfehler, kein HTTP-Status)",
      setup: () => {
        local.setItem(TOKEN_KEYS.refresh, "rt-1");
        fetchMock.mockRejectedValue(new TypeError("fetch failed"));
      },
    },
  ])(
    "getValidToken rejects — $label → cb(null) + console.error, KEIN unhandled rejection",
    async ({ setup }) => {
      await createPlayer();
      setup();

      const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const unhandled: unknown[] = [];
      const onUnhandled = (reason: unknown): void => {
        unhandled.push(reason);
      };
      process.on("unhandledRejection", onUnhandled);
      try {
        const tokens: unknown[] = [];
        getOAuthTokenFn()((token) => tokens.push(token));

        // Awaited flush: Microtask-Queue (bis die Rejection durchgereicht ist),
        // dann eine Event-Loop-Runde — eine unbehandelte Rejection feuert
        // spätestens hier als 'unhandledRejection' auf dem Prozess.
        await flushPromises();
        await vi.advanceTimersByTimeAsync(0);

        // Parity web/app.js L329: null durchreichen — das SDK meldet darauf
        // authentication_error (s.o., 3-s-verzögert).
        expect(tokens).toEqual([null]);
        // #10: Fachdetails nur in die Konsole
        expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
        expect(consoleErrorSpy.mock.calls[0].at(-1)).toBeInstanceOf(Error);
        expect(unhandled).toEqual([]);
      } finally {
        process.removeListener("unhandledRejection", onUnhandled);
        consoleErrorSpy.mockRestore();
      }
    },
  );
});

describe("SDK-Event ready", () => {
  it("setzt deviceId, räumt die gequeuete Track-ID inkl. Timer und zieht sie per playTrack nach (#9)", async () => {
    await playTrack("track-1"); // Queue vor SDK-ready (#9)
    seedValidToken();
    scriptPlay([{ status: 200, body: {} }]);
    await createPlayer();

    emit("ready", { device_id: "dev-1" });

    expect(deviceId.value).toBe("dev-1");
    await flushPromises();
    expect(playCalls).toHaveLength(1);
    expect(playCalls[0].url).toBe(`${PLAY_URL}?device_id=dev-1`);
    expect(JSON.parse(playCalls[0].init.body as string)).toEqual({
      uris: ["spotify:track:track-1"],
    });
    expect(drainQueuedTrack()).toBeNull();
    expect(playerMessage.value).toBeNull(); // Replay erfolgreich
  });

  it("löscht playerMessage nur bei AUTH_ERROR_MSG und QUEUE_FAIL_MSG — keine anderen Texte", async () => {
    await createPlayer();

    playerMessage.value = AUTH_ERROR_MSG;
    emit("ready", { device_id: "dev-1" });
    expect(playerMessage.value).toBeNull();

    playerMessage.value = QUEUE_FAIL_MSG;
    emit("ready", { device_id: "dev-1" });
    expect(playerMessage.value).toBeNull();

    // QUEUE_WAIT_MSG (noch keine Verbindung) und Fremdtexte bleiben stehen
    playerMessage.value = QUEUE_WAIT_MSG;
    emit("ready", { device_id: "dev-1" });
    expect(playerMessage.value).toBe(QUEUE_WAIT_MSG);

    playerMessage.value = "Unverwandte Meldung";
    emit("ready", { device_id: "dev-1" });
    expect(playerMessage.value).toBe("Unverwandte Meldung");
  });
});

describe("SDK-State- und Fehler-Events", () => {
  it("player_state_changed → playerState-Signal; trackLoaded folgt automatisch (#7)", async () => {
    await createPlayer();
    expect(trackLoaded.value).toBe(false);

    emit("player_state_changed", SDK_STATE);
    expect(playerState.value).toBe(SDK_STATE);
    expect(trackLoaded.value).toBe(true);

    emit("player_state_changed", SDK_STATE_OTHER);
    expect(playerState.value).toBe(SDK_STATE_OTHER);
    expect(trackLoaded.value).toBe(true);
  });

  it("initialization_error → 'Player-Fehler: …'; playback_error → 'Wiedergabe-Fehler: …'", async () => {
    await createPlayer();

    emit("initialization_error", { message: "SDK kaputt" });
    expect(playerMessage.value).toBe("Player-Fehler: SDK kaputt");

    emit("playback_error", { message: "Decode abgebrochen" });
    expect(playerMessage.value).toBe("Wiedergabe-Fehler: Decode abgebrochen");
  });

  it("authentication_error → AUTH_ERROR_MSG erst nach 3 s; ein späterer Fehler startet die Frist neu", async () => {
    await createPlayer();

    emit("authentication_error", { message: "SDK spurig A" });
    vi.advanceTimersByTime(2_999);
    expect(playerMessage.value).toBeNull();
    vi.advanceTimersByTime(1);
    expect(playerMessage.value).toBe(AUTH_ERROR_MSG);

    // Frist-Neustart: der zweite Fehler (2 s später) muss den ersten
    // nicht-gefeuerten Timer ablösen — kein verfrühter AUTH_ERROR_MSG
    playerMessage.value = null;
    emit("authentication_error", { message: "SDK spurig B" });
    vi.advanceTimersByTime(2_000);
    emit("authentication_error", { message: "SDK spurig C" });
    vi.advanceTimersByTime(2_000); // 4 s nach B, erst 2 s nach C
    expect(playerMessage.value).toBeNull(); // kein verfrühter Fehler von B
    vi.advanceTimersByTime(1_000);
    expect(playerMessage.value).toBe(AUTH_ERROR_MSG);
  });

  it("ready hebt den 3-s-Timer auf — spurige authentication_error bleiben folgenlos (Parity L349–357)", async () => {
    await createPlayer();

    emit("authentication_error", { message: "Spurig" });
    emit("ready", { device_id: "dev-1" });

    vi.advanceTimersByTime(10_000);
    expect(playerMessage.value).toBeNull();
  });

  it("account_error → logout() + setAuthError(LOGIN_PREMIUM_MSG), kein playerMessage (Parity L360–367)", async () => {
    await createPlayer();

    emit("account_error", { message: "Free-Account" });

    expect(logoutMock).toHaveBeenCalledExactlyOnceWith();
    expect(setAuthErrorMock).toHaveBeenCalledExactlyOnceWith(LOGIN_PREMIUM_MSG);
    expect(loginMock).not.toHaveBeenCalled();
    expect(playerMessage.value).toBeNull();
  });

  it("autoplay_failed → getCurrentState nachziehen (falls != null) + AUTOPLAY_HINT_MSG (iOS/Safari, Parity L372–379)", async () => {
    await createPlayer();

    handleMock.getCurrentState.mockResolvedValue(SDK_STATE);
    emit("autoplay_failed");
    await flushPromises();
    expect(playerState.value).toBe(SDK_STATE);
    expect(trackLoaded.value).toBe(true);
    expect(playerMessage.value).toBe(AUTOPLAY_HINT_MSG);

    // state == null: nichts nachziehen, Hinweis trotzdem zeigen
    playerState.value = null;
    handleMock.getCurrentState.mockResolvedValue(null);
    emit("autoplay_failed");
    await flushPromises();
    expect(playerState.value).toBeNull();
    expect(playerMessage.value).toBe(AUTOPLAY_HINT_MSG);
  });

  it("not_ready bleibt bewusst unbehandelt (Parity web/app.js hat keinen Handler)", async () => {
    await createPlayer();
    playerMessage.value = null;

    expect(() => emit("not_ready")).not.toThrow();
    expect(playerState.value).toBeNull();
    expect(playerMessage.value).toBeNull();
    expect(deviceId.value).toBeNull();
  });
});

describe("Logout-Reaktion auf authStatus 'logged-out' (Parity web/app.js L236–262)", () => {
  it("reißt die Player-Session komplett ab: disconnect + Handle weg, Signale geräumt, Queue + beide Timer tot", async () => {
    await playTrack("track-9"); // Queue + 10-s-Timer (#9)
    await createPlayer();
    deviceId.value = "dev-1";
    emit("player_state_changed", SDK_STATE); // Mini-Player sichtbar (#7)
    emit("authentication_error", { message: "SDK spurig" }); // 3-s-Timer

    authStatus.value = "logged-out";

    expect(handleMock.disconnect).toHaveBeenCalledExactlyOnceWith();
    expect(currentPlayerHandle()).toBeNull();
    expect(deviceId.value).toBeNull();
    expect(playerState.value).toBeNull();
    expect(trackLoaded.value).toBe(false); // Mini-Player verschwindet (#7)
    expect(drainQueuedTrack()).toBeNull(); // Queue inkl. Timer weg

    // Weder Queue-Timeout (10 s) noch Auth-Timeout (3 s) dürfen noch feuern
    vi.advanceTimersByTime(20_000);
    expect(playerMessage.value).toBe(QUEUE_WAIT_MSG);
    expect(playerMessage.value).not.toBe(QUEUE_FAIL_MSG);
    expect(playerMessage.value).not.toBe(AUTH_ERROR_MSG);

    // Nach Re-Login erzeugt createPlayer() einen frischen Player
    authStatus.value = "ready";
    await createPlayer();
    expect(createSpotifyPlayerMock).toHaveBeenCalledTimes(2);
    expect(handleMock.connect).toHaveBeenCalledTimes(1);
  });

  it("ohne vorhandenen Player: kein disconnect, kein Fehler", async () => {
    authStatus.value = "logged-out";

    expect(handleMock.disconnect).not.toHaveBeenCalled();
    expect(currentPlayerHandle()).toBeNull();
  });
});

describe("Ready-Reaktion auf authStatus 'ready' (WH3A1BP-2, Parität web/app.js init L618)", () => {
  it("erzeugt den Player automatisch beim Wechsel auf ready — die Verdrahtung fehlte im Smoke-Test", async () => {
    authStatus.value = "ready";

    await vi.waitFor(() => expect(createSpotifyPlayerMock).toHaveBeenCalled());
    expect(loadSpotifySdkMock).toHaveBeenCalled();
    expect(currentPlayerHandle()).not.toBeNull();
    expect(onEventCapture).not.toBeNull();
  });

  it("erzeugt keinen zweiten Player, wenn ready erneut gesetzt wird (Double-Create-Guard)", async () => {
    authStatus.value = "ready";
    await vi.waitFor(() => expect(createSpotifyPlayerMock).toHaveBeenCalledTimes(1));

    authStatus.value = "logged-out"; // Teardown wirft den Handle
    authStatus.value = "ready"; // frischer Login → genau ein neuer Player
    await vi.waitFor(() => expect(createSpotifyPlayerMock).toHaveBeenCalledTimes(2));
    expect(createSpotifyPlayerMock).toHaveBeenCalledTimes(2);
  });
});
