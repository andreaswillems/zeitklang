/**
 * Regression-Test für .github/workflows/rework-ci.yml — Subtask ZF96RD7-2
 * (OWASP A03 F3).
 *
 * check-secrets.mjs (Subtask ZF96RD7-1) fail-hard'ed mit exit 1, sobald das
 * SPOTIFY_CLIENT_SECRET fehlt UND CI erkannt wird (CI === "true" oder
 * GITHUB_ACTIONS === "true"). Damit die Fail-hard-Semantik in der CI
 * sichtbar und robust ist, muss der `npm run check:secrets`-Step der
 * Workflow-Datei explizit `CI: "true"` setzen — zusätzlich zum unveränderten
 * Actions-Secret.
 *
 * Der Test liest nur die Workflow-DATEI als Text (Plain-String-/Regex-Match,
 * kein YAML-Parser, keine neue npm-Dependency) und liest weder ../.env noch
 * irgendeinen Secret-Wert.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const workflowPath = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  ".github",
  "workflows",
  "rework-ci.yml",
);

/** Text des `npm run check:secrets`-Steps inkl. seines env-Blocks. */
function checkSecretsStepBlock(text) {
  const marker = "- run: npm run check:secrets";
  const start = text.indexOf(marker);
  if (start === -1) return null;
  const rest = text.slice(start + marker.length);
  const nextStep = rest.search(/\n\s*-\s+(run|uses):/);
  return nextStep === -1
    ? text.slice(start)
    : text.slice(start, start + marker.length + nextStep);
}

/**
 * Pin-Format für actions/*-Steps (ZQ59ZD3-1): voller 40-Hex-Commit-SHA plus
 * Versionskommentar. Dependabot schreibt punktierte Versionen (`# v7.0.1`),
 * daher `v\d+(\.\d+)*` statt nur `v\d+`.
 */
const ACTIONS_SHA_PIN_LINE_RE =
  /^\s*-\s*uses:\s*actions\/[^@\s]+@[0-9a-f]{40}\s*#\s*v\d+(\.\d+)*\s*$/;

describe("rework-ci.yml — check:secrets-Step (ZF96RD7-2)", () => {
  const text = readFileSync(workflowPath, "utf8");
  const step = checkSecretsStepBlock(text);

  it("Step existiert in der Workflow-Datei", () => {
    expect(step).not.toBeNull();
  });

  it("Step-Env enthält weiterhin das unveränderte Actions-Secret SPOTIFY_CLIENT_SECRET", () => {
    expect(step).toMatch(
      /SPOTIFY_CLIENT_SECRET:\s*\$\{\{\s*secrets\.SPOTIFY_CLIENT_SECRET\s*\}\}/,
    );
  });

  it('Step-Env enthält explizit CI: "true" (fail-hard exit 1 in check-secrets.mjs bei fehlendem Secret)', () => {
    expect(step).toMatch(/CI:\s*"true"/);
  });
});

/**
 * Subtask ZQ59ZD3-1 (OWASP A03: Actions auf Commit-SHA pinning + npm-audit-Gate).
 *
 * Gleiches Verfahren wie oben: Die Workflow-Datei wird nur als Text gelesen
 * (Plain-String-/Regex-Match, kein YAML-Parser, keine neue npm-Dependency).
 */
describe("rework-ci.yml — actions/* auf Commit-SHA gepinnt (ZQ59ZD3-1)", () => {
  const text = readFileSync(workflowPath, "utf8");
  const usesLines = text
    .split("\n")
    .filter((line) => /^\s*-\s*uses:\s*actions\//.test(line));

  it("mindestens zwei actions/*-Steps vorhanden (checkout + setup-node)", () => {
    expect(usesLines.length).toBeGreaterThanOrEqual(2);
  });

  it("jede `uses: actions/...`-Zeile ist ein 40-Hex-SHA mit Versionskommentar", () => {
    for (const line of usesLines) {
      expect(line).toMatch(ACTIONS_SHA_PIN_LINE_RE);
    }
  });

  it("Pin-Format akzeptiert punktierte Versionskommentare (Dependabot schreibt z. B. `# v7.0.1`)", () => {
    expect(
      "      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1",
    ).toMatch(ACTIONS_SHA_PIN_LINE_RE);
  });

  // Versionagnostisch: die konkrete SHA ändert sich bei jedem Dependabot-
  // Actions-Bump (z. B. checkout # v4 -> # v7.0.1) — gepinnt sein muss sie
  // trotzdem (voller 40-Hex-SHA + Versionskommentar), sonst failt der Loop-Test oben.
  it("actions/checkout ist auf einen 40-Hex-SHA gepinnt (Versionskommentar # vN[.N…])", () => {
    expect(text).toMatch(
      /uses:\s*actions\/checkout@[0-9a-f]{40}\s*#\s*v\d+(\.\d+)*/,
    );
  });

  it("actions/setup-node ist auf einen 40-Hex-SHA gepinnt (Versionskommentar # vN[.N…])", () => {
    expect(text).toMatch(
      /uses:\s*actions\/setup-node@[0-9a-f]{40}\s*#\s*v\d+(\.\d+)*/,
    );
  });

  it("keine ungepinnte actions/*-Tag-Referenz (@vN ohne SHA) mehr vorhanden", () => {
    const tagRefs = text
      .split("\n")
      .filter((line) => /uses:\s*actions\/[^@\s]+@v\d+/.test(line));
    expect(tagRefs).toEqual([]);
  });
});

describe("rework-ci.yml — volles `npm audit` als CI-Gate (ZQ59ZD3-1 + 6GF4NME)", () => {
  const text = readFileSync(workflowPath, "utf8");

  it("ci-Job enthält einen Step `npm audit` (Prod- + Dev-Deps-Gate, exit != 0 bei Vulnerabilities)", () => {
    expect(text).toMatch(/^\s*-\s*run:\s*npm audit\s*$/m);
  });

  it("kein `npm audit --omit=dev`-Step mehr vorhanden (dev-Deps seit 6GF4NME clean und voll gegated)", () => {
    expect(text).not.toMatch(/^\s*-\s*run:\s*npm audit --omit=dev\s*$/m);
  });
});

describe("rework-ci.yml — strukturelle YAML-Gültigkeit (ZQ59ZD3-1)", () => {
  const text = readFileSync(workflowPath, "utf8");
  const lines = text.split("\n");

  it("kein Tab-Zeichen in der Datei (YAML verbietet Tabs zur Einrückung)", () => {
    expect(text).not.toMatch(/\t/);
  });

  it("Top-Level-Keys name/on/permissions/concurrency/jobs stehen in Spalte 0", () => {
    for (const key of ["name:", "on:", "permissions:", "concurrency:", "jobs:"]) {
      expect(lines.some((line) => line.startsWith(key))).toBe(true);
    }
  });

  it("jede Step-Zeile (run/uses) ist eingerückt (mindestens 2 Spaces vor dem Bindestrich)", () => {
    const stepLines = lines.filter((line) => /^\s*-\s*(run|uses):/.test(line));
    expect(stepLines.length).toBeGreaterThanOrEqual(4);
    for (const line of stepLines) {
      expect(line).toMatch(/^ {2,}-\s*(run|uses):/);
    }
  });

  it("ci-Job mit runs-on und steps ist vorhanden", () => {
    expect(text).toMatch(/^ {2}ci:\s*$/m);
    expect(text).toMatch(/^ {4}runs-on:\s*\S+/m);
    expect(text).toMatch(/^ {4}steps:\s*$/m);
  });
});
