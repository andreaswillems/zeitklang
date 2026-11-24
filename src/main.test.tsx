import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { redirecting, resetForTests as resetAuth } from "./state/auth.ts";

// WH3A1BP-1 (Smoke-Test-Fund): main.tsx muss initAuth() anstoßen — sonst bleibt
// authStatus für immer auf "loading" und die App zeigt endlos den Spinner
// „Anmeldung läuft…". Der initAuth-Aufruf wird per Modul-Mock gezählt; die
// übrigen Auth-Exporte bleiben unverändert (Original via importOriginal).
// YWEC4VR-2: initPersistLogin() muss VOR initAuth() laufen — startupOrder
// zeichnet die Reihenfolge beider Aufrufe mit.
const { initAuthCalls, startupOrder } = vi.hoisted(() => ({
  initAuthCalls: [] as number[],
  startupOrder: [] as string[],
}));

vi.mock("./state/auth.ts", async (importOriginal) => {
  const original = await importOriginal<typeof import("./state/auth.ts")>();
  return {
    ...original,
    initPersistLogin: () => {
      startupOrder.push("initPersistLogin");
    },
    initAuth: () => {
      initAuthCalls.push(1);
      startupOrder.push("initAuth");
      return Promise.resolve();
    },
  };
});

const registerCalls: string[] = [];

// Tests für main.tsx (Subtask YKH6MG9-2): Mount in #app, SW-Registrierung
// (#17, Parity web/app.js init L604–609) und pageshow-Reset (#58, Parity
// L639–645). main.tsx wird einmal in beforeAll importiert, nachdem die
// Stubs stehen — die Modul-Seiteneffekte laufen genau einmal. register
// rejected absichtlich: der catch-Pfad (console.error, non-blocking) wird
// so ohne zweiten Import mitgeprüft. Ohne vi.resetModules() teilen sich
// dieser Test und main.tsx dieselben Store-Instanzen.
//
// Vitest 5 leert Mock-Calls vor jedem Test — die Aufrufe aus dem once-
// Import landen deshalb in plain Arrays, nicht in vi.fn()-Mocks.

const consoleErrors: unknown[][] = [];
const consoleError = vi.spyOn(console, "error");

/** happy-doms PageTransitionEvent trägt kein persisted — selbst anheften. */
function pageShow(persisted: boolean): Event {
  const event = new Event("pageshow");
  Object.defineProperty(event, "persisted", { value: persisted });
  return event;
}

beforeAll(async () => {
  // XQSXXEX: #app mit dem statischen Pre-JS-Ladezustand aus index.html
  // vorbefüllen — der echte Mount-Pfad muss ihn ersetzen (replaceChildren).
  document.body.innerHTML = `<div id="app">
        <section id="loading" role="status">
            <div class="spinner" aria-hidden="true"></div>
            <p>Anmeldung läuft…</p>
        </section>
    </div>`;
  Object.defineProperty(navigator, "serviceWorker", {
    value: {
      register: (url: string) => {
        registerCalls.push(url);
        return Promise.reject(new Error("SW boom"));
      },
    },
    configurable: true,
  });
  consoleError.mockImplementation((...args: unknown[]) => {
    consoleErrors.push(args);
  });
  await import("./main.tsx");
});

afterAll(() => {
  consoleError.mockRestore();
  Reflect.deleteProperty(navigator, "serviceWorker");
});

beforeEach(() => {
  resetAuth();
});

describe("main.tsx", () => {
  it("mountet App in #app, auch wenn die SW-Registrierung fehlschlägt (non-blocking)", () => {
    expect(document.querySelector("#app header h1")?.textContent).toBe("Zeitklang");
  });

  it("ersetzt den statischen Pre-JS-Ladezustand: genau ein #loading in #app, im main (XQSXXEX)", () => {
    expect(document.querySelector("#app main")).not.toBeNull();
    const loadings = document.querySelectorAll("#app #loading");
    expect(loadings).toHaveLength(1);
    expect(loadings[0]?.closest("main")).not.toBeNull();
  });

  it("registriert den SW relativ zur BASE_URL, Fehler geht nur in die Konsole (#17)", async () => {
    expect(registerCalls).toEqual([`${import.meta.env.BASE_URL}sw.js`]);
    await vi.waitFor(() =>
      expect(consoleErrors).toContainEqual([
        "SW-Registrierung fehlgeschlagen:",
        expect.any(Error),
      ]),
    );
  });

  it("stößt initAuth() genau einmal an (WH3A1BP-1) — sonst bliebe die App endlos im Ladezustand", () => {
    expect(initAuthCalls).toHaveLength(1);
  });

  it("ruft initPersistLogin() VOR initAuth() auf (YWEC4VR-2: refreshStorage() in initAuth hängt am persistLogin-Signal)", () => {
    expect(initAuthCalls).toHaveLength(1);
    expect(startupOrder).toEqual(["initPersistLogin", "initAuth"]);
  });

  it.each([true, false])(
    "pageshow persisted=%s: resetRedirecting nur bei persisted (#58)",
    (persisted) => {
      redirecting.value = true;
      window.dispatchEvent(pageShow(persisted));
      expect(redirecting.value).toBe(!persisted);
    },
  );
});
