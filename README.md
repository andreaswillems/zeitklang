# Zeitklang — Scanner-Player-PWA

Zeitklang ist eine **Scanner-Player-App**: Physische Karten tragen QR-Codes,
die auf einen Song linken. Karte scannen → der Song spielt auf dem Handy.
Titel und Interpret bleiben hinter einem Spoiler-Blur verborgen, bis man sie
bewusst aufdeckt. Es gibt keine Quiz- oder Spielelemente.

**Live:** https://andreaswillems.github.io/zeitklang/

## Wie es funktioniert

1. **Spotify-Login** (OAuth 2.0 + PKCE im Browser, Authorization Code Flow —
   **benötigt Spotify Premium**). Die Client-ID ist bewusst öffentlich (PKCE
   braucht kein Secret im Frontend, `src/lib/config.ts`).
2. **QR-Scan** der Karte direkt in der PWA (Kamera via html5-qrcode).
3. **Wiedergabe** über das offizielle
   [Spotify Web Playback SDK](https://developer.spotify.com/documentation/web-playback-sdk):
   Der Browser wird selbst zum Spotify-Connect-Gerät.

## Stack

**Preact + TypeScript + Vite** · Tests: Vitest + happy-dom · Lint/Format:
Biome · Service Worker: vite-plugin-pwa (`injectManifest`, Precache mit
Content-Hashes — nach dem ersten Laden komplett offline nutzbar).

## Projektstruktur

```
├── index.html            # Vite-Entry (CSP-Meta, statischer Pre-JS-Ladezustand)
├── public/               # Manifest, Icons — wird 1:1 nach dist/ kopiert
├── src/
│   ├── lib/              # reine, unit-testbare Logik (PKCE, Tokens, Redirect, …)
│   ├── adapters/         # Spotify SDK, html5-qrcode, qrcode-generator gekapselt
│   ├── state/            # Signals-Stores (auth, player, scanner, ui)
│   ├── components/       # Preact-Komponenten (Login, Scan, Sheet, MiniPlayer, …)
│   ├── styles/           # global.css + CSS-Module je Komponente
│   └── sw.ts             # Service Worker (injectManifest)
└── *.test.ts(x)          # Tests liegen neben den Modulen
```

## Voraussetzungen

- **Node 26 LTS** — gepinnt über `.tool-versions` (lokal via asdf, in CI via
  `node-version-file`).
- **npm** — committed `package-lock.json`; Installation immer per `npm ci`.

## Dev-Setup

```bash
npm ci        # frische Installation aus package-lock.json (installiert auch die Husky-Hooks)
npm run dev   # Vite-Dev-Server auf http://localhost:5173
```

Auf Port **5173** entwickelt man UI und Komponenten — allerdings **ohne
Login**: Die OAuth-Redirect-URI ist `https://127.0.0.1:8080/callback`, nicht
der Dev-Port. Wie der Login lokal trotzdem geht, steht unter
[„OAuth lokal“](#oauth-lokal).

## Komplettes lokales Gate

Vor jedem Commit/Push — identisch zur CI
([`.github/workflows/rework-ci.yml`](.github/workflows/rework-ci.yml)):

```bash
npm run ci            # Biome im CI-Modus (Lint + Format + Imports, non-zero bei Befunden)
npm run typecheck     # tsc --noEmit
npm test              # Vitest (alle Unit- und Komponenten-Tests)
npm run build         # Produktionsbuild → dist/
npm run check:secrets # Secret-Scan über src/, dist/, scripts/, public/, .github/, .husky/
```

Alle fünf Schritte müssen grün sein. Auto-Fix für Biome-Befunde vor dem Gate:
`npm run check:fix` (auto-fix) bzw. `npm run check` (read-only).

## OAuth lokal

Der OAuth-Redirect zeigt auf `https://127.0.0.1:8080/callback`. Deshalb testet
man die gebaute App lokal auf genau diesem Port:

```bash
npm run build
npx vite preview --port 8080
```

- `vite preview` liefert `dist/` auf Port 8080. Mit vorhandenem
  mkcert-Zertifikat (`.cache/serve-127.0.0.1.pem` + Key) schaltet
  `vite.config.ts` automatisch auf **HTTPS via mkcert** um; ohne Zertifikat
  läuft plain HTTP. Zertifikate und `.cache/` sind gitignored — **niemals
  committen**.
- Für UI-Änderungen ohne Login bleibt `npm run dev` (Port 5173); längere
  OAuth-Sessionen mit Live-Build: `npm run build:watch` + `vite preview`.

## Lokale Anmeldedaten („Angemeldet bleiben“)

Nach dem Login liegen zwei Token lokal im Browser: das **Access-Token** immer
in `sessionStorage` (flüchtig) und der **Refresh-Token** je nach Einstellung:

- **„Angemeldet bleiben“ an (Default):** Refresh-Token in `localStorage` —
  die Anmeldung überlebt das Schließen des Tabs/Browsers.
- **„Angemeldet bleiben“ aus:** Refresh-Token in `sessionStorage` —
  Session-only; nach dem Schließen des Tabs ist ein Re-Login nötig.

Die Checkbox sitzt in der **Login-Ansicht** unter dem Login-Button und in
der **Scan-Ansicht** im Header; die Einstellung lässt sich also auch
eingeloggt wechseln (`src/lib/tokens.ts`, `src/state/auth.ts`). Beim Logout
wird der Refresh-Token aus dem jeweils aktiven Speicher gelöscht.

## Troubleshooting

### „Verbindung zu Spotify fehlgeschlagen“ trotz erfolgtem Re-Consent

**Symptom:** Login und QR-Scan funktionieren, aber die Wiedergabe startet
nicht; die Statuszeile endet in „Verbindung zu Spotify fehlgeschlagen — bitte
Seite neu laden.“ Ein bereits erfolgter Re-Consent behebt das Problem
**nicht** — Spotify antwortet auf den Play-Transfer mit **403 UNKNOWN**.

**Ursache:** eine veraltete Login-/Token-Epoche — **kein App-Defekt**.
Tokens aus älteren Refresh-/Consent-Ketten bekommen von Spotify kein
`web-playback`: Der Play-Transfer antwortet mit 403 UNKNOWN.

**Abhilfe:** ein komplett frischer Login — er erzeugt eine funktionierende
Token-Epoche:

1. In einer **frischen Browser-Session** (privates Fenster) die App neu
   öffnen und neu einloggen, **oder**
2. in Spotify **vollständig ausloggen** und sich danach neu in die App
   einloggen.

### Logout löscht nur lokale Tokens — Widerruf nur manuell bei Spotify

`logout()` (`src/state/auth.ts`) entfernt nur die **lokalen** Anmeldedaten.
Spotify stellt keinen Revoke-API-Endpunkt bereit — ein Refresh-Token bleibt
serverseitig gültig, bis der Nutzer die App-Verbindung unter
**https://spotify.com/account/apps** manuell widerruft. Die App weist nach
dem Logout direkt im Login-Screen darauf hin.

## Lizenz

Lizensiert unter der **EUPL v. 1.2** — siehe [LICENSE](LICENSE).
