/**
 * Scanner-Store (Plan §5.2 scanner.ts, Spec §4; Parity zu web/app.js
 * QR-Scan L830–950, logout L236–243, Konstanten L283/L315).
 *
 * Teil 1 (Subtask JKA8RDZ-1): Lifecycle — Signale + startScan/stopScan/torch.
 * Teil 2 (Subtask JKA8RDZ-2): handleScannedText (Scan-Guard + Vibration #4 +
 * closeSheet-Seam #37 + playTrack) — hängt den onScan-Callback des
 * Adapter-Handles um.
 * Teil 3 (Subtask 7MXKQ3V-1, A10 F7): Der playTrack()-Aufruf in
 * handleScannedText ist fire-and-forget MIT .catch — eine Rejection landet
 * als console.error + QUEUE_FAIL_MSG in playerMessage, nie als unhandled
 * rejection.
 *
 * Der Store verdrahtet adapters/qr-scanner.ts (createQrScanner-Handle, lazy
 * beim ersten Start erzeugt — Gegenstück zum app.js-Modul-Singleton
 * `scanner`) mit den Browser-Globals. Der Player wird NICHT über
 * window.player angefasst, sondern über playTrack()/currentPlayerHandle()
 * aus state/player.ts (#51).
 */

import { effect, signal } from "@preact/signals";
import {
  type CreateQrScannerOptions,
  createQrScanner,
  type QrScannerHandle,
} from "../adapters/qr-scanner.ts";
import { createScanGuard, type ScanVerdict } from "../lib/scan-guard.ts";
import { authStatus } from "./auth.ts";
import {
  currentPlayerHandle,
  playerMessage,
  playTrack,
  QUEUE_FAIL_MSG,
} from "./player.ts";
import { closeShareDialog, closeSheet } from "./ui.ts";

/**
 * #17: Offline-Hinweis beim Scan-Start, landet in scanMessage (#53-Muster:
 * #result nur im Fehlerfall). Parity web/app.js L283 (Verwendung L858) —
 * byte-identisch. QE-Fix F1 (JKA8RDZ-1): der kurze Scan-Start-Text, nicht
 * der lange OFFLINE_MSG-Text der globalen Statuszeile (L282).
 */
export const OFFLINE_SCAN_MSG =
  "Keine Internetverbindung — bitte wieder verbinden und erneut scannen.";

/** #6 Stufe 2: Cooldown des Dubletten-Guards (Parity web/app.js SCAN_COOLDOWN_MS L315). */
export const SCAN_COOLDOWN_MS = 5_000;

/** #6 Stufe 2: Scanner läuft kontinuierlich — verhindert Doppel-Starts (Parity scannerActive). */
export const scannerActive = signal(false);
/** #3: Torch-Zustand als Modul-State — überlebt stopScan und wird beim nächsten Start neu angewendet. */
export const torchOn = signal(false);
/** Torch-Support des laufenden Scanners (Parity: torchBtn.hidden, L900–907/L922). */
export const torchSupported = signal(false);
/** Text für #result — wird nur im Fehlerfall gesetzt (Parity resultEl). */
export const scanMessage = signal<string | null>(null);

interface ScannerDeps {
  createScanner: (options: CreateQrScannerOptions) => QrScannerHandle;
  isOnline: () => boolean;
  closeShareDialog: () => void;
  closeSheet: () => void;
  now: () => number;
}

function browserDeps(): ScannerDeps {
  return {
    createScanner: (options) => createQrScanner(options),
    isOnline: () => navigator.onLine,
    // #94-Seam: Ein offener Share-Dialog weicht dem Scanner (Parity app.js
    // startScan L850–853: closeShareDialog()) — echtes closeShareDialog aus
    // state/ui.ts. Der ESM-Zyklus scanner<->ui ist sicher: die ui-Bindung
    // wird erst zur Aufrufzeit in diesem Arrow dereferenziert (wie beim
    // closeSheet-Seam unten).
    closeShareDialog: () => closeShareDialog(),
    // #37-Seam: Ein neuer Scan schiebt ein offenes Player-Sheet zu (Parity
    // app.js playScannedText L564–565: closeSheet()) — echtes closeSheet aus
    // state/ui.ts. Der ESM-Zyklus scanner<->ui ist sicher: die ui-Bindung
    // wird erst zur Aufrufzeit in diesem Arrow dereferenziert (ui liest
    // scannerActive nur lazy im computed).
    closeSheet: () => closeSheet(),
    now: () => Date.now(),
  };
}

