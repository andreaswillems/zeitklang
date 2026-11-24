import { currentPlayerHandle, playerState } from "../state/player.ts";
import { closeSheet, sheetOpen, spoilerOpen } from "../state/ui.ts";
import { PauseIcon, PlayIcon, SheetCloseIcon } from "./icons.tsx";
import styles from "./PlayerSheet.module.css";

/**
 * Player-Bottom-Sheet (Parity web/index.html L188–218, web/app.js openSheet
 * L659, closeSheet L681, renderPlayerState/handleState L385–437, Listener
 * L708–709; Issue-Kommentare siehe web/index.html und PlayerSheet.module.css).
 * Rendert #sheet-backdrop + #player-sheet als Geschwister der Sektionen —
 * der Mount in <main> bleibt in app.tsx (web/index.html L191 ff.).
 *
 * hidden folgt direkt !sheetOpen (deklarativ); die animierte Sheet-Fahrt
 * (open-Klasse via requestAnimationFrame, verzögertes hidden beim Schließen)
 * aus app.js L660–680 ist bewusst nicht portiert — Animationen sind Sache
 * der CSS-Übergänge, das Sheet erscheint/verschwindet ohne Frame-Trick.
 *
 * #61/#66: .revealed folgt spoilerOpen (computed aus sheetOpen) — Öffnen
 * enthüllt, Schließen verhüllt; kein manueller Spoiler-Toggle mehr (das
 * <details id="spoiler"> aus web/index.html L213–217 entfällt, der State
 * lebt im ui-Store).
 */
export function PlayerSheet() {
  const open = sheetOpen.value;
  const state = playerState.value;
  const track = state?.track_window.current_track;
  // app.js L392–397: Titel = current_track.name, Künstler komma-joined,
  // Cover = album.images[0] (hidden ohne Image).
  const img = track?.album.images[0];
  const revealed = spoilerOpen.value;
  const paused = state?.paused ?? true;
  return (
    <>
      {/* Backdrop: Tap schließt das Sheet (app.js L708–709). Rein dekorative
          Fläche — die Tastatur-Alternative ist der #sheet-close-Button. */}
      {/* biome-ignore lint/a11y/noStaticElementInteractions: Backdrop-Tap = closeSheet (Parity app.js L708–709); Tastatur-Nutzer schließen über #sheet-close */}
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: s.o. — kein Tastatur-Äquivalent nötig, #sheet-close ist fokussierbar */}
      <div
        id="sheet-backdrop"
        class={`${styles["sheet-backdrop"]}${open ? ` ${styles.open}` : ""}`}
        hidden={!open}
        onClick={closeSheet}
      />
      <section
        id="player-sheet"
        class={`${styles["player-sheet"]}${open ? ` ${styles.open}` : ""}`}
        hidden={!open}
        role="dialog"
        aria-modal="true"
        aria-label="Aktueller Song"
      >
        {/* #37: Chevron schließt das Sheet (app.js L708). */}
        <button
          type="button"
          id="sheet-close"
          class={`ghost ${styles["sheet-close"]}`}
          aria-label="Player schließen"
          onClick={closeSheet}
        >
          <SheetCloseIcon />
        </button>
        <div
          id="now-playing"
          class={`${styles["now-playing"]}${revealed ? ` ${styles.revealed}` : ""}${
            state !== null && !state.paused ? ` ${styles.playing}` : ""
          }`}
        >
          <img
            id="cover"
            class={styles.cover}
            alt="Album-Cover"
            width={92}
            height={92}
            hidden={!img}
            src={img?.url}
          />
          <div class={styles["np-meta"]}>
            {/* Equalizer-Deko, läuft nur bei .playing (CSS :not(.playing)) */}
            <div class={styles.eq} aria-hidden="true">
              <span />
              <span />
              <span />
            </div>
            <p id="np-title" class={styles["np-title"]}>
              {track?.name}
            </p>
            <p id="np-artist" class={styles["np-artist"]}>
              {track?.artists.map((a) => a.name).join(", ")}
            </p>
          </div>
          {/* #1/#29 (app.js L400–406, L651): Icon zeigt die NÄCHSTE AKTION —
              .paused steuert per CSS, welches Icon sichtbar ist; Klick →
              currentPlayerHandle()?.togglePlay(). hidden solange playerState null. */}
          <button
            type="button"
            id="toggle"
            class={`${styles.toggle}${paused ? ` ${styles.paused}` : ""}`}
            hidden={state === null}
            aria-label={paused ? "Wiedergabe fortsetzen" : "Wiedergabe pausieren"}
            onClick={() => currentPlayerHandle()?.togglePlay()}
          >
            <PlayIcon class={styles["icon-play"]} />
            <PauseIcon class={styles["icon-pause"]} />
          </button>
        </div>
      </section>
    </>
  );
}
