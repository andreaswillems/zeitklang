# AGENTS.md

> 📖 **Workflow-Dokumentation:** Siehe [`docs/workflow.md`](docs/workflow.md) für den kompletten Prozess von Song-Sammlung bis QR-Code-PDF. Weitere Doku: [`docs/spotify-client.md`](docs/spotify-client.md), [`docs/web-variante.md`](docs/web-variante.md), [`docs/pwa-spezifikation.md`](docs/pwa-spezifikation.md) (PWA: Spotify-Login + QR-Scan + Web Playback SDK in `web/`), [`docs/durchstich.md`](docs/durchstich.md) (QR-Scan im LAN), [`docs/icons.md`](docs/icons.md) (App-Icons: Dateien + Umfärben per Hue-Shift).

## Repo state

- Python project using **uv** as the package manager. Virtual env exists at `.venv/`.
- Package `zeitklang` in `app/zeitklang/` (eigener Top-Level-Ordner `app/`, Gegenstück zur PWA in `web/`), CLI-Einstieg: `zeitklang` (siehe `[project.scripts]` in `pyproject.toml`).
  - `config.py` — central paths (`PROJECT_ROOT`, `TOKEN_CACHE_PATH`, `DEFAULT_SONGS_FILE`, …) and `.env` credential loading.
  - `spotify_client.py` — Spotify client for fetching playlist data.
  - `spotify_auth.py` — shared OAuth token cache (`load_token`/`save_token`/`get_valid_token`/…), genutzt von Web-App, Discogs-Fetcher und SDK-Client.
  - `songs.py` — load/save song collections as JSON (`data/songs.json`).
  - `cards.py` — printable QR-code PDF generator (`zeitklang cards`).
  - `discogs.py` — Metalcore songs from Discogs + Spotify (`zeitklang fetch-discogs`).
  - `fetch_discogs_search.py` — radio hits of a year range via Discogs search (chart compilations ranked by community want); `--playlist-only` writes the playlist JSON with Discogs data only (`zeitklang fetch-discogs-search <output.json>`; output file is mandatory so existing collections are never overwritten). Weitere Optionen: `--compilations-per-year`, `--series`, `--genre`, `--add "Künstler - Titel"` (Icon-Track), `--spotify-delay`.
  - `enrich_spotify.py` — adds Spotify URLs/IDs to a song JSON (`zeitklang enrich-spotify <songs.json>`), the step after `fetch-discogs-search --playlist-only`.
  - `fetch_playlist.py` — save a Spotify playlist as JSON (`zeitklang fetch-playlist`).
  - `serve.py` — static file server for the PWA in `web/` with optional TLS via mkcert (`zeitklang serve`, 0.0.0.0:8080).
  - `auth/app.py` — Flask web app for the Spotify auth flow (`zeitklang web`).
