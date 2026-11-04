"""Spotify Client für das Abrufen von Playlist-Daten.

Verwendet das spotify-sdk, um Tracks aus einer Spotify-Playlist abzurufen
und in ein Format zu bringen, das für das Musik-Quiz geeignet ist.

WICHTIG: Das Abrufen von Playlist-Items erfordert User-Authentifizierung
(Authorization Code Flow), nicht nur Client Credentials. Beim ersten Aufruf
öffnet sich automatisch ein Browser für die Spotify-Anmeldung. Das Token
wird gecached und wiederverwendet.

HINWEIS: Die Search-Funktion verwendet direkten HTTP-Zugriff, da das
spotify-sdk 0.10.1 einen Bug hat (fehlendes 'popularity' Feld in der
API-Antwort verursacht Validierungsfehler).
"""

import os
from dataclasses import dataclass
from pathlib import Path
from typing import Literal

import httpx
from dotenv import load_dotenv
from spotify_sdk import SpotifyClient
from spotify_sdk.auth import AuthorizationCode, FileTokenCache
from spotify_sdk.models.playlist import PlaylistItem

from zeitklang import config


@dataclass
class Song:
    """Repräsentiert einen Song für das Quiz."""

    title: str
    artist: str
    release_year: int
    spotify_url: str
    spotify_id: str
    duration_ms: int
    preview_url: str | None

    def to_dict(self) -> dict:
        """Konvertiert den Song in ein Dictionary für JSON-Serialisierung."""
        return {
            "title": self.title,
            "artist": self.artist,
            "release_year": self.release_year,
            "spotify_url": self.spotify_url,
            "spotify_id": self.spotify_id,
            "duration_ms": self.duration_ms,
            "preview_url": self.preview_url,
        }


