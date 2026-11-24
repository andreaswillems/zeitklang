import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// Characterization-Test (SZZK8QC-2, Parity-Checkliste §10 Punkt 5): pinnt die
// bereits migrierte #62-Daumenzone aus web/style.css — besteht ab Ankunft,
// schließt nur die Test-Lücke (kein neues Verhalten, kein TDD-Rot).
// Muster aus global.css.test.ts: Datei relativ zum Projekt-Root lesen.
const css = readFileSync(
  resolve(process.cwd(), "src/components/ScanView.module.css"),
  "utf8",
);

const rule = (selector: string): string =>
  css.match(new RegExp(`${selector.replaceAll(".", "\\.")} \\{([^}]*)\\}`))?.[1] ?? "";

describe("ScanView.module.css: „Scannen“ in der Daumenzone (#62)", () => {
  it(".reader-wrap .start: fixiert unten mit Safe-Area, breites Rechteck (52 px Tap-Ziel), überschreibt die #45-Overlay-Regeln", () => {
    expect(css).toContain("/* #62: Start-Button als breites Rechteck in der Daumenzone");
    for (const decl of [
      "position: fixed;",
      "top: auto;",
      "left: 16px;",
      "right: 16px;",
      "bottom: calc(24px + env(safe-area-inset-bottom));",
      "margin: 0 auto;",
      "width: min(398px, calc(100vw - 32px));",
      "height: auto;",
      "min-height: 52px;",
      "z-index: 10;",
    ]) {
      expect(rule(".reader-wrap .start")).toContain(decl);
    }
    expect(rule(".reader-wrap .start svg")).toContain("width: 24px;");
    expect(rule(".reader-wrap .start svg")).toContain("height: 24px;");
  });
});
