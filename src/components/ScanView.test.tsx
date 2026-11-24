import { act, fireEvent, render, waitFor } from "@testing-library/preact";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetForTests as resetAuth } from "../state/auth.ts";
import { resetForTests as resetPlayer } from "../state/player.ts";
import {
  resetForTests as resetScanner,
  scanMessage,
  scannerActive,
  startScan,
  stopScan,
  toggleTorch,
  torchOn,
  torchSupported,
} from "../state/scanner.ts";
import {
  type BeforeInstallPromptEvent,
  captureInstallPrompt,
  installPrompt,
  resetForTests as resetUi,
  shareDialogOpen,
} from "../state/ui.ts";
import { ScanView } from "./ScanView.tsx";

// Komponenten-Tests der ScanView (Subtask WE3MQWG-1): Parity zu
// web/index.html L106–184 (Scan-Sektion, Issue-Kommentare im Markup) und
// web/app.js (startScan/stopScan L852–929, Torch L900–950, #18 L729–746,
// #94 L821). Echte Stores mit resetForTests() pro Test (Muster:
// LoginView.test.tsx); nur die Scanner-Aktionen startScan/stopScan/
// toggleTorch sind Spies — importOriginal hält die Signal-Instanzen für
// ui.ts intakt. Sichtbarkeit folgt den hidden-Attributen (in Tests ohne
// angewendetes CSS), die Signale steuern sie direkt.
vi.mock("../state/scanner.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../state/scanner.ts")>()),
  startScan: vi.fn(),
  stopScan: vi.fn(),
  toggleTorch: vi.fn(),
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

