import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// Characterization-Test (SZZK8QC-2, Parity-Checkliste §10 Punkt 8): pinnt die
// bereits migrierte #13-Cover-Transition aus web/style.css — besteht ab
// Ankunft, schließt nur die Test-Lücke (kein neues Verhalten, kein TDD-Rot).
// Muster aus global.css.test.ts: Datei relativ zum Projekt-Root lesen.
const css = readFileSync(
  resolve(process.cwd(), "src/components/PlayerSheet.module.css"),
  "utf8",
);

const rule = (selector: string): string =>
  css.match(new RegExp(`${selector.replaceAll(".", "\\.")} \\{([^}]*)\\}`))?.[1] ?? "";

describe("PlayerSheet.module.css: Cover-Transition (#13)", () => {
  it(".cover wächst weich von 92px auf 100% in .revealed; Spoiler-Blur löst sich; .np-meta gleitet ins Overlay; Sheet-Padding mit Safe-Area", () => {
    expect(css).toContain("#13: sanftes Wachsen beim Enthüllen");
    for (const decl of [
      "width: 92px;",
      "aspect-ratio: 1;",
      "filter: blur(7px);",
      "filter 0.3s,",
      "width 0.5s cubic-bezier(0.2, 0.8, 0.2, 1);",
    ]) {
      expect(rule(".cover")).toContain(decl);
    }
    expect(rule(".now-playing.revealed .cover")).toContain("width: 100%;");
    // Gruppen-Selektor: Cover + Titel + Interpret verlieren zusammen den Blur.
    const revealed =
      css.match(
        /\.now-playing\.revealed \.cover,\n\.now-playing\.revealed \.np-title,\n\.now-playing\.revealed \.np-artist \{([^}]*)\}/,
      )?.[1] ?? "";
    expect(revealed).toContain("filter: none;");
    for (const decl of [
      "position: absolute;",
      "left: 120px;",
      "top: 50%;",
      "left 0.5s cubic-bezier(0.2, 0.8, 0.2, 1),",
    ]) {
      expect(rule(".np-meta")).toContain(decl);
    }
    for (const decl of [
      "left: 14px;",
      "top: calc(100% - 14px);",
      "transform: translateY(-100%);",
    ]) {
      expect(rule(".now-playing.revealed .np-meta")).toContain(decl);
    }
    expect(rule(".player-sheet")).toContain(
      "padding: 4px 16px calc(20px + env(safe-area-inset-bottom));",
    );
  });
});

// 64CAM8A-3: Aufräumung der Biome-Warnungen — die Basisregel .toggle muss vor
// der Revealed-Überschreibung stehen (lint/style/noDescendingSpecificity):
// ein später deklarierter, schwächerer Selektor könnte auf offengelegten
// Karten von der stärkeren Revealed-Regel verdeckt werden.
describe("PlayerSheet.module.css: .toggle-Reihenfolge (Biome noDescendingSpecificity)", () => {
  it("Basisregel .toggle steht vor .now-playing.revealed .toggle", () => {
    const baseIdx = css.search(/^\.toggle \{$/m);
    const overrideIdx = css.search(/^\.now-playing\.revealed \.toggle \{$/m);
    expect(baseIdx).toBeGreaterThanOrEqual(0);
    expect(overrideIdx).toBeGreaterThanOrEqual(0);
    expect(baseIdx).toBeLessThan(overrideIdx);
  });
});
