import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  CreateSpotifyPlayerOptions,
  loadSpotifySdk,
  OnSpotifyPlayerEvent,
  SpotifyPlaybackState,
  SpotifyPlayerEvent,
  SpotifyPlayerHandle,
} from "./spotify-sdk.ts";

// Unit-Tests für adapters/spotify-sdk.ts — Teil 1: SDK-Loader + Window-Typen
// (Spec §5.1: SDK-Script dynamisch laden, Fehler -> PLAYER_ERR_LOAD).
//
// Akzeptanzkriterien:
// - loadSpotifySdk() hängt genau ein
//   <script src="https://sdk.scdn.co/spotify-player.js" async> per
//   document.createElement("script") an (CSP-konform: script-src 'self'
//   https://sdk.scdn.co, kein Inline-Code)
// - window.onSpotifyWebPlaybackSDKReady wird VOR dem Anhängen gesetzt; die
//   zurückgegebene Promise resolved, sobald das SDK den Callback aufruft
// - idempotent: parallele und wiederholte Aufrufe teilen eine Promise — nie
//   ein zweiter Script-Tag; nach Erfolg resolved ein Aufruf sofort
// - script.onerror rejected die Promise
//
// Kein echtes Netzwerk in den Tests: window/document werden pro Test per
// vi.stubGlobal durch ein Fake ersetzt. Das "SDK" ist der Test selbst, der
// window.onSpotifyWebPlaybackSDKReady() aufruft bzw. script.onerror() feuert.
//
// ---------------------------------------------------------------------------
// Teil 2 (Subtask 45ZVP76-2): Player-Wrapper createSpotifyPlayer — Plan §5.2
// (KEIN window.player mehr; state/player.ts verdrahtet den Adapter), Spec §5
// Schritt 1-2 + §8 (Events inkl. autoplay_failed und spurious
// authentication_error), Parity zu web/app.js createPlayer (~L318-380).
//
// Akzeptanzkriterien:
// - createSpotifyPlayer({ name, volume, getOAuthToken, onEvent }) wrapt
//   new Spotify.Player(...) — alle 8 SDK-Events (ready, not_ready,
//   player_state_changed, initialization_error, authentication_error,
//   account_error, playback_error, autoplay_failed) werden über den EINEN
//   typisierten onEvent-Callback mit Payload weitergeleitet (ready →
//   device_id, player_state_changed → state, Fehler-Events → message)
// - getOAuthToken behält die SDK-Signatur (cb: (token: string) => void) => void
//   und wird durchgereicht (Token-Quelle wird injiziert)
// - zurückgegebenes Handle: connect(), disconnect(), togglePlay(),
//   activateElement(), getCurrentState() als dünne Delegates an die Instanz
//
// Erwartete Exporte des Produktionsmoduls (implementiert der SWE im naechsten
// Schritt — die Typ-Importe oben sind der Compile-Time-Vertrag):
//   createSpotifyPlayer(options): SpotifyPlayerHandle
//   Typen: CreateSpotifyPlayerOptions, OnSpotifyPlayerEvent,
//   SpotifyPlayerEvent, SpotifyPlaybackState, SpotifyPlayerHandle
//
// Mock: window.Spotify.Player ist eine Fake-Klasse (vi.stubGlobal), die
// Konstruktor-Optionen + addListener-Registrierungen kapert; trigger() feuert
// Events. Das echte SDK wird hier NICHT geladen (kein loadSpotifySdk-Aufruf).

const SDK_URL = "https://sdk.scdn.co/spotify-player.js";

type ReadyCallback = () => void;

/** gefaketes <script>-Element, das der Loader über document.createElement erhält */
interface FakeScriptElement {
  tagName: string;
  src: string;
  async: boolean;
  /** A03 F4 (16YMRDA-1): SRI — integrity-Attribut des Script-Tags */
  integrity: string;
  /** A03 F4 (16YMRDA-1): CORS-Mode, Pflicht für SRI bei cross-origin Scripts */
  crossOrigin: string | null;
  textContent: string;
  onerror: ((event?: unknown) => void) | null;
  onload: ((event?: unknown) => void) | null;
  setAttribute: (name: string, value: string) => void;
  /** DOM-API: entfernt das Element aus dem Parent — der Loader ruft das beim Load-Timeout (A10 F6) */
  remove: () => void;
}

