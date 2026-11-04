"""Holt Metalcore-Songs von Discogs und reichert sie mit Spotify-URLs an.

Workflow:
1. Suche nach Metalcore-Alben bei Discogs
2. Holt Tracklists für jedes Album
3. Sucht jeden Song auf Spotify (für Spotify-URL)
4. Speichert alles als JSON (Standard: data/songs.json)

Verwendung:
    uv run zeitklang fetch-discogs [output.json]
"""

import time
from pathlib import Path

import httpx

from zeitklang import config, spotify_auth
from zeitklang.songs import save_songs

# ─── Konfiguration ───────────────────────────────────────────────

DISCOGS_BASE = "https://api.discogs.com"
DISCOGS_HEADERS = {"User-Agent": "Zeitklang/1.0 +https://github.com/yourusername/zeitklang"}

SPOTIFY_API_BASE = "https://api.spotify.com/v1"

# Rate-Limiting: Wartezeiten zwischen API-Calls (in Sekunden)
DISCOGS_DELAY = 2.5  # ~24 Requests/Minute (Discogs Limit: 25 unauthenticated)
SPOTIFY_DELAY = 0.2  # Spotify ist großzügiger

# Metalcore-Alben, die wir suchen wollen
# Format: {"artist": "...", "album": "...", "year": 20XX (optional)}
ALBUMS_TO_FETCH = [
    {"artist": "Killswitch Engage", "album": "Alive or Just Breathing", "year": 2002},
    {"artist": "As I Lay Dying", "album": "An Ocean Between Us", "year": 2007},
    {"artist": "Parkway Drive", "album": "Horizons", "year": 2007},
    {"artist": "August Burns Red", "album": "Constellations", "year": 2009},
    {"artist": "Bring Me The Horizon", "album": "Sempiternal", "year": 2013},
    {"artist": "Architects", "album": "All Our Gods Have Abandoned Us", "year": 2016},
    {"artist": "Trivium", "album": "Ascendancy", "year": 2005},
    {"artist": "Bullet For My Valentine", "album": "The Poison", "year": 2005},
    {"artist": "All That Remains", "album": "The Fall of Ideals", "year": 2006},
    {"artist": "Norma Jean", "album": "Redeemer", "year": 2006},
]


# ─── Hilfsfunktionen ─────────────────────────────────────────────


def load_spotify_access_token() -> str | None:
    """Lädt den Spotify Access Token aus dem gemeinsamen Token-Cache."""
    token = spotify_auth.load_token()
    if not token or not token.get("access_token"):
        print("❌ Kein Spotify-Token gefunden. Bitte zuerst mit `zeitklang web` verbinden!")
        return None
    return token["access_token"]


def search_discogs_release(
    artist: str, album: str, expected_year: int | None = None
) -> dict | None:
    """Sucht ein Album bei Discogs und gibt das beste Ergebnis zurück.

    Bevorzugt das älteste Release (Original-Veröffentlichung), um
    Re-Release-Jahre zu vermeiden.
    """
    query = f"{artist} {album}"
    params = {
        "q": query,
        "type": "release",
        "per_page": 10,
    }

    try:
        response = httpx.get(
            f"{DISCOGS_BASE}/database/search",
            headers=DISCOGS_HEADERS,
            params=params,
            timeout=30,
        )
        response.raise_for_status()
        data = response.json()
        results = data.get("results", [])

        if not results:
            return None

        # Kandidaten sammeln (gleicher Künstler + ähnlicher Titel)
        candidates = []
        for result in results:
            title = result.get("title", "")
            # Discogs formatiert als "Künstler - Album"
            if " - " in title:
                discogs_artist, discogs_album = title.split(" - ", 1)
                # Ähnlichkeitsprüfung
                if (
                    artist.lower() in discogs_artist.lower()
                    or discogs_artist.lower() in artist.lower()
                ):
                    candidates.append(result)

        if not candidates:
            # Fallback: erstes Ergebnis
            candidates = results[:3]

        # Jahr als int konvertieren (Discogs liefert manchmal Strings)
        def get_year(result: dict) -> int:
            year = result.get("year", 0)
            try:
                return int(year) if year else 0
            except ValueError, TypeError:
                return 0

        # Wenn erwartetes Jahr gegeben: bestes Match finden
        if expected_year:
            # Erst nach exaktem Jahr suchen
            for c in candidates:
                if get_year(c) == expected_year:
                    return c
            # Dann nach nächstem Jahr (±2 Jahre)
            best = min(candidates, key=lambda c: abs((get_year(c) or 9999) - expected_year))
            if abs((get_year(best) or 9999) - expected_year) <= 2:
                return best

        # Fallback: ältestes Release wählen (Original-Veröffentlichung)
        return min(candidates, key=lambda c: get_year(c) or 9999)

    except httpx.HTTPError as e:
        print(f"   ❌ Discogs-Suche fehlgeschlagen: {e}")
        return None


