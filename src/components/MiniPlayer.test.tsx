import { act, fireEvent, render } from "@testing-library/preact";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SpotifyPlaybackState } from "../adapters/spotify-sdk.ts";
import { resetForTests as resetAuth } from "../state/auth.ts";
import { playerState, resetForTests as resetPlayer } from "../state/player.ts";
import { resetForTests as resetScanner, scannerActive } from "../state/scanner.ts";
import {
  miniPlayerVisible,
  resetForTests as resetUi,
  sheetOpen,
  spoilerOpen,
} from "../state/ui.ts";
import styles from "./MiniPlayer.module.css";
import { MiniPlayer } from "./MiniPlayer.tsx";
import sheetStyles from "./PlayerSheet.module.css";
import { PlayerSheet } from "./PlayerSheet.tsx";

// Komponenten-Tests des MiniPlayers (Subtask KDT2C73-2): Parity zu
// web/index.html L219–231 (#mini-player/#mini-open/#mini-cover/.mini-meta/
// #mini-title/#mini-artist/#mini-toggle) und web/app.js (renderPlayerState
// L405–430, show L580, handleState L427–430, spoiler-toggle L429–437,
// Listener L707). Echte Stores mit resetForTests() pro Test (Muster:
// PlayerSheet.test.tsx); playerState wird direkt mit Track-Fixtures gesetzt,
// currentPlayerHandle ist ein Spy — importOriginal hält die Signal-Instanzen
// für ui.ts intakt.
const { togglePlayMock } = vi.hoisted(() => ({ togglePlayMock: vi.fn() }));
vi.mock("../state/player.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../state/player.ts")>()),
  currentPlayerHandle: () => ({ togglePlay: togglePlayMock }),
}));