interface FakeWindow {
  onSpotifyWebPlaybackSDKReady?: ReadyCallback;
  /** Teil 2: gemocktes SDK-Namespace (vi.stubGlobal("Spotify", …)) */
  Spotify?: { Player: typeof FakeSpotifyPlayer };
  /** Plan §5.2: darf vom Player-Wrapper NICHT gesetzt werden */
  player?: unknown;
}

interface FakeDocument {
  createElement: (tag: string) => FakeScriptElement;
  querySelector: (selector: string) => null;
  head: { appendChild: (el: FakeScriptElement) => FakeScriptElement };
  body: { appendChild: (el: FakeScriptElement) => FakeScriptElement };
  documentElement: { appendChild: (el: FakeScriptElement) => FakeScriptElement };
}

interface FakeDom {
  win: FakeWindow;
  doc: FakeDocument;
  createdTags: string[];
  appended: FakeScriptElement[];
  /** pro angehängtem Element: war window.onSpotifyWebPlaybackSDKReady da schon gesetzt? */
  callbackSetWhenAppended: boolean[];
  /** Elemente, die per el.remove() aus dem DOM entfernt wurden (Load-Timeout, A10 F6) */
  removed: FakeScriptElement[];
}

function makeFakeDom(): FakeDom {
  const createdTags: string[] = [];
  const appended: FakeScriptElement[] = [];
  const callbackSetWhenAppended: boolean[] = [];
  const removed: FakeScriptElement[] = [];
  const win: FakeWindow = {};

  const appendChild = (el: FakeScriptElement): FakeScriptElement => {
    appended.push(el);
    callbackSetWhenAppended.push(typeof win.onSpotifyWebPlaybackSDKReady === "function");
    return el;
  };

  const createElement = (tag: string): FakeScriptElement => {
    createdTags.push(tag);
    const el: FakeScriptElement = {
      tagName: tag.toUpperCase(),
      src: "",
      async: false,
      integrity: "",
      crossOrigin: null,
      textContent: "",
      onerror: null,
      onload: null,
      setAttribute: (name: string, value: string) => {
        if (name === "async") {
          el.async = true;
        } else {
          (el as unknown as Record<string, unknown>)[name] = value;
        }
      },
      remove: () => {
        removed.push(el);
      },
    };
    return el;
  };

  const doc: FakeDocument = {
    createElement,
    // kein bestehendes SDK-Script im Fake-DOM
    querySelector: () => null,
    head: { appendChild },
    body: { appendChild },
    documentElement: { appendChild },
  };
  return { win, doc, createdTags, appended, callbackSetWhenAppended, removed };
}

// Frische Modulinstanz pro Test: Die Idempotenz-Promise lebt im Modulzustand
// des Loaders — vi.resetModules() + dynamischer Import gibt jedem Test einen
// unberührten Loader (sonst kumulierte die Script-Anzahl über Tests hinweg).
async function freshLoader(): Promise<typeof loadSpotifySdk> {
  vi.resetModules();
  const mod = await import("./spotify-sdk.ts");
  return mod.loadSpotifySdk;
}

// Frische Modulinstanz inkl. Value-Exporte (SDK_LOAD_TIMEOUT_MS) für die
// Timeout-Tests (A10 F6, ZXY4675-3).
async function freshLoaderModule(): Promise<typeof import("./spotify-sdk.ts")> {
  vi.resetModules();
  return import("./spotify-sdk.ts");
}

let dom: FakeDom;

