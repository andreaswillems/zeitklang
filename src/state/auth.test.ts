import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import { AUTH_SCOPES, SPOTIFY_CLIENT_ID } from "../lib/config.ts";
import {
  LOGIN_DENIED_MSG,
  LOGIN_GENERIC_MSG,
  LOGIN_STATE_MSG,
  LOGOUT_HINT_MSG,
  MISSING_SCOPE_MSG,
} from "../lib/errors.ts";
import { base64url, type RandomBytes } from "../lib/pkce.ts";
import { KEYS as REDIRECT_KEYS } from "../lib/redirect.ts";
import { InMemoryStorage } from "../lib/storage.ts";
import { KEYS as TOKEN_KEYS } from "../lib/tokens.ts";
import {
  authError,
  authStatus,
  initAuth,
  initPersistLogin,
  login,
  logout,
  logoutHint,
  PERSIST_LOGIN_KEY,
  persistLogin,
  redirecting,
  refreshStorage,
  resetForTests,
  resetRedirecting,
  SCOPE_CHECK_GUARD_KEY,
  setPersistLogin,
} from "./auth.ts";

const { pkceChallengeMock, randomStringMock } = vi.hoisted(() => ({
  pkceChallengeMock: vi.fn<(verifier: string) => Promise<string>>(),
  randomStringMock: vi.fn<(length: number, randomBytes: RandomBytes) => string>(),
}));

vi.mock("../lib/pkce.ts", async (importOriginal) => ({
  // base64url bleibt echt (JWT-Crafting in den 71TAZ1B-3-Tests), nur die
  // kryptografischen Funktionen werden gemockt.
  ...(await importOriginal<typeof import("../lib/pkce.ts")>()),
  pkceChallenge: pkceChallengeMock,
  randomString: randomStringMock,
}));

const VERIFIER = "v".repeat(64);
const STATE = "s".repeat(16);
const INITIAL_URL = "https://127.0.0.1:8080/";
const TOKEN_URL = "https://accounts.spotify.com/api/token";
const NOW = 1_000_000;

// Craft-JWTs wie in lib/token-scopes.test.ts (base64url aus dem echten pkce-Modul)
const JWT_HEADER = base64url(new TextEncoder().encode('{"alg":"RS256","typ":"JWT"}'));
const JWT_SIGNATURE = base64url(new TextEncoder().encode("test-signature"));
const jwtWithScp = (scp: string): string =>
  `${JWT_HEADER}.${base64url(new TextEncoder().encode(JSON.stringify({ scp })))}.${JWT_SIGNATURE}`;
/** Access-Token mit ALLEN AUTH_SCOPES — „gesunde“ Anmeldung für ready-Tests. */
const FULL_SCOPES_JWT = jwtWithScp(AUTH_SCOPES);

let local: InMemoryStorage;
let session: InMemoryStorage;
let locationStub: { hostname: string; href: string; pathname: string; search: string };
let fetchMock: Mock<typeof fetch>;
let replaceStateMock: Mock;

