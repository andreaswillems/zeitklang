# PWA-Rebuild — Plan: Vite + Preact + TypeScript + Vitest

> **Status:** Plan (noch keine Umsetzung). Ziel: Die bestehende Vanilla-PWA in
> `web/` (eine Seite, `app.js` ~950 Zeilen, keine Tests, manueller Service Worker)
> strukturiert neu aufsetzen. Verhalten und Funktionsumfang bleiben 1:1 erhalten
> (Parity), die Architektur wird testbar.
> Verbindliche Verhaltens-Spec bleibt [`pwa-spezifikation.md`](pwa-spezifikation.md);
> dieser Plan beschreibt nur den technischen Neuaufbau.
> **Vorgabe Parallelbetrieb:** Die neue App wird in `rework/` aufgebaut. `web/`
> bleibt bis zur ausdrücklichen Freigabe durch Andreas vollständig unberührt und
> live — GitHub Pages deployt weiter `web/`, `zeitklang serve` liefert weiter
> `web/`. Umschaltung und Löschung von `web/` ist die eigene **Phase 7 „Cutover"**
> (§9), die erst nach Freigabe ausgeführt wird.

## 1. Ziel und Nicht-Ziele

**Ziel:** Die PWA läuft als typisiertes Preact-Projekt mit Build-Schritt, Unit- und
Komponenten-Tests, automatisch versioniertem Service Worker und CI-Build für
GitHub Pages.

**Nicht-Ziele (YAGNI, bewusst out of scope):**

- Kein neuer Funktionsumfang (keine Spiellogik, kein Router mit mehreren Seiten —
  die App bleibt eine Seite mit Zuständen, Spec §6/§9).
- Kein serverseitiger Token-Proxy (Refresh-Token bleibt im localStorage,
  Spec §8 — Restrisiko formal akzeptiert).
- Kein Playwright-E2E in v1 (OAuth gegen echtes Spotify ist nicht automatisierbar;
  manueller Smoke-Test nach Spec §10 bleibt bestehen). Playwright kann später
  für den Login-Screen ergänzt werden.
- Kein ESLint separat — Biome übernimmt Lint + Format (§6.1).
- **Kein Eingriff in die bestehende App während des Parallelbetriebs:** `web/`,
  `app/` und `pages.yml` bleiben bis Phase 7 (Cutover) unverändert. Die neue App
  entsteht ausschließlich in `rework/` — plus additive Root-Einträge (`.husky/`,
  `.gitignore`-Zeilen), die `web/` nicht verändern (§4, §6.2).
- **Die PWA braucht produktiv kein Python:** GitHub Pages liefert `rework/dist`
  statisch aus (reiner Actions-Workflow). Änderungen an `app/` betreffen nur den
  lokalen Dev-Server `zeitklang serve` und zwei Tests — und selbst die sind
  optional (§4: Variante A = eine Zeile in `config.py`, Variante B = gar keine
  Python-Änderung).

## 2. Stack-Entscheidungen

| Entscheidung | Festlegung | Begründung |
|---|---|---|
| Framework | **Preact** (`preact`, `@preact/signals`) | Kleinstes Bundle (~4–6 kb gzip) — wichtig auf Low-End-Handys mit Kamera + Audio; nahe am heutigen Vanilla-Code (JSX statt DOM-Manipulation); Signals sind ideal für den gekoppelten UI-State (Sheet/Mini-Player/Spoiler/Scanner) |
| Build | **Vite** + `@preact/preset-vite` | `base: './'` löst den Pages-Base-Pfad `/zeitklang/` (Spec §11), precompilierte JSX-Templates sind CSP-konform (kein `eval`/Inline) |
| Sprache | **TypeScript** (strict) | Der Umbau einer ungetesteten App braucht Typsicherheit sofort |
| Tests | **Vitest** + `happy-dom` + `@testing-library/preact` | leichtgewichtigstes Setup; happy-dom ist schneller als jsdom |
| PWA/Service Worker | **vite-plugin-pwa** mit `strategies: 'injectManifest'` (`src/sw.ts`) | volle Kontrolle über das Fetch-Verhalten (network-first Navigationen, damit `?code=…` nie gecacht wird); Precache-Liste + Hashes automatisch aus dem Build — das manuelle `CACHE_VERSION`-Bumpen entfällt |
| Paketmanager | **npm** mit committed `package-lock.json` | kommt mit Node; CI ohne Zusatz-Installation |
| Node-Version | **Node 26 LTS** via `rework/.nvmrc` (`26`) | neueste LTS (Codename „Lithium“, LTS seit 2026-10-28, Support bis April 2029); Node 27 ist Stand Nov. 2026 nur Alpha und wird nicht produktiv genutzt. `actions/setup-node` liest die Datei via `node-version-file` — lokal und CI nutzen dieselbe Quelle |
| Lint + Format | **Biome** (`@biomejs/biome` v2) | ein Tool statt ESLint + Prettier (ein Binary, ein Config); `biome ci` im CI, `biome check --write` lokal; formatiert TS/TSX **und** die CSS-Module; Details §6.1 |
| Pre-Commit-Hooks | **Husky v9 + lint-staged**, Hooks im Repo-Root `.husky/`, gescoped auf `rework/**` | `pre-commit`: Biome auto-fixt die staged rework-Files + `tsc`; `pre-push`: `vitest run` — beide über `npm --prefix rework`. `web/` wird nicht angefasst. CI bleibt Quelle der Wahrheit; Details §6.2 |
| QR-Scan / QR-Generierung | `html5-qrcode` und `qrcode-generator` als **npm-Dependencies** | nicht mehr vendored; gehasht im Bundle, vom SW precachebar. `html5-qrcode` (~100 kb) wird per dynamischem `import()` erst beim ersten Scan geladen (eigener Chunk) |
| Spotify SDK | bleibt externes Script `https://sdk.scdn.co/spotify-player.js` | CSP `script-src 'self' https://sdk.scdn.co` bleibt valide; Laden passiert im Adapter |

