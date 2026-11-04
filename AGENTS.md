# AGENTS.md

> 📖 **Workflow-Dokumentation:** Siehe [`docs/workflow.md`](docs/workflow.md) für den kompletten Prozess von Song-Sammlung bis QR-Code-PDF. Weitere Doku: [`docs/spotify-client.md`](docs/spotify-client.md), [`docs/web-variante.md`](docs/web-variante.md), [`docs/pwa-spezifikation.md`](docs/pwa-spezifikation.md) (PWA: Spotify-Login + QR-Scan + Web Playback SDK in `web/`).

## Repo state

- Python project using **uv** as the package manager. Virtual env exists at `.venv/`.
- Package `zeitklang` in `app/zeitklang/` (eigener Top-Level-Ordner `app/`, Gegenstück zur PWA in `web/`), CLI-Einstieg: `zeitklang` (siehe `[project.scripts]` in `pyproject.toml`).
  - `spotify_client.py` — Spotify client for fetching playlist data.
  - `spotify_auth.py` — shared OAuth token cache (`load_token`/`save_token`/`get_valid_token`/…), genutzt von Web-App, Discogs-Fetcher und SDK-Client.
  - `songs.py` — load/save song collections as JSON (`data/songs.json`).
  - `cards.py` — printable QR-code PDF generator (`zeitklang cards`).
  - `discogs.py` — Metalcore songs from Discogs + Spotify (`zeitklang fetch-discogs`).
  - `fetch_playlist.py` — save a Spotify playlist as JSON (`zeitklang fetch-playlist`).
  - `auth/app.py` — Flask web app for the Spotify auth flow (`zeitklang web`).
- `data/songs.json` — song collection committed to the repo.
- `output/` — generated artifacts (gitignored, e.g. the cards PDF).
- `web/` — static assets of the PWA (QR scanner + song playback), local via `zeitklang serve`, hosted on GitHub Pages (HTTPS), see `web/README.md` and `docs/pwa-spezifikation.md` §11.
- `app/tests/` — pytest tests. `README.md` (German) is the source of truth for the project idea — read it before planning.

## Project concept (from README.md)

A music quiz game:

- Players scan QR codes on physical cards with a **mobile scanner app**; each QR code links to a song which then plays.
- Players must place scanned songs in correct chronological order; first to 10 correctly placed cards wins.
- Variants: guessing artist and/or song title.

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
uv run zeitklang cards                            # Generate QR-code PDF → output/zeitklang-karten.pdf
uv run zeitklang serve                            # Statische PWA aus web/ im LAN ausliefern (0.0.0.0:8080, TLS via mkcert falls installiert)
uv run pytest                                   # Run tests
uv run ruff check && uv run ruff format         # Lint & format
uv sync                                         # Sync dependencies from uv.lock
uv add <package>                                # Add a dependency
```

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