beforeEach(() => {
  local = new InMemoryStorage();
  session = new InMemoryStorage();
  locationStub = {
    hostname: "127.0.0.1",
    href: INITIAL_URL,
    pathname: "/",
    search: "",
  };
  fetchMock = vi.fn<typeof fetch>();
  replaceStateMock = vi.fn();
  vi.stubGlobal("localStorage", local);
  vi.stubGlobal("sessionStorage", session);
  vi.stubGlobal("location", locationStub);
  vi.stubGlobal("fetch", fetchMock);
  vi.stubGlobal("history", { replaceState: replaceStateMock });
  vi.spyOn(Date, "now").mockReturnValue(NOW);
  vi.spyOn(console, "error").mockImplementation(() => {});
  randomStringMock.mockReset();
  randomStringMock.mockImplementation((length) => (length === 64 ? VERIFIER : STATE));
  pkceChallengeMock.mockReset();
  pkceChallengeMock.mockResolvedValue("challenge-123");
  resetForTests();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function tokenEndpointResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

describe("login", () => {
  it("baut die vollständige Authorize-URL und speichert Verifier + State in der Session", async () => {
    expect(authStatus.value).toBe("loading");
    expect(authError.value).toBeNull();
    expect(redirecting.value).toBe(false);

    await login();

    expect(randomStringMock.mock.calls).toEqual([
      [64, expect.any(Function)],
      [16, expect.any(Function)],
    ]);
    expect(pkceChallengeMock).toHaveBeenCalledExactlyOnceWith(VERIFIER);
    expect(session.getItem(REDIRECT_KEYS.verifier)).toBe(VERIFIER);
    expect(session.getItem(REDIRECT_KEYS.state)).toBe(STATE);
    expect(redirecting.value).toBe(true);

    const url = new URL(locationStub.href);
    expect(`${url.origin}${url.pathname}`).toBe("https://accounts.spotify.com/authorize");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      client_id: SPOTIFY_CLIENT_ID,
      response_type: "code",
      redirect_uri: "https://127.0.0.1:8080/callback",
      scope: AUTH_SCOPES,
      code_challenge_method: "S256",
      code_challenge: "challenge-123",
      state: STATE,
    });
  });

  it.each([
    { label: "Argument forceConsent", argument: true, storedFlag: null },
    { label: "gespeichertes Force-Consent-Flag", argument: false, storedFlag: "1" },
  ])("setzt show_dialog=true bei $label", async ({ argument, storedFlag }) => {
    if (storedFlag) local.setItem(REDIRECT_KEYS.forceConsent, storedFlag);

    await login(argument);

    expect(new URL(locationStub.href).searchParams.get("show_dialog")).toBe("true");
  });

  it("blockiert Doppeltaps schon während der PKCE-Challenge; resetRedirecting gibt Login wieder frei", async () => {
    let finishChallenge!: (challenge: string) => void;
    pkceChallengeMock.mockImplementation(
      () =>
        new Promise<string>((resolve) => {
          finishChallenge = resolve;
        }),
    );

    const first = login();
    const second = login();

    expect(redirecting.value).toBe(true);
    expect(randomStringMock).toHaveBeenCalledTimes(2);
    expect(pkceChallengeMock).toHaveBeenCalledTimes(1);
    expect(locationStub.href).toBe(INITIAL_URL);

    finishChallenge("slow-challenge");
    await Promise.all([first, second]);
    expect(pkceChallengeMock).toHaveBeenCalledTimes(1);
    expect(new URL(locationStub.href).searchParams.get("code_challenge")).toBe(
      "slow-challenge",
    );

    resetRedirecting();
    expect(redirecting.value).toBe(false);
    pkceChallengeMock.mockResolvedValue("after-reset");
    await login();
    expect(pkceChallengeMock).toHaveBeenCalledTimes(2);
  });
});

