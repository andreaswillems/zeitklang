import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import type { CreateQrScannerOptions, QrScannerHandle } from "../adapters/qr-scanner.ts";
import type { SpotifyPlayerHandle } from "../adapters/spotify-sdk.ts";
import { playerMessage, QUEUE_FAIL_MSG } from "./player.ts";
import {
  handleScannedText,
  OFFLINE_SCAN_MSG,
  resetForTests,
  SCAN_COOLDOWN_MS,
  scanMessage,
  scannerActive,
  setScannerDepsForTests,
  startScan,
  stopScan,
  toggleTorch,
  torchOn,
  torchSupported,
} from "./scanner.ts";

// Unit-Tests für state/scanner.ts — Subtask JKA8RDZ-1: Lifecycle
// (startScan/stopScan/torch + Signale). Subtask JKA8RDZ-2: handleScannedText
// (Scan-Guard + vibrate #4 + closeSheet-Seam #37 + playTrack) sowie QE-Fix F1
// (OFFLINE_SCAN_MSG-Text). Parity zu web/app.js L830–950, L236–243,
// playScannedText L534–568, Konstanten L283/L315.
//
// Mocks: adapters/qr-scanner (createQrScanner → Handle-Mock) und state/player
// (Partial-Mock: playTrack + currentPlayerHandle sind Mocks — kein Netzwerk;
// playerMessage-Signal und QUEUE_FAIL_MSG kommen ECHT aus ./player.ts, damit
// der A10-F7-Test gegen die echte Konstante prüft, Boundary wie in
// player.test.ts mit seinem Auth-Fake). Deps wie navigator.onLine werden pro
// Test über vi.spyOn bzw. setScannerDepsForTests gesteuert.

const { createQrScannerMock, currentPlayerHandleMock, playTrackMock } = vi.hoisted(
  () => ({
    createQrScannerMock: vi.fn<(options: CreateQrScannerOptions) => QrScannerHandle>(),
    currentPlayerHandleMock: vi.fn<() => SpotifyPlayerHandle | null>(),
    playTrackMock: vi.fn<(trackId: string) => Promise<void>>(),
  }),
);

vi.mock("../adapters/qr-scanner.ts", () => ({
  createQrScanner: createQrScannerMock,
}));

vi.mock("./player.ts", async (importOriginal) => {
  // Partial-Mock: nur playTrack/currentPlayerHandle werden ersetzt; das
  // playerMessage-Signal und QUEUE_FAIL_MSG bleiben die echten Exporte des
  // Moduls (A10 F7 / 7MXKQ3V-1: der .catch in scanner.ts setzt genau diese).
  const actual = await importOriginal<typeof import("./player.ts")>();
  return {
    ...actual,
    currentPlayerHandle: currentPlayerHandleMock,
    playTrack: playTrackMock,
  };
});

interface ScannerHandleMock extends QrScannerHandle {
  start: Mock<() => Promise<void>>;
  stop: Mock<() => Promise<void>>;
  applyTorch: Mock<(on: boolean) => Promise<boolean>>;
}

/** Adapter-Handle-Mock; torchSupported ist über den Setter zwischen Starts änderbar. */
function makeScannerHandle(torchSupportedInitial = false): {
  handle: ScannerHandleMock;
  setTorchSupported: (value: boolean) => void;
} {
  let supported = torchSupportedInitial;
  const handle: ScannerHandleMock = {
    get torchSupported() {
      return supported;
    },
    start: vi.fn<() => Promise<void>>(() => Promise.resolve()),
    stop: vi.fn<() => Promise<void>>(() => Promise.resolve()),
    applyTorch: vi.fn<(on: boolean) => Promise<boolean>>(() => Promise.resolve(true)),
  };
  return {
    handle,
    setTorchSupported: (value: boolean) => {
      supported = value;
    },
  };
}

let scanner: ReturnType<typeof makeScannerHandle>;
let pauseMock: Mock<() => void>;

