#!/usr/bin/env node
/**
 * lint-staged-Task für die Husky-Hooks (Repo-Root): Biome auf den gestaged
 * rework-Dateien ausführen (Format + Lint + Imports, auto-fix mit --write).
 *
 * lint-staged ruft Tasks am Git-Root mit root-relativen Pfaden auf
 * (rework/src/…). Biome darf nicht am Repo-Root laufen — rework/biome.json
 * wäre dort eine "nested root configuration" (Biome behandelt das cwd als
 * impliziten Root). Deshalb: cwd nach rework/ wechseln und das Präfix
 * `rework/` von den Pfaden strippen.
 *
 * Aufruf: node rework/scripts/biome-staged.mjs <datei>…   (cwd = Repo-Root)
 */
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const reworkDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const biomeBin = join(reworkDir, "node_modules", "@biomejs", "biome", "bin", "biome");

const files = process.argv
    .slice(2)
    .map((file) => file.replace(/^rework\//, ""));

if (files.length === 0) {
    process.exit(0);
}

const result = spawnSync(
    process.execPath,
    [biomeBin, "check", "--write", "--no-errors-on-unmatched", ...files],
    { cwd: reworkDir, stdio: "inherit" },
);
process.exit(result.status ?? 1);
