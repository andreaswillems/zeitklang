import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// Vitest läuft mit cwd = rework/ (npm test); Muster aus index.html.test.ts:
// Datei relativ zum Projekt-Root lesen und Inhalt pinnen.
const css = readFileSync(resolve(process.cwd(), "src/styles/global.css"), "utf8");

// Regelblock extrahieren: Deklarationen zwischen { … } (die Regeln sind
// nicht verschachtelt). Kommentare vorher entfernen — sie können selbst
// geschweifte Klammern enthalten (z. B. „#scan { padding-bottom }“ in #login).
// Leerer String, wenn der Selektor fehlt.
const rule = (selector: string): string =>
  css
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .match(new RegExp(`${selector} \\{([^}]*)\\}`))?.[1] ?? "";

describe("global.css: #logout (Parity web/style.css L521–553, #38)", () => {
  it("runder Icon-Button: #logout, :hover und svg 1:1 migriert, #38-Kommentar erhalten", () => {
    expect(css).toContain(
      "/* #38: Abmelden als runder Icon-Button oben rechts im Header",
    );
    for (const decl of [
      "position: absolute;",
      "top: 0;",
      "right: 0;",
      "width: 40px;",
      "height: 40px;",
      "display: flex;",
      "align-items: center;",
      "justify-content: center;",
      "padding: 0;",
      "border-radius: 50%;",
      "color: var(--text-dim);",
      "background: transparent;",
      "border: 1px solid var(--border);",
    ]) {
      expect(rule("#logout")).toContain(decl);
    }
    expect(rule("#logout:hover")).toContain("color: #fff;");
    expect(rule("#logout:hover")).toContain("border-color: rgba(255, 255, 255, 0.25);");
    expect(rule("#logout svg")).toContain("width: 18px;");
    expect(rule("#logout svg")).toContain("height: 18px;");
    expect(rule("#logout svg")).toContain("fill: currentColor;");
  });
});

// Characterization-Tests (SZZK8QC-2, Parity-Checkliste §10 Punkt 11): pinnen
// die bereits migrierten CSS-Regeln aus web/style.css — sie bestehen ab
// Ankunft und schließen nur die Test-Lücke für App-Shell-Lock (#90),
// Safe-Areas und reduced-motion (kein neues Verhalten, kein TDD-Rot).
describe("global.css: App-Shell-Lock (#90), Safe-Areas, reduced-motion", () => {
  it("#90: html/body gegen Scrollen gesperrt und gegen Zoom-Gesten unterdrückt, main ist der einzige Scroll-Container", () => {
    expect(css).toContain("/* #90: App-Shell-Lock");
    for (const decl of [
      "height: 100%;",
      "overflow: hidden;",
      "overscroll-behavior: none;",
      // Zoom-Lock: Doppel-Tap-Zoom aus (Pinch-Zoom sperrt der Viewport-Meta-Tag)
      "touch-action: manipulation;",
    ]) {
      expect(rule("html")).toContain(decl);
    }
    for (const decl of [
      "height: 100vh;",
      "height: 100dvh;",
      "display: flex;",
      "flex-direction: column;",
      "overflow: hidden;",
      "overscroll-behavior: none;",
      "touch-action: manipulation;",
    ]) {
      expect(rule("body")).toContain(decl);
    }
    for (const decl of [
      "flex: 1;",
      "min-height: 0;",
      "overflow-y: auto;",
      "overscroll-behavior: contain;",
    ]) {
      expect(rule("main")).toContain(decl);
    }
  });

  it("Safe-Areas: body-Padding auf allen vier Seiten via env(safe-area-inset-*), #login hält die Daumenzone frei (#56)", () => {
    for (const side of ["top", "right", "bottom", "left"]) {
      expect(rule("body")).toContain(`env(safe-area-inset-${side})`);
    }
    expect(rule("body")).toContain("calc(20px + env(safe-area-inset-top))");
    expect(rule("body")).toContain("calc(28px + env(safe-area-inset-bottom))");
    expect(rule("#login")).toContain(
      "padding-bottom: calc(88px + env(safe-area-inset-bottom));",
    );
  });

  // XQSXXEX: Der statische Pre-JS-Ladezustand in index.html braucht eine
  // globale Spinner-Regel — Twin von LoadingView.module.css, denn Vite hasht
  // Modul-Klassen und -Keyframes (statisches HTML kann sie nicht referenzieren).
  it("globaler Spinner für den statischen Pre-JS-Ladezustand, vor dem reduced-motion-Block (XQSXXEX)", () => {
    for (const decl of [
      "width: 36px;",
      "height: 36px;",
      "border: 3px solid var(--border);",
      "border-radius: 50%;",
      "border-top-color: var(--accent-bright);",
      "animation: spin 0.8s linear infinite;",
    ]) {
      expect(rule("\\.spinner")).toContain(decl);
    }
    expect(css).toContain("@keyframes spin {");
    expect(css).toContain("transform: rotate(360deg);");
    expect(css.indexOf(".spinner")).toBeLessThan(
      css.indexOf("@media (prefers-reduced-motion: reduce)"),
    );
  });

  it("prefers-reduced-motion: reduce stoppt Animationen und Transitions global (auch Spinner #8 / EQ-Deko)", () => {
    const block =
      css.match(/@media \(prefers-reduced-motion: reduce\) \{([\s\S]*)\}\s*$/)?.[1] ?? "";
    expect(block).toContain("*,");
    expect(block).toContain("*::before,");
    expect(block).toContain("*::after");
    expect(block).toContain("animation-duration: 0.01ms !important;");
    expect(block).toContain("transition-duration: 0.01ms !important;");
  });
});

// 64CAM8A-3: Aufräumung der Biome-Warnungen — die drei bewussten
// !important-Stellen werden per biome-ignore mit Begründung suppressed statt
// als still tolerierte Warnungen weiterzulaufen: [hidden] muss gegen
// überlagernde display-Regeln (#login etc.) gewinnen, reduzierte Motion muss
// alle Autoren-Animationen/-Transitions übertreffen.
describe("global.css: bewusste !important-Stellen per biome-ignore dokumentiert", () => {
  it("alle 3 !important-Deklarationen tragen eine Suppression mit Begründung, Verhalten unverändert", () => {
    const suppressions =
      css.match(/biome-ignore lint\/complexity\/noImportantStyles/g) ?? [];
    expect(suppressions.length).toBe(3);
    // Verhalten weiter gepinnt:
    expect(rule("\\[hidden\\]")).toContain("display: none !important;");
    expect(css).toContain("animation-duration: 0.01ms !important;");
    expect(css).toContain("transition-duration: 0.01ms !important;");
  });
});
