"""Reichert eine Song-JSON (z. B. aus `fetch-discogs-search --playlist-only`) mit Spotify-URLs an.

Schritt 2 des Reihen-Workflows: Die Playlist-JSON enthält bereits Titel, Künstler und
Jahr (aus Discogs); hier werden pro Song die Spotify-URL/-ID (für die QR-Karten) gesucht
und das Release-Jahr ggf. auf das Original-Jahr laut Spotify korrigiert.

Verwendung:
    uv run zeitklang enrich-spotify data/songs-90s.json [--spotify-delay 0.5]
"""

import json
import sys
import time
from pathlib import Path

from zeitklang.fetch_discogs_search import (
    SPOTIFY_DELAY,
    finalize_songs,
    get_client_credentials_token,
    pick_release_year,
    spotify_search_track,
)
from zeitklang.songs import save_songs


def enrich_song(song: dict, spotify_track: dict, year_floor: int) -> dict:
    """Füllt Spotify-Felder eines Songs und korrigiert das Release-Jahr (Original-Jahr,
    sofern es nicht vor `year_floor` und nicht nach dem bisherigen Jahr liegt)."""
    return {
        **song,
        "title": spotify_track["title"],
        "artist": spotify_track["artist"],
        "release_year": pick_release_year(
            spotify_track["release_year"], song.get("release_year", 0), year_floor
        ),
        "spotify_url": spotify_track["spotify_url"],
        "spotify_id": spotify_track["spotify_id"],
        "duration_ms": spotify_track["duration_ms"],
        "preview_url": spotify_track["preview_url"],
    }


def run(songs_file: str | Path, spotify_delay: float | None = None):
    """Sucht für alle Songs ohne Spotify-URL den passenden Spotify-Track."""
    songs_file = Path(songs_file)
    if spotify_delay is None:
        spotify_delay = SPOTIFY_DELAY

    with open(songs_file, encoding="utf-8") as f:
        data = json.load(f)
    if isinstance(data, dict):
        metadata = {k: v for k, v in data.items() if k != "songs"}
        songs = data.get("songs", [])
    else:
        metadata = {}
        songs = data

    missing = [s for s in songs if not s.get("spotify_url")]
    print("=" * 60)
    print(f"  🔎 Spotify-Anreicherung: {songs_file}")
    print("=" * 60)
    print(f"   {len(songs)} Songs gesamt, {len(missing)} ohne Spotify-URL")
    print()

    if not missing:
        print("✅ Alle Songs haben bereits eine Spotify-URL — nichts zu tun.")
        return

    print("🔐 Lade Spotify-Token (Client Credentials)...")
    access_token = get_client_credentials_token()
    print("   ✅ Token geladen")
    print()

    # Jahr-Untergrenze für die Original-Jahr-Korrektur (aus Metadaten oder ältestem Song)
    year_floor = metadata.get("year_start")
    if year_floor is None:
        years = [s.get("release_year", 0) for s in songs if s.get("release_year")]
        year_floor = min(years) if years else 0

    for i, song in enumerate(missing, 1):
        print(
            f"   [{i}/{len(missing)}] 🔎 {song.get('artist', '?')} - {song.get('title', '?')[:40]}",
            end=" ",
        )
        spotify_track = spotify_search_track(
            access_token, song.get("artist", ""), song.get("title", "")
        )
        if not spotify_track or not spotify_track.get("spotify_url"):
            print("❌ nicht auf Spotify gefunden")
        else:
            enriched = enrich_song(song, spotify_track, int(year_floor))
            songs[songs.index(song)] = enriched
            print(f"✅ ({enriched['release_year']})")
        time.sleep(spotify_delay)

    songs = finalize_songs(songs)
    with_url = sum(1 for s in songs if s.get("spotify_url"))

    print()
    print("=" * 60)
    print(f"  ✅ Fertig! {with_url}/{len(songs)} Songs mit Spotify-URL")
    print("=" * 60)
    print()

    output = save_songs(songs_file, songs, **metadata)
    print(f"💾 Gespeichert in: {output}")


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Verwendung: uv run zeitklang enrich-spotify <songs.json>")
        sys.exit(1)
    run(sys.argv[1])