## 3. Repo-Layout

```
rework/                     # die neue App — web/ bleibt bis Phase 7 (Cutover) unberührt
├── .nvmrc                    # "26" (Node 26 LTS — neueste LTS, siehe §2)
├── package.json / package-lock.json   # lint-staged-Config (Glob: rework/**/*.{ts,tsx,css,json})
├── vite.config.ts            # base './', outDir 'dist', VitePWA injectManifest, preview.https (mkcert-Cert, §4)
├── tsconfig.json             # strict, jsxImportSource: preact
├── vitest.config.ts          # happy-dom, setupFiles, globals: false (explizite Imports)
├── biome.json                # Lint + Format + Organize Imports (v2), siehe §6.1
├── index.html                # Vite-Entry: CSP-Meta, OG-Tags, <script type="module" src="/src/main.tsx">
├── public/                   # wird 1:1 nach dist/ kopiert
│   ├── manifest.webmanifest  # unverändert
│   ├── icon.png
│   └── icons/ (192, 512, maskable-512)
├── src/
│   ├── main.tsx              # Mount, Service-Worker-Registrierung
│   ├── app.tsx               # Shell: View-Switch, Header, Statuszeile
│   ├── config.ts             # clientId, Scopes, redirectUriForHost() (öffentlich, committed — wie heute config.js)
│   ├── styles/
│   │   ├── global.css        # :root-Tokens, body/main/header, Buttons, App-Shell-Lock (#90), reduced-motion, :has()-Regeln
│   │   └── *.module.css      # Komponenten-Styles (Vite CSS Modules, Typen via vite/client)
│   ├── lib/                  # reine, unit-testbare Logik — keine DOM/SDK/fetch-Globals, Deps werden injiziert
│   │   ├── pkce.ts           # randomString, base64url, pkceChallenge
│   │   ├── track-id.ts       # trackIdFrom(text)
│   │   ├── scan-guard.ts     # createScanGuard(cooldownMs) — Dubletten-/Invalid-Cooldown
│   │   ├── errors.ts         # playErrorMessage(status, reason), Login-Fehlertexte
│   │   ├── tokens.ts         # requestToken(body, deps), getValidToken(deps)
│   │   ├── redirect.ts       # handleRedirect(search, deps) — code/state/error auswerten
│   │   └── storage.ts        # Storage-Interface + localStorage/sessionStorage-Implementierung + InMemory für Tests
│   ├── adapters/             # imperative Welt, dünn gekapselt und in Tests mockbar
│   │   ├── spotify-sdk.ts    # lädt sdk.scdn.co, kapselt Spotify.Player + Events als Callback-API
│   │   ├── qr-scanner.ts     # kapselt html5-qrcode (dynamisches import), Torch, Capabilities
│   │   └── share-qr.ts       # qrcode-generator → Canvas
│   ├── state/                # Signals-Stores — der einzige Ort mit globalem Zustand
│   │   ├── auth.ts           # status, login(), logout(), initAuth(), authError
│   │   ├── player.ts         # deviceId, currentState, playTrack(), Queue, Re-Consent, Premium-Fehler
│   │   ├── scanner.ts        # scannerActive, startScan/stopScan, Torch, Scan-Handling inkl. Vibration
│   │   └── ui.ts             # view ('loading'|'login'|'scan'), sheetOpen, spoiler, Mini-Player-Sichtbarkeit (computed), Share-Dialog, Install-Prompt, online
│   ├── components/
│   │   ├── LoginView.tsx     # Wortmarke, EQ-Deko, Spotify-Button, Fehlerbereich, Premium-Badge, Install-/Share-Ghost-Buttons
│   │   ├── ScanView.tsx      # reader-wrap, Torch-, Stopp-, Start-Button, Guide-Karte, Ergebniszeile
│   │   ├── PlayerSheet.tsx   # Bottom-Sheet mit Now-Playing-Karte, Spoiler, Play/Pause
│   │   ├── MiniPlayer.tsx    # kompakte Leiste
│   │   ├── ShareDialog.tsx   # QR-Dialog „App teilen"
│   │   ├── LoadingView.tsx   # Ladezustand (#8)
│   │   └── icons.tsx         # Inline-SVG als Komponenten (logout, torch, close, play/pause, qr, install, share, spotify, …)
│   ├── sw.ts                 # Service Worker (injectManifest): Precache + network-first Navigationen, cache-first nur Precache
│   └── *.test.ts(x)          # Tests liegen neben den Modulen (src/lib/*.test.ts, src/components/*.test.tsx, src/state/*.test.ts)
└── dist/                     # Build-Output, gitignored; wird erst nach Cutover (Phase 7) von Pages und `zeitklang serve` ausgeliefert
```

