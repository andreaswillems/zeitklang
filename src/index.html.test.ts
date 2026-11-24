import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// Vitest läuft mit cwd = rework/ (npm test); import.meta.url ist in
// happy-dom keine file-URL, daher relativ zum Projekt-Root lesen.
const html = readFileSync(resolve(process.cwd(), "index.html"), "utf8");

// Content-Attribut byte-genau aus web/index.html gepinnt (#78/#92).
const CSP =
  "default-src 'self'; script-src 'self' https://sdk.scdn.co; frame-src https://sdk.scdn.co; style-src 'self'; img-src 'self' https://*.scdn.co data:; connect-src 'self' https://accounts.spotify.com https://api.spotify.com https://*.spotify.com wss://*.spotify.com; media-src blob: https://*.spotify.com; worker-src blob: 'self'; object-src 'none'; base-uri 'self'; form-action 'none'";

describe("index.html (Parity web/index.html)", () => {
  it("CSP-Meta ist byte-identisch zu web/index.html", () => {
    const match = html.match(
      /<meta http-equiv="Content-Security-Policy" content="([^"]*)">/,
    );
    expect(match?.[1]).toBe(CSP);
  });

  it("Vite-Entry: genau ein Module-Script, kein Stylesheet-Link, kein SDK-/Vendor-Script", () => {
    expect(html).toContain('<script type="module" src="/src/main.tsx"></script>');
    expect(html.match(/<script/g)).toHaveLength(1);
    expect(html).not.toMatch(/<link[^>]*rel="stylesheet"/);
    expect(html).not.toMatch(/<script[^>]*sdk\.scdn\.co/);
  });

  it("Head-Parity: Metas, OG/Twitter, Apple-PWA, relative Asset-Links, statischer Ladezustand in #app", () => {
    for (const snippet of [
      '<html lang="de">',
      '<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">',
      '<meta name="referrer" content="no-referrer">',
      '<meta name="theme-color" content="#0e0e0e">',
      "<title>Zeitklang</title>",
      '<meta name="description" content="Scanner-Player mit QR-Karten: Karte scannen, der Song spielt auf deinem Handy; Titel und Interpret erscheinen hinter einem Spoiler. Benötigt Spotify Premium.">',
      '<meta property="og:type" content="website">',
      '<meta property="og:site_name" content="Zeitklang">',
      '<meta property="og:title" content="Zeitklang · Scanner-Player mit QR-Karten">',
      '<meta property="og:description" content="Scanner-Player mit QR-Karten: Karte scannen, der Song spielt auf deinem Handy; Titel und Interpret erscheinen hinter einem Spoiler. Benötigt Spotify Premium.">',
      '<meta property="og:url" content="https://andreaswillems.github.io/zeitklang/">',
      '<meta property="og:image" content="https://andreaswillems.github.io/zeitklang/icons/icon-512.png">',
      '<meta property="og:image:width" content="512">',
      '<meta property="og:image:height" content="512">',
      '<meta property="og:image:alt" content="Zeitklang-App-Icon auf dunklem Hintergrund">',
      '<meta property="og:locale" content="de_DE">',
      '<meta name="twitter:card" content="summary">',
      '<meta name="twitter:title" content="Zeitklang · Scanner-Player mit QR-Karten">',
      '<meta name="twitter:description" content="Scanner-Player mit QR-Karten: Karte scannen, der Song spielt auf deinem Handy; Titel und Interpret erscheinen hinter einem Spoiler. Benötigt Spotify Premium.">',
      '<meta name="twitter:image" content="https://andreaswillems.github.io/zeitklang/icons/icon-512.png">',
      '<meta name="apple-mobile-web-app-capable" content="yes">',
      '<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">',
      '<meta name="apple-mobile-web-app-title" content="Zeitklang">',
      '<link rel="icon" href="icon.png">',
      '<link rel="apple-touch-icon" href="icon.png">',
      '<link rel="manifest" href="manifest.webmanifest">',
      // XQSXXEX: statischer Pre-JS-Ladezustand (Parity web/index.html
      // L60–63) direkt in #app — wird beim JS-Mount ersetzt (main.tsx).
      `    <div id="app">
        <section id="loading" role="status">
            <div class="spinner" aria-hidden="true"></div>
            <p>Anmeldung läuft…</p>
        </section>
    </div>`,
    ]) {
      expect(html).toContain(snippet);
    }
    expect(html).not.toContain("Phase 0");
    // CSP style-src 'self' bleibt valide: keine Inline-Styles/-Stylesheets.
    expect(html).not.toMatch(/\sstyle=/);
    expect(html).not.toMatch(/<style[\s>]/);
  });
});
