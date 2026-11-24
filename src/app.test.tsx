import { fireEvent, render } from "@testing-library/preact";
import { beforeEach, describe, expect, it } from "vitest";
import { App } from "./app.tsx";
import {
  authStatus,
  PERSIST_LOGIN_KEY,
  persistLogin,
  resetForTests as resetAuth,
} from "./state/auth.ts";
import { playerMessage, resetForTests as resetPlayer } from "./state/player.ts";
import { resetForTests as resetScanner } from "./state/scanner.ts";
import { online, resetForTests as resetUi, view } from "./state/ui.ts";

// Komponenten-Tests der App-Shell (Subtask YKH6MG9-2): View-Switch auf
// view(), Header mit Abmelden-Button (#38), Statuszeile (#17). Parity zu
// web/index.html + web/app.js show L573–585, updateOnlineHint L583–598.
// Echte Stores mit resetForTests() pro Test (Muster: state/ui.test.ts),
// view.value wird direkt gesetzt. Die Views bleiben leere Platzhalter-
// Sektionen — LoginView/ScanView/LoadingView folgen in 3b/3c.

// Byte-genau aus web/app.js L281–282 gepinnt (#17).
const OFFLINE_MSG =
  "Keine Internetverbindung. Scannen und Wiedergabe brauchen Internet — bitte WLAN oder Mobilfunk prüfen.";

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  resetAuth();
  resetPlayer();
  resetScanner();
  resetUi();
});