Daneben im **Repo-Root**: `.husky/pre-commit` + `.husky/pre-push` (Hooks laufen nur
auf `rework/`, §6.2). Die alte App in `web/` (`app.js`, `style.css`, `config.js`,
`sw.js`, `vendor/`) bleibt bis Phase 7 (Cutover) vollständig unberührt und live —
Git-History bleibt die Sicherung.

## 4. Build-, Dev- und Deploy-Workflow (Parallelbetrieb: neue App in `rework/`)

### Lokal (bis Cutover — `web/` und `zeitklang serve` bleiben unberührt)

```bash
cd rework
npm install
npm run dev                  # vite dev, Port 5173 — UI/Komponenten-Dev ohne Login
# ODER gebaut auf dem OAuth-Port testen:
npm run build:watch &        # vite build --watch → rework/dist/
npx vite preview --port 8080 # liefert rework/dist auf 0.0.0.0:8080
```

**OAuth lokal in der Parallelphase:** Die Redirect-URI ist
`https://127.0.0.1:8080/callback` (Spec §3, im Spotify-Dashboard registriert) und
zeigt bis zum Cutover auf die alte App (`zeitklang serve` liefert `web/`). Deshalb
testet man die rework-App lokal auf Port 8080 via `vite preview` — mit TLS über
das mkcert-Zertifikat aus `.cache/` (`preview.https` in `vite.config.ts`, z. B.
`.cache/serve-127.0.0.1.pem`); dann passt der Redirect und die **neue** App
empfängt `/?code=…` selbst. `npm run dev` (5173) bleibt für reines Komponenten-Dev
ohne Login. Nach dem Cutover (Phase 7) übernimmt `zeitklang serve` Port 8080 mit
`rework/dist`.

### Python (`app/`) — produktiv nicht nötig, nur Cutover-Minimum

**Grundsatz: Die PWA läuft produktiv vollständig ohne Python** — `pages.yml`
deployt `rework/dist` statisch. Lokal ist `vite preview --port 8080` mit mkcert-TLS
(§4 Lokal) die Python-freie Alternative zu `zeitklang serve`.

Der **Secret-Scan** (heute `test_web_assets.py` über `web/`) wird ab Phase 0
**Python-frei** in die rework-CI verlagert: `rework/scripts/check-secrets.mjs`
liest das Secret aus `process.env.SPOTIFY_CLIENT_SECRET` (CI) bzw. `../.env`
(lokal) und durchsucht `rework/src` + `rework/dist` (nach dem Build), exkl.
`node_modules/` → npm-Script `check:secrets`, Schritt in `rework-ci.yml` nach
`npm run build`. Damit fasst Phase 0–6 kein Python an.

Im Cutover (Phase 7) zwei Varianten für `zeitklang serve`:

- **Variante A (minimal, wenn `serve` bleiben soll):** eine Zeile in `config.py` —
  `WEB_DIR = PROJECT_ROOT / "rework" / "dist"`. `serve.py` bleibt unverändert und
  liefert dann `rework/dist` inkl. SPA-Fallback. Einzige Test-Anpassung:
  `test_serve.py` mit `create_app(static_dir=…)`-Fixture, weil der Preact-Build
  das DOM erst rendert (`id="reader"` steht nicht mehr im statischen HTML).
- **Variante B (gar keine Python-Änderung):** `zeitklang serve` wird im Cutover
  gestrichen (lokal nur `vite preview`), `test_serve.py`/`test_web_assets.py`
  werden mit `web/` entfernt bzw. obsolet (Secret-Scan läuft nur noch in
  `rework-ci.yml`).

### CI / GitHub Pages

- `.github/workflows/pages.yml` bleibt bis Phase 7 **unverändert** — Pages deployt
  weiter die alte App aus `web/`.
- Neuer Workflow `.github/workflows/rework-ci.yml` (push + PR, `paths: rework/**, .husky/**`):
  `actions/setup-node@v4` (`node-version-file: rework/.nvmrc`) →
  `HUSKY=0 npm ci` (working-directory `rework`, Hooks im CI aus) →
  `npm run ci` (Biome: Lint + Format + Imports — non-zero Exit bei Befunden) →
  `npm run typecheck` (`tsc --noEmit` — Biome ersetzt den Typechecker nicht) →
  `npm test` → `npm run build` (Build-Smoke) → `npm run check:secrets`
  (Secret-Scan auf `rework/dist` + `rework/src`, Python-frei, ersetzt langfristig
  `test_web_assets.py`).
