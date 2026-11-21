# Zeitklang — Workflow Dokumentation

Diese Dokumentation beschreibt den kompletten Workflow von der Song-Sammlung bis zum druckfertigen QR-Code PDF.

---

## 📋 Überblick

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   Spotify   │────▶│  zeitklang  │────▶│   Token     │────▶│  Spotify    │
│   Login     │     │  web       │     │   Cache     │     │   Suche     │
└─────────────┘     └─────────────┘     └─────────────┘     └──────┬──────┘
                                                                      │
┌─────────────┐     ┌─────────────┐     ┌─────────────┐              │
│   Discogs   │────▶│  zeitklang  │────▶│  data/      │◀─────────────┘
│   API       │     │  fetch-discogs  │  │  songs.json │
└─────────────┘     └─────────────┘     │  (116 Songs)│
                                        └──────┬──────┘
                                               │
                                        ┌──────┴──────┐
                                        │  zeitklang  │
                                        │  cards      │
                                        └──────┬──────┘
                                               │
                                        ┌──────┴──────┐
                                        │ output/     │
                                        │ zeitklang-  │
                                        │ karten.pdf  │
                                        └─────────────┘
```

---

## 🛠️ Voraussetzungen

```bash
# 1. Abhängigkeiten installieren
uv sync

# 2. Spotify-Credentials einrichten
# .env Datei mit folgenden Variablen erstellen:
#   SPOTIFY_CLIENT_ID=deine_client_id
#   SPOTIFY_CLIENT_SECRET=dein_client_secret
#
# Im Spotify Developer Dashboard muss als Redirect URI eingetragen sein:
#   http://127.0.0.1:8080/callback
```

---

## 🔄 Schritt-für-Schritt Workflow

### Schritt 1: Spotify verbinden (einmalig)

```bash
uv run zeitklang web
```

- Öffne http://127.0.0.1:8080 im Browser
- Klicke auf **„Mit Spotify verbinden“**
- Melde dich bei Spotify an und erlaube den Zugriff
- Token wird in `.cache/spotify-token.json` gespeichert

> ⚠️ **Wichtig:** Seit November 2024 können neue Spotify-Apps keine Playlist-Tracks mehr abrufen (`403 Forbidden`). Deshalb nutzen wir Discogs als Datenquelle.

---

### Schritt 2: Songs sammeln (Discogs + Spotify)

```bash
uv run zeitklang fetch-discogs
```

**Was passiert:**

| Quelle | Daten |
|--------|-------|
| **Discogs API** | Album-Tracklists, exakte Release-Jahre, Künstler, Alben |
| **Spotify Suche** | Spotify-URLs (zum Abspielen), Preview-URLs |

**Ergebnis:** `data/songs.json` mit 116 Metalcore-Songs (10 Alben, 2002–2016)

**Alben in der Datenbank:**

| Jahr | Album | Band |
|------|-------|------|
| 2002 | Alive Or Just Breathing | Killswitch Engage |
| 2005 | Ascendancy | Trivium |
| 2005 | The Poison | Bullet For My Valentine |
| 2006 | The Fall Of Ideals | All That Remains |
| 2006 | Redeemer | Norma Jean |
| 2007 | An Ocean Between Us | As I Lay Dying |
| 2007 | Horizons | Parkway Drive |
| 2009 | Constellations | August Burns Red |
| 2013 | Sempiternal | Bring Me The Horizon |
| 2016 | All Our Gods Have Abandoned Us | Architects |

---

### Schritt 3: QR-Code PDF generieren

```bash
uv run zeitklang cards
```

**Ergebnis:** `output/zeitklang-karten.pdf` (12 Seiten, 116 Karten)

**Karten-Layout:**

| Seite | Inhalt |
|-------|--------|
| Ungerade Seiten (1, 3, 5, ...) | **Vorderseite:** QR-Code → Spotify-URL |
| Gerade Seiten (2, 4, 6, ...) | **Rückseite:** Jahr, Künstler, Titel |

**Druck-Einstellungen:**
- Format: A4
- Duplex (doppelseitig)
- „An langer Kante wenden“ (Long-Edge Binding)
- 20 Karten pro Seite (4 × 5 Grid)

---

### Schritt 3b: Weitere Reihe anlegen (z. B. „90er Radio Hits")

Jede Reihe bekommt eine **eigene Song-JSON** und ein **eigenes PDF** — bestehende Dateien
(`data/songs.json`, `output/zeitklang-karten.pdf`) bleiben unberührt. Die Ausgabedatei ist
beim Fetch-Befehl deshalb Pflicht-Parameter:

```bash
# Schritt 1 — Discogs-Prüfung + Playlist erstellen (nur Discogs, ohne Spotify-URLs):
uv run zeitklang fetch-discogs-search data/songs-90s.json \
    --year-start 1990 --year-end 1999 --per-year 12 --name "90er Radio Hits" --playlist-only

