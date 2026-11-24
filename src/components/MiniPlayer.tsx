import { currentPlayerHandle, playerState } from "../state/player.ts";
import { miniPlayerVisible, openSheet, spoilerOpen } from "../state/ui.ts";
import { PauseIcon, PlayIcon } from "./icons.tsx";
import styles from "./MiniPlayer.module.css";

/**
 * Persistenter Mini-Player (Parity web/index.html L219–231, web/app.js
 * renderPlayerState L405–430, show L580, handleState L427–430, Listener
 * L707; Issue-Kommentare siehe web/index.html und MiniPlayer.module.css).
 * Mount in <main> nach dem PlayerSheet (app.tsx, web/index.html L219).
 *
 * hidden folgt miniPlayerVisible (computed aus state/ui.ts:
 * trackLoaded && !sheetOpen && scannerActive — #7/#47, Parity app.js
 * show L580 + handleState L427–430).
 *
 * #7/#61/#66: .revealed folgt spoilerOpen (computed aus sheetOpen) — die
 * Leiste deckt synchron mit dem PlayerSheet auf/ab (app.js spoiler-toggle
 * L429–437).
 */
export function MiniPlayer() {
  const visible = miniPlayerVisible.value;
  const state = playerState.value;
  const track = state?.track_window.current_track;
  // app.js L390–397: Titel = current_track.name, Künstler komma-joined,
  // Cover = album.images[0] (hidden ohne Image).
  const img = track?.album.images[0];
  const revealed = spoilerOpen.value;
  const paused = state?.paused ?? true;
  return (
    <div
      id="mini-player"
      class={`${styles["mini-player"]}${revealed ? ` ${styles.revealed}` : ""}${
        state !== null && !state.paused ? ` ${styles.playing}` : ""
      }`}
      hidden={!visible}
    >
      {/* #7: Tap auf die Infos öffnet das Player-Sheet (app.js L707). */}
      <button
        type="button"
        id="mini-open"
        class={styles["mini-open"]}
        aria-label="Aktuellen Song im Player anzeigen"
        onClick={openSheet}
      >
        <img
          id="mini-cover"
          class={styles["mini-cover"]}
          alt=""
          width={44}
          height={44}
          hidden={!img}
          src={img?.url}
        />
        <span class={styles["mini-meta"]}>
          {/* Modul-Klassen tragen den Spoiler-Blur/die Ellipsis-Regeln aus
              MiniPlayer.module.css (.mini-title/.mini-artist, revealed-Regeln) —
              ohne sie wären Titel/Künstler unverschleiert sichtbar (#7/#16). */}
          <span id="mini-title" class={styles["mini-title"]}>
            {track?.name}
          </span>
          <span id="mini-artist" class={styles["mini-artist"]}>
            {track?.artists.map((a) => a.name).join(", ")}
          </span>
        </span>
      </button>
      {/* #1/#29 (app.js L417–421): Icon zeigt die NÄCHSTE AKTION — .paused
          steuert per CSS, welches Icon sichtbar ist; Klick →
          currentPlayerHandle()?.togglePlay(). hidden solange playerState null. */}
      <button
        type="button"
        id="mini-toggle"
        class={`${styles["mini-toggle"]}${paused ? ` ${styles.paused}` : ""}`}
        hidden={state === null}
        aria-label={paused ? "Wiedergabe fortsetzen" : "Wiedergabe pausieren"}
        onClick={() => currentPlayerHandle()?.togglePlay()}
      >
        <PlayIcon class={styles["icon-play"]} />
        <PauseIcon class={styles["icon-pause"]} />
      </button>
    </div>
  );
}
