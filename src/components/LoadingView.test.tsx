import { render } from "@testing-library/preact";
import { describe, expect, it } from "vitest";
import { LoadingView } from "./LoadingView.tsx";

// Komponenten-Test der LoadingView (Subtask GAMWSY3-1): Inhalt des
// Ladezustands (#8), Parity web/index.html L60–63. Die Sektions-Hülle
// (id="loading", role="status", hidden-Switch) bleibt in app.tsx (3a).

describe("LoadingView (Parity web/index.html L60–63, #8)", () => {
  it("rendert Spinner (aria-hidden) und 'Anmeldung läuft…'", () => {
    const { container } = render(<LoadingView />);
    const spinner = container.querySelector("div");
    expect(spinner).toHaveAttribute("aria-hidden", "true");
    expect(container.querySelector("p")?.textContent).toBe("Anmeldung läuft…");
  });
});
