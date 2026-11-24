/**
 * Adapter für das Spotify Web Playback SDK — Teil 1: SDK-Loader (Spec §5
 * Schritt 1, Plan §5.1 Schicht 2 + §7). Lädt
 * `https://sdk.scdn.co/spotify-player.js` als externes Script per
 * document.createElement("script") — CSP-konform (`script-src 'self'
 * https://sdk.scdn.co`, kein Inline-Code). Nachfolger des Script-Tags in
 * web/index.html.
 *
 * Teil 2: Player-Wrapper createSpotifyPlayer (Plan §5.2, Spec §5 Schritt 1-2
 * + §8). Kapselt `new Spotify.Player(...)` als Callback-API — KEIN
 * window.player mehr (die Stores verdrahten den Adapter, Plan §5.2); Parity
 * zu web/app.js createPlayer (~L318-380).
 *
 * Im Gegensatz zu lib/ nutzt der Adapter bewusst die Browser-Globals
 * window/document (Plan §5.1: adapters sind imperative Fremdsysteme; in
 * Tests per vi.stubGlobal gemockt).
 */

/** die 8 SDK-Events, die der Wrapper über onEvent weiterleitet (Spec §5/§8) */
export type SpotifyPlayerEvent =
  | "ready"
  | "not_ready"
  | "player_state_changed"
  | "initialization_error"
  | "authentication_error"
  | "account_error"
  | "playback_error"
  | "autoplay_failed";

/**
 * Minimaler PlaybackState — die Felder, die die App rendert (Parity zu
 * web/app.js renderPlayerState).
 */
export interface SpotifyPlaybackState {
  paused: boolean;
  track_window: {
    current_track: {
      name: string;
      artists: Array<{ name: string }>;
      album: {
        images: Array<{ url: string }>;
      };
    };
  };
}

/**
 * Payload-Typ pro SDK-Event: ready/not_ready → device_id,
 * player_state_changed → state, Fehler-Events → message (Spec §5/§8).
 */
interface SpotifyPlayerEventPayloadMap {
  ready: { device_id: string };
  not_ready: { device_id: string };
  player_state_changed: SpotifyPlaybackState;
  initialization_error: { message: string };
  authentication_error: { message: string };
  account_error: { message: string };
  playback_error: { message: string };
  autoplay_failed: undefined;
}

/**
 * Der EINE typisierte Callback, über den alle SDK-Events laufen —
 * discriminated per Event (Plan §5.2: Callback-API statt verteilter Listener).
 */
export type OnSpotifyPlayerEvent = <E extends SpotifyPlayerEvent>(
  event: E,
  payload: SpotifyPlayerEventPayloadMap[E],
) => void;

/** Optionen für createSpotifyPlayer (Spec §5 Schritt 1). */
export interface CreateSpotifyPlayerOptions {
  name: string;
  volume: number;
  /** SDK-Signatur (cb: (token: string) => void) => void — Token-Quelle injiziert, 1:1 durchgereicht */
  getOAuthToken: (cb: (token: string) => void) => void;
  onEvent: OnSpotifyPlayerEvent;
}

/**
 * Dünnes Handle auf die Player-Instanz — reine Delegates, kein eigener
 * Zustand und kein window.player (Plan §5.2).
 */
export interface SpotifyPlayerHandle {
  connect(): void;
  disconnect(): void;
  togglePlay(): void;
  activateElement(): void;
  getCurrentState(): Promise<SpotifyPlaybackState | null>;
  /** #51 (additive Seam für state/scanner): Wiedergabe anhalten — dünner Delegate wie die übrigen. */
  pause(): void;
}

/** Konstruktor-Optionen, die das SDK vom Wrapper erwartet (Spec §5 Schritt 1). */
interface SpotifySdkPlayerOptions {
  name: string;
  volume: number;
  getOAuthToken: (cb: (token: string) => void) => void;
}

/** Minimale Typisierung der SDK-Player-Instanz (nur was der Wrapper nutzt). */
interface SpotifySdkPlayer {
  addListener<E extends SpotifyPlayerEvent>(
    event: E,
    listener: (payload: SpotifyPlayerEventPayloadMap[E]) => void,
  ): void;
  removeListener<E extends SpotifyPlayerEvent>(
    event: E,
    listener: (payload: SpotifyPlayerEventPayloadMap[E]) => void,
  ): void;
  connect(): void;
  disconnect(): void;
  togglePlay(): void;
  activateElement(): void;
  getCurrentState(): Promise<SpotifyPlaybackState | null>;
  /** #51: wird vom Handle 1:1 durchgereicht (SDK-API). */
  pause(): void;
}

/** Namespace, den das SDK nach dem Laden auf window hängt. */
interface SpotifySdkNamespace {
  Player: new (options: SpotifySdkPlayerOptions) => SpotifySdkPlayer;
}