let deps = browserDeps();

/** Test-Seam: einzelne Deps austauschen; resetForTests() stellt browserDeps() wieder her. */
export function setScannerDepsForTests(overrides: Partial<ScannerDeps>): void {
  deps = { ...browserDeps(), ...overrides };
}

/** Lazily erzeugtes Adapter-Handle; resetForTests() wirft es weg. */
let scannerHandle: QrScannerHandle | null = null;

/** Dubletten-Guard (#6 Stufe 2, Parity lastScanTrackId/lastInvalidScan L311–314) — lazy erzeugt, resetForTests() wirft ihn weg. */
let scanGuard: ((text: string) => ScanVerdict) | null = null;

function getScanGuard(): (text: string) => ScanVerdict {
  // now-Delegation liest deps.now() zum Aufrufzeitpunkt — setScannerDepsForTests
  // greift also auch nach der Erzeugung des Guards.
  scanGuard ??= createScanGuard(SCAN_COOLDOWN_MS, () => deps.now());
  return scanGuard;
}

function getScannerHandle(): QrScannerHandle {
  scannerHandle ??= deps.createScanner({
    // Scan-Handling: handleScannedText (Guard + vibrate + closeSheet +
    // playTrack, Parity playScannedText L534–568)
    onScan: handleScannedText,
  });
  return scannerHandle;
}

/**
 * Verarbeitet einen gescannten Text (Parity web/app.js playScannedText
 * L534–568): Der Dubletten-Guard (#6 Stufe 2, lib/scan-guard) entscheidet über
 * die Track-ID (nicht den Rohtext), dann —
 *
 * - "track": navigator.vibrate?.(80) (#4, L560 — progressive enhancement:
 *   navigator.vibrate fehlt z. B. in iOS Safari komplett, optional chaining,
 *   kein Fehler), dann closeSheet-Seam (#37, L564–565), dann
 *   playTrack(trackId) (L568) — fire-and-forget MIT .catch (A10 F7,
 *   7MXKQ3V-1): eine Rejection (Netzwerk-/Quota-Fehler) darf nie unhandled
 *   enden; Fachdetails gehen in die Konsole (#10), die kuratierte Meldung
 *   QUEUE_FAIL_MSG landet in playerMessage. Keine Erfolgsmeldung in
 *   scanMessage (#53).
 * - "invalid": scanMessage = "Kein Spotify-Track erkannt: " + text (L543,
 *   byte-identisch) — der Guard hebt die Meldung nur einmal pro
 *   Text/Zeitfenster, wiederholte Frames setzen sie nicht erneut.
 * - "ignored": nichts — kein Vibrieren, keine Meldung, kein Re-Play, kein
 *   closeSheet (L547–551).
 */
export function handleScannedText(text: string): void {
  const verdict = getScanGuard()(text);
  switch (verdict.kind) {
    case "track":
      navigator.vibrate?.(80); // #4 (L560)
      deps.closeSheet(); // #37 (L564–565)
      // L568 — A10 F7 (7MXKQ3V-1): playTrack() ist fire-and-forget; ohne
      // .catch würde eine Rejection (z. B. Netzwerk-/Quota-Fehler, den
      // player.ts absichtlich rethrowt) als unhandled rejection enden.
      playTrack(verdict.trackId).catch((err) => {
        console.error("Scan-Play fehlgeschlagen:", err); // Fachdetails nur Konsole (#10)
        playerMessage.value = QUEUE_FAIL_MSG; // kuratierte UI-Meldung aus ./player.ts
      });
      return;
    case "invalid":
      // L543 ("Kein Spotify-Track erkannt: " + text) — byte-identisch
      scanMessage.value = `Kein Spotify-Track erkannt: ${text}`;
      return;
    case "ignored":
      return;
  }
}

/**
 * Wendet den Torch-Zustand auf die Kamera an (Parity app.js applyTorch
 * L841–845 — hier über die Adapter-API applyTorch(on): Promise<boolean>, der
 * Adapter verwirft Fehlschläge selbst zu false). torchOn wird erst nach
 * Erfolg gesetzt.
 */
