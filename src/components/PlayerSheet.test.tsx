import { act, fireEvent, render } from "@testing-library/preact";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SpotifyPlaybackState } from "../adapters/spotify-sdk.ts";
import { resetForTests as resetAuth } from "../state/auth.ts";
import {
  currentPlayerHandle,
  playerState,
  resetForTests as resetPlayer,
} from "../state/player.ts";
import { resetForTests as resetScanner } from "../state/scanner.ts";
import {
  closeSheet,
  resetForTests as resetUi,
  sheetOpen,
  spoilerOpen,
} from "../state/ui.ts";
import styles from "./PlayerSheet.module.css";
import { PlayerSheet } from "./PlayerSheet.tsx";

// Komponenten-Tests des PlayerSheets (Subtask KDT2C73-1): Parity zu
// web/index.html L188–218 (#sheet-backdrop/#player-sheet) und web/app.js
// (openSheet L659, closeSheet L681, handleState/renderPlayerState L385–437,
// Spoiler-toggle L429–437, Listener L708–709). Echte Stores mit
// resetForTests() pro Test (Muster: ScanView.test.tsx); playerState wird
// direkt mit Track-Fixtures gesetzt, currentPlayerHandle ist ein Spy —
// importOriginal hält die Signal-Instanzen für ui.ts intakt.
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

describe("PlayerSheet (Parity web/index.html L188–218 + app.js L385–437/L659–709)", () => {
  it("#sheet-backdrop + #player-sheet: hidden ohne sheetOpen, dialog-Rolle/Labels bei Open; kein Auto-Open beim Play (#6 Stufe 2)", () => {
    const { container } = render(<PlayerSheet />);
    const backdrop = container.querySelector("#sheet-backdrop") as Element;
    const sheet = container.querySelector("#player-sheet") as Element;
    expect(backdrop).not.toBeVisible();
    expect(sheet).not.toBeVisible();
    expect(sheet).toHaveAttribute("role", "dialog");
    expect(sheet).toHaveAttribute("aria-modal", "true");
    expect(sheet).toHaveAttribute("aria-label", "Aktueller Song");
    // #6 Stufe 2 (app.js L481–483): Track-State allein öffnet das Sheet nicht.
    act(() => {
      playerState.value = trackFixture();
    });
    expect(sheetOpen.value).toBe(false);
    expect(sheet).not.toBeVisible();
    act(() => {
      sheetOpen.value = true;
    });
    expect(backdrop).toBeVisible();
    expect(sheet).toBeVisible();
  });

  it("#sheet-close (ghost, aria-label) und Backdrop-Klick rufen closeSheet() auf (app.js L708–709)", () => {
    const { container } = render(<PlayerSheet />);
    act(() => {
      sheetOpen.value = true;
    });
    const close = container.querySelector("#sheet-close") as Element;
    expect(close).toHaveAttribute("aria-label", "Player schließen");
    expect(close.className).toContain("ghost");
    expect(close.querySelector("svg")).not.toBeNull(); // SheetCloseIcon
    fireEvent.click(close);
    expect(sheetOpen.value).toBe(false);
    expect(container.querySelector("#player-sheet")).not.toBeVisible();
    act(() => {
      sheetOpen.value = true;
    });
    fireEvent.click(container.querySelector("#sheet-backdrop") as Element);
    expect(sheetOpen.value).toBe(false);
    // closeSheet() ist idempotent (Guard in state/ui.ts)
    act(() => closeSheet());
    expect(sheetOpen.value).toBe(false);
  });

  it("#now-playing-Karte: #cover (alt/width/height, src aus playerState, hidden ohne Image), .np-meta mit .eq (3 spans, aria-hidden) + #np-title/#np-artist (app.js L390–397)", () => {
    const { container } = render(<PlayerSheet />);
    act(() => {
      playerState.value = trackFixture();
      sheetOpen.value = true;
    });
    const card = container.querySelector("#now-playing") as Element;
    const cover = container.querySelector("#cover") as HTMLImageElement;
    expect(cover).toHaveAttribute("alt", "Album-Cover");
    expect(cover).toHaveAttribute("width", "92");
    expect(cover).toHaveAttribute("height", "92");
    expect(cover).toBeVisible();
    expect(cover.src).toBe("https://img.example/cover.jpg");
    const meta = card.querySelector(".np-meta, [class*='np-meta']") as Element;
    expect(meta).not.toBeNull();
    const eq = meta.querySelector("[class*='eq']") as Element;
    expect(eq).toHaveAttribute("aria-hidden", "true");
    expect(eq.querySelectorAll("span")).toHaveLength(3);
    expect(container.querySelector("#np-title")?.textContent).toBe("Songtitel");
    expect(container.querySelector("#np-artist")?.textContent).toBe(
      "Künstler A, Künstler B",
    );
    // ohne Album-Image: #cover hidden (app.js L395)
    act(() => {
      playerState.value = trackFixture({ images: [] });
    });
    expect(container.querySelector("#cover")).not.toBeVisible();
  });

  it(".revealed folgt spoilerOpen (computed aus sheetOpen): Öffnen enthüllt, Schließen verhüllt (#13/#61/#66)", () => {
    const { container } = render(<PlayerSheet />);
    act(() => {
      playerState.value = trackFixture();
    });
    const card = container.querySelector("#now-playing") as Element;
    expect(spoilerOpen.value).toBe(false);
    expect(card.classList.contains(styles.revealed)).toBe(false);
    act(() => {
      sheetOpen.value = true;
    });
    expect(spoilerOpen.value).toBe(true);
    expect(card.classList.contains(styles.revealed)).toBe(true);
    act(() => {
      sheetOpen.value = false;
    });
    expect(spoilerOpen.value).toBe(false);
    expect(card.classList.contains(styles.revealed)).toBe(false);
  });

  it("#toggle: hidden ohne playerState; PlayIcon/PauseIcon + .paused + aria-label folgen paused; .playing am Card folgt !paused; Klick → currentPlayerHandle()?.togglePlay() (app.js L400–406/L651)", () => {
    const { container } = render(<PlayerSheet />);
    const toggle = container.querySelector("#toggle") as Element;
    expect(toggle).not.toBeVisible(); // hidden solange playerState null
    act(() => {
      playerState.value = trackFixture({ paused: false });
      sheetOpen.value = true;
    });
    const card = container.querySelector("#now-playing") as Element;
    expect(toggle).toBeVisible();
    expect(toggle).toHaveAttribute("aria-label", "Wiedergabe pausieren");
    expect(toggle.classList.contains(styles.paused)).toBe(false);
    expect(card.classList.contains(styles.playing)).toBe(true);
    expect(toggle.querySelectorAll("svg")).toHaveLength(2); // PlayIcon + PauseIcon
    fireEvent.click(toggle);
    expect(togglePlayMock).toHaveBeenCalledTimes(1);
    expect(currentPlayerHandle).toBeDefined();
    act(() => {
      playerState.value = trackFixture({ paused: true });
    });
    expect(toggle).toHaveAttribute("aria-label", "Wiedergabe fortsetzen");
    expect(toggle.classList.contains(styles.paused)).toBe(true);
    expect(card.classList.contains(styles.playing)).toBe(false);
  });
});
