import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// Tests für sw.ts (Phase 4, Parity web/sw.js, Spec §7): Precache aus
// self.__WB_MANIFEST, install → skipWaiting, activate → claim + Cleanup,
// Navigationen network-first und NIE gecacht (?code=… aus dem OAuth-
// Redirect), offline → precachte Shell, Assets cache-first NUR gegen den
// Precache, Cross-Origin/non-GET laufen vorbei.
//
// Once-Import wie main.test.tsx: alle Stubs (self/caches/fetch/Manifest)
// stehen VOR dem einmaligen Import in beforeAll; die Listener-Registrierung
// läuft genau einmal. Vitest 5 leert Mock-Calls vor jedem Test — Aufrufe
// landen deshalb in plain Zählern/Arrays, nicht in vi.fn()-Mocks.

const ORIGIN = "https://example.com";
const SW_URL = `${ORIGIN}/sw.js`;
const MANIFEST = [
  { url: "index.html", revision: "abc123" },
  { url: "assets/index-HASH.js", revision: null },
  "manifest.webmanifest",
  "icon.png",
];

interface StubRequest {
  url: string;
  method: string;
  mode?: string;
}
interface StubEvent {
  request?: StubRequest;
  waitUntil: (p: Promise<unknown>) => void;
  respondWith?: (p: Promise<Response>) => void;
}

const handlers: Record<string, (event: StubEvent) => void> = {};
const abs = (url: string) => new URL(url, SW_URL).href;

// In-Memory-CacheStorage: addAll legt Precache-Einträge an (ohne Netz),
// match sucht exakt über die absolute URL (wie das echte Cache-Interface
// mit ignoreSearch: false — ?code=… trifft damit nie einen Precache-Key).
const cacheStore = new Map<string, Map<string, Response>>();
const cachesStub = {
  open: async (name: string) => {
    let entries = cacheStore.get(name);
    if (!entries) {
      entries = new Map();
      cacheStore.set(name, entries);
    }
    const cache = entries;
    return {
      addAll: async (urls: string[]) => {
        for (const url of urls) cache.set(abs(url), new Response(`precache:${url}`));
      },
    };
  },
  match: async (request: string | StubRequest) => {
    const url = typeof request === "string" ? abs(request) : request.url;
    for (const entries of cacheStore.values()) {
      const hit = entries.get(url);
      if (hit) return hit;
    }
    return undefined;
  },
  keys: async () => [...cacheStore.keys()],
  delete: async (name: string) => cacheStore.delete(name),
};

const fetchCalls: string[] = [];
let fetchImpl: (url: string) => Promise<Response> = async (url) =>
  new Response(`net:${url}`);
const fetchStub = (request: string | StubRequest) => {
  const url = typeof request === "string" ? request : request.url;
  fetchCalls.push(url);
  return fetchImpl(url);
};

let skipWaitingCalls = 0;
let claimCalls = 0;
const selfStub = {
  __WB_MANIFEST: MANIFEST,
  location: { origin: ORIGIN, href: SW_URL },
  skipWaiting: () => {
    skipWaitingCalls += 1;
    return Promise.resolve();
  },
  clients: {
    claim: () => {
      claimCalls += 1;
      return Promise.resolve();
    },
  },
  addEventListener: (type: string, handler: (event: StubEvent) => void) => {
    handlers[type] = handler;
  },
};

function lifecycle(type: "install" | "activate"): Promise<unknown> {
  const promises: Promise<unknown>[] = [];
  handlers[type]({ waitUntil: (p) => promises.push(p) });
  return Promise.all(promises);
}

function fireFetch(request: StubRequest): Promise<Response> | undefined {
  let response: Promise<Response> | undefined;
  handlers.fetch({
    request,
    waitUntil: () => {},
    respondWith: (p) => {
      response = p;
    },
  });
  return response;
}

const precacheEntries = () => [...cacheStore.values()].flatMap((c) => [...c.keys()]);

beforeAll(async () => {
  vi.stubGlobal("self", selfStub);
  vi.stubGlobal("caches", cachesStub);
  vi.stubGlobal("fetch", fetchStub);
  await import("./sw.ts");
  // Alten Cache aus der CACHE_VERSION-Ära säen — activate muss ihn entsorgen.
  cacheStore.set("zeitklang-v12", new Map());
  await lifecycle("install");
  await lifecycle("activate");
});

afterAll(() => {
  vi.unstubAllGlobals();
});

beforeEach(() => {
  fetchImpl = async (url) => new Response(`net:${url}`);
  fetchCalls.length = 0;
});

describe("sw.ts (Parity web/sw.js)", () => {
  it("install precacht alle __WB_MANIFEST-Einträge + skipWaiting; activate claimt + löscht alte Caches", () => {
    expect([...cacheStore.keys()]).toHaveLength(1); // zeitklang-v12 ist weg
    expect(precacheEntries().sort()).toEqual(
      MANIFEST.map((e) => abs(typeof e === "string" ? e : e.url)).sort(),
    );
    expect(skipWaitingCalls).toBe(1);
    expect(claimCalls).toBe(1);
  });

  it("Navigation network-first: Antwort kommt vom Netz und landet NIE im Cache (?code=…)", async () => {
    const url = `${ORIGIN}/?code=oauth-geheim`;
    const before = precacheEntries();
    const response = fireFetch({ url, method: "GET", mode: "navigate" });
    expect(await response?.then((r) => r.text())).toBe(`net:${url}`);
    expect(fetchCalls).toEqual([url]);
    expect(precacheEntries()).toEqual(before); // kein dynamisches Caching
  });

  it("Offline-Navigation (?code=…): Fallback auf die precachte Shell index.html", async () => {
    fetchImpl = () => Promise.reject(new Error("offline"));
    const response = fireFetch({
      url: `${ORIGIN}/?code=offline-code`,
      method: "GET",
      mode: "navigate",
    });
    expect(await response?.then((r) => r.text())).toBe("precache:index.html");
    expect(precacheEntries()).not.toContain(`${ORIGIN}/?code=offline-code`);
  });

  it("Assets cache-first nur gegen den Precache: Treffer ohne Netz, Miss übers Netz ohne Cache-Write", async () => {
    const hit = fireFetch({ url: abs("assets/index-HASH.js"), method: "GET" });
    expect(await hit?.then((r) => r.text())).toBe("precache:assets/index-HASH.js");
    expect(fetchCalls).toEqual([]);

    const before = precacheEntries();
    const missUrl = `${ORIGIN}/nicht-precacht.txt`;
    const miss = fireFetch({ url: missUrl, method: "GET" });
    expect(await miss?.then((r) => r.text())).toBe(`net:${missUrl}`);
    expect(fetchCalls).toEqual([missUrl]);
    expect(precacheEntries()).toEqual(before);
  });

  it("Cross-Origin (Spotify-API) und non-GET laufen unangetastet am SW vorbei", () => {
    expect(
      fireFetch({ url: "https://api.spotify.com/v1/me", method: "GET" }),
    ).toBeUndefined();
    expect(fireFetch({ url: `${ORIGIN}/`, method: "POST" })).toBeUndefined();
    expect(fetchCalls).toEqual([]);
  });
});