describe("logout", () => {
  it("verwirft beide Token-Speicher, erzwingt Consent und setzt die Auth-Signals zurück", () => {
    session.setItem(TOKEN_KEYS.access, "access-token");
    session.setItem(TOKEN_KEYS.expiresAt, "12345");
    local.setItem(TOKEN_KEYS.refresh, "refresh-token");
    authStatus.value = "ready";
    authError.value = "alter Fehler";

    logout();

    expect(session.getItem(TOKEN_KEYS.access)).toBeNull();
    expect(session.getItem(TOKEN_KEYS.expiresAt)).toBeNull();
    expect(local.getItem(TOKEN_KEYS.refresh)).toBeNull();
    expect(local.getItem(REDIRECT_KEYS.forceConsent)).toBe("1");
    expect(authStatus.value).toBe("logged-out");
    expect(authError.value).toBeNull();
  });

  it("löscht den Refresh-Token aus dem AKTIVEN Speicher (YWEC4VR-2): persistLogin=false → sessionStorage, localStorage bleibt leer", () => {
    setPersistLogin(false); // schreibt Key "0"; Migration no-op (noch kein Token)
    session.setItem(TOKEN_KEYS.access, "access-token");
    session.setItem(TOKEN_KEYS.expiresAt, "12345");
    session.setItem(TOKEN_KEYS.refresh, "rt-session");
    authStatus.value = "ready";

    logout();

    expect(session.getItem(TOKEN_KEYS.refresh)).toBeNull();
    expect(local.getItem(TOKEN_KEYS.refresh)).toBeNull(); // war nie in local
    expect(session.getItem(TOKEN_KEYS.access)).toBeNull();
    expect(session.getItem(TOKEN_KEYS.expiresAt)).toBeNull();
    expect(local.getItem(REDIRECT_KEYS.forceConsent)).toBe("1");
    expect(authStatus.value).toBe("logged-out");
  });

  it("entfernt zusätzlich KEYS.scopes aus der Session (BSF4QZM-2: Stale-Scopes überdauern keine Session)", () => {
    session.setItem(TOKEN_KEYS.access, "access-token");
    session.setItem(TOKEN_KEYS.expiresAt, "12345");
    session.setItem(TOKEN_KEYS.scopes, AUTH_SCOPES);
    local.setItem(TOKEN_KEYS.refresh, "refresh-token");

    logout();

    expect(session.getItem(TOKEN_KEYS.scopes)).toBeNull();
    expect(session.getItem(TOKEN_KEYS.access)).toBeNull();
    expect(local.getItem(TOKEN_KEYS.refresh)).toBeNull();
  });

  it("setzt zusätzlich logoutHint auf LOGOUT_HINT_MSG (SA8H08W-1: lokaler Logout reicht nicht, Widerruf unter spotify.com/account/apps)", () => {
    logout();

    expect(authStatus.value).toBe("logged-out");
    expect(logoutHint.value).toBe(LOGOUT_HINT_MSG);
  });

  it("login() und erfolgreiches initAuth löschen den Logout-Hinweis wieder (SA8H08W-1)", async () => {
    logout();
    expect(logoutHint.value).toBe(LOGOUT_HINT_MSG);

    await login();
    expect(logoutHint.value).toBeNull();

    logout();
    expect(logoutHint.value).toBe(LOGOUT_HINT_MSG);
    session.setItem(TOKEN_KEYS.access, FULL_SCOPES_JWT); // 71TAZ1B-3: volle Scopes
    session.setItem(TOKEN_KEYS.expiresAt, String(NOW + 1));
    await initAuth();
    expect(authStatus.value).toBe("ready");
    expect(logoutHint.value).toBeNull();
  });

  it("resetForTests() setzt logoutHint zurück (SA8H08W-1)", () => {
    logout();
    expect(logoutHint.value).toBe(LOGOUT_HINT_MSG);

    resetForTests();

    expect(logoutHint.value).toBeNull();
  });
});

