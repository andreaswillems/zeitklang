import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InMemoryStorage, type Storage } from "./storage.ts";
import {
  getValidToken,
  KEYS,
  moveRefreshToken,
  requestToken,
  TOKEN_TIMEOUT_MS,
} from "./tokens.ts";

// Unit-Tests für lib/tokens.ts (Spec §3.3/§3.5, Parity zu web/app.js
// requestToken/getValidToken). Reines Modul (Plan §5.1): keine DOM/fetch-
// Globals — alle Deps werden injiziert. Erwarteter Kontrakt für tokens.ts:
//
//   interface TokenDeps {
//     fetch: typeof fetch;
//     session: Storage;        // Access-Token + expires_at (flüchtig)
//     refresh: () => Storage;  // Refresh-Token — Funktion, damit ein
//                              // Laufzeit-Wechsel der Einstellung sofort greift
//     now: () => number;       // ms seit Epoch
//     tokenUrl: string;
//     clientId: string;
//   }
//   requestToken(body: Record<string, string>, deps: TokenDeps): Promise<void>
//   getValidToken(deps: TokenDeps): Promise<string | null>
//   moveRefreshToken(from: Storage, to: Storage): void

const TOKEN_URL = "https://accounts.spotify.com/api/token";
const CLIENT_ID = "test-client-id";

// Storage-Keys — Parity zu web/app.js KEYS
const ACCESS = "zeitklang_access";
const EXPIRES_AT = "zeitklang_expires_at";
const REFRESH = "zeitklang_refresh";

type FetchResult = { ok: boolean; status: number; body?: unknown };
type FetchCall = { url: string; init: RequestInit };

// Deps-Fabrik: InMemory-Storage + gemocktes fetch (zeichnet Calls auf) +
// manuelle Uhr (Default t = 1_000_000 ms)
function makeDeps(handler: (url: string, init: RequestInit) => FetchResult) {
  const session = new InMemoryStorage();
  const local = new InMemoryStorage();
  const calls: FetchCall[] = [];
  let t = 1_000_000;
  const fetchMock = (async (url: unknown, init?: RequestInit) => {
    const u = String(url);
    const i = init ?? {};
    calls.push({ url: u, init: i });
    const r = handler(u, i);
    return { ok: r.ok, status: r.status, json: async () => r.body } as Response;
  }) as unknown as typeof fetch;
  const deps = {
    fetch: fetchMock,
    session,
    refresh: () => local,
    now: () => t,
    tokenUrl: TOKEN_URL,
    clientId: CLIENT_ID,
  };
  return {
    deps,
    session,
    local,
    calls,
    setNow: (v: number) => {
      t = v;
    },
  };
}

const okTokens = (body: Record<string, unknown>): FetchResult => ({
  ok: true,
  status: 200,
  body,
});

