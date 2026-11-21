# Zeitklang — Scanner-Player

Dieses Repo enthält den Code für „Zeitklang", einen Scanner-Player mit QR-Karten.

Die Grundidee: QR-Codes auf physischen Kärtchen mit einer mobilen Scanner-App scannen; jeder QR-Code ist mit einem Musikstück (Spotify) verknüpft, das direkt auf dem Handy abspielt. Titel und Interpret bleiben in der App hinter einem Spoiler verborgen, bis sie bewusst enthüllt werden. Eine Quiz-Funktion oder andere Spiele-Elemente sind vorerst nicht geplant.

## Projektstruktur

```
app/zeitklang/     # Python-Package (CLI, Spotify-Client, Karten-Generator, Auth-Webapp)
├── cli.py             #   `zeitklang` Kommando mit Subcommands
├── auth/              #   Spotify-Auth-Webapp (`zeitklang web`, Port 8080)
data/                  # Song-Sammlungen als JSON (data/songs.json)
web/                   # statische Assets der PWA (Login + QR-Scan + Wiedergabe per Web Playback SDK), siehe web/README.md
docs/                  # Detail-Dokumentation (Workflow, Spotify-Client, Web-Variante)
output/                # generierte Artefakte (gitignored, z. B. Karten-PDF)
app/tests/             # pytest-Tests
```

## Quickstart

```bash
uv sync                              # Dependencies installieren
uv run zeitklang web                   # Spotify-Login im Browser: http://127.0.0.1:8080
uv run zeitklang fetch-discogs         # Metalcore-Songs von Discogs + Spotify → data/songs.json
uv run zeitklang fetch-playlist "<playlist-url>"   # beliebige Playlist → data/songs.json
uv run zeitklang fetch-discogs-search data/songs-90s.json --name "90er Radio Hits" --playlist-only
                                       # Radio-Hits 1990–1999 (Discogs-Compilations) → eigene JSON (ohne Spotify; URLs später via enrich-spotify)
uv run zeitklang cards                 # QR-Karten-PDF → output/zeitklang-karten.pdf
uv run zeitklang cards data/songs-90s.json output/90s-karten.pdf   # eigene Reihe → eigenes PDF
uv run zeitklang serve                 # QR-Scanner-Web-App im LAN starten (URL + QR-Code im Terminal)
uv run pytest                        # Tests
uv run ruff check && uv run ruff format   # Lint & Format
```

## Die Kärtchen

Die Kärtchen werden als PDF generiert (`zeitklang cards`), das ausgedruckt und ausgeschnitten werden kann. Jedes Kärtchen enthält auf der einen Seite einen QR-Code (verlinkt auf den Spotify-Song) und auf der anderen Seite Veröffentlichungsjahr, Künstler und Titel. Druck: doppelseitig, „an langer Kante wenden".

### Weitere Karten-Reihen

Jede Reihe lebt in einer eigenen Song-JSON unter `data/` und bekommt ein eigenes PDF unter `output/` — bestehende Reihen (z. B. `data/songs.json` → `output/zeitklang-karten.pdf`) bleiben unberührt:

```bash
# Schritt 1 — Discogs abfragen und Playlist-JSON erstellen (ohne Spotify):
# pro Jahr werden die meistgewollten Chart-Compilations gesucht (Bravo Hits, Now! …),
# deren Tracklists (Chart-Reihenfolge) landen als Song-Liste in der JSON
uv run zeitklang fetch-discogs-search data/songs-90s.json \
    --year-start 1990 --year-end 1999 --per-year 12 --name "90er Radio Hits" --playlist-only

# Schritt 2 — Spotify-URLs für die QR-Karten nachpflegen (eigenständiger Schritt,
# bei Rate-Limit einfach erneut starten, bereits angereicherte Songs werden übersprungen)
uv run zeitklang enrich-spotify data/songs-90s.json

# Schritt 3 — Karten-PDF für genau diese Reihe generieren
uv run zeitklang cards data/songs-90s.json output/90s-karten.pdf
```

## Die Web-App (aktueller Stand: Login, Scan, Wiedergabe)

Gestartet mit `uv run zeitklang serve`: Der Server liefert die Web-App aus `web/` im lokalen Netz (Port 8080) und druckt die LAN-URL als QR-Code ins Terminal. Ablauf:

1. Am Mac `https://127.0.0.1:8080` öffnen → „Mit Spotify anmelden" → Spotify-Consent → zurück auf der Seite, angemeldet.
2. „Scan starten" tippen → Kamera-Freigabe erteilen.
3. QR-Code einer gedruckten Karte scannen → der Song spielt direkt im Browser.

Die Wiedergabe läuft per **Web Playback SDK**: Der Browser wird zum Spotify-Connect-Gerät, gestartet wird der Track über die Web API. **Spotify Premium erforderlich** — ohne Premium erscheint eine entsprechende Meldung. Auf iOS startet die Wiedergabe evtl. pausiert → einmal auf ▶ tippen.

Der Login läuft als Authorization-Code-Flow mit PKCE direkt im Browser (kein Client Secret in der Web-App, siehe `docs/pwa-spezifikation.md` §3). **Einmalig im Spotify-Dashboard** die Redirect-URI `https://127.0.0.1:8080/callback` registrieren. Access-Token in sessionStorage, Refresh-Token in localStorage → Reload bleibt angemeldet, „Abmelden" räumt beide Speicher.

**Handy:** Der Login läuft über GitHub Pages — **https://andreaswillems.github.io/zeitklang/** —, weil Spotify keine LAN-IPs als Redirect-URI erlaubt (`docs/pwa-spezifikation.md` §11). Dafür einmalig die Pages-URL im Spotify-Dashboard als Redirect-URI registrieren.

**Wichtig:** Browser geben die Kamera nur in einem sicheren Kontext frei (HTTPS oder localhost). Deshalb liefert `zeitklang serve` automatisch HTTPS über [mkcert](https://github.com/FiloSottile/mkcert) aus, sofern installiert (`brew install mkcert && mkcert -install`); ohne mkcert läuft nur HTTP mit Warnung. Am Mac dann via `https://localhost:8080` vortesten.

**Einmalig pro iPhone:** die mkcert-CA installieren — Pfad steht beim Start von `zeitklang serve` im Terminal (`…/rootCA.pem`). Datei per AirDrop aufs iPhone senden → Profil installieren → *Einstellungen → Allgemein → Info → Zertifikatsvertrauenseinstellungen* → volle Vertrauensstellung für die mkcert-CA aktivieren. Danach Kamera-Freigabe wie gewohnt.

Beim ersten Start fragt die macOS-Firewall nach eingehenden Verbindungen → erlauben. Nicht gleichzeitig mit `zeitklang web` betreiben (beide Port 8080).

## Dokumentation

- `docs/workflow.md` — kompletter Workflow von der Song-Sammlung bis zum QR-Code-PDF
- `docs/spotify-client.md` — Spotify-Client: Bedienung, Auth-Modi, SDK-Bug-Workarounds
- `docs/durchstich.md` — Durchstich: QR-Scan im LAN (aktueller Umsetzungsschritt)
- `docs/pwa-spezifikation.md` — Spezifikation der PWA: Spotify-Login, QR-Scan, Wiedergabe
- `docs/web-variante.md` — historische Konzeptstudie für eine digitale Web-Variante
- `docs/icons.md` — App-Icons: Dateien + Umfärben per Hue-Shift
- `AGENTS.md` — Repo-Übersicht und Befehle für KI-Agenten