describe("persistLogin — Signal + localStorage-Key zeitklang_persist_login (YWEC4VR-2)", () => {
  it("Default: persistLogin=true (1 = angemeldet bleiben); der Key liegt erst nach setPersistLogin in localStorage", () => {
    expect(persistLogin.value).toBe(true);
    expect(local.getItem(PERSIST_LOGIN_KEY)).toBeNull();
  });

  it("initPersistLogin() liest den Key aus localStorage ins Signal: '0' → false, '1' → true, fehlender Key → Default true", () => {
    local.setItem(PERSIST_LOGIN_KEY, "0");
    initPersistLogin();
    expect(persistLogin.value).toBe(false);

    local.setItem(PERSIST_LOGIN_KEY, "1");
    initPersistLogin();
    expect(persistLogin.value).toBe(true);

    local.removeItem(PERSIST_LOGIN_KEY);
    persistLogin.value = false;
    initPersistLogin();
    expect(persistLogin.value).toBe(true);
  });

  it("setPersistLogin(false) schreibt '0' UND migriert einen vorhandenen Refresh-Token local→session (moveRefreshToken) — local bleibt ohne Token", () => {
    local.setItem(TOKEN_KEYS.refresh, "rt-local");

    setPersistLogin(false);

    expect(local.getItem(PERSIST_LOGIN_KEY)).toBe("0");
    expect(persistLogin.value).toBe(false);
    expect(session.getItem(TOKEN_KEYS.refresh)).toBe("rt-local");
    expect(local.getItem(TOKEN_KEYS.refresh)).toBeNull();
  });

  it("setPersistLogin(true) schreibt '1' UND migriert den Refresh-Token session→local", () => {
    session.setItem(TOKEN_KEYS.refresh, "rt-session");

    setPersistLogin(true);

    expect(local.getItem(PERSIST_LOGIN_KEY)).toBe("1");
    expect(persistLogin.value).toBe(true);
    expect(local.getItem(TOKEN_KEYS.refresh)).toBe("rt-session");
    expect(session.getItem(TOKEN_KEYS.refresh)).toBeNull();
  });

  it("setPersistLogin ohne vorhandenen Refresh-Token: Key wird geschrieben, Migration ist no-op", () => {
    setPersistLogin(false);

    expect(local.getItem(PERSIST_LOGIN_KEY)).toBe("0");
    expect(persistLogin.value).toBe(false);
    expect(session.getItem(TOKEN_KEYS.refresh)).toBeNull();
    expect(local.getItem(TOKEN_KEYS.refresh)).toBeNull();
  });

  it("refreshStorage() = persistLogin ? deps.local : deps.session", () => {
    local.setItem(TOKEN_KEYS.refresh, "rt-local");
    session.setItem(TOKEN_KEYS.refresh, "rt-session");

    persistLogin.value = true;
    expect(refreshStorage().getItem(TOKEN_KEYS.refresh)).toBe("rt-local");

    persistLogin.value = false;
    expect(refreshStorage().getItem(TOKEN_KEYS.refresh)).toBe("rt-session");
  });

  it("resetForTests() setzt persistLogin auf den Default true zurück", () => {
    setPersistLogin(false);
    expect(persistLogin.value).toBe(false);

    resetForTests();

    expect(persistLogin.value).toBe(true);
  });
});