describe("ScanView (Parity web/index.html L106–184)", () => {
  it("rendert #reader-wrap mit #reader, Overlay-Buttons, #start, #guide und #result", () => {
    const { container } = render(<ScanView />);
    const wrap = container.querySelector("#reader-wrap");
    expect(wrap).not.toBeNull();
    expect(wrap?.querySelector("#reader")).not.toBeNull(); // html5-qrcode-Mount
    const torch = container.querySelector("#torch");
    expect(torch).toHaveAttribute("aria-label", "Taschenlampe");
    expect(torch).toHaveAttribute("aria-pressed", "false");
    expect(torch).not.toBeVisible(); // hidden bis torchSupported (#3)
    expect(torch?.querySelector("svg")).not.toBeNull(); // TorchIcon
    const stop = container.querySelector("#scan-stop");
    expect(stop).toHaveAttribute("aria-label", "Scan stoppen");
    expect(stop).not.toBeVisible(); // hidden solange !scannerActive (#45)
    expect(stop?.querySelector("svg")).not.toBeNull(); // ScanStopIcon
    const start = container.querySelector("#start");
    expect(start).toBeVisible(); // scannerActive=false (#62)
    expect(start).not.toHaveAttribute("aria-label"); // WCAG 2.5.3: sichtbarer Text ist der Name
    expect(start?.textContent).toBe("Scannen");
    expect(start?.querySelector("svg")).not.toBeNull(); // QrIcon
    const guide = container.querySelector("#guide");
    expect(guide).toBeVisible(); // nur bei gestopptem Scanner (#70)
    expect(guide?.querySelector("p")?.textContent).toBe("So funktioniert’s");
    const steps = guide?.querySelectorAll("ol li");
    expect(steps).toHaveLength(3);
    expect(steps?.[0].textContent).toContain("Karte scannen");
    expect(steps?.[0].textContent).toContain("QR-Kärtchen vor die Kamera halten");
    expect(steps?.[1].textContent).toContain("Song hören");
    expect(steps?.[1].textContent).toContain("Der Song spielt auf deinem Handy");
    expect(steps?.[2].textContent).toContain("Titel ansehen");
    expect(steps?.[2].textContent).toContain(
      "Tippe auf die Leiste und enthülle Titel und Interpret",
    );
    const arrows = guide?.querySelectorAll("li > svg");
    expect(arrows).toHaveLength(2); // Pfeile nur zwischen den Schritten
    for (const arrow of arrows ?? []) {
      expect(arrow).toHaveAttribute("aria-hidden", "true"); // rein dekorativ
    }
    const install = container.querySelector("#install-scan");
    expect(install).not.toBeVisible(); // hidden bis installPrompt (#18)
    expect(install?.textContent).toBe("App installieren");
    const share = container.querySelector("#share-scan");
    expect(share).toBeVisible(); // Sichtbarkeit folgt allein der Guide-Karte (#94)
    expect(share?.textContent).toBe("App teilen");
    const result = container.querySelector("#result");
    expect(result).toHaveAttribute("role", "status");
    expect(result?.textContent).toBe("");
  });

  it("#start-Sichtbarkeit folgt scannerActive (ticket-required); Klicks → startScan()/stopScan() (#62/#45)", () => {
    const { container } = render(<ScanView />);
    const start = container.querySelector("#start") as Element;
    const stop = container.querySelector("#scan-stop") as Element;
    expect(start).toBeVisible();
    expect(stop).not.toBeVisible();
    fireEvent.click(start);
    expect(startScan).toHaveBeenCalledTimes(1);
    expect(startScan).toHaveBeenCalledWith();
    act(() => {
      scannerActive.value = true;
    });
    expect(start).not.toBeVisible(); // hidden solange der Scanner läuft
    expect(stop).toBeVisible();
    fireEvent.click(stop);
    expect(stopScan).toHaveBeenCalledTimes(1);
    expect(stopScan).toHaveBeenCalledWith();
  });

  it("#torch: hidden bis torchSupported, aria-pressed folgt torchOn, Klick → toggleTorch() (#3)", () => {
    const { container } = render(<ScanView />);
    const torch = container.querySelector("#torch") as Element;
    expect(torch).not.toBeVisible();
    act(() => {
      torchSupported.value = true;
    });
    expect(torch).toBeVisible();
    expect(torch).toHaveAttribute("aria-pressed", "false");
    act(() => {
      torchOn.value = true;
    });
    expect(torch).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(torch);
    expect(toggleTorch).toHaveBeenCalledTimes(1);
    expect(toggleTorch).toHaveBeenCalledWith();
  });

  it("#guide nur bei gestopptem Scanner sichtbar (#70)", () => {
    const { container } = render(<ScanView />);
    const guide = container.querySelector("#guide") as Element;
    expect(guide).toBeVisible();
    act(() => {
      scannerActive.value = true;
    });
    expect(guide).not.toBeVisible();
    act(() => {
      scannerActive.value = false;
    });
    expect(guide).toBeVisible();
  });

  it("#result (role=status) zeigt scanMessage an (#53)", () => {
    const { container } = render(<ScanView />);
    const result = container.querySelector("#result") as Element;
    expect(result).toHaveAttribute("role", "status");
    expect(result.textContent).toBe("");
    act(() => {
      scanMessage.value = "Kein Spotify-Track erkannt: https://example.com/x";
    });
    expect(result.textContent).toBe("Kein Spotify-Track erkannt: https://example.com/x");
  });

  it("#install-scan nur mit installPrompt sichtbar; Klick verbraucht das Event (#18, L724–746)", async () => {
    const { container } = render(<ScanView />);
    const button = container.querySelector("#install-scan") as Element;
    expect(button).not.toBeVisible();
    const prompt = vi.fn();
    const fake = {
      preventDefault: vi.fn(),
      prompt,
      userChoice: Promise.resolve({ outcome: "dismissed", platform: "" }),
    } as unknown as BeforeInstallPromptEvent;
    act(() => captureInstallPrompt(fake));
    expect(button).toBeVisible();
    fireEvent.click(button);
    expect(prompt).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(installPrompt.value).toBeNull());
    expect(button).not.toBeVisible();
  });

  it("Klick auf #share-scan → shareDialogOpen (#94, L821 — Dialog-UI folgt in 3e)", () => {
    const { container } = render(<ScanView />);
    fireEvent.click(container.querySelector("#share-scan") as Element);
    expect(shareDialogOpen.value).toBe(true);
  });
});
