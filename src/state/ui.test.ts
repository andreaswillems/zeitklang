import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import type { CreateQrScannerOptions, QrScannerHandle } from "../adapters/qr-scanner.ts";
import type {
  CreateSpotifyPlayerOptions,
  SpotifyPlaybackState,
  SpotifyPlayerHandle,
} from "../adapters/spotify-sdk.ts";
import { authStatus, resetForTests as resetAuth } from "./auth.ts";
import { playerState, resetForTests as resetPlayer } from "./player.ts";
import {
  handleScannedText,
  resetForTests as resetScanner,
  scannerActive,
  startScan,
} from "./scanner.ts";
import {
  type BeforeInstallPromptEvent,
  captureInstallPrompt,
  closeShareDialog,
  closeSheet,
  installPrompt,
  miniPlayerVisible,
  online,
  openShareDialog,
  openSheet,
  promptInstall,
  resetForTests as resetUi,
  shareDialogOpen,
  sheetOpen,
  spoilerOpen,
  view,
} from "./ui.ts";

// Unit-Tests für state/ui.ts — Subtask QMZ02D0-1: view/sheetOpen-Signale,
// spoilerOpen/miniPlayerVisible-Computeds, openSheet/closeSheet-Guards,
// authStatus-Reaktion (View + Logout) und der echte closeSheet-Seam #37 im
// Scanner. Parity zu web/app.js show L573–585, init L617–622, logout
// L240–243/L259–261, openSheet L660, closeSheet L682, playScannedText L564–565.
// Subtask QMZ02D0-2: Share-Dialog (#94, L808–819) + echter closeShareDialog-
// Seam im Scanner (L853), Install-Prompt (#18, L729–753), online-Signal
// (#17, L599–600).
//
// Echte Stores (auth/player/scanner/ui) mit resetForTests() pro Test — nur
// adapters/qr-scanner ist gemockt (Handle-Mock wie in scanner.test.ts, kein
// html5-qrcode, keine Kamera). Der Player läuft real im Queue-Pfad (#9):
// fake timers halten den 10-s-Timeout, resetPlayer() räumt ihn wieder weg.

const { createQrScannerMock } = vi.hoisted(() => ({
  createQrScannerMock: vi.fn<(options: CreateQrScannerOptions) => QrScannerHandle>(),
}));

vi.mock("../adapters/qr-scanner.ts", () => ({
  createQrScanner: createQrScannerMock,
}));

const { createSpotifyPlayerMock, loadSpotifySdkMock } = vi.hoisted(() => ({
  createSpotifyPlayerMock:
    vi.fn<(options: CreateSpotifyPlayerOptions) => SpotifyPlayerHandle>(),
  loadSpotifySdkMock: vi.fn<() => Promise<void>>(),
}));

// SDK-Adapter mocken (wie in player.test.ts): happy-dom lädt keine externen
// Scripts — ohne Mock feuert script.onerror („Spotify SDK nicht ladbar“) und
// landet als DOMException + console.error im stderr des pre-push-Hooks (git push).
vi.mock("../adapters/spotify-sdk.ts", () => ({
  createSpotifyPlayer: createSpotifyPlayerMock,
  loadSpotifySdk: loadSpotifySdkMock,
}));

interface ScannerHandleMock extends QrScannerHandle {
  start: Mock<() => Promise<void>>;
  stop: Mock<() => Promise<void>>;
  applyTorch: Mock<(on: boolean) => Promise<boolean>>;
}

let scannerHandle: ScannerHandleMock;

/** Minimaler SDK-State — trackLoaded prüft nur playerState !== null (#7). */
function loadTrack(): void {
  playerState.value = {} as SpotifyPlaybackState;
}

/**
 * Fake-#18-Event: happy-dom kann ein Fake nicht durch ein dispatchtes
 * beforeinstallprompt-Event tragen — direkt in den Capture-Handler injiziert.
 */
function fakeInstallEvent(
  userChoice: Promise<unknown> = Promise.resolve(),
): BeforeInstallPromptEvent {
  return {
    preventDefault: vi.fn(),
    prompt: vi.fn(() => Promise.resolve()),
    userChoice,
  } as unknown as BeforeInstallPromptEvent;
}