def get_discogs_tracklist(release_id: int) -> list[dict]:
    """Holt die Tracklist eines Discogs-Releases."""
    try:
        response = httpx.get(
            f"{DISCOGS_BASE}/releases/{release_id}",
            headers=DISCOGS_HEADERS,
            timeout=30,
        )
        response.raise_for_status()
        data = response.json()

        artist = "Unknown"
        artists = data.get("artists", [])
        if artists:
            artist = artists[0].get("name", "Unknown")

        # Jahr als int konvertieren (Discogs liefert manchmal Strings)
        year_raw = data.get("year", 0)
        try:
            year = int(year_raw) if year_raw else 0
        except ValueError, TypeError:
            year = 0

        album_title = data.get("title", "Unknown Album")

        tracklist = []
        for track in data.get("tracklist", []):
            # Nur echte Tracks (keine Intros, Interludes mit <1 Min, etc.)
            duration = track.get("duration", "")
            title = track.get("title", "")

            # Überspringe sehr kurze Tracks (Intros, Interludes)
            if duration:
                try:
                    minutes = int(duration.split(":")[0])
                    if minutes < 1 and len(tracklist) > 0:
                        continue  # Intro/Interlude überspringen
                except ValueError, IndexError:
                    pass

            tracklist.append(
                {
                    "title": title,
                    "artist": artist,
                    "album": album_title,
                    "release_year": year,
                    "duration": duration,
                    "discogs_release_id": release_id,
                }
            )

        return tracklist

    except httpx.HTTPError as e:
        print(f"   ❌ Tracklist konnte nicht geladen werden: {e}")
        return []


def search_spotify_track(access_token: str, artist: str, title: str) -> dict | None:
    """Sucht einen Song auf Spotify und gibt Track-Infos zurück."""
    query = f"track:{title} artist:{artist}"
    params = {
        "q": query,
        "type": "track",
        "limit": 3,  # Top 3 Ergebnisse
    }
    headers = {"Authorization": f"Bearer {access_token}"}

    try:
        response = httpx.get(
            f"{SPOTIFY_API_BASE}/search",
            headers=headers,
            params=params,
            timeout=15,
        )
        response.raise_for_status()
        data = response.json()

        tracks = data.get("tracks", {}).get("items", [])
        if not tracks:
            return None

        # Bestes Ergebnis: exakter Titel-Match bevorzugen
        for track in tracks:
            track_name = track.get("name", "").lower()
            if title.lower() in track_name or track_name in title.lower():
                return parse_spotify_track(track)

        # Fallback: erstes Ergebnis
        return parse_spotify_track(tracks[0])

    except httpx.HTTPError as e:
        print(f"   ⚠️  Spotify-Suche fehlgeschlagen für '{title}': {e}")
        return None


def parse_spotify_track(track: dict) -> dict:
    """Extrahiert relevante Infos aus einem Spotify-Track."""
    artists = ", ".join(a.get("name", "") for a in track.get("artists", []))

    release_year = 0
    album = track.get("album", {})
    release_date = album.get("release_date", "")
    if release_date:
        try:
            release_year = int(release_date[:4])
        except ValueError, IndexError:
            release_year = 0

    return {
        "title": track.get("name", ""),
        "artist": artists,
        "release_year": release_year,
        "spotify_url": track.get("external_urls", {}).get("spotify", ""),
        "spotify_id": track.get("id", ""),
        "duration_ms": track.get("duration_ms", 0),
        "preview_url": track.get("preview_url"),
        "album": album.get("name", ""),
    }


# ─── Hauptprogramm ───────────────────────────────────────────────