describe("requestToken", () => {
  it("POST an tokenUrl mit Content-Type application/x-www-form-urlencoded und Body als URLSearchParams", async () => {
    const { deps, calls } = makeDeps(() =>
      okTokens({ access_token: "at", expires_in: 3600 }),
    );
    const body = {
      grant_type: "authorization_code",
      code: "auth-code-123",
      redirect_uri: "https://127.0.0.1:8080/callback",
      client_id: CLIENT_ID,
      code_verifier: "verifier-abc",
    };
    await requestToken(body, deps);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(TOKEN_URL);
    expect(calls[0].init.method).toBe("POST");
    expect(calls[0].init.headers).toEqual({
      "Content-Type": "application/x-www-form-urlencoded",
    });
    expect(calls[0].init.body).toBe(new URLSearchParams(body).toString());
  });

  it("ok: speichert access_token + expires_at (30 s Puffer, Parity web/app.js) im Session-Storage, refresh_token im Local-Storage", async () => {
    const { deps, session, local } = makeDeps(() =>
      okTokens({ access_token: "at-1", expires_in: 3600, refresh_token: "rt-1" }),
    );
    await requestToken({ grant_type: "authorization_code" }, deps);
    expect(session.getItem(ACCESS)).toBe("at-1");
    // expires_at = now + (expires_in - 30) * 1000 — 30 s Puffer vor Ablauf
    expect(session.getItem(EXPIRES_AT)).toBe(String(1_000_000 + (3600 - 30) * 1000));
    expect(local.getItem(REFRESH)).toBe("rt-1");
  });

  it("ok ohne refresh_token in der Antwort: Local-Storage bleibt leer (kein Überschreiben)", async () => {
    const { deps, session, local } = makeDeps(() =>
      okTokens({ access_token: "at-2", expires_in: 3600 }),
    );
    await requestToken({ grant_type: "refresh_token" }, deps);
    expect(session.getItem(ACCESS)).toBe("at-2");
    expect(local.getItem(REFRESH)).toBeNull();
  });

  it("!ok: wirft Error mit .status und speichert nichts", async () => {
    const { deps, session, local, calls } = makeDeps(() => ({
      ok: false,
      status: 400,
      body: { error: "invalid_grant" },
    }));
    const err = await requestToken({ grant_type: "authorization_code" }, deps).catch(
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(Error);
    expect((err as Error & { status: number }).status).toBe(400);
    expect(calls).toHaveLength(1);
    expect(session.getItem(ACCESS)).toBeNull();
    expect(session.getItem(EXPIRES_AT)).toBeNull();
    expect(local.getItem(REFRESH)).toBeNull();
  });
});

// BSF4QZM-1: scope-Feld der Token-Antwort persistieren — Exchange UND Refresh
// laufen beide über requestToken; fehlt scope in der Antwort, wird ein
// Stale-Wert aus früherer Session per removeItem entfernt (kein Stale-Wert).
describe("requestToken — scope-Feld der Token-Antwort (BSF4QZM-1)", () => {
  it("KEYS.scopes ist der additive Storage-Key zeitklang_scopes", () => {
    expect(KEYS.scopes).toBe("zeitklang_scopes");
  });

  it("Exchange-Grant: roher scope-String (Leerzeichen-getrennt, Parity zum Antwortfeld) landet in deps.session", async () => {
    const scope =
      "streaming user-modify-playback-state user-read-playback-state user-read-private";
    const { deps, session } = makeDeps(() =>
      okTokens({
        access_token: "at-1",
        expires_in: 3600,
        refresh_token: "rt-1",
        scope,
      }),
    );
    await requestToken({ grant_type: "authorization_code" }, deps);
    expect(session.getItem(KEYS.scopes)).toBe(scope);
  });

  it("Refresh-Grant: scope wird ebenfalls persistiert (beide Grants laufen über requestToken)", async () => {
    const { deps, session, local } = makeDeps(() =>
      okTokens({
        access_token: "at-new",
        expires_in: 3600,
        scope: "streaming user-read-private",
      }),
    );
    local.setItem(REFRESH, "rt-old");
    await requestToken(
      {
        grant_type: "refresh_token",
        refresh_token: "rt-old",
        client_id: CLIENT_ID,
      },
      deps,
    );
    expect(session.getItem(KEYS.scopes)).toBe("streaming user-read-private");
  });

  it("fehlt scope in der Antwort → Stale-Wert aus früherer Session wird per removeItem entfernt", async () => {
    const { deps, session } = makeDeps(() =>
      okTokens({ access_token: "at-2", expires_in: 3600 }),
    );
    session.setItem(KEYS.scopes, "stale-a stale-b");
    await requestToken({ grant_type: "refresh_token" }, deps);
    expect(session.getItem(KEYS.scopes)).toBeNull();
  });
});

describe("getValidToken", () => {
  it("gültiges Access-Token (now < expires_at) → Rückgabe ohne fetch", async () => {
    const { deps, session, calls } = makeDeps(() => okTokens({}));
    session.setItem(ACCESS, "at-valid");
    session.setItem(EXPIRES_AT, String(1_000_000 + 10_000));
    await expect(getValidToken(deps)).resolves.toBe("at-valid");
    expect(calls).toHaveLength(0);
  });

  it("abgelaufen (now >= expires_at) + Refresh-Token → Refresh-Grant, danach neues Access-Token aus dem Session-Storage", async () => {
    const { deps, session, local, calls } = makeDeps(() =>
      okTokens({ access_token: "at-new", expires_in: 3600 }),
    );
    session.setItem(ACCESS, "at-old");
    // now === expires_at gilt als abgelaufen (gültig nur bei now < expires_at)
    session.setItem(EXPIRES_AT, String(1_000_000));
    local.setItem(REFRESH, "rt-old");
    await expect(getValidToken(deps)).resolves.toBe("at-new");
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(TOKEN_URL);
    expect(calls[0].init.method).toBe("POST");
    const sent = new URLSearchParams(calls[0].init.body as string);
    expect(sent.get("grant_type")).toBe("refresh_token");
    expect(sent.get("refresh_token")).toBe("rt-old");
    expect(sent.get("client_id")).toBe(CLIENT_ID);
    expect(session.getItem(ACCESS)).toBe("at-new");
  });

  it("HTTP 400 beim Refresh → Refresh-Token wird verworfen und der Fehler durchgereicht (Spec §3.5)", async () => {
    const { deps, session, local } = makeDeps(() => ({
      ok: false,
      status: 400,
      body: { error: "invalid_grant" },
    }));
    session.setItem(ACCESS, "at-old");
    session.setItem(EXPIRES_AT, String(1_000_000 - 1));
    local.setItem(REFRESH, "rt-old");
    const err = await getValidToken(deps).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error & { status: number }).status).toBe(400);
    expect(local.getItem(REFRESH)).toBeNull();
  });

  it("abgelaufen ohne Refresh-Token → null, kein fetch", async () => {
    const { deps, session, calls } = makeDeps(() => okTokens({}));
    session.setItem(ACCESS, "at-old");
    session.setItem(EXPIRES_AT, String(1_000_000 - 1));
    await expect(getValidToken(deps)).resolves.toBeNull();
    expect(calls).toHaveLength(0);
  });
});