beforeEach(() => {
  resetAuth();
  resetPlayer();
  resetScanner();
  resetUi();
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

function trackFixture(overrides?: {
  paused?: boolean;
  images?: Array<{ url: string }>;
}): SpotifyPlaybackState {
  return {
    paused: overrides?.paused ?? false,
    track_window: {
      current_track: {
        name: "Songtitel",
        artists: [{ name: "Künstler A" }, { name: "Künstler B" }],
        album: {
          images: overrides?.images ?? [{ url: "https://img.example/cover.jpg" }],
        },
      },
    },
  };
}

describe("MiniPlayer (Parity web/index.html L219–231 + app.js L405–437/L580/L707)", () => {
  it("#mini-player hidden folgt miniPlayerVisible — die drei Bedingungen einzeln variiert (trackLoaded / !sheetOpen / scannerActive; app.js show L580 + handleState L427–430)", () => {
    const { container } = render(<MiniPlayer />);
    const bar = container.querySelector("#mini-player") as Element;
    // kein Track → hidden, auch mit laufendem Scanner
    act(() => {
      scannerActive.value = true;
    });
    expect(miniPlayerVisible.value).toBe(false);
    expect(bar).not.toBeVisible();
    // Track geladen + Sheet geschlossen + Scanner aktiv → sichtbar
    act(() => {
      playerState.value = trackFixture();
    });
    expect(miniPlayerVisible.value).toBe(true);
    expect(bar).toBeVisible();
    // Bedingung Sheet geschlossen (#37): Sheet offen → Leiste redundant, hidden
    act(() => {
      sheetOpen.value = true;
    });
    expect(bar).not.toBeVisible();
    act(() => {
      sheetOpen.value = false;
    });
    expect(bar).toBeVisible();
    // Bedingung Scanner aktiv (#47): Scanner gestoppt → hidden
    act(() => {
      scannerActive.value = false;
    });
    expect(bar).not.toBeVisible();
    act(() => {
      scannerActive.value = true;
    });
    expect(bar).toBeVisible();
    // Bedingung Track geladen: playerState null → hidden
    act(() => {
      playerState.value = null;
    });
    expect(bar).not.toBeVisible();
  });

  it(".revealed am #mini-player folgt spoilerOpen (computed aus sheetOpen) — deckt synchron mit dem PlayerSheet auf/ab (#7/#61/#66, app.js spoiler-toggle L429–437)", () => {
    const { container } = render(
      <>
        <MiniPlayer />
        <PlayerSheet />
      </>,
    );
    const bar = container.querySelector("#mini-player") as Element;
    const card = container.querySelector("#now-playing") as Element;
    act(() => {
      playerState.value = trackFixture();
    });
    expect(spoilerOpen.value).toBe(false);
    expect(bar.classList.contains(styles.revealed)).toBe(false);
    expect(card.classList.contains(sheetStyles.revealed)).toBe(false);
    act(() => {
      sheetOpen.value = true;
    });
    expect(spoilerOpen.value).toBe(true);
    expect(bar.classList.contains(styles.revealed)).toBe(true);
    expect(card.classList.contains(sheetStyles.revealed)).toBe(true);
    act(() => {
      sheetOpen.value = false;
    });
    expect(bar.classList.contains(styles.revealed)).toBe(false);
    expect(card.classList.contains(sheetStyles.revealed)).toBe(false);
  });

  it('#mini-open (aria-label, Klick → openSheet(), app.js L707) mit #mini-cover (alt="", 44×44, src aus playerState, hidden ohne Image) und .mini-meta mit #mini-title/#mini-artist (app.js L405–413)', () => {
    const { container } = render(<MiniPlayer />);
    const open = container.querySelector("#mini-open") as Element;
    expect(open).toHaveAttribute("aria-label", "Aktuellen Song im Player anzeigen");
    // openSheet-Guard (state/ui.ts): ohne Track öffnet der Klick nicht
    fireEvent.click(open);
    expect(sheetOpen.value).toBe(false);
    act(() => {
      playerState.value = trackFixture();
      scannerActive.value = true;
    });
    fireEvent.click(open);
    expect(sheetOpen.value).toBe(true);
    act(() => {
      sheetOpen.value = false;
    });
    // QE-Befund KDT2C73-2: Die portierten Blur-/Typografie-Regeln
    // (.mini-cover/.mini-meta/.mini-title/.mini-artist + revealed-Regeln in
    // MiniPlayer.module.css) brauchen ihre Modul-Klassen an den Ziel-Elementen
    // — sonst greifen sie nie und der Spoiler-Blur fehlt (#7/#16).
    expect(open).toHaveClass(styles["mini-open"]);
    const cover = container.querySelector("#mini-cover") as HTMLImageElement;
    expect(cover).toHaveAttribute("alt", "");
    expect(cover).toHaveAttribute("width", "44");
    expect(cover).toHaveAttribute("height", "44");
    expect(cover).toBeVisible();
    expect(cover.src).toBe("https://img.example/cover.jpg");
    expect(cover).toHaveClass(styles["mini-cover"]);
    const meta = open.querySelector("[class*='mini-meta']") as Element;
    expect(meta).not.toBeNull();
    expect(meta).toHaveClass(styles["mini-meta"]);
    const title = container.querySelector("#mini-title") as Element;
    const artist = container.querySelector("#mini-artist") as Element;
    expect(title).toHaveClass(styles["mini-title"]);
    expect(artist).toHaveClass(styles["mini-artist"]);
    expect(title.textContent).toBe("Songtitel");
    expect(artist.textContent).toBe("Künstler A, Künstler B");
    // ohne Album-Image: #mini-cover hidden (app.js L410)
    act(() => {
      playerState.value = trackFixture({ images: [] });
    });
    expect(container.querySelector("#mini-cover")).not.toBeVisible();
  });

  it("#mini-toggle: hidden solange playerState null; PlayIcon/PauseIcon (icon-play/icon-pause) + .paused + aria-label folgen paused (app.js L414–421); Klick → currentPlayerHandle()?.togglePlay(); .playing am #mini-player folgt !paused (app.js L416)", () => {
    const { container } = render(<MiniPlayer />);
    const bar = container.querySelector("#mini-player") as Element;
    const toggle = container.querySelector("#mini-toggle") as Element;
    act(() => {
      scannerActive.value = true;
    });
    // hidden solange playerState null — am Button selbst (die Leiste ist ohne
    // Track ohnehin hidden, siehe erster Test)
    expect(toggle).toHaveAttribute("hidden");
    act(() => {
      playerState.value = trackFixture({ paused: false });
    });
    expect(bar).toBeVisible();
    expect(toggle).toBeVisible();
    expect(toggle).not.toHaveAttribute("hidden");
    expect(toggle).toHaveAttribute("aria-label", "Wiedergabe pausieren");
    expect(toggle.classList.contains(styles.paused)).toBe(false);
    expect(bar.classList.contains(styles.playing)).toBe(true);
    const icons = toggle.querySelectorAll("svg");
    expect(icons).toHaveLength(2); // PlayIcon + PauseIcon
    expect(icons[0].classList.contains(styles["icon-play"])).toBe(true);
    expect(icons[1].classList.contains(styles["icon-pause"])).toBe(true);
    fireEvent.click(toggle);
    expect(togglePlayMock).toHaveBeenCalledTimes(1);
    act(() => {
      playerState.value = trackFixture({ paused: true });
    });
    expect(toggle).toHaveAttribute("aria-label", "Wiedergabe fortsetzen");
    expect(toggle.classList.contains(styles.paused)).toBe(true);
    expect(bar.classList.contains(styles.playing)).toBe(false);
  });
});
