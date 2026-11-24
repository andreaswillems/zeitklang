/**
 * Regression-Test für .github/dependabot.yml — Subtask ZQ59ZD3-2
 * (OWASP A03 F2).
 *
 * Dependabot muss zwei Ökosysteme abdecken:
 *  - github-actions mit directory "/" — deckt ALLE Workflows in
 *    .github/workflows/ ab (rework-ci.yml UND pages.yml).
 *  - npm mit directory "/" — package.json liegt im Repo-Root.
 *
 * Gleiches Verfahren wie rework-ci.test.mjs: Die Datei wird nur als Text
 * gelesen (Plain-String-/Regex-Match, kein YAML-Parser, keine neue
 * npm-Dependency).
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const dependabotPath = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  ".github",
  "dependabot.yml",
);

/** Text-Blöcke aller `- package-ecosystem:`-Einträge (Kommentarzeilen ausgenommen). */
function updateBlocks(text) {
  const blocks = [];
  let current = null;
  for (const line of text.split("\n")) {
    const entry = line.match(/^\s*-\s*package-ecosystem:\s*"?([a-z-]+)"?\s*$/);
    if (entry) {
      current = { ecosystem: entry[1], text: `${line}\n` };
      blocks.push(current);
    } else if (current && /^\s*\S/.test(line) && !/^\s*#/.test(line)) {
      current.text += `${line}\n`;
    }
  }
  return blocks;
}

describe(".github/dependabot.yml (ZQ59ZD3-2)", () => {
  it("Datei existiert im Repo", () => {
    expect(existsSync(dependabotPath)).toBe(true);
  });

  const text = existsSync(dependabotPath)
    ? readFileSync(dependabotPath, "utf8")
    : "";

  it("enthält `version: 2` auf Top-Level", () => {
    expect(text).toMatch(/^version:\s*2\s*$/m);
  });

  it("kein Tab-Zeichen in der Datei (YAML verbietet Tabs zur Einrückung)", () => {
    expect(text).not.toMatch(/\t/);
  });

  it('github-actions-Update mit directory "/" (covers .github/workflows inkl. rework-ci.yml UND pages.yml)', () => {
    const block = updateBlocks(text).find((b) => b.ecosystem === "github-actions");
    expect(block).toBeDefined();
    expect(block.text).toMatch(/^\s*directory:\s*\/\s*$/m);
  });

  it('npm-Update mit directory "/" (package.json liegt im Repo-Root)', () => {
    const block = updateBlocks(text).find((b) => b.ecosystem === "npm");
    expect(block).toBeDefined();
    expect(block.text).toMatch(/^\s*directory:\s*\/\s*$/m);
  });

  it('kein npm-Update mehr auf directory "/rework" (Unterverzeichnis existiert nicht mehr)', () => {
    const npmBlocks = updateBlocks(text).filter((b) => b.ecosystem === "npm");
    expect(npmBlocks.length).toBeGreaterThanOrEqual(1);
    for (const block of npmBlocks) {
      expect(block.text).not.toMatch(/^\s*directory:\s*\/rework\s*$/m);
    }
  });

  it("jeder Update-Block hat schedule (daily|weekly) + open-pull-requests-limit", () => {
    const blocks = updateBlocks(text);
    expect(blocks.length).toBeGreaterThanOrEqual(2);
    for (const block of blocks) {
      expect(block.text).toMatch(/^\s*schedule:\s*$/m);
      expect(block.text).toMatch(/^\s*interval:\s*(daily|weekly)\s*$/m);
      expect(block.text).toMatch(/^\s*open-pull-requests-limit:\s*\d+\s*$/m);
    }
  });
});