- `.gitignore` (Root, additive Ergänzung in Phase 0): `node_modules/` (matcht
  `rework/node_modules/`), `.husky/_`. `dist/` ist bereits global ignoriert und
  matcht damit auch `rework/dist/`.

## 5. Architektur

### 5.1 Drei Schichten

1. **`lib/` — pure Logik.** Funktionen nehmen ihre Abhängigkeiten als Parameter
   (Storage-Interface, `fetch`, `search`-String, `hostname`, RNG). Keine globalen
   Imports → in Vitest direkt testbar, ohne DOM-Mocking.
2. **`adapters/` — imperative Fremdsysteme.** Spotify SDK, html5-qrcode,
   qrcode-generator, Storage. Dünne Wrapper mit klarer Callback-API; in Tests
   durch Mocks ersetzt.
3. **`state/` — Signals-Stores.** Der einzige Ort mit globalem Zustand. Stores
   verdrahten `lib/` + `adapters/` mit den echten Browser-Globals und exponieren
   `signal`/`computed` für Komponenten. Kein `window.player` mehr.

### 5.2 Store-Skizzen (Signatur-Ebene)

```ts
// state/auth.ts
type AuthStatus = "loading" | "ready" | "logged-out";
export const authStatus = signal<AuthStatus>("loading");
export const authError = signal<string | null>(null);        // #58: gezielte Meldungen
export const redirecting = signal(false);                    // #58: Doppeltipp-Schutz
export function login(forceConsent?: boolean): void;         // baut Authorize-URL, location.href
export function logout(): void;                              // Tokens verwerfen, forceConsent-Flag, player.disconnect
export async function initAuth(): Promise<void>;             // handleRedirect → getValidToken → Status

// state/player.ts
export const deviceId = signal<string | null>(null);
export const playerState = signal<SpotifyPlayerState | null>(null);
export const trackLoaded = computed(() => playerState.value !== null);
export function createPlayer(): void;                        // über spotify-sdk-Adapter
export async function playTrack(trackId: string): Promise<void>; // Queue, 401-Retry, 403/404/412-Mapping, Re-Consent

// state/scanner.ts
export const scannerActive = signal(false);
export const torchOn = signal(false);
export async function startScan(): Promise<void>;
export function stopScan(): void;
export function handleScannedText(text: string): void;      // trackIdFrom + Guard + vibrate + playTrack

// state/ui.ts
export const view = signal<"loading" | "login" | "scan">("loading");
export const sheetOpen = signal(false);
export const spoilerOpen = computed(() => sheetOpen.value); // #61/#66: Blur folgt dem Sheet
export const miniPlayerVisible = computed(() => trackLoaded() && !sheetOpen() && scannerActive());
export const shareDialogOpen = signal(false);
export const installPrompt = signal<BeforeInstallPromptEvent | null>(null);
export const online = signal(navigator.onLine);
```

### 5.3 Komponenten