beforeEach(() => {
  vi.useFakeTimers();
  scannerHandle = {
    torchSupported: false,
    start: vi.fn<() => Promise<void>>(() => Promise.resolve()),
    stop: vi.fn<() => Promise<void>>(() => Promise.resolve()),
    applyTorch: vi.fn<(on: boolean) => Promise<boolean>>(() => Promise.resolve(true)),
  };
  createQrScannerMock.mockReset();
  createQrScannerMock.mockReturnValue(scannerHandle);
  loadSpotifySdkMock.mockReset();
  loadSpotifySdkMock.mockResolvedValue(undefined);
  createSpotifyPlayerMock.mockReset();
  createSpotifyPlayerMock.mockReturnValue({
    connect: vi.fn(),
    disconnect: vi.fn(),
    togglePlay: vi.fn(),
    activateElement: vi.fn(),
    getCurrentState: vi.fn(() => Promise.resolve(null)),
    pause: vi.fn(),
  });
  resetAuth();
  resetPlayer();
  resetScanner();
  resetUi();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("state/ui — view + sheet (Subtask QMZ02D0-1)", () => {
  it("view folgt authStatus: ready → scan, logged-out → login, loading lässt view unverändert (Parity init L617–622, logout L259–261)", () => {
    // resetForTests()-Ausgangszustand: loading, Sheet zu, Spoiler zu
    expect(view.value).toBe("loading");
    expect(sheetOpen.value).toBe(false);
    expect(spoilerOpen.value).toBe(false);

    authStatus.value = "ready";
    expect(view.value).toBe("scan");

    authStatus.value = "loading";
    expect(view.value).toBe("scan"); // loading: keine Änderung

    authStatus.value = "logged-out";
    expect(view.value).toBe("login");
  });

  it("authStatus ready startet die Player-Erzeugung ohne externen SDK-Script-Tag und ohne console.error (kein stderr-Spam im pre-push-Hook)", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    authStatus.value = "ready";
    // createPlayer() ist fire-and-forget async — Mikro-Tasks flushen
    for (let i = 0; i < 10; i++) await Promise.resolve();
    expect(document.querySelector('script[src*="sdk.scdn.co"]')).toBeNull();
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it("openSheet-Guards: ohne trackLoaded bleibt das Sheet zu; Doppel-Open ist ein No-Op (Parity L660)", () => {
    openSheet();
    expect(sheetOpen.value).toBe(false); // !trackLoaded → no-op

    loadTrack();
    openSheet();
    expect(sheetOpen.value).toBe(true);

    openSheet(); // sheetOpen → no-op
    expect(sheetOpen.value).toBe(true);
  });

  it("spoilerOpen folgt sheetOpen in beide Richtungen (#61/#66: Öffnen enthüllt, Schließen verhüllt); closeSheet ist idempotent (Parity L682)", () => {
    loadTrack();
    expect(spoilerOpen.value).toBe(false);

    openSheet();
    expect(spoilerOpen.value).toBe(true);

    closeSheet();
    expect(sheetOpen.value).toBe(false);
    expect(spoilerOpen.value).toBe(false);

    closeSheet(); // !sheetOpen → no-op
    expect(sheetOpen.value).toBe(false);
    expect(spoilerOpen.value).toBe(false);
  });

  it("miniPlayerVisible = trackLoaded && !sheetOpen && scannerActive — Wahrheitstabelle (#7/#47, Parity L580/L690)", () => {
    for (const loaded of [false, true]) {
      for (const sheet of [false, true]) {
        for (const active of [false, true]) {
          playerState.value = loaded ? ({} as SpotifyPlaybackState) : null;
          sheetOpen.value = sheet;
          scannerActive.value = active;
          expect(miniPlayerVisible.value).toBe(loaded && !sheet && active);
        }
      }
    }
  });

  it("Logout-Reaktion: offenes Sheet schließt, Scanner stoppt (Kamera aus in der Login-Ansicht), view → login (Parity logout L240–243/L259–261)", async () => {
    authStatus.value = "ready";
    loadTrack();
    openSheet();
    await startScan();
    expect(scannerActive.value).toBe(true);
    expect(sheetOpen.value).toBe(true);

    authStatus.value = "logged-out";

    expect(sheetOpen.value).toBe(false);
    expect(scannerActive.value).toBe(false);
    expect(scannerHandle.stop).toHaveBeenCalledTimes(1);
    expect(view.value).toBe("login");
  });

  it("Seam #37 echt: handleScannedText schließt ein offenes Sheet über das echte ui.closeSheet — Spoiler-Reset strukturell (Parity playScannedText L564–565, playTrack L468)", () => {
    loadTrack();
    openSheet();
    expect(sheetOpen.value).toBe(true);

    handleScannedText("https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC");

    expect(sheetOpen.value).toBe(false);
    expect(spoilerOpen.value).toBe(false);
  });
});

describe("state/ui — Share-Dialog + Install-Prompt + online (Subtask QMZ02D0-2)", () => {
  it("shareDialogOpen: öffnen/schließen ohne Guards, idempotent (Parity L808–819)", () => {
    expect(shareDialogOpen.value).toBe(false);

    openShareDialog();
    expect(shareDialogOpen.value).toBe(true);
    openShareDialog(); // kein Doppel-Open-Guard — Parity: keine Guards
    expect(shareDialogOpen.value).toBe(true);

    closeShareDialog();
    expect(shareDialogOpen.value).toBe(false);
    closeShareDialog(); // idempotent
    expect(shareDialogOpen.value).toBe(false);
  });

  it("Seam #94 echt: startScan schließt einen offenen Share-Dialog über das echte ui.closeShareDialog (Parity startScan L853)", async () => {
    openShareDialog();
    expect(shareDialogOpen.value).toBe(true);

    await startScan();

    expect(shareDialogOpen.value).toBe(false);
    expect(scannerActive.value).toBe(true);
  });

  it("beforeinstallprompt-Capture: preventDefault() + Event landet in installPrompt (Parity L729–733)", () => {
    expect(installPrompt.value).toBeNull();

    const event = fakeInstallEvent();
    captureInstallPrompt(event);

    expect(event.preventDefault).toHaveBeenCalledTimes(1);
    expect(installPrompt.value).toBe(event);
  });

  it("promptInstall: ohne Event No-Op; mit Event prompt() + userChoice abwarten (Rejection geschluckt) + installPrompt=null (Parity L739–743)", async () => {
    await promptInstall(); // null-Guard (L739)
    expect(installPrompt.value).toBeNull();

    const event = fakeInstallEvent(Promise.reject(new Error("abgebrochen")));
    captureInstallPrompt(event);
    await promptInstall();

    expect(event.prompt).toHaveBeenCalledTimes(1);
    expect(installPrompt.value).toBeNull();
  });

  it("promptInstall-Reihenfolge: installPrompt wird erst NACH dem Settlen von userChoice geleert (Parity L741–743)", async () => {
    let resolveChoice: (value: unknown) => void = () => {};
    const userChoice = new Promise<unknown>((resolve) => {
      resolveChoice = resolve;
    });
    const event = fakeInstallEvent(userChoice);
    captureInstallPrompt(event);

    const pending = promptInstall();
    expect(event.prompt).toHaveBeenCalledTimes(1);
    expect(installPrompt.value).toBe(event); // userChoice pending → Signal bleibt gesetzt

    resolveChoice({ outcome: "accepted", platform: "web" });
    await pending;
    expect(installPrompt.value).toBeNull();
  });

  it("appinstalled räumt installPrompt ab (Parity L750–753)", () => {
    captureInstallPrompt(fakeInstallEvent());
    expect(installPrompt.value).not.toBeNull();

    window.dispatchEvent(new Event("appinstalled"));

    expect(installPrompt.value).toBeNull();
  });

  it("online-Signal: Initialwert navigator.onLine, online/offline-Events flippen es (Parity L599–600)", () => {
    expect(online.value).toBe(navigator.onLine);

    window.dispatchEvent(new Event("offline"));
    expect(online.value).toBe(false);

    window.dispatchEvent(new Event("online"));
    expect(online.value).toBe(true);
  });
});
