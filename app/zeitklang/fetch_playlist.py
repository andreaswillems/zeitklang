"""Spotify-Playlist abrufen und als JSON speichern.

Verwendung:
    uv run zeitklang fetch-playlist <playlist-url> [output.json]

Beispiel:
    uv run zeitklang fetch-playlist \
        "https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M" data/songs.json

Beim ersten Aufruf öffnet sich ein Browser für die Spotify-Anmeldung.
"""

import sys
from pathlib import Path

from zeitklang import config
from zeitklang.songs import save_songs
from zeitklang.spotify_client import SpotifyPlaylistClient, extract_playlist_id


def run(playlist_url: str, output_file: str | Path = config.DEFAULT_SONGS_FILE):
    """Lädt eine Playlist von Spotify und speichert sie als JSON."""
    output_file = Path(output_file)

    # Playlist-ID extrahieren
    try:
        playlist_id = extract_playlist_id(playlist_url)
    except ValueError as e:
        print(f"❌ Fehler: {e}")
        sys.exit(1)

    print(f"📋 Playlist-ID: {playlist_id}")
    print()

    # Client mit Authorization Code Flow (erforderlich für Playlist-Items)
    with SpotifyPlaylistClient(auth_mode="authorization_code") as client:
        # Playlist-Informationen abrufen
        print("🔍 Lade Playlist-Informationen...")
        info = client.get_playlist_info(playlist_id)
        print(f"   Name: {info['name']}")
        print(f"   Owner: {info['owner']}")
        print()

        # Tracks abrufen
        print("🎵 Lade Tracks...")
        songs = client.get_playlist_tracks(playlist_id)
        print(f"   {len(songs)} Songs gefunden")
        print()

        # Als JSON speichern
        output = save_songs(output_file, [song.to_dict() for song in songs], playlist=info)

        print(f"✅ Gespeichert in: {output}")
        print()

        # Vorschau der ersten 5 Songs
        print("🎧 Vorschau (erste 5 Songs):")
        for i, song in enumerate(songs[:5], 1):
            print(f"   {i}. {song.title} - {song.artist} ({song.release_year})")
        if len(songs) > 5:
            print(f"   ... und {len(songs) - 5} weitere")


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Verwendung: uv run zeitklang fetch-playlist <playlist-url> [output.json]")
        print()
        print("Beispiel:")
        print("  uv run zeitklang fetch-playlist")
        print('    "https://open.spotify.com/playlist/..." data/songs.json')
        sys.exit(1)
    run(sys.argv[1], sys.argv[2] if len(sys.argv) > 2 else config.DEFAULT_SONGS_FILE)