beforeEach(() => {
  dom = makeFakeDom();
  vi.stubGlobal("window", dom.win);
  vi.stubGlobal("document", dom.doc);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("loadSpotifySdk — SDK-Loader", () => {
  it('hängt genau ein externes Script an (createElement("script"), src = sdk.scdn.co, async, kein Inline) und setzt window.onSpotifyWebPlaybackSDKReady VOR dem Anhängen; die Promise resolved beim SDK-Callback', async () => {
    const load = await freshLoader();
    const promise = load();

    expect(dom.createdTags).toEqual(["script"]);
    expect(dom.appended).toHaveLength(1);
    const script = dom.appended[0];
    expect(script.src).toBe(SDK_URL);
    expect(script.async).toBe(true);
    // kein Inline-Code (CSP script-src 'self' https://sdk.scdn.co, Plan §7)
    expect(script.textContent).toBe("");

    // Callback war zum Zeitpunkt des Anhängens bereits gesetzt
    expect(dom.callbackSetWhenAppended).toEqual([true]);
    expect(typeof dom.win.onSpotifyWebPlaybackSDKReady).toBe("function");

    // die Promise resolved, sobald das SDK den Callback aufruft
    dom.win.onSpotifyWebPlaybackSDKReady?.();
    await expect(promise).resolves.toBeUndefined();
  });

  it("idempotent: parallele Aufrufe teilen eine Promise — nie ein zweiter Script-Tag", async () => {
    const load = await freshLoader();
    const p1 = load();
    const p2 = load();
    const p3 = load();

    expect(p2).toBe(p1);
    expect(p3).toBe(p1);
    expect(dom.createdTags).toEqual(["script"]);
    expect(dom.appended).toHaveLength(1);

    dom.win.onSpotifyWebPlaybackSDKReady?.();
    await expect(p1).resolves.toBeUndefined();
    await expect(p2).resolves.toBeUndefined();
    await expect(p3).resolves.toBeUndefined();
  });

  it("nach erfolgreichem Laden resolved ein erneuter Aufruf sofort — ohne weiteren Script-Tag", async () => {
    const load = await freshLoader();
    const p1 = load();
    dom.win.onSpotifyWebPlaybackSDKReady?.();
    await p1;

    const p2 = load();
    expect(p2).toBe(p1);
    // resolved sofort, ohne dass der Callback erneut aufgerufen wird
    await expect(p2).resolves.toBeUndefined();
    expect(dom.createdTags).toEqual(["script"]);
    expect(dom.appended).toHaveLength(1);
  });

  it("script.onerror rejected die Promise", async () => {
    const load = await freshLoader();
    const promise = load();

    const script = dom.appended[0];
    expect(typeof script.onerror).toBe("function");
    script.onerror?.(new Error("network error"));

    const err = await promise.catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
  });
});

// ---------------------------------------------------------------------------
// Load-Timeout (Security A10, Finding F6, ZXY4675-3): heute feuert bei einem
// hängenden Script-Load weder window.onSpotifyWebPlaybackSDKReady noch
// script.onerror — die Promise settlet nie. loadSpotifySdk() muss zusätzlich
// einen setTimeout(SDK_LOAD_TIMEOUT_MS) haben und beim Timeout rejecten.
// ---------------------------------------------------------------------------

describe("loadSpotifySdk — Load-Timeout (A10 F6)", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("rejected nach SDK_LOAD_TIMEOUT_MS, wenn weder SDK-Callback noch onerror feuert — Script-Element wird entfernt, Timer aufgeräumt, Promise bleibt shared (kein Retry)", async () => {
    const mod = await freshLoaderModule();
    const { loadSpotifySdk, SDK_LOAD_TIMEOUT_MS } = mod;
    vi.useFakeTimers();

    const promise = loadSpotifySdk();
    // Rejection-Handler SOFORT anhängen — sonst unhandled rejection, sobald
    // der Timeout-Timer feuert
    const settled = promise.then(
      () => ({ ok: true as const }),
      (err: unknown) => ({ ok: false as const, err }),
    );
    // parallele Aufrufe teilen weiterhin EINE Promise — nie ein zweiter Script-Tag
    const p2 = loadSpotifySdk();
    expect(p2).toBe(promise);
    expect(dom.appended).toHaveLength(1);

    // weder window.onSpotifyWebPlaybackSDKReady noch script.onerror feuert
    await vi.advanceTimersByTimeAsync(SDK_LOAD_TIMEOUT_MS);

    const result = await settled;
    if (result.ok) throw new Error("Promise muss beim Timeout rejecten");
    const err = result.err;
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toMatch(/Timeout/);
    expect((err as Error).message).toContain(`${SDK_LOAD_TIMEOUT_MS}`);
    expect((err as Error).message).toContain(SDK_URL);
    // Script-Element wurde aus dem DOM entfernt
    expect(dom.removed).toEqual([dom.appended[0]]);
    // Timer ist aufgeräumt
    expect(vi.getTimerCount()).toBe(0);
    // Verhalten wie heute bei onerror: die geteilte Promise bleibt rejected —
    // kein automatischer Retry/Reset
    expect(loadSpotifySdk()).toBe(promise);
    await expect(loadSpotifySdk()).rejects.toThrow(/Timeout/);
  });

  it("resolved vor dem Timeout: der SDK-Callback cleared den Timer — kein verspätetes Reject (Timer-Count 0), Script bleibt im DOM", async () => {
    const mod = await freshLoaderModule();
    const { loadSpotifySdk, SDK_LOAD_TIMEOUT_MS } = mod;
    vi.useFakeTimers();

    const promise = loadSpotifySdk();
    const catchSpy = vi.fn();
    void promise.catch(catchSpy);

    // SDK-Callback feuert VOR Ablauf des Timeouts
    dom.win.onSpotifyWebPlaybackSDKReady?.();
    await expect(promise).resolves.toBeUndefined();
    expect(vi.getTimerCount()).toBe(0);

    // auch nach Ablauf des vollen Timeouts kein verspätetes Reject
    await vi.advanceTimersByTimeAsync(SDK_LOAD_TIMEOUT_MS * 2);
    expect(catchSpy).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
    // nur der Timeout entfernt das Script — hier bleibt es angehängt
    expect(dom.removed).toHaveLength(0);
  });

  it("onerror vor dem Timeout rejected die Promise und cleared den Timer (Timer-Count 0) — kein doppeltes Reject nach Ablauf des Timeouts", async () => {
    const mod = await freshLoaderModule();
    const { loadSpotifySdk, SDK_LOAD_TIMEOUT_MS } = mod;
    vi.useFakeTimers();

    const promise = loadSpotifySdk();
    const catchSpy = vi.fn();
    void promise.catch(catchSpy);

    dom.appended[0].onerror?.(new Error("network error"));
    await expect(promise).rejects.toThrow(/nicht ladbar/);
    expect(vi.getTimerCount()).toBe(0);

    // nach Ablauf des Timeouts feuert nichts mehr — genau ein Reject
    await vi.advanceTimersByTimeAsync(SDK_LOAD_TIMEOUT_MS * 2);
    expect(catchSpy).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
    // onerror entfernt das Script NICHT (nur der Timeout tut das)
    expect(dom.removed).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// SRI (Subresource Integrity) am dynamischen SDK-Script-Tag — A03 F4
// (Ticket 16YMRDA-1, HITL-Entscheid Option (a)): integrity + crossOrigin am
// per document.createElement("script") erzeugten Element. crossOrigin=
// "anonymous" ist Pflicht für SRI bei cross-origin Scripts (lädt das Script
// im CORS-Mode; sdk.scdn.co liefert Access-Control-Allow-Origin: *). Die CSP
// whitelisted in script-src bereits exakt https://sdk.scdn.co
// (rework/index.html — reserviert, bleibt unverändert).
// ---------------------------------------------------------------------------

describe("loadSpotifySdk — SRI (A03 F4, 16YMRDA-1)", () => {
  it('exportiert SDK_INTEGRITY = "sha384-…" (sha384 des SDK-Scripts, gefetcht 2026-11-22 von https://sdk.scdn.co/spotify-player.js, 25561 bytes)', async () => {
    const mod = await freshLoaderModule();
    expect(mod.SDK_INTEGRITY).toBe(
      "sha384-HRyPFJwmFLBNI5OKyBEO8khWgPzi3uJ6IrutgD+g7CdvCQMAeB3jL/MI2heG1dhI",
    );
  });

  it('setzt am script-Element integrity === SDK_INTEGRITY und crossOrigin === "anonymous"; src bleibt exakt die SDK-URL; textContent === "" (kein Inline-Code)', async () => {
    const mod = await freshLoaderModule();
    const promise = mod.loadSpotifySdk();

    expect(dom.createdTags).toEqual(["script"]);
    expect(dom.appended).toHaveLength(1);
    const script = dom.appended[0];
    expect(script.src).toBe(SDK_URL);
    expect(script.integrity).toBe(mod.SDK_INTEGRITY);
    expect(script.crossOrigin).toBe("anonymous");
    // kein Inline-Code (CSP, Plan §7)
    expect(script.textContent).toBe("");

    dom.win.onSpotifyWebPlaybackSDKReady?.();
    await expect(promise).resolves.toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Teil 2: Player-Wrapper createSpotifyPlayer
// ---------------------------------------------------------------------------

/** Konstruktor-Optionen, die das SDK vom Wrapper erwartet (Spec §5 Schritt 1). */
interface FakePlayerConstructorOptions {
  name: string;
  volume: number;
  getOAuthToken: (cb: (token: string) => void) => void;
}

type FakeListener = (payload?: unknown) => void;

/**
 * Gefakte Spotify.Player-Klasse: kapert Konstruktor-Optionen und
 * addListener-Registrierungen; trigger() feuert SDK-Events an die Listener.
 */
class FakeSpotifyPlayer {
  static instances: FakeSpotifyPlayer[] = [];
  readonly options: FakePlayerConstructorOptions;
  readonly registeredEvents: string[] = [];
  private readonly listeners = new Map<string, FakeListener[]>();
  readonly connect = vi.fn();
  readonly disconnect = vi.fn();
  readonly togglePlay = vi.fn();
  readonly activateElement = vi.fn();
  readonly getCurrentState = vi.fn<() => Promise<unknown>>(() => Promise.resolve(null));

  constructor(options: FakePlayerConstructorOptions) {
    this.options = options;
    FakeSpotifyPlayer.instances.push(this);
  }

  addListener(event: string, listener: FakeListener): void {
    this.registeredEvents.push(event);
    const list = this.listeners.get(event) ?? [];
    list.push(listener);
    this.listeners.set(event, list);
  }

  /** Test-Helfer: feuert ein SDK-Event an alle registrierten Listener. */
  trigger(event: string, payload?: unknown): void {
    for (const listener of this.listeners.get(event) ?? []) listener(payload);
  }
}

/** alle 8 SDK-Events, die der Wrapper weiterleiten muss (Spec §5/§8) */
const ALL_EVENTS: SpotifyPlayerEvent[] = [
  "ready",
  "not_ready",
  "player_state_changed",
  "initialization_error",
  "authentication_error",
  "account_error",
  "playback_error",
  "autoplay_failed",
];

// Frische Modulinstanz pro Test — ABER dynamisch importiert: Ein statischer
// Import von createSpotifyPlayer ließe in der Red-Phase (Export fehlt noch)
// das ganze Modul fehlschlagen und die 4 Loader-Tests oben mit kippen.
async function freshAdapter(): Promise<typeof import("./spotify-sdk.ts")> {
  vi.resetModules();
  return import("./spotify-sdk.ts");
}

describe("createSpotifyPlayer — Player-Wrapper", () => {
  beforeEach(() => {
    FakeSpotifyPlayer.instances = [];
    const spotify = { Player: FakeSpotifyPlayer };
    dom.win.Spotify = spotify;
    vi.stubGlobal("Spotify", spotify);
  });

  it("erzeugt new Spotify.Player({ name, volume, getOAuthToken }) — ohne window.player (Plan §5.2)", async () => {
    const { createSpotifyPlayer } = await freshAdapter();
    const options: CreateSpotifyPlayerOptions = {
      name: "Zeitklang PWA",
      volume: 0.8,
      getOAuthToken: vi.fn((cb: (token: string) => void) => cb("token")),
      onEvent: vi.fn<OnSpotifyPlayerEvent>(),
    };
    createSpotifyPlayer(options);

    expect(FakeSpotifyPlayer.instances).toHaveLength(1);
    const player = FakeSpotifyPlayer.instances[0];
    expect(player.options.name).toBe("Zeitklang PWA");
    expect(player.options.volume).toBe(0.8);
    expect(player.options.getOAuthToken).toBe(options.getOAuthToken);
    // kein globaler window.player mehr (Plan §5.2: Stores verdrahten den Adapter)
    expect(dom.win.player).toBeUndefined();
  });

  it("getOAuthToken behält die SDK-Signatur (cb: (token: string) => void) => void — reine Durchreichung der injizierten Token-Quelle", async () => {
    const { createSpotifyPlayer } = await freshAdapter();
    const getOAuthToken = vi.fn((cb: (token: string) => void) => cb("token-abc"));
    createSpotifyPlayer({
      name: "Zeitklang PWA",
      volume: 0.8,
      getOAuthToken,
      onEvent: vi.fn<OnSpotifyPlayerEvent>(),
    });
    const sdkGetOAuthToken = FakeSpotifyPlayer.instances[0].options.getOAuthToken;

    const cb = vi.fn();
    sdkGetOAuthToken(cb);
    expect(getOAuthToken).toHaveBeenCalledWith(cb);
    expect(cb).toHaveBeenCalledWith("token-abc");
  });

  it("leitet alle 8 SDK-Events über den einen onEvent-Callback weiter — inklusive Payload (ready → device_id, player_state_changed → state, Fehler-Events → message)", async () => {
    const { createSpotifyPlayer } = await freshAdapter();
    const onEvent = vi.fn<OnSpotifyPlayerEvent>();
    createSpotifyPlayer({
      name: "Zeitklang PWA",
      volume: 0.8,
      getOAuthToken: () => {},
      onEvent,
    });
    const player = FakeSpotifyPlayer.instances[0];

    // alle 8 Events abonniert
    expect([...player.registeredEvents].sort()).toEqual([...ALL_EVENTS].sort());

    const state = {
      paused: false,
      track_window: {
        current_track: {
          name: "Song",
          artists: [{ name: "Künstler" }],
          album: { images: [{ url: "https://example.com/cover.jpg" }] },
        },
      },
    } as unknown as SpotifyPlaybackState;
    const eventPayloads: Array<[SpotifyPlayerEvent, unknown]> = [
      ["ready", { device_id: "test-device-id" }],
      ["not_ready", undefined],
      ["player_state_changed", state],
      ["initialization_error", { message: "init failed" }],
      ["authentication_error", { message: "auth failed" }],
      ["account_error", { message: "no premium" }],
      ["playback_error", { message: "playback failed" }],
      ["autoplay_failed", undefined],
    ];
    for (const [event, payload] of eventPayloads) player.trigger(event, payload);

    expect(onEvent).toHaveBeenCalledTimes(eventPayloads.length);
    for (const [event, payload] of eventPayloads) {
      expect(onEvent).toHaveBeenCalledWith(event, payload);
    }
  });

  it("Handle delegiert connect/disconnect/togglePlay/activateElement/getCurrentState dünn an die Player-Instanz (connect() ruft player.connect())", async () => {
    const { createSpotifyPlayer } = await freshAdapter();
    const handle: SpotifyPlayerHandle = createSpotifyPlayer({
      name: "Zeitklang PWA",
      volume: 0.8,
      getOAuthToken: () => {},
      onEvent: vi.fn<OnSpotifyPlayerEvent>(),
    });
    const player = FakeSpotifyPlayer.instances[0];

    handle.connect();
    expect(player.connect).toHaveBeenCalledTimes(1);
    handle.disconnect();
    expect(player.disconnect).toHaveBeenCalledTimes(1);
    handle.togglePlay();
    expect(player.togglePlay).toHaveBeenCalledTimes(1);
    handle.activateElement();
    expect(player.activateElement).toHaveBeenCalledTimes(1);

    const state = { paused: true } as unknown as SpotifyPlaybackState;
    player.getCurrentState.mockReturnValue(Promise.resolve(state));
    await expect(handle.getCurrentState()).resolves.toBe(state);
    expect(player.getCurrentState).toHaveBeenCalledTimes(1);
  });

  it("wirft einen klaren Error, wenn window.Spotify fehlt (SDK nicht geladen)", async () => {
    const { createSpotifyPlayer } = await freshAdapter();
    // Guard: SDK nicht via loadSpotifySdk geladen — weder window.Spotify noch global
    delete dom.win.Spotify;
    vi.stubGlobal("Spotify", undefined);

    expect(() =>
      createSpotifyPlayer({
        name: "Zeitklang PWA",
        volume: 0.8,
        getOAuthToken: () => {},
        onEvent: vi.fn<OnSpotifyPlayerEvent>(),
      }),
    ).toThrow(/nicht geladen|loadSpotifySdk/);
    // es wurde keine Player-Instanz konstruiert
    expect(FakeSpotifyPlayer.instances).toHaveLength(0);
  });
});
