import { describe, expect, it } from "vitest";

// Phase 0: Smoke-Test für das Test-Setup (happy-dom + jest-dom + Cleanup).
// Wird durch die echten lib-/ Komponenten-Tests ab Phase 1 ersetzt.
describe("Phase-0-Setup", () => {
  it("happy-dom stellt ein DOM bereit", () => {
    const div = document.createElement("div");
    div.id = "smoke";
    document.body.append(div);
    expect(document.getElementById("smoke")).toBeInTheDocument();
  });
});