// deps.refresh ist eine FUNKTION (kein Storage): requestToken/getValidToken
// werten sie bei JEDEM Zugriff neu aus, damit ein Laufzeit-Wechsel der
// Speicher-Einstellung sofort greift (Schreiben, Lesen UND Löschen).
describe("deps.refresh() — Funktion statt Storage (Laufzeit-Wechsel greift sofort)", () => {
  it("wertet refresh() bei jedem Zugriff neu aus: Schreiben in a, nach Wechsel Lesen/Löschen in b — a bleibt unberührt", async () => {
    const a = new InMemoryStorage();
    const b = new InMemoryStorage();
    let current: Storage = a;
    const session = new InMemoryStorage();
    const calls: FetchCall[] = [];
    const t = 1_000_000;
    let respond: FetchResult = okTokens({
      access_token: "at-1",
      expires_in: 3600,
      refresh_token: "rt-a",
    });
    const fetchMock = (async (url: unknown, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      return {
        ok: respond.ok,
        status: respond.status,
        json: async () => respond.body,
      } as Response;
    }) as unknown as typeof fetch;
    const deps = {
      fetch: fetchMock,
      session,
      refresh: () => current,
      now: () => t,
      tokenUrl: TOKEN_URL,
      clientId: CLIENT_ID,
    };

    // Schreiben: Refresh-Token landet im aktuell gesetzten Storage a
    await requestToken({ grant_type: "authorization_code" }, deps);
    expect(a.getItem(REFRESH)).toBe("rt-a");
    expect(b.getItem(REFRESH)).toBeNull();

    // Laufzeit-Wechsel der Einstellung: ab jetzt gilt b
    current = b;
    // Lesen: abgelaufen + in b KEIN Refresh-Token → null ohne fetch (a hat
    // zwar rt-a, wird aber nicht angefasst)
    session.setItem(EXPIRES_AT, String(t - 1));
    await expect(getValidToken(deps)).resolves.toBeNull();
    expect(calls).toHaveLength(1);

    // in b liegt jetzt einer → Lesen greift auf b zu
    b.setItem(REFRESH, "rt-b");
    respond = okTokens({ access_token: "at-2", expires_in: 3600 });
    await expect(getValidToken(deps)).resolves.toBe("at-2");
    expect(calls).toHaveLength(2);
    const sent = new URLSearchParams(calls[1].init.body as string);
    expect(sent.get("refresh_token")).toBe("rt-b");

    // Löschen: HTTP 400 beim Refresh löscht im aktuell gesetzten Storage b
    respond = { ok: false, status: 400, body: { error: "invalid_grant" } };
    session.setItem(EXPIRES_AT, String(t - 1));
    const err = await getValidToken(deps).catch((e: unknown) => e);
    expect((err as Error & { status: number }).status).toBe(400);
    expect(b.getItem(REFRESH)).toBeNull();
    expect(a.getItem(REFRESH)).toBe("rt-a");
  });
});