describe("App-Shell (Parity web/index.html + app.js show)", () => {
  it.each(["loading", "login", "scan"] as const)(
    "view '%s': nur diese Sektion sichtbar, Header-h1 'Zeitklang' steht",
    (v) => {
      view.value = v;
      const { container } = render(<App />);
      for (const id of ["loading", "login", "scan"]) {
        const section = container.querySelector(`#${id}`);
        if (id === v) {
          expect(section).toBeVisible();
        } else {
          expect(section).not.toBeVisible();
        }
      }
      expect(container.querySelector("header h1")?.textContent).toBe("Zeitklang");
    },
  );

  it("loading-Sektion: role status und Text 'Anmeldung läuft…' (#8)", () => {
    const { container } = render(<App />); // view startet auf loading
    const loading = container.querySelector("#loading");
    expect(loading).toHaveAttribute("role", "status");
    expect(loading?.textContent).toBe("Anmeldung läuft…");
  });

  it("Abmelden-Button nur in der Scan-Ansicht sichtbar, Klick → logged-out (#38)", () => {
    for (const v of ["loading", "login"] as const) {
      view.value = v;
      const { container, unmount } = render(<App />);
      expect(container.querySelector("#logout")).not.toBeVisible();
      unmount();
    }
    view.value = "scan";
    const { container } = render(<App />);
    const button = container.querySelector("#logout");
    expect(button).toBeVisible();
    expect(button).toHaveAttribute("aria-label", "Abmelden");
    expect(button?.querySelector("svg")).not.toBeNull(); // LogoutIcon
    fireEvent.click(button as Element);
    expect(authStatus.value).toBe("logged-out");
  });

  it("„Angemeldet bleiben“-Toggle im Scan-Header neben #logout (YWEC4VR-3): nur in der Scan-Ansicht sichtbar, Klick toggelt persistLogin + localStorage-Key", () => {
    for (const v of ["loading", "login"] as const) {
      view.value = v;
      const { container, unmount } = render(<App />);
      const checkbox = container.querySelector("header input[type='checkbox']");
      expect(checkbox).not.toBeNull();
      expect(checkbox).not.toBeVisible(); // hidden analog current !== scan
      unmount();
    }
    view.value = "scan";
    const { container } = render(<App />);
    const header = container.querySelector("header") as Element;
    const checkbox = header.querySelector("input[type='checkbox']") as HTMLInputElement;
    expect(checkbox).toBeVisible();
    expect(checkbox.checked).toBe(true); // persistLogin-Default: true
    // sitzt neben dem #logout-Button im Header
    const logout = header.querySelector("#logout") as Element;
    expect(logout.previousElementSibling?.contains(checkbox)).toBe(true);

    fireEvent.click(checkbox);

    expect(persistLogin.value).toBe(false);
    expect(localStorage.getItem(PERSIST_LOGIN_KEY)).toBe("0");
    expect(checkbox.checked).toBe(false);
  });

  it("Statuszeile (#17): offline → OFFLINE_MSG, online → leer, am Ende von main", () => {
    online.value = false;
    const { container, unmount } = render(<App />);
    const status = container.querySelector("#status");
    expect(status).toHaveAttribute("role", "alert");
    expect(status?.textContent).toBe(OFFLINE_MSG);
    expect(status).toBe(container.querySelector("main")?.lastElementChild);
    unmount();

    online.value = true;
    const { container: onlineContainer } = render(<App />);
    expect(onlineContainer.querySelector("#status")?.textContent).toBe("");
  });

  it("Statuszeilen-Merging (3d): online zeigt playerMessage, offline überschreibt alles (#17)", () => {
    online.value = true;
    playerMessage.value = "Verbinde mit Spotify — der Titel startet in Kürze.";
    const { container, unmount } = render(<App />);
    expect(container.querySelector("#status")?.textContent).toBe(
      "Verbinde mit Spotify — der Titel startet in Kürze.",
    );
    unmount();
    // offline → OFFLINE_MSG überschreibt playerMessage (Vorrang wie
    // offlineShown in web/app.js L583–598)
    online.value = false;
    const { container: offlineContainer } = render(<App />);
    expect(offlineContainer.querySelector("#status")?.textContent).toBe(OFFLINE_MSG);
  });

  it("PlayerSheet hängt als Geschwister der Sektionen in <main> vor der Statuszeile (web/index.html L191 ff.)", () => {
    const { container } = render(<App />);
    const main = container.querySelector("main") as Element;
    const backdrop = main.querySelector("#sheet-backdrop");
    const sheet = main.querySelector("#player-sheet");
    expect(backdrop).not.toBeNull();
    expect(sheet).not.toBeNull();
    expect(backdrop).not.toBeVisible(); // hidden ohne sheetOpen
    expect(sheet).not.toBeVisible();
    expect(sheet).toHaveAttribute("role", "dialog");
    expect(sheet).toHaveAttribute("aria-label", "Aktueller Song");
    // Reihenfolge wie web/index.html: Sektionen … Sheet … #status zuletzt
    expect(main.lastElementChild).toBe(main.querySelector("#status"));
    const children = Array.from(main.children).map((el) => el.id);
    expect(children.indexOf("player-sheet")).toBeLessThan(children.indexOf("status"));
  });

  it("MiniPlayer hängt nach dem PlayerSheet in <main> vor der Statuszeile, hidden ohne miniPlayerVisible (web/index.html L219–231)", () => {
    const { container } = render(<App />);
    const main = container.querySelector("main") as Element;
    const mini = main.querySelector("#mini-player");
    expect(mini).not.toBeNull();
    // miniPlayerVisible = trackLoaded && !sheetOpen && scannerActive — alles
    // false nach resetForTests() → hidden (app.js show L580)
    expect(mini).not.toBeVisible();
    const children = Array.from(main.children).map((el) => el.id);
    expect(children.indexOf("mini-player")).toBeGreaterThan(
      children.indexOf("player-sheet"),
    );
    expect(children.indexOf("mini-player")).toBeLessThan(children.indexOf("status"));
    expect(main.lastElementChild).toBe(main.querySelector("#status"));
  });

  it("ShareDialog hängt nach dem MiniPlayer in <main> vor der Statuszeile, hidden ohne shareDialogOpen (web/index.html L238–247)", () => {
    const { container } = render(<App />);
    const main = container.querySelector("main") as Element;
    const backdrop = main.querySelector("#share-backdrop");
    const dialog = main.querySelector("#share-dialog");
    expect(backdrop).not.toBeNull();
    expect(dialog).not.toBeNull();
    expect(backdrop).not.toBeVisible(); // hidden ohne shareDialogOpen (#94)
    expect(dialog).not.toBeVisible();
    const children = Array.from(main.children).map((el) => el.id);
    expect(children.indexOf("share-dialog")).toBeGreaterThan(
      children.indexOf("mini-player"),
    );
    expect(children.indexOf("share-dialog")).toBeLessThan(children.indexOf("status"));
    expect(main.lastElementChild).toBe(main.querySelector("#status"));
  });
});