beforeEach(() => {
  scanner = makeScannerHandle();
  createQrScannerMock.mockReset();
  createQrScannerMock.mockReturnValue(scanner.handle);
  pauseMock = vi.fn();
  currentPlayerHandleMock.mockReset();
  currentPlayerHandleMock.mockReturnValue({
    pause: pauseMock,
  } as unknown as SpotifyPlayerHandle);
  playTrackMock.mockReset();
  playTrackMock.mockResolvedValue(undefined);
  resetForTests();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("state/scanner — Lifecycle", () => {
  it("initial sind alle Signale zurückgesetzt", () => {
    expect(scannerActive.value).toBe(false);
    expect(torchOn.value).toBe(false);
    expect(torchSupported.value).toBe(false);
    expect(scanMessage.value).toBeNull();
  });

  it("startScan startet den Adapter und setzt scannerActive erst nach erfolgreichem start() (#45)", async () => {
    let resolveStart!: () => void;
    scanner.handle.start.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveStart = resolve;
        }),
    );
    const pending = startScan();
    // noch nicht aktiv, solange der Adapter-start läuft
    expect(scannerActive.value).toBe(false);
    resolveStart();
    await pending;
    expect(createQrScannerMock).toHaveBeenCalledTimes(1);
    expect(scanner.handle.start).toHaveBeenCalledTimes(1);
    expect(scannerActive.value).toBe(true);
  });

  it("Doppel-Start-Guard (#6 Stufe 2): startScan während aktiv ruft den Adapter nicht erneut auf", async () => {
    await startScan();
    await startScan();
    await startScan();
    expect(scanner.handle.start).toHaveBeenCalledTimes(1);
    expect(createQrScannerMock).toHaveBeenCalledTimes(1);
    expect(scannerActive.value).toBe(true);
  });

  it("Offline-Guard #17: navigator.onLine === false → kein Adapter-start, scanMessage === OFFLINE_SCAN_MSG, kein scannerActive-Flip", async () => {
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    const closeShareDialog = vi.fn();
    setScannerDepsForTests({ closeShareDialog });

    await startScan();

    expect(scanner.handle.start).not.toHaveBeenCalled();
    expect(scannerActive.value).toBe(false); // #start bleibt logisch verfügbar
    expect(scanMessage.value).toBe(OFFLINE_SCAN_MSG);
    // Parity app.js L283 — byte-identisch (QE-Fix F1: kurzer Scan-Start-Text)
    expect(scanMessage.value).toBe(
      "Keine Internetverbindung — bitte wieder verbinden und erneut scannen.",
    );
    // #94-Seam läuft vor dem Offline-Guard (Parity L853 vor L857)
    expect(closeShareDialog).toHaveBeenCalledTimes(1);
  });

  it("QE-Fix F1 (JKA8RDZ-1): OFFLINE_SCAN_MSG ist byte-identisch zum kurzen Text aus web/app.js L283 (Verwendung L858)", () => {
    expect(OFFLINE_SCAN_MSG).toBe(
      "Keine Internetverbindung — bitte wieder verbinden und erneut scannen.",
    );
  });

  it("Adapter-Startfehler (Kamera nicht verfügbar) → scanMessage 'Kamera nicht verfügbar: <err>' (Parity L936), scannerActive bleibt false, erneuter Versuch möglich", async () => {
    const err = new Error("NotAllowedError: Permission denied");
    scanner.handle.start.mockRejectedValueOnce(err);

    await expect(startScan()).resolves.toBeUndefined();

    expect(scanMessage.value).toBe(`Kamera nicht verfügbar: ${err}`);
    expect(scannerActive.value).toBe(false);

    // #45: #start bleibt verfügbar — nächster Versuch startet erneut
    await startScan();
    expect(scanner.handle.start).toHaveBeenCalledTimes(2);
    expect(scannerActive.value).toBe(true);
  });

  it("#94-Seam: startScan ruft den injizierbaren closeShareDialog-Callback (Default: echtes ui.closeShareDialog, Call-Time-Deref)", async () => {
    const closeShareDialog = vi.fn();
    setScannerDepsForTests({ closeShareDialog });

    await startScan();

    expect(closeShareDialog).toHaveBeenCalledTimes(1);
    expect(scannerActive.value).toBe(true);
  });

  it("Default-Seam ist das echte ui.closeShareDialog — startScan ohne Injektion läuft normal durch", async () => {
    await expect(startScan()).resolves.toBeUndefined();
    expect(scannerActive.value).toBe(true);
  });

  it("torchSupported folgt handle.torchSupported nach erfolgreichem Start", async () => {
    await startScan();
    expect(torchSupported.value).toBe(false); // Mock-Default: kein Torch

    stopScan();
    scanner.setTorchSupported(true);
    await startScan();
    expect(torchSupported.value).toBe(true);
  });

  it("toggleTorch schaltet torchOn um und ruft applyTorch(!torchOn)", async () => {
    scanner.setTorchSupported(true);
    await startScan();

    expect(torchOn.value).toBe(false);
    await toggleTorch();
    expect(scanner.handle.applyTorch).toHaveBeenLastCalledWith(true);
    expect(torchOn.value).toBe(true);

    await toggleTorch();
    expect(scanner.handle.applyTorch).toHaveBeenLastCalledWith(false);
    expect(torchOn.value).toBe(false);
  });

  it("stopScan: torchOn bleibt als Modul-State erhalten (#3), torchSupported fällt auf false", async () => {
    scanner.setTorchSupported(true);
    await startScan();
    await toggleTorch();
    expect(torchOn.value).toBe(true);

    stopScan();

    expect(scannerActive.value).toBe(false);
    expect(torchOn.value).toBe(true); // #3: persistiert über den Stopp hinaus
    expect(torchSupported.value).toBe(false);
  });

  it("Neustart mit torchOn === true wendet applyTorch(true) erneut an (Parity L896–899)", async () => {
    scanner.setTorchSupported(true);
    await startScan();
    await toggleTorch(); // torchOn = true
    stopScan();
    scanner.handle.applyTorch.mockClear();

    await startScan();

    expect(scanner.handle.applyTorch).toHaveBeenCalledTimes(1);
    expect(scanner.handle.applyTorch).toHaveBeenCalledWith(true);
    expect(torchOn.value).toBe(true);
    expect(scannerActive.value).toBe(true);
  });

  it("Neustart ohne Torch-Support ruft applyTorch nicht auf, torchOn bleibt erhalten", async () => {
    scanner.setTorchSupported(true);
    await startScan();
    await toggleTorch();
    stopScan();
    scanner.handle.applyTorch.mockClear();
    scanner.setTorchSupported(false);

    await startScan();

    expect(scanner.handle.applyTorch).not.toHaveBeenCalled();
    expect(torchSupported.value).toBe(false);
    expect(torchOn.value).toBe(true);
  });

  it("applyTorch-Fehlschlag in toggleTorch zieht den Support zurück (torchSupported=false, torchOn=false) ohne unhandled rejection (Parity L943–948)", async () => {
    scanner.setTorchSupported(true);
    await startScan();
    await toggleTorch();
    expect(torchOn.value).toBe(true);

    scanner.handle.applyTorch.mockResolvedValue(false);
    await expect(toggleTorch()).resolves.toBeUndefined();

    expect(torchSupported.value).toBe(false);
    expect(torchOn.value).toBe(false);
  });

  it("stopScan ist ein No-Op, wenn der Scanner nicht aktiv ist", () => {
    stopScan();

    expect(pauseMock).not.toHaveBeenCalled();
    expect(scanner.handle.stop).not.toHaveBeenCalled();
    expect(scannerActive.value).toBe(false);
  });

  it("stopScan pausiert den Player genau einmal über currentPlayerHandle()?.pause() (#51) und stoppt den Adapter", async () => {
    await startScan();

    stopScan();

    expect(pauseMock).toHaveBeenCalledTimes(1);
    expect(scanner.handle.stop).toHaveBeenCalledTimes(1);
    expect(scannerActive.value).toBe(false);

    stopScan(); // No-Op — kein zweites pause()
    expect(pauseMock).toHaveBeenCalledTimes(1);
    expect(scanner.handle.stop).toHaveBeenCalledTimes(1);
  });

  it("stopScan ohne Player-Handle (null) pausiert nichts und wirft nicht", async () => {
    currentPlayerHandleMock.mockReturnValue(null);
    await startScan();

    expect(() => stopScan()).not.toThrow();
    expect(scannerActive.value).toBe(false);
  });

  it("resetForTests stellt alle Signale und Seams wieder her", async () => {
    const closeShareDialog = vi.fn();
    setScannerDepsForTests({ closeShareDialog });
    scanner.setTorchSupported(true);
    await startScan();
    await toggleTorch();
    stopScan();
    expect(torchOn.value).toBe(true);

    resetForTests();

    expect(scannerActive.value).toBe(false);
    expect(torchOn.value).toBe(false);
    expect(torchSupported.value).toBe(false);
    expect(scanMessage.value).toBeNull();

    // Seams zurück auf Default: injizierter Callback wird nicht mehr gerufen,
    // ein neues Adapter-Handle wird beim nächsten Start lazy erzeugt
    await startScan();
    expect(closeShareDialog).toHaveBeenCalledTimes(1);
    expect(createQrScannerMock).toHaveBeenCalledTimes(2);
    expect(scannerActive.value).toBe(true);
  });
});

