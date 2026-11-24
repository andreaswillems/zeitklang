import { act, fireEvent, render } from "@testing-library/preact";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetForTests as resetAuth } from "../state/auth.ts";
import { resetForTests as resetPlayer } from "../state/player.ts";
import { resetForTests as resetScanner } from "../state/scanner.ts";
import {
  closeShareDialog,
  openShareDialog,
  resetForTests as resetUi,
  shareDialogOpen,
} from "../state/ui.ts";
import { ShareDialog } from "./ShareDialog.tsx";

// Komponenten-Tests des ShareDialogs (Subtask 0BSJFEA-1): Parity zu
// web/index.html L238–247 (#share-backdrop/#share-dialog) und web/app.js
// (appUrl L771–773, openShareDialog L808–814, closeShareDialog L816–819,
// Listener L821–829). Echte Stores mit resetForTests() pro Test (Muster:
// PlayerSheet.test.tsx); nur der share-qr-Adapter ist ein Spy — happy-dom
// liefert null für getContext("2d"), das QR-Rendering wird als Aufruf
// (canvas, url) geprüft statt als Bitmap.
const { renderShareQrMock } = vi.hoisted(() => ({
  // async wie das echte Modul (Lazy-Import, XK91FVT): Promise zurückgeben.
  renderShareQrMock: vi.fn(() => Promise.resolve()),
}));
vi.mock("../adapters/share-qr.ts", () => ({ renderShareQr: renderShareQrMock }));

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

describe("ShareDialog (Parity web/index.html L238–247 + app.js L771–829)", () => {
  it("#share-backdrop + #share-dialog: hidden ohne shareDialogOpen; Dialog-Rolle/Labels, #share-close (Schließen, CloseIcon), .share-title, canvas#share-qr 328×328", () => {
    const { container } = render(<ShareDialog />);
    const backdrop = container.querySelector("#share-backdrop") as Element;
    const dialog = container.querySelector("#share-dialog") as Element;
    expect(backdrop.tagName).toBe("DIV");
    expect(backdrop).not.toBeVisible();
    expect(dialog.tagName).toBe("SECTION");
    expect(dialog).not.toBeVisible();
    expect(dialog).toHaveAttribute("role", "dialog");
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog).toHaveAttribute("aria-label", "App teilen");
    const close = dialog.querySelector("#share-close") as Element;
    expect(close).toHaveAttribute("aria-label", "Schließen");
    // CloseIcon: X-Pfad byte-exakt aus web/index.html L242.
    expect(close.querySelector("svg path")?.getAttribute("d")).toBe(
      "M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z",
    );
    expect(dialog.querySelector("[class*='share-title']")?.textContent).toBe(
      "App auf anderem Handy öffnen",
    );
    const canvas = dialog.querySelector("#share-qr") as HTMLCanvasElement;
    expect(canvas.tagName).toBe("CANVAS");
    expect(canvas).toHaveAttribute("width", "328");
    expect(canvas).toHaveAttribute("height", "328");
    expect(dialog.querySelector("#share-url")).not.toBeNull();
  });

  it("Open: sichtbar, #share-url = origin + pathname (bewusst ohne ?code=), renderShareQr(canvas, url) — erst beim Öffnen (app.js L808–814)", () => {
    // OAuth-Redirect-Query anhängen: appUrl() (app.js L771–773) lässt sie draußen.
    const href = location.href;
    history.replaceState(null, "", `${location.pathname}?code=oauth-geheim`);
    try {
      const { container } = render(<ShareDialog />);
      expect(renderShareQrMock).not.toHaveBeenCalled();
      act(() => openShareDialog());
      expect(container.querySelector("#share-backdrop")).toBeVisible();
      const dialog = container.querySelector("#share-dialog") as Element;
      expect(dialog).toBeVisible();
      const url = location.origin + location.pathname;
      expect(container.querySelector("#share-url")?.textContent).toBe(url);
      expect(url).not.toContain("code=");
      expect(renderShareQrMock).toHaveBeenCalledTimes(1);
      expect(renderShareQrMock).toHaveBeenCalledWith(
        container.querySelector("#share-qr"),
        url,
      );
    } finally {
      history.replaceState(null, "", href);
    }
  });

  it("Schließen: #share-close-Klick, Backdrop-Klick und Esc (window keydown, ohne Open-Guard) → closeShareDialog(), danach wieder hidden (app.js L821–829)", () => {
    const { container } = render(<ShareDialog />);
    const backdrop = container.querySelector("#share-backdrop") as Element;
    const dialog = container.querySelector("#share-dialog") as Element;
    act(() => openShareDialog());
    fireEvent.click(container.querySelector("#share-close") as Element);
    expect(shareDialogOpen.value).toBe(false);
    expect(dialog).not.toBeVisible();
    expect(backdrop).not.toBeVisible();
    act(() => openShareDialog());
    fireEvent.click(backdrop);
    expect(shareDialogOpen.value).toBe(false);
    expect(dialog).not.toBeVisible();
    act(() => openShareDialog());
    fireEvent.keyDown(window, { key: "Escape" });
    expect(shareDialogOpen.value).toBe(false);
    expect(dialog).not.toBeVisible();
    // Kein Open-Guard (Parity app.js L825–829): Esc im geschlossenen Zustand
    // und closeShareDialog() sind idempotent.
    fireEvent.keyDown(window, { key: "Escape" });
    act(() => closeShareDialog());
    expect(shareDialogOpen.value).toBe(false);
  });
});
