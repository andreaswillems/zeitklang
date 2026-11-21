#!/usr/bin/env node
/**
 * Secret-Scan für die rework-PWA — Python-frei (docs/pwa-rebuild.md §4).
 * Ersetzt langfristig app/tests/test_web_assets.py (Scan über web/).
 *
 * Durchsucht rework/src und rework/dist (nach dem Build, exkl. node_modules/)
 * nach dem SPOTIFY_CLIENT_SECRET. Quelle des Secrets:
 *   1. process.env.SPOTIFY_CLIENT_SECRET (CI: Actions-Secret in rework-ci.yml)
 *   2. ../.env (lokale Entwicklung)
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const reworkDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = join(reworkDir, "..");
const scanDirs = ["src", "dist"]
    .map((dir) => join(reworkDir, dir))
    .filter((dir) => existsSync(dir));

function loadSecret() {
    if (process.env.SPOTIFY_CLIENT_SECRET) {
        return process.env.SPOTIFY_CLIENT_SECRET.trim();
    }
    const envPath = join(repoRoot, ".env");
    if (existsSync(envPath)) {
        const match = readFileSync(envPath, "utf8").match(
            /^SPOTIFY_CLIENT_SECRET\s*=\s*(.+)$/m,
        );
        if (match) {
            return match[1].trim().replace(/^["']|["']$/g, "");
        }
    }
    return null;
}

function* walk(dir) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
        const path = join(dir, entry.name);
        if (entry.isDirectory()) {
            yield* walk(path);
        } else {
            yield path;
        }
    }
}

const secret = loadSecret();
if (!secret || secret.length < 8) {
    // Kein Secret konfiguriert (z. B. Actions-Secret noch nicht gesetzt) —
    // es gibt nichts, wonach gesucht werden könnte. Laut warnen und überspringen,
    // damit die CI grün bleibt; lokal greift der Scan über ../.env.
    console.warn(
        "check-secrets: WARNUNG — SPOTIFY_CLIENT_SECRET nicht konfiguriert " +
            "(weder Umgebungsvariable noch ../.env), Scan wird übersprungen. " +
            "In CI muss das Actions-Secret SPOTIFY_CLIENT_SECRET gesetzt sein.",
    );
    process.exit(0);
}

let scanned = 0;
let hits = 0;
for (const dir of scanDirs) {
    for (const file of walk(dir)) {
        scanned++;
        let content;
        try {
            content = readFileSync(file, "utf8");
        } catch {
            continue; // z. B. Binärdatei
        }
        if (content.includes(secret)) {
            hits++;
            console.error(
                `check-secrets: SECRET gefunden in ${relative(repoRoot, file)}`,
            );
        }
    }
}

if (hits > 0) {
    console.error(
        `check-secrets: FEHLER — Secret in ${hits} Datei(en) gefunden.`,
    );
    process.exit(1);
}

const dirs = scanDirs.map((dir) => relative(repoRoot, dir)).join(", ");
console.log(`check-secrets: OK — ${scanned} Dateien in ${dirs} enthalten das Secret nicht.`);