async function applyTorch(on: boolean): Promise<boolean> {
  const handle = scannerHandle;
  if (handle === null) return false;
  const ok = await handle.applyTorch(on);
  if (ok) torchOn.value = on;
  return ok;
}

/**
 * Startet den kontinuierlichen Scan (Parity web/app.js startScan L852–907):
 * Doppel-Start-Guard (#6 Stufe 2), #94-Seam, Offline-Guard (#17: kein
 * Kamera-Start, OFFLINE_SCAN_MSG in scanMessage), scannerActive erst NACH
 * erfolgreichem Adapter-start (#45), dann Torch-Support übernehmen und einen
 * persistierten torchOn-Zustand (#3) wieder anwenden (L896–899). Ein
 * Startfehler landet als „Kamera nicht verfügbar: <err>“ in scanMessage
 * (Parity L936) — scannerActive bleibt false, der Start bleibt verfügbar.
 */
export async function startScan(): Promise<void> {
  if (scannerActive.value) return; // #6 Stufe 2: bereits laufend — kein Neustart
  deps.closeShareDialog(); // #94: offener QR-Dialog weicht dem Scanner (L853)
  const handle = getScannerHandle();
  if (!deps.isOnline()) {
    // #17: offline keinen Kamera-Start wagen — die Wiedergabe bräche ohnehin
    // sofort ab (L857–860)
    scanMessage.value = OFFLINE_SCAN_MSG;
    return;
  }
  try {
    await handle.start();
  } catch (err) {
    // Kamera braucht HTTPS oder localhost
    scanMessage.value = `Kamera nicht verfügbar: ${err}`;
    return;
  }
  scannerActive.value = true; // #45: erst nach erfolgreichem Start (L893)
  // #3: Torch-Support erst nach erfolgreichem Start übernehmen (L900–907)
  torchSupported.value = handle.torchSupported;
  if (torchSupported.value && torchOn.value) {
    await applyTorch(true); // Zustand nach Neustart wiederherstellen (L896–899)
  }
}

/**
 * Stoppt den Scanner (Parity web/app.js stopScan L916–929): No-Op wenn nicht
 * aktiv; pausiert die Wiedergabe genau einmal über
 * currentPlayerHandle()?.pause() (#51 — der Player bleibt verbunden, der
 * nächste Scan startet direkt den nächsten Track); stoppt den Adapter;
 * torchOn bleibt als Modul-State erhalten (#3), torchSupported fällt auf false.
 */
export function stopScan(): void {
  if (!scannerActive.value) return;
  scannerActive.value = false;
  currentPlayerHandle()?.pause(); // #51: Hör-Situation komplett beenden
  if (scannerHandle !== null) {
    // #45: Kamera evtl. schon zu — der Adapter verwirft das selbst zu undefined.
    void scannerHandle.stop().catch(() => {});
  }
  torchSupported.value = false;
}

/**
 * Schaltet die Taschenlampe um (Parity web/app.js torchBtn-Handler L943–950):
 * applyTorch(!torchOn). Schlägt das Umschalten fehl (Support weggezogen), wird
 * torchSupported zurückgezogen und torchOn auf false gesetzt — kein Fehler,
 * keine unhandled rejection.
 */
export async function toggleTorch(): Promise<void> {
  if (scannerHandle === null) return;
  const ok = await applyTorch(!torchOn.value);
  if (!ok) {
    torchSupported.value = false;
    torchOn.value = false;
  }
}

/**
 * Logout-Reaktion (Parity web/app.js logout L240–243): die Kamera darf in
 * der Login-Ansicht nicht weiterlaufen. Idempotent über den scannerActive-
 * Guard in stopScan — Per-Store-Muster wie in state/player.ts (auth.ts
 * überlässt diese Reaktionen den Stores).
 */
effect(() => {
  if (authStatus.value === "logged-out") {
    stopScan();
  }
});

/** Stellt Signale, Adapter-Handle, Guard-Zustand und Deps für Test-Isolation wieder her. */
export function resetForTests(): void {
  scannerActive.value = false;
  torchOn.value = false;
  torchSupported.value = false;
  scanMessage.value = null;
  scannerHandle = null;
  scanGuard = null;
  deps = browserDeps();
}