// Timeout am Token-Endpunkt (Security-Audit A10:2025, Finding F6): requestToken
// routet den POST durch fetchWithTimeout (lib/http.ts) mit TOKEN_TIMEOUT_MS —
// ein hängender Token-Fetch darf die App nicht ewig im „Anmeldung läuft…“
// hängen lassen.
describe("Timeout am Token-Endpunkt (A10 F6)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // Deps mit ewig hängendem fetch (nie auflösendes Promise)
  function makeHangingDeps() {
    const session = new InMemoryStorage();
    const local = new InMemoryStorage();
    const calls: FetchCall[] = [];
    const fetchMock = (async (url: unknown, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      return new Promise<Response>(() => {}); // hängt ewig
    }) as unknown as typeof fetch;
    const deps = {
      fetch: fetchMock,
      session,
      refresh: () => local,
      now: () => 1_000_000,
      tokenUrl: TOKEN_URL,
      clientId: CLIENT_ID,
    };
    return { deps, session, local, calls };
  }

  it("requestToken: hängt nicht ewig — nach TOKEN_TIMEOUT_MS reject mit TimeoutError, nichts im Storage, kein .status", async () => {
    const { deps, session, local, calls } = makeHangingDeps();
    const caught = requestToken(
      { grant_type: "refresh_token", refresh_token: "rt-1", client_id: CLIENT_ID },
      deps,
    ).catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(TOKEN_TIMEOUT_MS);
    const err = (await caught) as Error & { status?: number };
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("TimeoutError");
    // KEIN .status === 400 → getValidToken darf den Refresh-Token NICHT verwerfen
    expect(err.status).toBeUndefined();
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(TOKEN_URL);
    expect(calls[0].init.method).toBe("POST");
    // init trägt zusätzlich das abort-Signal; nach dem Timeout ist es aborted
    expect(calls[0].init.signal).toBeDefined();
    expect((calls[0].init.signal as AbortSignal).aborted).toBe(true);
    expect(session.getItem(ACCESS)).toBeNull();
    expect(session.getItem(EXPIRES_AT)).toBeNull();
    expect(local.getItem(REFRESH)).toBeNull();
  });

  it("getValidToken: Timeout beim Refresh wird durchgereicht (statt ewig zu hängen) und der Refresh-Token bleibt erhalten", async () => {
    const { deps, session, local } = makeHangingDeps();
    session.setItem(ACCESS, "at-old");
    session.setItem(EXPIRES_AT, String(1_000_000 - 1)); // abgelaufen
    local.setItem(REFRESH, "rt-old");
    const caught = getValidToken(deps).catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(TOKEN_TIMEOUT_MS);
    const err = (await caught) as Error & { status?: number };
    expect(err.name).toBe("TimeoutError");
    expect(err.status).not.toBe(400);
    // Refresh-Token NICHT verworfen (nur HTTP 400 verwirft, Spec §3.5)
    expect(local.getItem(REFRESH)).toBe("rt-old");
  });
});

// moveRefreshToken(from, to) — pure Funktion für den Wechsel der Speicher-
// Einstellung: verschiebt KEYS.refresh von `from` nach `to` und löscht ihn
// in `from`; no-op, wenn in `from` keiner liegt.
describe("moveRefreshToken", () => {
  it("verschiebt KEYS.refresh von `from` nach `to` und löscht ihn in `from`", () => {
    const from = new InMemoryStorage();
    const to = new InMemoryStorage();
    from.setItem(REFRESH, "rt-1");
    moveRefreshToken(from, to);
    expect(to.getItem(REFRESH)).toBe("rt-1");
    expect(from.getItem(REFRESH)).toBeNull();
  });

  it("no-op, wenn in `from` kein Refresh-Token liegt — beide bleiben leer", () => {
    const from = new InMemoryStorage();
    const to = new InMemoryStorage();
    moveRefreshToken(from, to);
    expect(from.getItem(REFRESH)).toBeNull();
    expect(to.getItem(REFRESH)).toBeNull();
  });

  it("fasst nur KEYS.refresh an — andere Keys in `from` bleiben stehen und landen nicht in `to`", () => {
    const from = new InMemoryStorage();
    const to = new InMemoryStorage();
    from.setItem(REFRESH, "rt-1");
    from.setItem("anderer_key", "wert");
    moveRefreshToken(from, to);
    expect(to.getItem(REFRESH)).toBe("rt-1");
    expect(from.getItem(REFRESH)).toBeNull();
    expect(from.getItem("anderer_key")).toBe("wert");
    expect(to.getItem("anderer_key")).toBeNull();
  });
});