# Schritt 2 — Spotify-URLs nachpflegen (idempotent, bei 429 einfach erneut starten):
uv run zeitklang enrich-spotify data/songs-90s.json

# Schritt 3 — eigenes Karten-PDF für diese Reihe:
uv run zeitklang cards data/songs-90s.json output/90s-karten.pdf
```

Optional lassen sich Icon-Tracks garantieren: `--add "Nirvana - Smells Like Teen Spirit"` (Discogs-Jahr + Spotify-URL).

**Ergebnis:** `data/songs-90s.json` (max. 10 Songs × 10 Jahre) und `output/90s-karten.pdf`.
Das PDF trägt den Reihen-Namen im Titel („Zeitklang Karten — 90er Radio Hits Edition“).

---

## 📁 Dateien im Projekt

| Datei | Zweck |
|-------|-------|
| `app/zeitklang/auth/app.py` | Spotify Auth Webapp (Port 8080) — `zeitklang web` |
| `web/` | Statische Assets der geplanten PWA (QR-Scanner + Player) — siehe `web/README.md` |
| `app/zeitklang/discogs.py` | Holt Songs von Discogs + Spotify — `zeitklang fetch-discogs` |
| `app/zeitklang/fetch_discogs_search.py` | Sucht Radio-Hits eines Zeitraums über Discogs-Compilations — `zeitklang fetch-discogs-search` |
| `app/zeitklang/enrich_spotify.py` | Spotify-URLs in eine Song-JSON nachpflegen — `zeitklang enrich-spotify` |
| `app/zeitklang/cards.py` | Erstellt druckbares QR-Code PDF — `zeitklang cards [input.json] [output.pdf]` |
| `app/zeitklang/spotify_client.py` | Spotify API Client (Library) |
| `app/zeitklang/songs.py` | Song-JSON laden/speichern |
| `data/songs.json` | Song-Datenbank Metalcore (116 Songs) |
| `data/songs-90s.json` | Reihe „90er Radio Hits" (eigene JSON pro Reihe) |
| `output/zeitklang-karten.pdf` | Druckfertige Karten (gitignored, wird neu generiert) |
| `app/tests/` | pytest-Tests (`uv run pytest`) |
| `.cache/spotify-token.json` | Gespeicherter Spotify-Token |
| `.env` | Spotify API Credentials |

---

## 🎮 Spielablauf

1. **Karten mischen** und verdeckt austeilen
2. **Spieler scannt QR-Code** → Song wird auf Spotify abgespielt
3. **Spieler entscheidet:** Wann wurde der Song veröffentlicht?
4. **Karte wird in die persönliche Zeitleiste eingeordnet** (chronologisch)
5. **Richtige Platzierung?** → Karte bleibt liegen, 1 Punkt
6. **Falsche Platzierung?** → Karte wird zurückgegeben
7. **Erster Spieler mit 10 korrekten Karten gewinnt!**

---

## 🔧 Erweiterungsmöglichkeiten

- [ ] Mehr Alben zu `ALBUMS_TO_FETCH` in `app/zeitklang/discogs.py` hinzufügen
- [ ] Andere Genres unterstützen (z.B. Rock, Pop, 80s)
- [ ] Spiel-Webapp (Punkte zählen, Runden verwalten)
- [ ] Mobile Scanner-App
- [ ] Verschiedene Schwierigkeitsstufen (nur Jahr / Jahr + Künstler / Jahr + Künstler + Titel)

---

## ⚠️ Bekannte Einschränkungen

| Problem | Ursache | Lösung |
|---------|---------|--------|
| Spotify Playlist-Items `403 Forbidden` | API-Einschränkung seit Nov 2024 für neue Apps | Discogs als Datenquelle nutzen |
| Einige Re-Release-Jahre falsch | Discogs findet manchmal Re-Releases | Erwartetes Jahr in `ALBUMS_TO_FETCH` prüfen |
| 1 Song ohne Spotify-URL | Nicht auf Spotify gefunden | Manuell hinzufügen oder entfernen |