class SpotifyPlaylistClient:
    """Client zum Abrufen von Playlist-Daten von Spotify.

    Unterstützt zwei Authentifizierungsmodi:
    - "authorization_code" (Standard): Voller Zugriff inkl. Playlist-Items.
      Erfordert einmalige Browser-Anmeldung.
    - "client_credentials": Nur für öffentliche Daten (Track-Details, etc.).
      Funktioniert NICHT für Playlist-Items.
    """

    # Scopes für Playlist-Zugriff
    PLAYLIST_SCOPES = [
        "playlist-read-private",
        "playlist-read-collaborative",
    ]

    SPOTIFY_API_BASE = "https://api.spotify.com/v1"
    SPOTIFY_ACCOUNTS_BASE = "https://accounts.spotify.com"

    def __init__(
        self,
        env_path: str | Path | None = None,
        auth_mode: Literal["authorization_code", "client_credentials"] = "authorization_code",
        token_cache_path: str | Path | None = None,
        redirect_uri: str = "http://127.0.0.1:8080/callback",
        auto_authorize: bool = True,
    ):
        """Initialisiert den Client.

        Args:
            env_path: Pfad zur .env-Datei. Standard: .env im Projektroot.
            auth_mode: "authorization_code" (voller Zugriff) oder
                       "client_credentials" (nur öffentliche Daten).
            token_cache_path: Pfad für den Token-Cache. Standard: .cache/spotify-token.json
            redirect_uri: Redirect-URI für OAuth (muss in Spotify Dashboard konfiguriert sein).
            auto_authorize: Wenn True, wird automatisch der Browser für die
                           Autorisierung geöffnet (nur bei authorization_code).
        """
        # .env laden
        if env_path is None:
            env_path = config.ENV_FILE
        load_dotenv(env_path)

        self.client_id = os.getenv("SPOTIFY_CLIENT_ID")
        self.client_secret = os.getenv("SPOTIFY_CLIENT_SECRET")

        if not self.client_id or not self.client_secret:
            raise ValueError(
                "SPOTIFY_CLIENT_ID und SPOTIFY_CLIENT_SECRET müssen in der .env gesetzt sein"
            )

        self.auth_mode = auth_mode
        self._client: SpotifyClient | None = None
        self._auth: AuthorizationCode | None = None
        self._access_token: str | None = None

        if auth_mode == "authorization_code":
            self._init_authorization_code(token_cache_path, redirect_uri, auto_authorize)
        else:
            self._init_client_credentials()

    def _init_authorization_code(
        self,
        token_cache_path: str | Path | None,
        redirect_uri: str,
        auto_authorize: bool,
    ):
        """Initialisiert den Authorization Code Flow."""
        # Token-Cache Pfad
        if token_cache_path is None:
            token_cache_path = config.TOKEN_CACHE_PATH
        token_cache_path = Path(token_cache_path)
        token_cache_path.parent.mkdir(parents=True, exist_ok=True)

        # Token-Cache erstellen
        cache = FileTokenCache(str(token_cache_path))

        # Auth Provider erstellen
        self._auth = AuthorizationCode(
            client_id=self.client_id,
            client_secret=self.client_secret,
            redirect_uri=redirect_uri,
            scope=self.PLAYLIST_SCOPES,
            token_cache=cache,
        )

        # Prüfen, ob bereits ein Token existiert
        token_info = cache.get()
        if token_info is None and auto_authorize:
            print("🔐 Spotify-Autorisierung erforderlich...")
            print("   Ein Browser-Fenster öffnet sich. Bitte melde dich bei Spotify an.")
            print(f"   Nach der Anmeldung wirst du zu {redirect_uri} weitergeleitet.")
            print()
            self._auth.authorize_local()
            print("✅ Autorisierung erfolgreich! Token wurde gespeichert.")
        elif token_info is None:
            raise ValueError(
                "Kein gespeicherter Token gefunden. Rufe den Client mit "
                "auto_authorize=True auf oder führe die Autorisierung manuell durch."
            )

        # Client mit Auth Provider erstellen
        self._client = SpotifyClient(auth_provider=self._auth)
        # Access Token für direkte HTTP-Calls holen
        self._access_token = self._auth.get_access_token()

    def _init_client_credentials(self):
        """Initialisiert den Client Credentials Flow (nur öffentliche Daten)."""
        self._client = SpotifyClient.from_client_credentials(
            client_id=self.client_id,
            client_secret=self.client_secret,
        )
        # Token für direkte HTTP-Calls holen
        self._access_token = self._get_client_credentials_token()

    def _get_client_credentials_token(self) -> str:
        """Holt ein Access Token via Client Credentials Flow."""
        response = httpx.post(
            f"{self.SPOTIFY_ACCOUNTS_BASE}/api/token",
            data={"grant_type": "client_credentials"},
            auth=(self.client_id, self.client_secret),
        )
        response.raise_for_status()
        return response.json()["access_token"]

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        self.close()

    def close(self):
        """Schließt den Client und gibt Ressourcen frei."""
        if self._client:
            self._client.close()
        if self._auth:
            self._auth.close()

    def get_playlist_info(self, playlist_id: str) -> dict:
        """Ruft grundlegende Informationen über eine Playlist ab.

        Verwendet direkten HTTP-Zugriff (Workaround für SDK-Bug in v0.10.1:
        Das Playlist-Modell erwartet ein 'items' Feld, das die API nicht liefert).

        Args:
            playlist_id: Die Spotify-ID der Playlist (z.B. aus der URL).

        Returns:
            Dictionary mit name, description, owner, public, etc.
        """
        if not self._access_token:
            raise RuntimeError("Kein Access Token verfügbar.")

        headers = {"Authorization": f"Bearer {self._access_token}"}
        response = httpx.get(
            f"{self.SPOTIFY_API_BASE}/playlists/{playlist_id}",
            headers=headers,
        )
        response.raise_for_status()
        data = response.json()

        owner = data.get("owner", {})
        external_urls = data.get("external_urls", {})

        return {
            "id": data.get("id"),
            "name": data.get("name"),
            "description": data.get("description"),
            "owner": owner.get("display_name"),
            "public": data.get("public"),
            "collaborative": data.get("collaborative"),
            "spotify_url": external_urls.get("spotify"),
        }

    def get_playlist_tracks(
        self,
        playlist_id: str,
        limit: int = 50,
        market: str | None = None,
    ) -> list[Song]:
        """Ruft alle Tracks einer Playlist ab (mit Paginierung).

        HINWEIS: Erfordert Authorization Code Authentifizierung!

        Args:
            playlist_id: Die Spotify-ID der Playlist.
            limit: Anzahl der Tracks pro API-Abruf (max. 50).
            market: Optionaler Ländercode (z.B. "DE") für verfügbare Inhalte.

        Returns:
            Liste von Song-Objekten.
        """
        if self.auth_mode != "authorization_code":
            raise RuntimeError(
                "get_playlist_tracks() erfordert Authorization Code Authentifizierung. "
                "Erstelle den Client mit auth_mode='authorization_code'."
            )

        songs: list[Song] = []
        offset = 0

        while True:
            page = self._client.playlists.get_items(
                playlist_id,
                limit=limit,
                offset=offset,
                market=market,
            )

            for item in page.items:
                song = self._playlist_item_to_song(item)
                if song is not None:
                    songs.append(song)

            # Prüfen, ob weitere Seiten vorhanden sind
            if page.next is None:
                break
            offset += limit

        return songs

    def search_tracks(
        self,
        query: str,
        limit: int = 10,
        market: str | None = None,
    ) -> list[Song]:
        """Sucht nach Tracks auf Spotify.

        Verwendet direkten HTTP-Zugriff (Workaround für SDK-Bug in v0.10.1).
        Funktioniert mit beiden Authentifizierungsmodi.

        Args:
            query: Suchbegriff (z.B. "Shape of You Ed Sheeran").
            limit: Maximale Anzahl Ergebnisse (max. 50).
            market: Optionaler Ländercode.

        Returns:
            Liste von Song-Objekten.
        """
        if not self._access_token:
            raise RuntimeError("Kein Access Token verfügbar.")

        headers = {"Authorization": f"Bearer {self._access_token}"}
        params = {
            "q": query,
            "type": "track",
            "limit": min(limit, 50),
        }
        if market:
            params["market"] = market

        response = httpx.get(
            f"{self.SPOTIFY_API_BASE}/search",
            headers=headers,
            params=params,
        )
        response.raise_for_status()
        data = response.json()

        songs: list[Song] = []
        tracks = data.get("tracks", {}).get("items", [])
        for track in tracks:
            song = self._dict_to_song(track)
            if song:
                songs.append(song)

        return songs

    def _playlist_item_to_song(self, item: PlaylistItem) -> Song | None:
        """Konvertiert ein PlaylistItem in ein Song-Objekt.

        Überspringt Items, die keine Tracks sind (z.B. Episoden) oder
        lokale Dateien ohne ausreichende Daten.
        """
        track = item.item
        if track is None or track.type_ != "track":
            return None

        return self._track_to_song(track)

    def _track_to_song(self, track) -> Song | None:
        """Konvertiert ein SDK Track-Objekt in ein Song-Objekt."""
        if track is None:
            return None

        # Künstler zusammenfügen (z.B. "Artist A, Artist B")
        artists = ", ".join(artist.name for artist in track.artists)

        # Release-Jahr aus dem Album extrahieren
        release_year = 0
        if track.album and track.album.release_date:
            try:
                release_year = int(track.album.release_date[:4])
            except ValueError, IndexError:
                release_year = 0

        # Spotify-URL
        spotify_url = ""
        if track.external_urls:
            spotify_url = track.external_urls.spotify

        return Song(
            title=track.name,
            artist=artists,
            release_year=release_year,
            spotify_url=spotify_url,
            spotify_id=track.id,
            duration_ms=track.duration_ms,
            preview_url=track.preview_url,
        )

    def _dict_to_song(self, track: dict) -> Song | None:
        """Konvertiert ein Track-Dictionary (von direktem HTTP-Call) in ein Song-Objekt."""
        if not track:
            return None

        # Künstler zusammenfügen
        artists = ", ".join(a.get("name", "") for a in track.get("artists", []))

        # Release-Jahr aus dem Album extrahieren
        release_year = 0
        album = track.get("album", {})
        if album.get("release_date"):
            try:
                release_year = int(album["release_date"][:4])
            except ValueError, IndexError:
                release_year = 0

        # Spotify-URL
        spotify_url = track.get("external_urls", {}).get("spotify", "")

        return Song(
            title=track.get("name", ""),
            artist=artists,
            release_year=release_year,
            spotify_url=spotify_url,
            spotify_id=track.get("id", ""),
            duration_ms=track.get("duration_ms", 0),
            preview_url=track.get("preview_url"),
        )


def extract_playlist_id(playlist_url_or_id: str) -> str:
    """Extrahiert die Playlist-ID aus einer Spotify-URL oder ID.

    Unterstützte Formate:
    - Reine ID: "37i9dQZF1DXcBWIGoYBM5M"
    - URL: "https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M"
    - URI: "spotify:playlist:37i9dQZF1DXcBWIGoYBM5M"

    Args:
        playlist_url_or_id: Spotify-URL, URI oder reine ID.

    Returns:
        Die Playlist-ID.

    Raises:
        ValueError: Wenn das Format nicht erkannt wird.
    """
    text = playlist_url_or_id.strip()

    # Reine ID (alphanumerisch, typisch 22 Zeichen)
    if text.isalnum() and len(text) >= 20:
        return text

    # URI: spotify:playlist:ID
    if text.startswith("spotify:playlist:"):
        return text.split(":")[-1].split("?")[0]

    # URL: https://open.spotify.com/playlist/ID?si=...
    if "open.spotify.com/playlist/" in text:
        playlist_id = text.split("open.spotify.com/playlist/")[-1]
        return playlist_id.split("?")[0].split("/")[0]

    raise ValueError(f"Konnte Playlist-ID nicht extrahieren aus: {playlist_url_or_id}")
