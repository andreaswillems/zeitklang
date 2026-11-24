#!/usr/bin/env node
/**
 * Secret-Scan für das ganze Repo — Python-frei.
 *
 * Durchsucht defaultScanDirs(repoRoot) — also src, dist (nach dem Build)
 * sowie scripts/, public/, .github/ und .husky/ (jeweils nur wenn vorhanden,
 * exkl. node_modules/ und Dot-Einträge innerhalb der Verzeichnisse).
 * nach dem SPOTIFY_CLIENT_SECRET. Quelle des Secrets:
 *   1. process.env.SPOTIFY_CLIENT_SECRET (CI: Actions-Secret in rework-ci.yml)
 *   2. ../.env (lokale Entwicklung)
 *
 * Fail-hard in CI (ZF96RD7, OWASP A03 F3): Fehlt das Secret UND ist CI erkannt
 * (CI === "true" oder GITHUB_ACTIONS === "true"), exit 1 — der Scan darf in CI
 * nie stillschweigend ausfallen (fail-open). Lokal ohne .env bleibt der weiche
 * Skip (Warnung + exit 0), damit Dev ohne .env weiterarbeiten kann.
 *
 * Ausnahme Dependabot: GitHub übergibt Dependabot-Runs (push durch
 * dependabot[bot] und Dependabot-PRs) KEINE Repo-Secrets — das Secret ist dort
 * strukturell nicht verfügbar, nicht falsch konfiguriert. Daher weicher Skip
 * (Warnung + exit 0), wenn GITHUB_ACTOR === "dependabot[bot]"; der Fail-hard
 * bleibt für alle anderen CI-Runs (main, PRs von Menschen) aktiv.
 *
 * Testbar: runCheckSecrets({ env, envFilePath, scanDirs, baseDir, log }) liefert
 * den Exit-Code; process.exit wird nur im Main-Wrapper unten aufgerufen.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

function loadSecret(env, envFilePath) {
    if (env.SPOTIFY_CLIENT_SECRET) {
        return env.SPOTIFY_CLIENT_SECRET.trim();
    }
    if (envFilePath && existsSync(envFilePath)) {
        const match = readFileSync(envFilePath, "utf8").match(
            /^SPOTIFY_CLIENT_SECRET\s*=\s*(.+)$/m,
        );
        if (match) {
            return match[1].trim().replace(/^["']|["']$/g, "");
        }
    }
    return null;
}

function isCi(env) {
    return env.CI === "true" || env.GITHUB_ACTIONS === "true";
}

/**
 * Dependabot-Runs (push durch dependabot[bot], Dependabot-PRs) bekommen von
 * GitHub keine Repo-Secrets — ein fehlendes Secret ist dort strukturell
 * bedingt, nicht Konfigurationsfehler (siehe Header-Kommentar).
 */
function isDependabot(env) {
    return env.GITHUB_ACTOR === "dependabot[bot]";
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

/**
 * Kern des Secret-Scans — ohne process.exit, damit importierbar/testbar.
 * Liefert den Exit-Code (0 = OK/weich übersprungen, 1 = Hit oder Secret fehlt in CI).
 * Druckt niemals den Secret-Wert selbst.
 */
export function runCheckSecrets({ env, envFilePath, scanDirs, baseDir, log }) {
    const secret = loadSecret(env, envFilePath);
    if (!secret || secret.length < 8) {
        // Kein Secret konfiguriert — es gibt nichts, wonach gesucht werden könnte.
        const ci = isCi(env);
        if (ci && isDependabot(env)) {
            // Dependabot-Ausnahme: GitHub übergibt Dependabot-Runs keine
            // Repo-Secrets — das Secret fehlt dort strukturell. Weicher Skip,
            // damit Dependabot-PRs nicht am Fail-hard scheitern; auf main und
            // PRs von Menschen bleibt der Fail-hard unten aktiv.
            log.warn(
                "check-secrets: WARNUNG — SPOTIFY_CLIENT_SECRET nicht konfiguriert " +
                    `(weder Umgebungsvariable noch ${envFilePath}), aber ` +
                    "GITHUB_ACTOR=dependabot[bot]: GitHub übergibt Dependabot-Runs " +
                    "keine Repo-Secrets. Scan wird übersprungen — exit 0.",
            );
            return 0;
        }
        if (ci) {
            // Fail-hard (ZF96RD7): In CI muss das Actions-Secret gesetzt sein —
            // ein stillschweigender Skip würde den Scan wirkungslos machen.
            log.error(
                "check-secrets: FEHLER — SPOTIFY_CLIENT_SECRET nicht konfiguriert " +
                    `(weder Umgebungsvariable noch ${envFilePath}), aber CI erkannt ` +
                    "(CI/GITHUB_ACTIONS=true). Scan wird NICHT übersprungen — exit 1. " +
                    "In CI muss das Actions-Secret SPOTIFY_CLIENT_SECRET gesetzt sein.",
            );
            return 1;
        }
        // Lokal ohne .env: weicher Skip, damit die Entwicklung ohne .env läuft.
        log.warn(
            "check-secrets: WARNUNG — SPOTIFY_CLIENT_SECRET nicht konfiguriert " +
                `(weder Umgebungsvariable noch ${envFilePath}), Scan wird übersprungen. ` +
                "In CI muss das Actions-Secret SPOTIFY_CLIENT_SECRET gesetzt sein.",
        );
        return 0;
    }

    let scanned = 0;
    let hits = 0;
    for (const dir of scanDirs) {
        if (!existsSync(dir)) continue;
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
                log.error(
                    `check-secrets: SECRET gefunden in ${relative(baseDir, file)}`,
                );
            }
        }
    }

    if (hits > 0) {
        log.error(
            `check-secrets: FEHLER — Secret in ${hits} Datei(en) gefunden.`,
        );
        return 1;
    }

    const dirs = scanDirs.map((dir) => relative(baseDir, dir)).join(", ");
    log.log(`check-secrets: OK — ${scanned} Dateien in ${dirs} enthalten das Secret nicht.`);
    return 0;
}

/**
 * Standard-Scan-Verzeichnisse relativ zum Repo-Root. Dot-Verzeichnisse wie
 * .github/.husky müssen explizit aufgeführt werden — walk() überspringt
 * Dot-Einträge nur INNERHALB der scanDirs, die Top-Level-Verzeichnisse
 * selbst werden gescannt. Nicht existente Verzeichnisse werden ausgelassen.
 */
export function defaultScanDirs(repoRoot) {
    const candidates = ["src", "dist", "scripts", "public", ".github", ".husky"];
    return candidates.map((dir) => join(repoRoot, dir)).filter((dir) => existsSync(dir));
}

// Dünner Main-Wrapper: process.exit NUR bei direktem Aufruf, nie beim Import.
const isMain =
    process.argv[1] &&
    import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
    const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
    const exitCode = runCheckSecrets({
        env: process.env,
        envFilePath: join(repoRoot, ".env"),
        scanDirs: defaultScanDirs(repoRoot),
        baseDir: repoRoot,
        log: console,
    });
    process.exit(exitCode);
}