describe("initAuth", () => {
  it("nutzt ein gültiges Access-Token ohne fetch und wird ready", async () => {
    // 71TAZ1B-3: nur ein Token mit ALLEN AUTH_SCOPES ist „ready“ — sonst
    // greift der proaktive Scope-Check (siehe eigenes describe unten).
    session.setItem(TOKEN_KEYS.access, FULL_SCOPES_JWT);
    session.setItem(TOKEN_KEYS.expiresAt, String(NOW + 1));

    await initAuth();

    expect(authStatus.value).toBe("ready");
    expect(authError.value).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refresht ein abgelaufenes Access-Token über den Token-Endpunkt und wird ready", async () => {
    session.setItem(TOKEN_KEYS.access, "expired-access");
    session.setItem(TOKEN_KEYS.expiresAt, String(NOW));
    local.setItem(TOKEN_KEYS.refresh, "old-refresh");
    fetchMock.mockResolvedValue(
      tokenEndpointResponse(200, {
        access_token: FULL_SCOPES_JWT, // 71TAZ1B-3: voller Scope-Satz → ready
        expires_in: 3600,
        refresh_token: "new-refresh",
      }),
    );

    await initAuth();

    expect(authStatus.value).toBe("ready");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(TOKEN_URL);
    expect(init?.method).toBe("POST");
    expect(Object.fromEntries(new URLSearchParams(init?.body as string))).toEqual({
      grant_type: "refresh_token",
      refresh_token: "old-refresh",
      client_id: SPOTIFY_CLIENT_ID,
    });
    expect(session.getItem(TOKEN_KEYS.access)).toBe(FULL_SCOPES_JWT);
    expect(session.getItem(TOKEN_KEYS.expiresAt)).toBe(String(NOW + (3600 - 30) * 1000));
  });

  it("nutzt refreshStorage() als Refresh-Dep (YWEC4VR-2): persistLogin=false → Refresh-Token aus der Session, neuer Token landet in der Session, local bleibt leer", async () => {
    persistLogin.value = false; // direkt am Signal — keine Migration
    session.setItem(TOKEN_KEYS.access, "expired-access");
    session.setItem(TOKEN_KEYS.expiresAt, String(NOW));
    session.setItem(TOKEN_KEYS.refresh, "rt-session");
    fetchMock.mockResolvedValue(
      tokenEndpointResponse(200, {
        access_token: FULL_SCOPES_JWT, // 71TAZ1B-3: voller Scope-Satz → ready
        expires_in: 3600,
        refresh_token: "new-refresh",
      }),
    );

    await initAuth();

    expect(authStatus.value).toBe("ready");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(TOKEN_URL);
    expect(Object.fromEntries(new URLSearchParams(init?.body as string))).toEqual({
      grant_type: "refresh_token",
      refresh_token: "rt-session",
      client_id: SPOTIFY_CLIENT_ID,
    });
    expect(session.getItem(TOKEN_KEYS.access)).toBe(FULL_SCOPES_JWT);
    expect(session.getItem(TOKEN_KEYS.refresh)).toBe("new-refresh");
    expect(local.getItem(TOKEN_KEYS.refresh)).toBeNull();
  });

  it("verwirft den Refresh-Token bei HTTP 400 und zeigt den generischen Login-Fehler", async () => {
    session.setItem(TOKEN_KEYS.access, "expired-access");
    session.setItem(TOKEN_KEYS.expiresAt, String(NOW - 1));
    local.setItem(TOKEN_KEYS.refresh, "invalid-refresh");
    fetchMock.mockResolvedValue(tokenEndpointResponse(400, { error: "invalid_grant" }));

    await initAuth();

    expect(local.getItem(TOKEN_KEYS.refresh)).toBeNull();
    expect(authError.value).toBe(LOGIN_GENERIC_MSG);
    expect(authStatus.value).toBe("logged-out");
    expect(console.error).toHaveBeenCalledWith(
      "Login fehlgeschlagen:",
      expect.objectContaining({ status: 400 }),
    );
  });

  it("ist ohne Tokens logged-out; ein Redirect ohne code/error bleibt ohne fetch und replaceState ein no-op", async () => {
    locationStub.pathname = "/callback";
    locationStub.search = "?foo=bar";

    await initAuth();

    expect(authStatus.value).toBe("logged-out");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(replaceStateMock).not.toHaveBeenCalled();
  });

  it("tauscht einen Redirect-Code mit passendem State gegen Tokens und wird ready", async () => {
    session.setItem(REDIRECT_KEYS.state, STATE);
    session.setItem(REDIRECT_KEYS.verifier, VERIFIER);
    locationStub.pathname = "/callback";
    locationStub.search = `?code=auth-code&state=${STATE}`;
    fetchMock.mockResolvedValue(
      tokenEndpointResponse(200, {
        access_token: FULL_SCOPES_JWT, // 71TAZ1B-3: voller Scope-Satz → ready
        expires_in: 3600,
        refresh_token: "refresh-from-code",
      }),
    );

    await initAuth();

    expect(replaceStateMock).toHaveBeenCalledExactlyOnceWith(null, "", "/callback");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(TOKEN_URL);
    expect(Object.fromEntries(new URLSearchParams(init?.body as string))).toEqual({
      grant_type: "authorization_code",
      code: "auth-code",
      redirect_uri: "https://127.0.0.1:8080/callback",
      client_id: SPOTIFY_CLIENT_ID,
      code_verifier: VERIFIER,
    });
    expect(session.getItem(TOKEN_KEYS.access)).toBe(FULL_SCOPES_JWT);
    expect(authStatus.value).toBe("ready");
  });

  it.each([
    {
      label: "access_denied",
      search: "?error=access_denied",
      message: LOGIN_DENIED_MSG,
    },
    {
      label: "State-Mismatch",
      search: "?code=auth-code&state=wrong-state",
      message: LOGIN_STATE_MSG,
    },
  ])(
    "zeigt bei $label die gezielte Fehlermeldung und bleibt logged-out",
    async ({ search, message }) => {
      session.setItem(REDIRECT_KEYS.state, STATE);
      session.setItem(REDIRECT_KEYS.verifier, VERIFIER);
      locationStub.pathname = "/callback";
      locationStub.search = search;

      await initAuth();

      expect(authError.value).toBe(message);
      expect(authStatus.value).toBe("logged-out");
      expect(fetchMock).not.toHaveBeenCalled();
      expect(replaceStateMock).toHaveBeenCalledExactlyOnceWith(null, "", "/callback");
    },
  );
});

