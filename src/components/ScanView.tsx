import {
  scanMessage,
  scannerActive,
  startScan,
  stopScan,
  toggleTorch,
  torchOn,
  torchSupported,
} from "../state/scanner.ts";
import { installPrompt, openShareDialog, promptInstall } from "../state/ui.ts";
import {
  InstallIcon,
  MusicNoteIcon,
  QrIcon,
  ScanStopIcon,
  StepArrowIcon,
  TagIcon,
  TorchIcon,
} from "./icons.tsx";
import styles from "./ScanView.module.css";

/**
 * Scan-Ansicht (Parity web/index.html L106–184, Issue-Kommentare siehe
 * web/index.html und ScanView.module.css): #reader-wrap mit #reader
 * (Mount-Punkt für html5-qrcode — adapters/qr-scanner.ts new
 * Html5Qrcode("reader"), die DOM-id bleibt), Torch (#3), Scan-Stopp (#45),
 * Start-Button in der Daumenzone (#62), Guide-Karte (#70) mit
 * #install-scan (#18) und #share-scan (#94) sowie Ergebniszeile #result.
 * Die Sektions-Hülle (id="scan", hidden-Switch auf view()) bleibt in
 * app.tsx (3a).
 *
 * Guide-Sichtbarkeit: direkt über das scannerActive-Signal (hidden-Attribut
 * auf #guide) statt nur per CSS-:has() — im Browser äquivalent zur
 * :has()-Regel (derselbe Signal-Zustand wie #start), in den Komponenten-Tests
 * ohne angewendetes CSS direkt prüfbar. Die :has()-Regeln bleiben zur Parity
 * im ScanView.module.css.
 */
export function ScanView() {
  const active = scannerActive.value;
  return (
    <>
      {/* #45/#47/#62: Anker-Wrapper für die Overlay-Buttons über dem
          Kamerabild — Torch oben links (#3), Scan-Stopp oben rechts (#45). */}
      <div id="reader-wrap" class={styles["reader-wrap"]}>
        {/* html5-qrcode-Mount-Punkt — DOM-id "reader" bleibt
            (adapters/qr-scanner.ts). */}
        <div id="reader" class={styles.reader} />
        {/* #3: Taschenlampe für dunkle Umgebung; hidden bis der Torch-Support
            des Geräts erkannt wurde, aria-pressed folgt torchOn. */}
        <button
          type="button"
          id="torch"
          class={styles.torch}
          hidden={!torchSupported.value}
          aria-pressed={torchOn.value}
          aria-label="Taschenlampe"
          onClick={() => void toggleTorch()}
        >
          <TorchIcon />
        </button>
        {/* #45: Scanner manuell stoppen — hidden solange !scannerActive. */}
        <button
          type="button"
          id="scan-stop"
          class={styles["scan-stop"]}
          hidden={!active}
          aria-label="Scan stoppen"
          onClick={() => stopScan()}
        >
          <ScanStopIcon />
        </button>
        {/* #62: Start-Button in der Daumenzone; hidden solange der Scanner
            läuft. Der sichtbare Text „Scannen“ ist der zugängliche Name —
            ein aria-label entfällt bewusst (WCAG 2.5.3 „Label in Name“). */}
        <button
          type="button"
          id="start"
          class={styles.start}
          hidden={active}
          onClick={() => void startScan()}
        >
          <QrIcon />
          <span>Scannen</span>
        </button>
        {/* #70: Onboarding-Kurzanleitung — nur bei gestopptem Scanner
            sichtbar (hidden folgt scannerActive, äquivalent zur
            :has()-Regel im ScanView.module.css). Pfeile rein dekorativ. */}
        <div id="guide" class={styles.guide} hidden={active}>
          <div class={styles["guide-card"]}>
            <p class={styles["guide-title"]}>So funktioniert’s</p>
            <ol class={styles["guide-steps"]}>
              <li>
                <span class={styles["step-icon"]}>
                  <QrIcon />
                </span>
                <span class={styles["step-text"]}>
                  <strong>Karte scannen</strong>
                  <small>QR-Kärtchen vor die Kamera halten</small>
                </span>
                <StepArrowIcon class={styles["step-arrow"]} />
              </li>
              <li>
                <span class={styles["step-icon"]}>
                  <MusicNoteIcon />
                </span>
                <span class={styles["step-text"]}>
                  <strong>Song hören</strong>
                  <small>Der Song spielt auf deinem Handy</small>
                </span>
                <StepArrowIcon class={styles["step-arrow"]} />
              </li>
              <li>
                <span class={styles["step-icon"]}>
                  <TagIcon />
                </span>
                <span class={styles["step-text"]}>
                  <strong>Titel ansehen</strong>
                  <small>Tippe auf die Leiste und enthülle Titel und Interpret</small>
                </span>
              </li>
            </ol>
            {/* #18: Install-Button in der Guide-Karte — hidden bis
                installPrompt (beforeinstallprompt); Klick → promptInstall(). */}
            <button
              type="button"
              id="install-scan"
              class={`ghost ${styles["install-scan"]}`}
              hidden={installPrompt.value === null}
              onClick={() => void promptInstall()}
            >
              <InstallIcon />
              <span>App installieren</span>
            </button>
            {/* #94: „App teilen“ in der Guide-Karte — Klick → openShareDialog()
                (der QR-Dialog selbst folgt in Phase 3e). */}
            <button
              type="button"
              id="share-scan"
              class={`ghost ${styles["share-scan"]}`}
              onClick={openShareDialog}
            >
              <QrIcon />
              <span>App teilen</span>
            </button>
          </div>
        </div>
      </div>
      {/* #53: Ergebniszeile — Text nur im Fehlerfall (scanMessage). */}
      <p id="result" class={styles.result} role="status">
        {scanMessage.value}
      </p>
    </>
  );
}