declare global {
  interface Window {
    /** Wird vom SDK nach dem Laden aufgerufen — wird VOR dem Anhängen des Scripts gesetzt. */
    onSpotifyWebPlaybackSDKReady?: () => void;
    /** SDK-Namespace, steht nach erfolgreichem loadSpotifySdk() auf window */
    Spotify?: SpotifySdkNamespace;
  }
}

/** CSP-Whitelist-URL des SDK (Plan §7). */
const SDK_URL = "https://sdk.scdn.co/spotify-player.js";

/**
 * Timeout für das Laden des SDK-Scripts (A10 F6, Audit 2026-11-22): feuert
 * weder window.onSpotifyWebPlaybackSDKReady noch script.onerror (hängendes
 * Script-Load, z. B. langsames Netzwerk), würde die Promise nie settlen.
 * 15 s — Script-Load im Mobilfunknetz.
 */
export const SDK_LOAD_TIMEOUT_MS = 15_000;

/**
 * Modul-level geteilte Promise: parallele und wiederholte Aufrufe liefern
 * DASSELBE Promise-Objekt — es wird nie ein zweiter Script-Tag angehängt;
 * nach erfolgreichem Laden resolved ein erneuter Aufruf sofort.
 */
let sdkPromise: Promise<void> | null = null;

/**
 * Lädt das Web Playback SDK genau einmal. Setzt window.onSpotifyWebPlaybackSDKReady
 * VOR dem Anhängen des Scripts; die zurückgegebene Promise resolved, sobald das
 * SDK den Callback aufruft. Bei script.onerror rejected sie mit einem Error.
 * A10 F6: feuert weder der Callback noch onerror innerhalb von
 * SDK_LOAD_TIMEOUT_MS (hängendes Script-Load), rejected die Promise mit einem
 * Timeout-Error und das Script-Element wird aus dem DOM entfernt.
 */
export function loadSpotifySdk(): Promise<void> {
  if (sdkPromise) return sdkPromise;
  sdkPromise = new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = SDK_URL;
    // kein SRI (Revert 16YMRDA): Spotify rotiert das ungeversionte Skript —
    // ein gepinnter Hash wurde stale und blockierte den Load komplett.
    script.async = true;
    // A10 F6: Load-Timeout — ohne Timer würde die Promise bei hängendem
    // Script-Load nie settlen. Beim Timeout das Script wieder entfernen.
    const timer = setTimeout(() => {
      script.remove();
      reject(
        new Error(
          `Spotify SDK nicht geladen (Timeout nach ${SDK_LOAD_TIMEOUT_MS} ms): ${SDK_URL}`,
        ),
      );
    }, SDK_LOAD_TIMEOUT_MS);
    // Callback zuerst, damit das SDK ihn beim Laden sofort findet.
    window.onSpotifyWebPlaybackSDKReady = () => {
      clearTimeout(timer);
      resolve();
    };
    // kein textContent/innerHTML — nur externes Script (CSP, Plan §7)
    script.onerror = () => {
      clearTimeout(timer);
      reject(new Error(`Spotify SDK nicht ladbar: ${SDK_URL}`));
    };
    document.head.appendChild(script);
  });
  return sdkPromise;
}

/** alle 8 SDK-Events, die der Wrapper abonniert (Spec §5/§8) */
const SPOTIFY_PLAYER_EVENTS: readonly SpotifyPlayerEvent[] = [
  "ready",
  "not_ready",
  "player_state_changed",
  "initialization_error",
  "authentication_error",
  "account_error",
  "playback_error",
  "autoplay_failed",
];

/**
 * Erzeugt den Web-Playback-Player und kapselt ihn als Callback-API (Plan §5.2).
 * Konstruiert `new window.Spotify.Player({ name, volume, getOAuthToken })` —
 * setzt KEIN window.player und hält keinen globalen mutable State. Alle 8
 * SDK-Events werden über den einen onEvent-Callback weitergeleitet (inkl.
 * Payload). Das zurückgegebene Handle delegiert dünn an die Instanz.
 */
export function createSpotifyPlayer(
  options: CreateSpotifyPlayerOptions,
): SpotifyPlayerHandle {
  const spotify = window.Spotify;
  if (!spotify) {
    throw new Error(
      "Spotify Web Playback SDK nicht geladen — loadSpotifySdk() zuerst aufrufen",
    );
  }
  const player = new spotify.Player({
    name: options.name,
    volume: options.volume,
    // SDK-Signatur bleibt (cb: (token) => void) => void — reine Durchreichung
    getOAuthToken: options.getOAuthToken,
  });
  for (const event of SPOTIFY_PLAYER_EVENTS) {
    player.addListener(event, (payload) => options.onEvent(event, payload));
  }
  return {
    connect: () => player.connect(),
    disconnect: () => player.disconnect(),
    togglePlay: () => player.togglePlay(),
    activateElement: () => player.activateElement(),
    getCurrentState: () => player.getCurrentState(),
    pause: () => player.pause(),
  };
}
