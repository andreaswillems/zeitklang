/**
 * Tests für check-secrets.mjs — Subtask ZF96RD7-1 (OWASP A03 F3, fail-open in CI).
 *
 * Die Tests injizieren env/envFilePath/scanDirs auf Temp-Fixtures und lesen
 * NIEMALS das echte ../.env. Das ambiente CI-Env wird nicht verwendet —
 * der CI-Pfad wird über das injizierte env-Objekt gesteuert.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { defaultScanDirs, runCheckSecrets } from "./check-secrets.mjs";

const SECRET = "test-secret-0123456789";

let tmp;
let scanDir;
let envFilePath;
let messages;

function makeLog() {
  messages = { log: [], warn: [], error: [] };
  return {
    log: (msg) => messages.log.push(String(msg)),
    warn: (msg) => messages.warn.push(String(msg)),
    error: (msg) => messages.error.push(String(msg)),
  };
}

function run({ env = {}, withEnvFile = false, files = {} } = {}) {
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(join(scanDir, name), content);
  }
  if (withEnvFile) {
    writeFileSync(envFilePath, `SPOTIFY_CLIENT_SECRET="${SECRET}"\n`);
  }
  return runCheckSecrets({
    env,
    envFilePath,
    scanDirs: [scanDir],
    baseDir: tmp,
    log: makeLog(),
  });
}

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "check-secrets-test-"));
  scanDir = join(tmp, "src");
  mkdirSync(scanDir);
  envFilePath = join(tmp, ".env");
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

describe("runCheckSecrets — Secret vorhanden", () => {
  it("(a) sauberes scanDir -> exit 0 und der Scan lief wirklich (Dateien gezählt)", () => {
    const code = run({
      env: { SPOTIFY_CLIENT_SECRET: `  ${SECRET}  ` }, // trim() muss greifen
      files: { "clean.ts": "export const x = 1;\n" },
    });
    expect(code).toBe(0);
    expect(messages.error).toEqual([]);
    expect(messages.log.join("\n")).toContain("OK");
    expect(messages.log.join("\n")).toContain("1 Dateien"); // Scan lief über 1 Datei
  });

  it("(b) scanDir enthält das Secret -> exit 1, Pfad im Log, Secret-Wert nie gedruckt", () => {
    const code = run({
      env: { SPOTIFY_CLIENT_SECRET: SECRET },
      files: { "leak.ts": `const s = "${SECRET}";\n` },
    });
    expect(code).toBe(1);
    expect(messages.error.join("\n")).toContain("leak.ts");
    for (const group of Object.values(messages)) {
      for (const msg of group) {
        expect(msg).not.toContain(SECRET);
      }
    }
  });

  it("Secret aus der env-Datei (envFilePath) wird gelesen, inkl. Quote-Stripping", () => {
    const code = run({
      env: {}, // kein env-Secret
      withEnvFile: true,
      files: { "clean.ts": "ok\n" },
    });
    expect(code).toBe(0);
    expect(messages.log.join("\n")).toContain("OK");
  });
});

describe("runCheckSecrets — Secret fehlt", () => {
  it("(c) CI erkannt (CI=true) -> console.error + exit 1 (fail-hard, kein Scan)", () => {
    const code = run({
      env: { CI: "true" },
      files: { "clean.ts": "ok\n" },
    });
    expect(code).toBe(1);
    expect(messages.error.join("\n")).toContain("SPOTIFY_CLIENT_SECRET");
    expect(messages.log).toEqual([]); // Scan lief nicht
  });

  it("(c') GITHUB_ACTIONS=true allein genügt als CI-Erkennung", () => {
    const code = run({ env: { GITHUB_ACTIONS: "true" } });
    expect(code).toBe(1);
    expect(messages.error.length).toBeGreaterThan(0);
  });

  it("(d) lokal (kein CI-Env) -> console.warn + exit 0 (weicher Skip wie bisher)", () => {
    const code = run({ env: {} });
    expect(code).toBe(0);
    expect(messages.warn.join("\n")).toContain("SPOTIFY_CLIENT_SECRET");
    expect(messages.error).toEqual([]);
  });

  it("(e) Secret kürzer als 8 Zeichen zählt als fehlend (scanDir enthält den kurzen Wert -> trotzdem warn + exit 0 lokal)", () => {
    const short = "kurz";
    const code = run({
      env: { SPOTIFY_CLIENT_SECRET: short },
      files: { "would-hit.ts": `const s = "${short}";\n` },
    });
    expect(code).toBe(0);
    expect(messages.warn.length).toBeGreaterThan(0);
    expect(messages.error).toEqual([]); // kein Scan, also kein Hit möglich
  });

  it("(e') kurzes Secret + CI -> exit 1 über den Fehlend-Pfad", () => {
    const code = run({ env: { SPOTIFY_CLIENT_SECRET: "kurz", CI: "true" } });
    expect(code).toBe(1);
    expect(messages.error.length).toBeGreaterThan(0);
  });
});

describe("runCheckSecrets — Dependabot-Runs (Secret strukturell nicht verfügbar)", () => {
  it("(f) CI + GITHUB_ACTOR=dependabot[bot] ohne Secret -> warn + exit 0 (kein fail-hard, kein Scan)", () => {
    const code = run({
      env: { CI: "true", GITHUB_ACTOR: "dependabot[bot]" },
      files: { "clean.ts": "ok\n" },
    });
    expect(code).toBe(0);
    expect(messages.warn.join("\n")).toContain("dependabot");
    expect(messages.error).toEqual([]);
    expect(messages.log).toEqual([]); // Scan lief nicht
  });

  it("(f') GITHUB_ACTIONS=true + dependabot[bot] -> ebenfalls weicher Skip + exit 0", () => {
    const code = run({
      env: { GITHUB_ACTIONS: "true", GITHUB_ACTOR: "dependabot[bot]" },
    });
    expect(code).toBe(0);
    expect(messages.warn.length).toBeGreaterThan(0);
    expect(messages.error).toEqual([]);
  });

  it("(f'') CI + anderer Actor (nicht dependabot[bot]) -> fail-hard exit 1 bleibt bestehen", () => {
    const code = run({
      env: { CI: "true", GITHUB_ACTOR: "andreaswillems" },
    });
    expect(code).toBe(1);
    expect(messages.error.length).toBeGreaterThan(0);
  });

  it("(f''') dependabot[bot] MIT vorhandenem Secret -> Scan läuft normal (exit 0, Dateien gezählt)", () => {
    const code = run({
      env: {
        CI: "true",
        GITHUB_ACTOR: "dependabot[bot]",
        SPOTIFY_CLIENT_SECRET: SECRET,
      },
      files: { "clean.ts": "ok\n" },
    });
    expect(code).toBe(0);
    expect(messages.error).toEqual([]);
    expect(messages.log.join("\n")).toContain("1 Dateien");
  });
});

describe("runCheckSecrets — Scan-Semantik", () => {
  it("node_modules und Dotfile-Einträge werden übersprungen", () => {
    mkdirSync(join(scanDir, "node_modules"));
    mkdirSync(join(scanDir, ".hidden"));
    writeFileSync(join(scanDir, "node_modules", "leak.js"), SECRET);
    writeFileSync(join(scanDir, ".hidden", "leak.js"), SECRET);
    writeFileSync(join(scanDir, ".env-leak"), SECRET);
    writeFileSync(join(scanDir, "clean.ts"), "ok\n");
    const code = runCheckSecrets({
      env: { SPOTIFY_CLIENT_SECRET: SECRET },
      envFilePath,
      scanDirs: [scanDir],
      baseDir: tmp,
      log: makeLog(),
    });
    expect(code).toBe(0); // nur clean.ts wurde gescannt, kein Hit
    expect(messages.log.join("\n")).toContain("1 Dateien");
  });
});

describe("defaultScanDirs — Scan über das ganze Repo", () => {
  it("liefert alle vorhandenen Repo-Verzeichnisse inkl. .github/ (Dot-Dir)", () => {
    for (const dir of ["src", "dist", "scripts", "public", ".github/workflows"]) {
      mkdirSync(join(tmp, dir), { recursive: true });
    }
    const dirs = defaultScanDirs(tmp).map((dir) => relative(tmp, dir));
    expect(dirs).toContain(join("src"));
    expect(dirs).toContain(join("dist"));
    expect(dirs).toContain(join("scripts"));
    expect(dirs).toContain(join("public"));
    expect(dirs).toContain(".github"); // Dot-Dir als Top-Level explizit dabei
  });

  it("lässt nicht existierende Verzeichnisse aus (kein Fehler, kein leerer Eintrag)", () => {
    mkdirSync(join(tmp, "dist"));
    const dirs = defaultScanDirs(tmp).map((dir) => relative(tmp, dir));
    expect(dirs).toEqual(["src", "dist"]);
  });

  it(".github als Top-Level-scanDir wird wirklich gescannt (Dot-Dir-Regel greift nur für Einträge, nicht die Wurzel)", () => {
    mkdirSync(join(tmp, ".github", "workflows"), { recursive: true });
    writeFileSync(join(tmp, ".github", "workflows", "leak.yml"), SECRET);
    const code = runCheckSecrets({
      env: { SPOTIFY_CLIENT_SECRET: SECRET },
      envFilePath,
      scanDirs: [join(tmp, ".github")],
      baseDir: tmp,
      log: makeLog(),
    });
    expect(code).toBe(1);
    expect(messages.error.join("\n")).toContain("leak.yml");
  });
});
