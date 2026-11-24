import { act, fireEvent, render } from "@testing-library/preact";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { KEYS as TOKEN_KEYS } from "../lib/tokens.ts";
import {
  PERSIST_LOGIN_KEY,
  persistLogin,
  resetForTests as resetAuth,
} from "../state/auth.ts";
import { PersistLoginToggle } from "./PersistLoginToggle.tsx";

// Komponenten-Tests des „Angemeldet bleiben"-Toggles (Subtask YWEC4VR-3):
// checked folgt dem persistLogin-Signal (state/auth.ts, Subtask YWEC4VR-2),
// onChange ruft setPersistLogin(!persistLogin.value) — inklusive
// localStorage-Key zeitklang_persist_login UND Token-Migration via
// moveRefreshToken (Refresh-Token wandert localStorage ↔ sessionStorage).
// Echte Stores mit resetForTests() (Muster: LoginView.test.tsx); happy-dom
// liefert localStorage/sessionStorage — pro Test geleert, damit Key und
// Migration isoliert prüfbar sind.

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  resetAuth();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("PersistLoginToggle (YWEC4VR-3)", () => {
  it("rendert Checkbox mit Label „Angemeldet bleiben“ (label umschließt das input → zugänglicher Name); checked folgt dem persistLogin-Signal (Default true)", () => {
    const { container, getByLabelText } = render(<PersistLoginToggle />);
    const label = container.querySelector("label");
    expect(label).not.toBeNull();
    expect(label?.getAttribute("class")).toContain("persist-login");
    const checkbox = getByLabelText("Angemeldet bleiben") as HTMLInputElement;
    expect(checkbox.tagName).toBe("INPUT");
    expect(checkbox).toHaveAttribute("type", "checkbox");
    expect(label?.contains(checkbox)).toBe(true);
    expect(checkbox.checked).toBe(true); // persistLogin-Default: true
    act(() => {
      persistLogin.value = false;
    });
    expect(checkbox.checked).toBe(false);
    act(() => {
      persistLogin.value = true;
    });
    expect(checkbox.checked).toBe(true);
  });

  it("Klick toggelt Signal + localStorage-Key + Migration: persistLogin false → Refresh-Token liegt danach in sessionStorage, localStorage-Quellen-Key gelöscht (setPersistLogin → moveRefreshToken)", () => {
    localStorage.setItem(TOKEN_KEYS.refresh, "rt-local");
    const { getByLabelText } = render(<PersistLoginToggle />);
    const checkbox = getByLabelText("Angemeldet bleiben") as HTMLInputElement;
    expect(checkbox.checked).toBe(true);

    fireEvent.click(checkbox);

    expect(persistLogin.value).toBe(false);
    expect(localStorage.getItem(PERSIST_LOGIN_KEY)).toBe("0");
    expect(sessionStorage.getItem(TOKEN_KEYS.refresh)).toBe("rt-local");
    expect(localStorage.getItem(TOKEN_KEYS.refresh)).toBeNull();
    expect(checkbox.checked).toBe(false);

    // und zurück: true → Key "1", Token wandert session→local
    fireEvent.click(checkbox);

    expect(persistLogin.value).toBe(true);
    expect(localStorage.getItem(PERSIST_LOGIN_KEY)).toBe("1");
    expect(localStorage.getItem(TOKEN_KEYS.refresh)).toBe("rt-local");
    expect(sessionStorage.getItem(TOKEN_KEYS.refresh)).toBeNull();
    expect(checkbox.checked).toBe(true);
  });

  it("Klick ohne vorhandenen Refresh-Token: Key wird geschrieben, Migration ist no-op", () => {
    const { getByLabelText } = render(<PersistLoginToggle />);
    const checkbox = getByLabelText("Angemeldet bleiben") as HTMLInputElement;

    fireEvent.click(checkbox);

    expect(persistLogin.value).toBe(false);
    expect(localStorage.getItem(PERSIST_LOGIN_KEY)).toBe("0");
    expect(sessionStorage.getItem(TOKEN_KEYS.refresh)).toBeNull();
    expect(localStorage.getItem(TOKEN_KEYS.refresh)).toBeNull();
  });
});
