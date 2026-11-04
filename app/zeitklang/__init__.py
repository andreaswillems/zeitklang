"""zeitklang — Musik-Quiz mit QR-Karten."""

from zeitklang.songs import load_songs, save_songs
from zeitklang.spotify_client import Song, SpotifyPlaylistClient, extract_playlist_id

__version__ = "0.1.0"

__all__ = [
    "Song",
    "SpotifyPlaylistClient",
    "extract_playlist_id",
    "load_songs",
    "save_songs",
    "__version__",
]