def run(output_path: str | Path = config.DEFAULT_SONGS_FILE):
    """Sucht die konfigurierten Alben bei Discogs/Spotify und speichert das Ergebnis."""
    print("=" * 60)
    print("  🎸 Discogs → Spotify Metalcore Song Fetcher")
    print("=" * 60)
    print()

    # Spotify Token laden
    print("🔐 Lade Spotify-Token...")
    access_token = load_spotify_access_token()
    if not access_token:
        return
    print("   ✅ Token geladen")
    print()

    all_songs: list[dict] = []

    for i, album_info in enumerate(ALBUMS_TO_FETCH, 1):
        artist = album_info["artist"]
        album = album_info["album"]
        expected_year = album_info.get("year", "?")

        print(f"[{i}/{len(ALBUMS_TO_FETCH)}] 🔍 Suche: {artist} - {album} ({expected_year})")

        # 1. Album bei Discogs suchen (mit erwartetem Jahr für Original-Release)
        release = search_discogs_release(artist, album, expected_year)
        if not release:
            print("   ❌ Nicht gefunden bei Discogs")
            continue

        release_id = release.get("id")
        print(f"   ✅ Gefunden: ID {release_id}")

        time.sleep(DISCOGS_DELAY)

        # 2. Tracklist holen
        tracklist = get_discogs_tracklist(release_id)
        if not tracklist:
            print("   ❌ Keine Tracklist gefunden")
            continue

        print(f"   📀 {len(tracklist)} Songs gefunden")

        # 3. Jeden Song auf Spotify suchen
        for j, discogs_track in enumerate(tracklist, 1):
            title = discogs_track["title"]
            print(f"      [{j}/{len(tracklist)}] 🔎 {title[:40]}...", end=" ", flush=True)

            spotify_track = search_spotify_track(access_token, artist, title)

            if spotify_track:
                # Kombiniere Discogs + Spotify Daten
                song = {
                    "title": spotify_track["title"],
                    "artist": spotify_track["artist"],
                    "release_year": discogs_track["release_year"] or spotify_track["release_year"],
                    "spotify_url": spotify_track["spotify_url"],
                    "spotify_id": spotify_track["spotify_id"],
                    "duration_ms": spotify_track["duration_ms"],
                    "preview_url": spotify_track["preview_url"],
                    "album": discogs_track["album"],
                    "discogs_release_id": discogs_track["discogs_release_id"],
                }
                all_songs.append(song)
                print(f"✅ ({spotify_track['release_year']})")
            else:
                # Fallback: nur Discogs-Daten
                song = {
                    "title": discogs_track["title"],
                    "artist": discogs_track["artist"],
                    "release_year": discogs_track["release_year"],
                    "spotify_url": "",
                    "spotify_id": "",
                    "duration_ms": 0,
                    "preview_url": None,
                    "album": discogs_track["album"],
                    "discogs_release_id": discogs_track["discogs_release_id"],
                }
                all_songs.append(song)
                print(f"⚠️  (nur Discogs, Jahr: {discogs_track['release_year']})")

            time.sleep(SPOTIFY_DELAY)

        print()
        time.sleep(DISCOGS_DELAY)

    # ─── Ergebnisse speichern ────────────────────────────────────

    print("=" * 60)
    print(f"  ✅ Fertig! {len(all_songs)} Songs gesammelt")
    print("=" * 60)
    print()

    # Nach Jahr sortieren (für Zeitklang wichtig!)
    all_songs.sort(key=lambda s: (s["release_year"], s["artist"], s["title"]))

    # Statistik
    with_spotify = sum(1 for s in all_songs if s["spotify_url"])
    without_spotify = len(all_songs) - with_spotify
    years = sorted(set(s["release_year"] for s in all_songs if s["release_year"] > 0))

    print("📊 Statistik:")
    print(f"   Gesamt: {len(all_songs)} Songs")
    print(f"   Mit Spotify-URL: {with_spotify}")
    print(f"   Ohne Spotify-URL: {without_spotify}")
    print(f"   Jahre: {years[0]} - {years[-1]}" if years else "   Keine Jahre gefunden")
    print()

    # Als JSON speichern
    output = save_songs(
        output_path,
        all_songs,
        source="Discogs + Spotify",
        genre="Metalcore",
    )

    print(f"💾 Gespeichert in: {output}")
    print()

    # Vorschau der ersten 10 Songs
    print("🎧 Vorschau (erste 10 Songs, nach Jahr sortiert):")
    for i, song in enumerate(all_songs[:10], 1):
        spotify_icon = "🎵" if song["spotify_url"] else "❌"
        print(
            f"   {i:2d}. [{song['release_year']}] {song['title']} - {song['artist']} {spotify_icon}"
        )
    if len(all_songs) > 10:
        print(f"   ... und {len(all_songs) - 10} weitere")


if __name__ == "__main__":
    import sys

    run(sys.argv[1] if len(sys.argv) > 1 else config.DEFAULT_SONGS_FILE)
