import { act, fireEvent, render, waitFor } from "@testing-library/preact";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LOGOUT_HINT_MSG } from "../lib/errors.ts";
import {
  authError,
  authStatus,
  login,
  logout,
  logoutHint,
  PERSIST_LOGIN_KEY,
  persistLogin,
  redirecting,
  resetForTests as resetAuth,
  resetRedirecting,
} from "../state/auth.ts";
import { resetForTests as resetPlayer } from "../state/player.ts";
import { resetForTests as resetScanner } from "../state/scanner.ts";
import {
  type BeforeInstallPromptEvent,
  captureInstallPrompt,
  installPrompt,
  resetForTests as resetUi,
  shareDialogOpen,
} from "../state/ui.ts";
import { LoginView } from "./LoginView.tsx";

// Komponenten-Tests der LoginView (Subtask GAMWSY3-1): Parity zu
// web/index.html L65–104 und web/app.js login/showLoginError L110–130,
// Listener L632–646, Install L724–746, Share L821. Echte Stores mit
// resetForTests() pro Test (Muster: app.test.tsx); nur login() ist ein
// Spy — importOriginal hält die Signal-Instanzen für ui.ts/player.ts intakt.
vi.mock("../state/auth.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../state/auth.ts")>()),
  login: vi.fn(),
}));

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  resetAuth();
  resetPlayer();
  resetScanner();
  resetUi();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("LoginView (Parity web/index.html + app.js)", () => {
  it("rendert Wortmarke, EQ-Deko, Hero-Text, Spotify-Button und Premium-Badge (#56/#57)", () => {
    const { container } = render(<LoginView />);
    expect(container.querySelector("h2")?.textContent).toBe("Zeitklang");
    const eq = container.querySelector("h2 + div");
    expect(eq).toHaveAttribute("aria-hidden", "true");
    expect(eq?.querySelectorAll("span")).toHaveLength(4);
    expect(container.querySelector("p")?.textContent).toBe(
      "Melde dich an, scanne eine Karte und das Lied spielt auf deinem Handy.",
    );
    const button = container.querySelector("#login-button");
    expect(button).toHaveAttribute("type", "button");
    expect(button).not.toBeDisabled();
    expect(button?.querySelector("svg")).not.toBeNull(); // SpotifyIcon
    expect(container.querySelector("#login-label")?.textContent).toBe(
      "Mit Spotify anmelden",
    );
    expect(container.querySelector("#login-error")).not.toBeVisible();
    const link = container.querySelector("p a");
    expect(link?.textContent).toBe("Spotify Premium");
    expect(link).toHaveAttribute("href", "https://www.spotify.com/premium/");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener");
    expect(container.querySelector("#share-login")).toBeVisible();
  });

  it("Klick auf #login-button → login() ohne Argumente (L632: Event darf nicht als forceConsent durchrutschen)", () => {
    const { container } = render(<LoginView />);
    fireEvent.click(container.querySelector("#login-button") as Element);
    expect(login).toHaveBeenCalledTimes(1);
    expect(login).toHaveBeenCalledWith();
  });

  it("authError → #login-error sichtbar (role alert) mit Text; Retry-Klick → location.reload() (#58, L110–114/L637)", () => {
    const reload = vi.spyOn(window.location, "reload").mockImplementation(() => {});
    const { container } = render(<LoginView />);
    act(() => {
      authError.value = "Anmeldung fehlgeschlagen.";
    });
    const error = container.querySelector("#login-error");
    expect(error).toBeVisible();
    expect(error).toHaveAttribute("role", "alert");
    expect(container.querySelector("#login-error-text")?.textContent).toBe(
      "Anmeldung fehlgeschlagen.",
    );
    fireEvent.click(container.querySelector("#login-retry") as Element);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("redirecting → disabled + 'Weiterleitung zu Spotify…' + Fehler hidden; resetRedirecting() reaktiviert (#58, L123–125/L641–646)", () => {
    authError.value = "Altfehler";
    redirecting.value = true;
    const { container } = render(<LoginView />);
    const button = container.querySelector("#login-button");
    expect(button).toBeDisabled();
    expect(container.querySelector("#login-label")?.textContent).toBe(
      "Weiterleitung zu Spotify…",
    );
    expect(container.querySelector("#login-error")).not.toBeVisible();
    // bfcache-Rückkehr: main.tsx ruft resetRedirecting() bei pageshow —
    // die View darf disabled/Label nur aus dem Signal ableiten.
    act(() => resetRedirecting());
    expect(button).not.toBeDisabled();
    expect(container.querySelector("#login-label")?.textContent).toBe(
      "Mit Spotify anmelden",
    );
  });

  it("Install-Button (#18): hidden ohne Prompt, sichtbar mit Prompt, Klick verbraucht das Event (L724–746)", async () => {
    const { container } = render(<LoginView />);
    const button = container.querySelector("#install-login");
    expect(button).not.toBeVisible();
    const prompt = vi.fn();
    const fake = {
      preventDefault: vi.fn(),
      prompt,
      userChoice: Promise.resolve({ outcome: "dismissed", platform: "" }),
    } as unknown as BeforeInstallPromptEvent;
    act(() => captureInstallPrompt(fake));
    expect(button).toBeVisible();
    fireEvent.click(button as Element);
    expect(prompt).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(installPrompt.value).toBeNull());
    expect(button).not.toBeVisible();
  });

  it("Klick auf #share-login → shareDialogOpen (#94, L821 — Dialog-UI folgt in 3e)", () => {
    const { container } = render(<LoginView />);
    fireEvent.click(container.querySelector("#share-login") as Element);
    expect(shareDialogOpen.value).toBe(true);
  });

  it("„Angemeldet bleiben“-Toggle (YWEC4VR-3): Checkbox direkt unter dem Login-Button im DOM, checked folgt persistLogin, Klick toggelt Signal + localStorage-Key", () => {
    const { container, getByLabelText } = render(<LoginView />);
    const checkbox = getByLabelText("Angemeldet bleiben") as HTMLInputElement;
    expect(checkbox).toHaveAttribute("type", "checkbox");
    expect(checkbox.checked).toBe(true); // persistLogin-Default: true
    // DOM-Position: direkt nach dem Login-Button („unter dem Login-Button“)
    const loginButton = container.querySelector("#login-button") as Element;
    expect(loginButton.nextElementSibling?.contains(checkbox)).toBe(true);

    fireEvent.click(checkbox);

    expect(persistLogin.value).toBe(false);
    expect(localStorage.getItem(PERSIST_LOGIN_KEY)).toBe("0");
    expect(checkbox.checked).toBe(false);
  });

  it("Logout-Hinweis #logout-hint: hidden ohne logoutHint, nach logout() sichtbar mit LOGOUT_HINT_MSG (SA8H08W-1)", () => {
    const { container } = render(<LoginView />);
    const hint = container.querySelector("#logout-hint");
    expect(hint).not.toBeNull();
    expect(hint).not.toBeVisible();

    act(() => logout());

    expect(authStatus.value).toBe("logged-out");
    expect(hint).toBeVisible();
    expect(hint?.textContent).toBe(LOGOUT_HINT_MSG);
    expect(logoutHint.value).toBe(LOGOUT_HINT_MSG);
  });
});