describe("initAuth — proaktiver Scope-Check nach Login (71TAZ1B-3)", () => {
  it("Token mit Scope-Subset (user-modify-playback-state fehlt) → authError = MISSING_SCOPE_MSG, authStatus 'logged-out', KEIN Redirect; sessionStorage-Guard + forceConsent gesetzt; erneutes initAuth redirectet ebenfalls nicht (kein Loop)", async () => {
    session.setItem(
      TOKEN_KEYS.access,
      jwtWithScp("streaming user-read-playback-state user-read-private"),
    );
    session.setItem(TOKEN_KEYS.expiresAt, String(NOW + 3_600_000));

    await initAuth();

    expect(authStatus.value).toBe("logged-out");
    expect(authError.value).toBe(MISSING_SCOPE_MSG);
    expect(locationStub.href).toBe(INITIAL_URL); // kein navigate() — kein automatischer Re-Consent
    expect(session.getItem(SCOPE_CHECK_GUARD_KEY)).toBe("1");
    // nächster manueller Login läuft mit show_dialog (Consent-Dialog sicher zeigen)
    expect(local.getItem(REDIRECT_KEYS.forceConsent)).toBe("1");
    // #10: Fachdetails (fehlende Scopes) nur in der Konsole
    expect(console.error).toHaveBeenCalledWith(
      "Anmeldung ohne alle erforderlichen Scopes — fehlt:",
      ["user-modify-playback-state"],
    );

    // Kein Loop: zweites initAuth (z. B. bfcache-Rückkehr) — weiterhin kein Redirect
    await initAuth();
    expect(locationStub.href).toBe(INITIAL_URL);
    expect(authStatus.value).toBe("logged-out");
    expect(authError.value).toBe(MISSING_SCOPE_MSG);
  });

  it("Token mit allen AUTH_SCOPES → ready, authError null, Guard NICHT gesetzt, kein fetch", async () => {
    session.setItem(TOKEN_KEYS.access, FULL_SCOPES_JWT);
    session.setItem(TOKEN_KEYS.expiresAt, String(NOW + 3_600_000));

    await initAuth();

    expect(authStatus.value).toBe("ready");
    expect(authError.value).toBeNull();
    expect(session.getItem(SCOPE_CHECK_GUARD_KEY)).toBeNull();
    expect(local.getItem(REDIRECT_KEYS.forceConsent)).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("Refresh-Pfad: abgelaufenes Access-Token, neuer Token per Refresh nur mit Scope-Subset → authError = MISSING_SCOPE_MSG (der Check greift auch nach dem Refresh)", async () => {
    session.setItem(TOKEN_KEYS.access, "expired-access");
    session.setItem(TOKEN_KEYS.expiresAt, String(NOW));
    local.setItem(TOKEN_KEYS.refresh, "old-refresh");
    fetchMock.mockResolvedValue(
      tokenEndpointResponse(200, {
        access_token: jwtWithScp("streaming user-read-private"),
        expires_in: 3600,
        refresh_token: "new-refresh",
      }),
    );

    await initAuth();

    expect(authStatus.value).toBe("logged-out");
    expect(authError.value).toBe(MISSING_SCOPE_MSG);
    expect(locationStub.href).toBe(INITIAL_URL); // kein Redirect/Loop
    expect(session.getItem(SCOPE_CHECK_GUARD_KEY)).toBe("1");
  });
});

describe("initAuth — Scope-Check auf persistierte Scopes (BSF4QZM-2: scope-Feld primär, JWT-Fallback, unbekannt = keine Aussage)", () => {
  // Opaker Access-Token wie in Prod (kein JWT, 1 Segment, z. B. „BQB…“)
  const OPAQUE_TOKEN = "BQB1opaker-access-token-ohne-jwt-segmente";

  /** Opaken Access-Token seeden; optional das persistierte scope-Feld (KEYS.scopes). */
  function seedOpaqueAccess(scopeField?: string): void {
    session.setItem(TOKEN_KEYS.access, OPAQUE_TOKEN);
    session.setItem(TOKEN_KEYS.expiresAt, String(NOW + 3_600_000));
    if (scopeField !== undefined) session.setItem(TOKEN_KEYS.scopes, scopeField);
  }

  it("(a) opaker Token + persistierte Scopes vollständig → ready, KEIN authError, kein Guard/forceConsent, kein fetch", async () => {
    seedOpaqueAccess(AUTH_SCOPES);

    await initAuth();

    expect(authStatus.value).toBe("ready");
    expect(authError.value).toBeNull();
    expect(session.getItem(SCOPE_CHECK_GUARD_KEY)).toBeNull();
    expect(local.getItem(REDIRECT_KEYS.forceConsent)).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("(b) opaker Token + KEYS.scopes fehlt (Alt-Session von vor BSF4QZM — der Prod-Repro-Fall) → ready, KEIN authError/Guard/forceConsent; Konsole: tokenShape-Hinweis (Quelle „unbekannt“), NIEMALS Token-Werte (#10 + check:secrets)", async () => {
    seedOpaqueAccess(); // kein scope-Feld persistiert

    await initAuth();

    expect(authStatus.value).toBe("ready");
    expect(authError.value).toBeNull();
    expect(session.getItem(SCOPE_CHECK_GUARD_KEY)).toBeNull();
    expect(local.getItem(REDIRECT_KEYS.forceConsent)).toBeNull();
    expect(console.error).toHaveBeenCalledWith(
      "Gewährte Scopes unbekannt (Quelle: unbekannt) — Token-Form:",
      { segments: 1, payloadKeys: [] },
    );
    // #10 + check:secrets: der Token-String taucht nirgends in der Konsole auf
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain(
      OPAQUE_TOKEN,
    );
  });

  it("(c) persistierte Scopes als Teilmenge (user-modify-playback-state fehlt) → MISSING_SCOPE_MSG + Guard + forceConsent, kein Redirect (unverändertes 71TAZ1B-3-Verhalten)", async () => {
    seedOpaqueAccess("streaming user-read-playback-state user-read-private");

    await initAuth();

    expect(authStatus.value).toBe("logged-out");
    expect(authError.value).toBe(MISSING_SCOPE_MSG);
    expect(locationStub.href).toBe(INITIAL_URL); // kein navigate() — kein Auto-Redirect
    expect(session.getItem(SCOPE_CHECK_GUARD_KEY)).toBe("1");
    expect(local.getItem(REDIRECT_KEYS.forceConsent)).toBe("1");
    // #10: Fachdetails (fehlende Scopes) nur in der Konsole
    expect(console.error).toHaveBeenCalledWith(
      "Anmeldung ohne alle erforderlichen Scopes — fehlt:",
      ["user-modify-playback-state"],
    );
  });

  it("(d) JWT-Fallback greift NUR ohne persistiertes scope-Feld: scope-Feld vollständig + JWT mit Subset → ready (das Feld gewinnt)", async () => {
    session.setItem(TOKEN_KEYS.access, jwtWithScp("streaming")); // JWT-Subset
    session.setItem(TOKEN_KEYS.expiresAt, String(NOW + 3_600_000));
    session.setItem(TOKEN_KEYS.scopes, AUTH_SCOPES); // persistiertes Feld vollständig

    await initAuth();

    expect(authStatus.value).toBe("ready");
    expect(authError.value).toBeNull();
    expect(session.getItem(SCOPE_CHECK_GUARD_KEY)).toBeNull();
  });
});