describe("state/scanner — handleScannedText (Subtask JKA8RDZ-2)", () => {
  const ID_A = "4uLU6hMCjMI75M1A2tKUQC";
  const TRACK_A = `https://open.spotify.com/track/${ID_A}`;
  const TRACK_A_QUERY = `https://open.spotify.com/track/${ID_A}?si=xyz`;
  const INVALID = "https://example.com/kein-track";

  let closeSheetMock: Mock<() => void>;
  let nowValue: number;
  let vibrateRestore: (() => void) | null = null;

  /** navigator.vibrate ist in happy-dom nicht vorhanden — stub als own property, nach dem Test wieder entfernt. */
  function stubNavigatorVibrate(value: unknown): void {
    vibrateRestore?.();
    const prev = Object.getOwnPropertyDescriptor(navigator, "vibrate");
    Object.defineProperty(navigator, "vibrate", {
      configurable: true,
      writable: true,
      value,
    });
    vibrateRestore = () => {
      if (prev) {
        Object.defineProperty(navigator, "vibrate", prev);
      } else {
        delete (navigator as unknown as { vibrate?: unknown }).vibrate;
      }
    };
  }

  beforeEach(() => {
    closeSheetMock = vi.fn();
    nowValue = 1_000;
    playerMessage.value = null; // echtes player.ts-Signal (Partial-Mock) zurücksetzen
    // closeSheet-Seam #37 + Guard-Clock injizieren; vibrate läuft über den
    // echten navigator-Pfad (Default-Dep), gestubbt via stubNavigatorVibrate.
    setScannerDepsForTests({ closeSheet: closeSheetMock, now: () => nowValue });
  });

  afterEach(() => {
    vibrateRestore?.();
    vibrateRestore = null;
  });

  it("Verdict 'track': navigator.vibrate?.(80) → closeSheet → playTrack(trackId) in dieser Reihenfolge (Parity L560, L564–565, L568); scanMessage bleibt null", () => {
    const vibrateSpy = vi.fn<(pattern: number) => boolean>();
    stubNavigatorVibrate(vibrateSpy);

    handleScannedText(TRACK_A);

    expect(vibrateSpy).toHaveBeenCalledTimes(1);
    expect(vibrateSpy).toHaveBeenCalledWith(80);
    expect(closeSheetMock).toHaveBeenCalledTimes(1);
    expect(playTrackMock).toHaveBeenCalledTimes(1);
    expect(playTrackMock).toHaveBeenCalledWith(ID_A);
    expect(scanMessage.value).toBeNull();
    // Reihenfolge wie in web/app.js playScannedText: vibrate (L560) → closeSheet (L564) → playTrack (L568)
    expect(vibrateSpy.mock.invocationCallOrder[0]).toBeLessThan(
      closeSheetMock.mock.invocationCallOrder[0],
    );
    expect(closeSheetMock.mock.invocationCallOrder[0]).toBeLessThan(
      playTrackMock.mock.invocationCallOrder[0],
    );
  });

  it("#4 Progressive Enhancement: fehlendes navigator.vibrate (iOS-Safari) wirft nicht — closeSheet + playTrack laufen trotzdem", () => {
    stubNavigatorVibrate(undefined); // Property effektiv weg, wie in iOS Safari

    expect(() => handleScannedText(TRACK_A)).not.toThrow();
    expect(playTrackMock).toHaveBeenCalledTimes(1);
    expect(playTrackMock).toHaveBeenCalledWith(ID_A);
    expect(closeSheetMock).toHaveBeenCalledTimes(1);
  });

  it("Verdict 'invalid': scanMessage === 'Kein Spotify-Track erkannt: ' + text (byte-identisch L543); kein vibrate, kein closeSheet, kein playTrack", () => {
    const vibrateSpy = vi.fn<(pattern: number) => boolean>();
    stubNavigatorVibrate(vibrateSpy);

    handleScannedText(INVALID);

    // byte-identische Parity zur Konkatenation in web/app.js L543
    expect(scanMessage.value).toBe(
      "Kein Spotify-Track erkannt: https://example.com/kein-track",
    );
    expect(vibrateSpy).not.toHaveBeenCalled();
    expect(closeSheetMock).not.toHaveBeenCalled();
    expect(playTrackMock).not.toHaveBeenCalled();
  });

  it("Wiederholte invalid-Frames im Cooldown-Fenster setzen scanMessage nicht erneut (Guard: Meldung nur einmal pro Text/Zeitfenster)", () => {
    handleScannedText(INVALID);
    expect(scanMessage.value).toBe(`Kein Spotify-Track erkannt: ${INVALID}`);

    scanMessage.value = "SENTINEL";
    nowValue += 1_000;
    handleScannedText(INVALID); // derselbe Text im Fenster → ignored

    expect(scanMessage.value).toBe("SENTINEL");
  });

  it("Verdict 'ignored': Dublette innerhalb 5 s — auch über eine ANDERE URL mit derselben ID; kein vibrate, keine Message, kein playTrack, kein closeSheet (Parity L547–551)", () => {
    const vibrateSpy = vi.fn<(pattern: number) => boolean>();
    stubNavigatorVibrate(vibrateSpy);
    handleScannedText(TRACK_A);
    vibrateSpy.mockClear();
    closeSheetMock.mockClear();
    playTrackMock.mockClear();

    nowValue += 1_000;
    handleScannedText(TRACK_A); // derselbe Text
    handleScannedText(TRACK_A_QUERY); // andere URL, gleiche Track-ID

    expect(vibrateSpy).not.toHaveBeenCalled();
    expect(closeSheetMock).not.toHaveBeenCalled();
    expect(playTrackMock).not.toHaveBeenCalled();
    expect(scanMessage.value).toBeNull();
  });

  it("Nach Ablauf des Cooldowns (SCAN_COOLDOWN_MS) wird derselbe Track wieder akzeptiert — playTrack insgesamt zweimal", () => {
    handleScannedText(TRACK_A);
    nowValue += SCAN_COOLDOWN_MS - 1;
    handleScannedText(TRACK_A); // noch im Fenster → ignored
    expect(playTrackMock).toHaveBeenCalledTimes(1);

    nowValue += 1; // exakt SCAN_COOLDOWN_MS seit dem ersten Scan
    handleScannedText(TRACK_A);

    expect(playTrackMock).toHaveBeenCalledTimes(2);
    expect(playTrackMock).toHaveBeenNthCalledWith(1, ID_A);
    expect(playTrackMock).toHaveBeenNthCalledWith(2, ID_A);
  });

  it("onScan-Callback des Adapter-Handles ist an handleScannedText verdrahtet — Scans während des Laufs landen im Store", async () => {
    await startScan();
    expect(createQrScannerMock).toHaveBeenCalledTimes(1);
    const { onScan } = createQrScannerMock.mock.calls[0][0];

    onScan(TRACK_A);

    expect(playTrackMock).toHaveBeenCalledTimes(1);
    expect(playTrackMock).toHaveBeenCalledWith(ID_A);
    expect(closeSheetMock).toHaveBeenCalledTimes(1);
  });

  it("resetForTests() räumt den Guard-Zustand — dieselbe ID im selben Zeitfenster wird danach wieder akzeptiert", () => {
    handleScannedText(TRACK_A);
    expect(playTrackMock).toHaveBeenCalledTimes(1);

    resetForTests();
    handleScannedText(TRACK_A); // ohne Guard-Reset: ignored

    expect(playTrackMock).toHaveBeenCalledTimes(2);
    expect(playTrackMock).toHaveBeenNthCalledWith(2, ID_A);
  });

  it("A10 F7 (7MXKQ3V-1): playTrack-Rejection am fire-and-forget-Aufruf → KEIN unhandled rejection, console.error mit Fachdetails, playerMessage === QUEUE_FAIL_MSG", async () => {
    const err = new Error("TypeError: fetch failed");
    playTrackMock.mockRejectedValue(err);
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown): void => {
      unhandled.push(reason);
    };
    process.on("unhandledRejection", onUnhandled);
    try {
      handleScannedText(TRACK_A);

      // Der Scan selbst läuft unverändert ab: vibrate → closeSheet → playTrack
      expect(playTrackMock).toHaveBeenCalledTimes(1);
      expect(playTrackMock).toHaveBeenCalledWith(ID_A);
      expect(closeSheetMock).toHaveBeenCalledTimes(1);

      // Awaited flush: zwei Macrotask-Runden — eine unbehandelte Rejection
      // feuert spätestens hier als 'unhandledRejection' auf dem Prozess.
      await new Promise((resolve) => setTimeout(resolve, 0));
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(unhandled).toEqual([]);
      expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
      expect(consoleErrorSpy.mock.calls[0]).toContain(err); // Fachdetails nur Konsole (#10)
      expect(playerMessage.value).toBe(QUEUE_FAIL_MSG); // kuratierte UI-Meldung
    } finally {
      process.removeListener("unhandledRejection", onUnhandled);
      consoleErrorSpy.mockRestore();
    }
  });
});
