# Spotify Client — Bedienung & Fallstricke

Dokumentation für `app/zeitklang/spotify_client.py` und `zeitklang fetch-playlist` (`app/zeitklang/fetch_playlist.py`).

---

## Schnellstart

### 1. Voraussetzungen

- Spotify Developer App mit `Client ID` und `Client Secret` (in `.env`)
- Redirect-URI `http://127.0.0.1:8080/callback` im [Spotify Dashboard](https://developer.spotify.com/dashboard) konfiguriert

### 2. Playlist als JSON speichern

```bash
uv run zeitklang fetch-playlist "https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M" data/songs.json
```

Beim **ersten Aufruf** öffnet sich ein Browser — dort bei Spotify anmelden und Zugriff gewähren. Das Token wird in `.cache/spotify-token.json` gespeichert.

### 3. Programmatisch verwenden

```python
from zeitklang import SpotifyPlaylistClient, extract_playlist_id

playlist_id = extract_playlist_id("https://open.spotify.com/playlist/...")

with SpotifyPlaylistClient(auth_mode="authorization_code") as client:
    # Playlist-Info
    info = client.get_playlist_info(playlist_id)
    print(info["name"])

    # Alle Tracks abrufen
    songs = client.get_playlist_tracks(playlist_id)
    for song in songs:
        print(f"{song.title} — {song.artist} ({song.release_year})")
```

---

## Authentifizierungs-Modi

| Modus | Funktioniert für | Playlist-Tracks? | Browser-Login nötig? |
|-------|------------------|:----------------:|:--------------------:|
| `client_credentials` | Suche, Track-Details, Playlist-Info | ❌ Nein | ❌ Nein |
| `authorization_code` (Standard) | Alles inkl. Playlist-Items | ✅ Ja | ✅ Nur beim 1. Mal |

**Wichtig**: `get_playlist_tracks()` funktioniert **nur** mit `authorization_code`!

```python
# Nur für öffentliche Daten (schnell, kein Login)
with SpotifyPlaylistClient(auth_mode="client_credentials") as client:
    songs = client.search_tracks("Shape of You Ed Sheeran")

# Für Playlist-Tracks (voller Zugriff)
with SpotifyPlaylistClient(auth_mode="authorization_code") as client:
    songs = client.get_playlist_tracks("37i9dQZF1DXcBWIGoYBM5M")
```

---

## API-Referenz

### `SpotifyPlaylistClient`

```python
SpotifyPlaylistClient(
    auth_mode="authorization_code",  # oder "client_credentials"
    token_cache_path=None,  # Standard: .cache/spotify-token.json
    redirect_uri="http://127.0.0.1:8080/callback",
    auto_authorize=True,  # Browser automatisch öffnen
)
```

| Methode | Beschreibung | Auth-Modus |
|---------|--------------|------------|
| `get_playlist_info(playlist_id)` | Playlist-Name, Owner, etc. | Beide |
| `get_playlist_tracks(playlist_id, limit=50, market=None)` | Alle Tracks mit Paginierung | Nur `authorization_code` |
| `search_tracks(query, limit=10, market=None)` | Track-Suche | Beide |
| `close()` | Ressourcen freigeben | — |

### `Song` (Dataclass)

```python
@dataclass
class Song:
    title: str  # Songtitel
    artist: str  # Künstler (bei mehreren: "A, B, C")
    release_year: int  # Veröffentlichungsjahr (aus Album)
    spotify_url: str  # https://open.spotify.com/track/...
    spotify_id: str  # Spotify-ID (z.B. "7qiZfU4dY1lWllzX7mPBI3")
    duration_ms: int  # Dauer in Millisekunden
    preview_url: str | None  # 30-Sekunden-Preview (oft None)
```

### `extract_playlist_id(url_or_id)`

Akzeptiert:
- Reine ID: `"37i9dQZF1DXcBWIGoYBM5M"`
- URL: `"https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M?si=..."`
- URI: `"spotify:playlist:37i9dQZF1DXcBWIGoYBM5M"`

---

## ⚠️ Fallstricke & Bekannte Probleme

### 1. Playlist-Items erfordern User-Authentifizierung

**Problem**: `GET /playlists/{id}/items` gibt mit Client Credentials `401 Valid user authentication required` zurück.

**Lösung**: `authorization_code` Modus verwenden:
```python
SpotifyPlaylistClient(auth_mode="authorization_code")
```

### 2. Redirect-URI muss konfiguriert sein

**Problem**: `authorize_local()` schlägt fehl mit "Invalid redirect URI".

**Lösung**: Im [Spotify Developer Dashboard](https://developer.spotify.com/dashboard):
1. App auswählen → **Edit Settings**
2. Unter **Redirect URIs** hinzufügen: `http://127.0.0.1:8080/callback`

### 3. SDK-Bug: Search funktioniert nicht

**Problem**: `client.search.search()` wirft `ValidationError: popularity Field required`.

**Ursache**: `spotify-sdk` 0.10.1 erwartet `popularity` als Pflichtfeld, aber die Spotify API liefert es nicht.

**Lösung**: Der Client verwendet direkten `httpx`-Zugriff für `search_tracks()`:
```python
# Funktioniert (direkter HTTP-Call)
songs = client.search_tracks("Bohemian Rhapsody Queen")
```

### 4. SDK-Bug: Playlist-Info wirft Fehler

**Problem**: `client.playlists.get()` wirft `ValidationError: items Field required`.

**Ursache**: Das `Playlist`-Modell erwartet ein `items`-Feld, das die API nicht liefert.

**Lösung**: Der Client verwendet direkten `httpx`-Zugriff für `get_playlist_info()`.

### 5. Token-Cache nicht im Git

**Problem**: `.cache/spotify-token.json` enthält sensible Tokens.

**Lösung**: Bereits in `.gitignore` eingetragen:
```
.cache/
.env
```

### 6. Rate Limiting (429)

**Problem**: Zu viele API-Calls führen zu `429 Too Many Requests`.

**Lösung**: Das SDK hat automatisches Retry mit exponential backoff. Bei `get_playlist_tracks()` wird automatisch paginiert (max. 50 pro Request).

### 7. Playlist-ID Extraktion

**Problem**: Ungültige URLs führen zu Fehlern.

**Lösung**: `extract_playlist_id()` unterstützt mehrere Formate und wirft `ValueError` bei ungültigen Eingaben:
```python
from zeitklang import extract_playlist_id

# Alle diese Formate funktionieren:
extract_playlist_id("37i9dQZF1DXcBWIGoYBM5M")
extract_playlist_id("https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M?si=abc")
extract_playlist_id("spotify:playlist:37i9dQZF1DXcBWIGoYBM5M")
```

### 8. Lokale Tracks in Playlists

**Problem**: Lokal hochgeladene Tracks haben keine Spotify-URL.

**Lösung**: Der Client filtert Tracks ohne `external_urls.spotify` — diese erscheinen mit leerem `spotify_url` in der Liste.

### 9. `preview_url` ist oft `None`

**Problem**: Die 30-Sekunden-Preview ist für viele Tracks nicht verfügbar.

**Lösung**: `song.preview_url` kann `None` sein — immer prüfen:
```python
if song.preview_url:
    # Preview abspielen
    pass
```

---

## Umgebungsvariablen

| Variable | Beschreibung | Quelle |
|----------|--------------|--------|
| `SPOTIFY_CLIENT_ID` | Spotify App Client ID | `.env` |
| `SPOTIFY_CLIENT_SECRET` | Spotify App Client Secret | `.env` |

**Hinweis**: Das SDK erwartet eigentlich `SPOTIFY_SDK_CLIENT_ID`/`SPOTIFY_SDK_CLIENT_SECRET`, aber der Client mappt automatisch von den `SPOTIFY_CLIENT_*` Variablen aus der `.env`.

---

## Tests ausführen

```bash
uv run pytest
```

Testet (ohne Netzwerkzugriff):
- ✅ Playlist-ID Extraktion (URL, URI, reine ID)
- ✅ Song-Serialisierung
- ✅ Song-JSON laden/speichern
- ✅ QR-Code-Generierung

Netzwerk-Tests (Track-Suche, Playlist-Info via `client_credentials`) sind nicht automatisiert — manuell via `uv run zeitklang fetch-playlist` prüfen.

---

## Nächste Schritte

- [ ] Song-Daten in JSON speichern (`zeitklang fetch-playlist`)
- [ ] QR-Code PDF generieren (aus Song-Daten)
- [ ] Scanner-App entwickeln