`app.tsx` rendert je nach `view()` die `LoginView` oder `ScanView`, dazu global
`LoadingView` (anfangs sichtbar, #8), `PlayerSheet`, `MiniPlayer`, `ShareDialog`
und die Statuszeile. Komponenten sind dünn: Sie lesen Signals, rufen Store-Aktionen
auf, enthalten keine Business-Logik. Event-Handler aus dem alten `app.js`
(`pageshow`-Reset, `beforeinstallprompt`, `online/offline`, Esc für Share-Dialog)
wandern in `main.tsx` bzw. in die Stores.

## 6. Tests, Lint & Format (Vitest + Biome)

- **Setup:** `vitest.config.ts` mit `environment: "happy-dom"`,
  `setupFiles: ["src/test/setup.ts"]` (`@testing-library/jest-dom/vitest`, Cleanup
  nach jedem Test). Explizite Imports statt `globals: true` (bessere TS-Typen).
- **`lib/` (Unit, ohne Mocks nötig — Deps sind Parameter):**
  - `pkce.test.ts`: RFC-7636-Testvektor (verifier → challenge
    `E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM`), `randomString`-Länge/Alphabet.
  - `track-id.test.ts`: `open.spotify.com/track/<id>` (mit/ohne Query),
    `spotify:track:<id>`, `/play/<id>`, ungültige Eingaben.
  - `scan-guard.test.ts`: Dubletten-Cooldown (gleiche ID innerhalb 5 s ignoriert,
    danach akzeptiert), ungültige Scans nur einmal pro Zeitfenster.
  - `errors.test.ts`: Mapping 401/403(+`PREMIUM_REQUIRED`)/404/412/sonstige → UI-Texte.
  - `tokens.test.ts` / `redirect.test.ts`: `requestToken` (Body, Storage-Writes,
    400 → Refresh-Token verwerfen), `handleRedirect` (state-Mismatch → CSRF-Fehler,
    `access_denied` → Meldung, Erfolg → Token-Tausch + `history.replaceState`,
    `forceConsent`-Flag-Logik). Deps: InMemory-Storage, gemocktes `fetch`,
    `crypto.subtle` (in Node 22 global vorhanden).
  - `config.test.ts`: `redirectUriForHost("127.0.0.1")` → lokaler Callback,
    sonst Pages-URL.
- **`state/` (Unit mit gemockten Adaptern):** `vi.mock("../adapters/spotify-sdk")`
  usw. — Player-Queue (Scan vor `ready` wird nachgereicht), 401-Retry genau einmal,
  403 `PREMIUM_REQUIRED` → `logout()` + Premium-Meldung, sonstiges 403 → Re-Consent
  genau einmal pro Seitenladung, `account_error` → Logout, `autoplay_failed` →
  State nachziehen. Scanner-Store: Start/Stop, Doppel-Start verhindert, Torch.
- **`components/` (Component-Tests mit `@testing-library/preact`):**
  LoginView rendert Button + Badge; Klick ruft `login()`; Fehlerbereich zeigt
  `authError`; ScanView blendet Start-Button aus, solange `scannerActive`;
  MiniPlayer-Sichtbarkeit folgt `miniPlayerVisible`; ShareDialog zeigt App-URL.
  Stores dafür in Tests auf frische Signals zurücksetzen (Factory statt Singleton
  oder expliziter `resetForTests()`-Export).
- **CI:** `npm run ci` (Biome, §6.1), `npm test` (vitest run), `npm run typecheck`
  (`tsc --noEmit`) im `rework-ci.yml`.

### 6.1 Statische Code-Analyse & Formatting: Biome

Biome ersetzt ESLint **und** Prettier mit einem Tool — ein Binary, ein
Config-File, schnell genug für jeden CI-Lauf:

- **`biome.json`** (in `rework/`):
  - Formatter: 4 Spaces, `lineWidth: 90`, doppelte Quotes, Semikolons,
    Trailing Commas — exakt der bisherige Stil in `app.js`, damit der Diff beim
    Migrieren klein bleibt.
  - Linter: `rules.recommended` (enthält u. a. a11y-Regeln wie `useAltText` —
    passend zur PWA mit ihren Icon-Buttons und aria-labels).
  - Assist: `source.organizeImports: "on"` (Import-Sortierung bei `check --write`).
  - `vcs.useIgnoreFile: true` — `node_modules/` und `dist/` werden über die
    `.gitignore` automatisch ausgeschlossen.
  - `files.includes`: `src/**` (TS, TSX, CSS-Module, Tests), `vite.config.ts`,
    `vitest.config.ts`, `package.json`. `index.html` und `manifest.webmanifest`
    bleiben außen vor. Biome 2 formatiert auch CSS — `style.css` wird beim
    Migrieren einmalig mit `biome format --write` durchlaufen.
- **Scripts in `package.json`:**

  | Script | Befehl | Zweck |
  |---|---|---|
  | `npm run check` | `biome check .` | Lint + Format + Imports, read-only |
  | `npm run check:fix` | `biome check --write .` | Auto-Fix lokal |
  | `npm run ci` | `biome ci .` | CI-Modus: Exit ≠ 0 bei Befunden, keine Writes |
  | `npm run typecheck` | `tsc --noEmit` | Typecheck bleibt bei tsc |
  | `npm test` | `vitest run` | Tests (unverändert) |

- **Regeln:** Start mit `recommended`; projekt-spezifische Ausnahmen (z. B.
  `noExplicitAny` in den Adapter-Typen fürs SDK) als `overrides` in `biome.json`,
  sobald sie konkret auftreten — nicht vorzeitig konfigurieren.
- **CI:** `rework-ci.yml` führt `npm run ci` als eigenen Schritt vor `typecheck`/`test`
  aus. Zusätzlich lokal: Pre-Commit-Hooks via Husky (§6.2) — der CI bleibt die
  Quelle der Wahrheit.

### 6.2 Pre-Commit-Hooks: Husky + lint-staged (Repo-Root, gescoped auf `rework/`)

Damit schon vor dem Commit klar ist, ob Biome/tsc/tests grün sind. Husky v9
installiert die Hooks zwar in `.git/hooks` des Repo-Roots (technisch unvermeidbar),
aber die Hooks selbst rufen **ausschließlich** `rework/`-Skripte auf — `web/` wird
nicht angefasst:

- **Dev-Deps:** `husky` (v9) und `lint-staged` in `rework/package.json`;
  `"prepare": "husky"` in `rework/package.json` — läuft automatisch bei
  `npm install` **in `rework/`**. Husky v9 ohne `.git` (z. B. Docker) exitet sauber
  mit 0; im CI zusätzlich `HUSKY=0` (§4).
- **Phase 0:** `cd rework && npx husky init` — Husky v9 erkennt den `.husky`-Ordner
  und setzt `core.hooksPath` entsprechend; `.husky/_` landet in der Root-`.gitignore`
  (generierte Husky-Dateien werden nicht committed).
- **`.husky/pre-commit`:**

  ```sh
  #!/usr/bin/env sh
  . "$(dirname -- "$0")/_/husky.sh"
  npm --prefix rework exec lint-staged   # Biome check --write auf staged rework-Files
  npm --prefix rework run typecheck      # tsc --noEmit — Projekt ist klein, < 5 s
  ```

- **`.husky/pre-push`:** `npm --prefix rework test` (vitest run).
- **`lint-staged`-Config** (in `rework/package.json`) — Glob auf `rework/**`, damit
  nie eine Datei der alten App durchläuft:

  ```json
  "lint-staged": {
    "rework/**/*.{ts,tsx,css,json}": "biome check --write --no-errors-on-unmatched --config-path=rework"
  }
  ```

  Biome fixt Format/Imports automatisch und lässt den Commit bei nicht
  auto-fixbaren Lint-Fehlern scheitern. Weil Biome die `.gitignore` respektiert,
  laufen `node_modules/` und `dist/` nie durch.
- **Ablauf:** `git commit` → Biome fixt die staged `rework/`-Files (legt Fixes neu
  ab) → `tsc` → Commit. Schlägt ein Schritt fehl, bricht der Commit ab; nach dem
  Fix einfach erneut `git commit`.

## 7. PWA, Service Worker, Sicherheit

- **`public/manifest.webmanifest` + Icons** bleiben unverändert; `index.html`
  referenziert sie relativ (`./manifest.webmanifest`).
- **`src/sw.ts` (injectManifest):** Precache aller Build-Assets (Hashes automatisch
  im `self.__WB_MANIFEST`), `skipWaiting` + `clients.claim()` in `activate`,
  `cleanupOutdatedCaches()`. Fetch-Verhalten 1:1 aus dem alten `sw.js`: Navigationen
  **network-first** und niemals in den Cache nachgezogen (`?code=…` darf nicht
  gecacht werden), sonstige same-origin GETs **cache-first** nur gegen den Precache,
  alles Cross-Origin (Spotify-API, SDK) vorbei. `CACHE_VERSION` entfällt.
- **Registrierung** in `main.ts` (CSP-konform, kein Inline-Script):
  `navigator.serviceWorker.register(import.meta.env.BASE_URL + "sw.js")`.
- **CSP-Meta-Tag** bleibt in `rework/index.html` genau wie heute in `web/index.html`
  (`script-src 'self' https://sdk.scdn.co` etc.). Vite-Build erzeugt externe
  JS/CSS-Dateien; `build.assetsInlineLimit: 0` stellt sicher, dass keine
  data-URL-Assets entstehen. Das SDK wird im Adapter per
  `document.createElement("script")` geladen.
- **Base-Pfad:** `base: "./"` in `vite.config.ts` — alle Asset-URLs, der SW-Pfad
  und `start_url` bleiben relativ (Spec §11).

## 8. CSS-Strategie

- `src/styles/global.css`: Design-Tokens (`:root`), `body`/`main`/`header`,
  App-Shell-Lock (#90), Buttons, Animationen, `prefers-reduced-motion`,
  `:has()`-Regeln (z. B. Header-Wortmarke nur auf Login) — alles, was strukturweit
  gilt.
- Komponenten-Styles als `*.module.css` neben den Komponenten (Vite CSS Modules;
  Typen kommen über `vite/client`). Selektoren aus dem heutigen `style.css`
  (1302 Zeilen) werden Phase für Phase in die Module aufgeteilt, inklusive der
  Issue-Kommentare (#13, #37, #47 …), damit die Design-Historie erhalten bleibt.

## 9. Migrationsphasen

Arbeit auf Branch `pwa-rebuild`. **Phasen 0–6** landen per Merge in `main` —
dann liegt `rework/` in main, `web/` bleibt unverändert live (Pages deployt weiter
`web/`). **Phase 7 (Cutover)** wird erst nach ausdrücklicher Freigabe durch Andreas
ausgeführt.

| Phase | Inhalt | Done-Kriterium |
|---|---|---|
| **0 — Setup** | `rework/package.json` (inkl. `@biomejs/biome`, `husky`, `lint-staged`, `"prepare": "husky"`, lint-staged-Config), `rework/.nvmrc`, `tsconfig.json`, `vite.config.ts`, `vitest.config.ts`, `biome.json`, Root-`.husky/pre-commit` + `.husky/pre-push` (`cd rework && npx husky init`), Root-`.gitignore` (additiv: `node_modules/`, `.husky/_`), leere `rework/src/`-Struktur, `rework/scripts/check-secrets.mjs` + `"check:secrets"`-Script, `.github/workflows/rework-ci.yml` (läuft grün auf leerem Projekt) — **`app/` und `web/` werden in Phase 0 nicht angefasst** | `cd rework && npm ci && npm run ci && npm run typecheck && npm test && npm run build` lokal grün; rework-CI grün inkl. `check:secrets`; `uv run pytest` unverändert grün; Hook-Test: unformatierte Datei in `rework/` stagen → `git commit` fixt bzw. bricht sauber ab |
| **1 — lib + Tests** | `rework/src/lib/*` (pkce, track-id, scan-guard, errors, tokens, redirect, storage, config) + alle Unit-Tests | 100 % der lib-Tests grün; `tsc --noEmit` sauber |
| **2 — adapters + stores** | `rework/src/adapters/*`, `rework/src/state/*` + Store-Tests mit gemockten Adaptern | Store-Tests grün (Player-Queue, Fehler-Mapping, Scanner-Guard, Auth-Flow) |
| **3 — Komponenten + Views** | `rework/src/components/*`, `app.tsx`, `main.tsx`, `index.html`, CSS-Migration (`global.css` + Module), Parity-Checkliste §10 abarbeiten | `npm run build` produziert `rework/dist/`; App rendert alle Zustände; Parity-Checkliste vollständig |
| **4 — PWA** | `rework/public/` (Manifest, Icons), `rework/src/sw.ts` (injectManifest), SW-Registrierung, CSP-Verifizierung im gebauten `dist/index.html` | SW precachet Build-Assets; Flugmodus-Test: Shell lädt offline; `?code=`-Navigation landet nie im Cache |
| **5 — Doku + rework-CI finalisieren** | `rework/README.md`, `AGENTS.md` Commands (`cd rework && npm …`), diese Datei Status; `rework-ci.yml` auf finalen Stand | rework-CI grün; Doku aktuell |
| **6 — Smoke lokal (rework)** | Manueller Smoke-Test Spec §10.1–6 gegen `vite preview --port 8080` (TLS via mkcert, §4) bzw. `npm run dev` — **ohne Pages**, `web/` bleibt live | Spec §10.1–6 bestanden |
| **7 — Cutover (nur nach ausdrücklicher Freigabe durch Andreas!)** | `pages.yml` umbauen (`setup-node` → `HUSKY=0 npm ci` in `rework` → build → `path: ./rework/dist`), `web/` löschen, `web/README.md` durch Verweis ersetzen, Pages-Smoke Spec §10.7–8 inkl. iOS-Safari. Python nur nach Variante A (§4): eine Zeile `WEB_DIR` in `config.py` + `test_serve.py`-Fixture — oder Variante B: gar keine Python-Änderung, `serve` streichen | Spec §10 vollständig bestanden auf Pages; Pages deployt `rework/dist`; `web/` entfernt; `uv run pytest` grün |

## 10. Parity-Checkliste (aus `web/README.md` „Umsetzungsstand" + Spec)

- [ ] Login: Spotify-Branding-Button, Wortmarke + EQ-Deko, Premium-Badge
- [ ] Weiterleitungszustand + Doppeltipp-Schutz + `pageshow`-Reset (#58), Fehlerbereich mit „Erneut versuchen", gezielte Meldungen (access_denied, state, Premium)
- [ ] Ladezustand ab First Paint (#8)
- [ ] Kontinuierlicher Scanner, Dubletten-Guard 5 s (#6), Vibrations-Feedback (#4)
- [ ] Torch-Button nur bei erkanntem Support (#3), Stopp-Overlay (#45), „Scannen" in der Daumenzone (#62)
- [ ] Track-Queue bei Scan vor SDK-ready (#9), 10-s-Timeout-Meldung
- [ ] Offline-Hinweise (#17), `autoplay_failed`-Handling (iOS)
- [ ] Mini-Player (#7) mit Spoiler-Sync, Bottom-Sheet (#37) mit Cover-Transition (#13), Spoiler folgt Sheet (#61/#66)
- [ ] Abmelden-Icon (#38) nur in Scan-Ansicht; Logout löscht beide Tokens + `forceConsent`-Flag
- [ ] Install-Ghost-Buttons via `beforeinstallprompt` (#18), Share-QR-Dialog (#94) mit Esc/Backdrop
- [ ] Service Worker: Shell offline, Navigationen network-first (#17), App-Shell-Lock (#90), Safe-Areas, reduced-motion
- [ ] CSP-Meta + Referrer-Policy + OG/Twitter-Tags + Apple-PWA-Metas unverändert
- [ ] Smoke-Test Spec §10.1–6 lokal gegen die rework-App (Phase 6) und §10.7–8 auf Pages nach dem Cutover (Phase 7)

## 11. Mapping alt → neu

| Alt (`web/`) | Neu (`rework/src/`) |
|---|---|
| `config.js` | `lib/config.ts` (`redirectUriForHost(hostname)` als pure Funktion) |
| `app.js` Auth-Teil (PKCE, Tokens, Redirect, Logout) | `lib/pkce.ts`, `lib/tokens.ts`, `lib/redirect.ts`, `state/auth.ts` |
| `app.js` Player-Teil (SDK, Queue, Fehler-Mapping) | `adapters/spotify-sdk.ts`, `state/player.ts`, `lib/errors.ts` |
| `app.js` Scan-Teil (html5-qrcode, Torch, Guard, Vibration) | `adapters/qr-scanner.ts`, `state/scanner.ts`, `lib/scan-guard.ts`, `lib/track-id.ts` |
| `app.js` Sheet/Mini-Player/Share/Install/Status | `state/ui.ts`, `components/PlayerSheet.tsx`, `MiniPlayer.tsx`, `ShareDialog.tsx`, `adapters/share-qr.ts` |
| `index.html` Sektionen | `components/LoginView.tsx`, `ScanView.tsx`, `LoadingView.tsx`, `icons.tsx` |
| `style.css` | `styles/global.css` + `*.module.css` |
| `sw.js` (manuell, CACHE_VERSION) | `src/sw.ts` (injectManifest, Hash-Precache) |
| `vendor/html5-qrcode.min.js`, `vendor/qrcode-generator.js` | npm-Dependencies, gebündelt |
| `manifest.webmanifest`, `icon.png`, `icons/` | `public/` (unverändert) |

## 12. Risiken und Mitigationen

| Risiko | Mitigation |
|---|---|
| CSP-Verletzung durch Vite-Build (Inline-Scripts/data-URLs) | `assetsInlineLimit: 0`; CSP-Meta im Entry; SW-Registrierung ohne Inline-Snippet; manueller Smoke-Test im Flugmodus |
| `base: './'` + Service-Worker-Scope auf Pages (`/zeitklang/`) | SW-Pfad relativ registrieren; Precache relativ; Pages-Deploy testet §10.7 |
| `injectManifest` + TS (DOM vs. WebWorker-Typen in `sw.ts`) | Bewährtes Muster: Modul-Scope `declare let self: ServiceWorkerGlobalScope`; `tsc --noEmit` in CI fängt Regressionen |
| Node-Version driftet zwischen lokal und CI auseinander | `.nvmrc` ist die einzige Quelle (`setup-node` mit `node-version-file`); bei neuem LTS nur diese Datei bumpen — ab Node 27 erscheint jährlich eine neue LTS-Major |
| html5-qrcode im Test/Build | Adapter kapselt dynamisches `import()`; in Tests `vi.mock` des Adapters; eigener Lazy-Chunk hält den Initial-Bundle klein |
| OAuth-Dev-Loop in der Parallelphase (Redirect-URI zeigt bis Cutover auf die alte App) | rework-App lokal auf Port 8080 via `vite preview` mit mkcert-TLS (`preview.https`), `npm run dev` (5173) nur ohne Login (§4); nach Phase 7 übernimmt `zeitklang serve` |
| Zwei Apps parallel: Pages und `zeitklang serve` liefern bis Cutover die alte App | `pages.yml` und `serve.py` bleiben bis Phase 7 unverändert; Cutover erst nach ausdrücklicher Freigabe; rework-CI läuft unabhängig auf `rework/**` |
| Husky-Hooks im Repo-Root könnten versehentlich `web/` anfassen | lint-staged-Glob scoped auf `rework/**/*`; pre-commit/pre-push rufen nur `npm --prefix rework …` auf (§6.2) |
| `crypto.subtle` in Tests | Node ≥ 20 stellt `crypto` global bereit; happy-dom-Umgebung übernimmt das |
| Client Secret landet versehentlich in `rework/` (src oder Build-Output) | Secret-Scan läuft Python-frei in `rework-ci.yml` (`npm run check:secrets` scannt `rework/src` + `rework/dist`, exkl. `node_modules/`); lokal liest das Script `../.env`, im CI das Actions-Secret |
| Verhaltensverlust beim Umzug (die Issue-Kommentare dokumentieren viele Detailentscheidungen) | Parity-Checkliste §10; Issue-Kommentare werden mit in die neuen Dateien übernommen; manueller Smoke-Test vor Merge |

## 13. Offene Punkte (bei Umsetzung zu klären)

1. Biome-Config: 4 Spaces, doppelte Quotes, `lineWidth: 90` — exakt der bisherige
   Stil in `app.js` (§6.1), damit der Diff beim Migrieren klein bleibt.
2. Ob `@preact/signals` oder Preact-eigene `useState` in Komponenten: Store-Signals global, Komponenten lesen Signals direkt (kein Prop-Drilling).
3. `qrcode-generator` hat offizielle Typen (`@types/qrcode-generator`); html5-qrcode bringt eigene Typen mit.
4. Ordnername `rework/` ist bestätigt; Husky-Hooks liegen zwingend im Repo-Root
   (git-Hooks), sind aber per lint-staged-Glob und `npm --prefix rework` auf die
   neue App beschränkt (§6.2).
5. Cutover-Variante für `zeitklang serve`: A (eine Zeile `WEB_DIR` in `config.py`,
   `serve` bleibt) oder B (gar keine Python-Änderung, `serve` streichen, lokal
   `vite preview`) — Entscheidung bei Phase 7 (§4).
