import { useEffect, useRef } from "preact/hooks";
import { renderShareQr } from "../adapters/share-qr.ts";
import { closeShareDialog, shareDialogOpen } from "../state/ui.ts";
import { CloseIcon } from "./icons.tsx";
import styles from "./ShareDialog.module.css";

/**
 * Share-QR-Dialog „App teilen“ (#94, Parity web/index.html L238–247,
 * web/app.js appUrl L771–773, openShareDialog L808–814, closeShareDialog
 * L816–819, Listener L821–829; Issue-Kommentare siehe web/index.html und
 * ShareDialog.module.css). Rendert #share-backdrop + #share-dialog als
 * Geschwister der Sektionen — der Mount in <main> bleibt in app.tsx.
 *
 * hidden folgt direkt !shareDialogOpen (deklarativ). Das QR-Rendering ist
 * eine Reaktion auf das Signal im Komponenten-Effekt (nicht imperativ im
 * Store — der #94-Kommentar in state/ui.ts nennt das als Phase 3e); der
 * URL-Text ist derived render (location ändert sich ohne Seitenladung nie).
 */
export function ShareDialog() {
  const open = shareDialogOpen.value;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // appUrl() (app.js L771–773): Origin + Pfad, bewusst ohne Query —
  // ?code=… aus dem OAuth-Redirect bleibt draußen.
  const url = location.origin + location.pathname;

  // Parity openShareDialog (app.js L808–814): QR aufs Canvas beim Öffnen.
  // renderShareQr ist async (Lazy-Import von qrcode-generator, XK91FVT) —
  // fire-and-forget; bis das Lazy-Chunk geladen ist, bleibt #share-url sichtbar.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!open || !canvas) return;
    void renderShareQr(canvas, url);
  }, [open, url]);

  // Esc schließt den QR-Dialog (app.js L825–829) — auf dem Handy sind
  // Backdrop-Tap und X-Icon die Wege, Esc der Weg über die Desktop-Tastatur.
  // Listener lebt hier in der Komponente (nicht main.tsx): ShareDialog ist
  // immer montiert, damit ist der Listener wie im Original global aktiv.
  // Kein Open-Guard — closeShareDialog() ist idempotent.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeShareDialog();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <>
      {/* Backdrop: Tap schließt den Dialog (app.js L824). Rein dekorative
          Fläche — die Tastatur-Alternativen sind #share-close und Esc. */}
      {/* biome-ignore lint/a11y/noStaticElementInteractions: Backdrop-Tap = closeShareDialog (Parity app.js L824); Tastatur-Nutzer schließen über #share-close/Esc */}
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: s.o. — kein Tastatur-Äquivalent nötig, #share-close ist fokussierbar */}
      <div
        id="share-backdrop"
        class={styles["share-backdrop"]}
        hidden={!open}
        onClick={closeShareDialog}
      />
      <section
        id="share-dialog"
        class={styles["share-dialog"]}
        hidden={!open}
        role="dialog"
        aria-modal="true"
        aria-label="App teilen"
      >
        <button
          type="button"
          id="share-close"
          class={styles["share-close"]}
          aria-label="Schließen"
          onClick={closeShareDialog}
        >
          <CloseIcon />
        </button>
        <p class={styles["share-title"]}>App auf anderem Handy öffnen</p>
        <canvas
          id="share-qr"
          class={styles["share-qr"]}
          ref={canvasRef}
          width={328}
          height={328}
        />
        <p id="share-url" class={styles["share-url"]}>
          {url}
        </p>
      </section>
    </>
  );
}
