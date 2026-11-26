# AGENTS.md

Öffentliche PWA zum privaten Backend `../zeitklang` (Repo-Split BYYXC7J, Kontext siehe dessen AGENTS.md). Scanner-Player: QR-Code scannen → Song spielt; Titel/Interakt hinter Spoiler-Blur. **Keine Quiz-Features** geplant. README.md (Deutsch) ist Source of Truth fürs Konzept.

## Stack & Setup

- **Preact + TypeScript + Vite**; Tests: Vitest + happy-dom; Lint/Format: Biome; Service Worker: vite-plugin-pwa (`injectManifest`).
- **Node 26**, gepinnt in `.tool-versions` (asdf; CI via `node-version-file`). Installation immer `npm ci` (package-lock committed) — nie `npm install`.

## Komplettes lokales Gate — vor jedem Commit/Push, identisch zur CI (`.github/workflows/rework-ci.yml`)

```bash
npm run ci            # Biome im CI-Modus (Lint + Format + Imports, fail-hard)
npm run typecheck     # tsc --noEmit
npm test              # Vitest
npm run build         # Produktionsbuild → dist/
npm run check:secrets # Secret-Scan (in CI fail-hard, wenn SPOTIFY_CLIENT_SECRET fehlt)
```

Biome-Auto-Fix: `npm run check:fix` (read-only: `npm run check`). Husky-Hooks laufen nach `npm ci`; pre-commit macht lint-staged + typecheck + test — `check:secrets` steht **nicht** in den Hooks und muss manuell laufen.

## Dev-Server & OAuth (wichtig)

- `npm run dev` → Port 5173, nur UI-Entwicklung — **Login geht dort nicht**: die OAuth-Redirect-URI ist `https://127.0.0.1:8080/callback`.
- Login lokal testen: `npm run build && npx vite preview --port 8080`. Mit mkcert-Zertifikat (`.cache/serve-127.0.0.1.pem`) liefert `vite.config.ts` automatisch HTTPS; sonst plain HTTP. Zertifikate/`.cache/` sind gitignored — **niemals committen**.
- Längere OAuth-Sessions mit Live-Build: `npm run build:watch` + `npx vite preview --port 8080`.

## Deploy

- Push auf `main` deployt `dist/` automatisch nach GitHub Pages (`.github/workflows/pages.yml`, Live: https://andreaswillems.github.io/zeitklang/).
- `main` ist protected: Fixes laufen über Feature-Branch + Pull Request auf `main`, der Merge deployt automatisch. **PRs immer per `gh`-CLI erstellen** (`gh pr create`, als `andreaswillems` authentifiziert) — der GitHub-App-Connector (MCP) hat auf diesem Repo keinen Schreibzugriff (403 "Resource not accessible by integration").
- `base: './'` in `vite.config.ts` wegen des Pages-Base-Pfads `/zeitklang/` — alle Asset-URLs relativ halten.
- GitHub-Actions sind auf Commit-SHAs gepinnt (OWASP A03) — Pinnen beim Aktualisieren beibehalten.

## PWA-Besonderheiten

- `src/sw.ts` ist der Service Worker (injectManifest); `main.tsx` registriert ihn selbst (`injectRegister: false` — kein redundantes `registerSW.js`). Manifest + Icons kommen unverändert aus `public/`.
- `assetsInlineLimit: 0` wegen CSP — keine Inline-/data-URL-Assets einbauen.
- Vitest: `globals: false` → immer explizite Imports (`describe/it/expect` aus `vitest`); Tests liegen neben den Modulen.
- Spotify-Login ist PKCE ohne Secret: die öffentliche Client-ID in `src/lib/config.ts` ist Absicht, kein Leak. Das echte Secret existiert nur als CI-Env für den Secret-Scan.

## Ticket-Arbeit

Epiq-Board lebt im privaten Repo `../zeitklang`; Commits hier können nicht per `Epiq-Ref` verlinkt werden → Commit-Hash manuell im Ticket kommentieren.