- `data/songs.json` — song collection committed to the repo (Metalcore).
- `data/songs-90s.json` — example of a separate series ("90er Radio Hits"); each series gets its own JSON in `data/` and its own PDF in `output/` (e.g. `output/90s-karten.pdf`).
- `output/` — generated artifacts (gitignored, e.g. `zeitklang-karten.pdf`, `90s-karten.pdf`, `metalcore-karten.pdf`).
- `web/` — static assets of the PWA (QR scanner + song playback), local via `zeitklang serve`, hosted on GitHub Pages (HTTPS), see `web/README.md` and `docs/pwa-spezifikation.md` §11.
- `.github/workflows/pages.yml` — deployed `web/` bei jedem Push auf `main` zu GitHub Pages (Settings → Pages → Source: „GitHub Actions").
- `app/tests/` — pytest tests. `README.md` (German) is the source of truth for the project idea — read it before planning.

## Project concept (from README.md)

A scanner-player app:

- Users scan QR codes on physical cards with a **mobile scanner app**; each QR code links to a song which then plays on their phone.
- Title and artist stay hidden behind a spoiler blur until deliberately revealed.
- No quiz features or other game elements are planned for now.

## Tech stack

- **Python 3.15** (see `.python-version` and `pyproject.toml`)
- **uv** for dependency management (`pyproject.toml` + `uv.lock`)
- Runtime deps: `spotify-sdk`, `flask`, `python-dotenv`, `qrcode`, `reportlab`, `pillow`, `httpx` (via sdk)
- Dev deps (dependency-group `dev`): `pytest`, `ruff`

## Commands

```bash
uv run zeitklang web                              # Web app for Spotify auth (http://127.0.0.1:8080)
uv run zeitklang fetch-playlist "<playlist-url>"  # Fetch playlist → data/songs.json
uv run zeitklang fetch-discogs                    # Discogs + Spotify → data/songs.json
uv run zeitklang fetch-discogs-search data/songs-90s.json --year-start 1990 --year-end 1999 --per-year 12 --name "90er Radio Hits" --playlist-only
                                                  # Step 1: Discogs search → playlist JSON (output path mandatory);
                                                  # extra options: --compilations-per-year, --series, --genre, --add "Künstler - Titel", --spotify-delay
uv run zeitklang enrich-spotify data/songs-90s.json   # Step 2: add Spotify URLs to the JSON (idempotent; --spotify-delay for rate limits)
uv run zeitklang cards                            # Generate QR-code PDF → output/zeitklang-karten.pdf
uv run zeitklang cards data/songs-90s.json output/90s-karten.pdf   # Cards PDF for a specific series
uv run zeitklang serve                            # Statische PWA aus web/ im LAN ausliefern (0.0.0.0:8080, TLS via mkcert falls installiert)
uv run pytest                                   # Run tests
uv run ruff check && uv run ruff format         # Lint & format
uv sync                                         # Sync dependencies from uv.lock
uv add <package>                                # Add a dependency

# PWA-Rebuild in rework/ (Parallelbetrieb — web/ bleibt bis Phase 7 live, siehe docs/pwa-rebuild.md):
cd rework && npm ci                             # frische Installation aus package-lock.json (installiert auch die Husky-Hooks)
cd rework && npm run ci && npm run typecheck && npm test && npm run build && npm run check:secrets
                                                  # komplette lokale Prüfung (Biome, tsc, Vitest, Build, Secret-Scan) — identisch zur rework-CI
cd rework && npm run dev                        # Dev-Server Port 5173 (UI-Dev ohne Login)
npx vite preview --port 8080                   # gebaute App auf dem OAuth-Port 8080 (TLS via mkcert, falls .cache/serve-127.0.0.1.pem existiert)

# Epiq (git-natives Issue-Board, siehe Abschnitt unten):
epiq                                            # Epiq-TUI im Repo starten (Board, Sync mit :sync)
epiq gui                                        # Browser-UI fürs Board
```

## Epiq — Issue-Tracking ([epiq.sh](https://epiq.sh), github.com/ljtn/epiq)

- Git-nativer, local-first Issue-Tracker: State lebt als append-only Event-Log auf der dedizierten Branch `__epiq_state__` (auf origin gepusht, Worktree unter `~/.epiq-global/worktrees/<id>/`). Im Repo initialisiert via `.epiq/project.json`; `.epiq/events/` und `.epiq/log/` sind gitignored. Die State-Branch nie manuell anfassen.
- Installation: `npm install --global epiq` (liefert `epiq` und `epiq-mcp`). Rechner-Konfig in `~/.epiq-global/config.json`.
- Nutzung: `epiq` (TUI), `epiq gui` (Browser). Agents arbeiten über den in Vibe registrierten MCP-Server `epiq` (`vibe mcp add epiq --transport stdio --command /opt/homebrew/bin/epiq-mcp`), Tools erscheinen als `mcp_epiq.epiq_*`; Sync bei MCP nie automatisch, sondern explizit `epiq_sync`. Workflow-Regeln für Agents: Skill `.vibe/skills/epiq/SKILL.md` (bei Ticket-Arbeit laden).
- Commits mit einer `Epiq-Ref: <ticket-ref>`-Zeile im Commit-Body mit Tickets verknüpfen (ref ist die 7-stellige Ticket-ID).

## Spotify Client (`zeitklang.spotify_client`)

Two auth modes:

| Mode | Use for | Playlist tracks? |
|------|---------|------------------|
| `client_credentials` | Search, track/playlist info | ❌ No |
| `authorization_code` (default) | Everything incl. playlist items | ✅ Yes |

**Getting playlist tracks** requires `authorization_code` mode. On first run, a browser opens for Spotify login. The token is cached in `.cache/spotify-token.json` (shared path from `zeitklang.config.TOKEN_CACHE_PATH`, also used by the web app).

**IMPORTANT**: The Spotify Developer Dashboard must have `http://127.0.0.1:8080/callback` (auth web app, `zeitklang web`) and `https://127.0.0.1:8080/callback` (PWA login via `zeitklang serve`, TLS via mkcert) configured as redirect URIs.

```python
from zeitklang import SpotifyPlaylistClient, extract_playlist_id

playlist_id = extract_playlist_id("https://open.spotify.com/playlist/...")

with SpotifyPlaylistClient(auth_mode="authorization_code") as client:
    songs = client.get_playlist_tracks(playlist_id)
    for song in songs:
        print(f"{song.title} - {song.artist} ({song.release_year})")
```

**SDK Bug Workaround**: `spotify-sdk` 0.10.1 has validation bugs (missing `popularity` in search results, missing `items` in playlist response). The client uses direct `httpx` calls for `search_tracks()` and `get_playlist_info()` to work around this.

## Environment

- `.env` contains Spotify API credentials (`SPOTIFY_CLIENT_ID`, `SPOTIFY_CLIENT_SECRET`). **Never commit this file.**
- `.cache/` contains the cached Spotify token. Gitignored.
- `output/` contains generated PDFs. Gitignored.
- `.venv/` is gitignored. Run `uv sync` after cloning to recreate it.

## Conventions

- Keep project documentation in **German** to match the README, unless the user asks otherwise.
- Code, tests and commit messages may be English; user-facing docs stay German.
- When adding tests, lint, or CI, update the Commands section above.
