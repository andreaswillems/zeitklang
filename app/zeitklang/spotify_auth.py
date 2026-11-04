"""Gemeinsame Spotify-Token-Verwaltung (OAuth Authorization Code Flow).

Wird von der Webapp (`zeitklang web`), dem Discogs-Fetcher und als
Token-Cache-Pfad auch vom spotify-sdk (`spotify_client.py`) verwendet.
Der Token liegt in `.cache/spotify-token.json` (gitignored).
"""

import json
import time
from pathlib import Path

import httpx

from zeitklang import config

SPOTIFY_AUTH_URL = "https://accounts.spotify.com/authorize"
SPOTIFY_TOKEN_URL = "https://accounts.spotify.com/api/token"

# Muss in der Spotify Developer Dashboard als Redirect-URI konfiguriert sein
REDIRECT_URI = "http://127.0.0.1:8080/callback"
PLAYLIST_SCOPES = ["playlist-read-private", "playlist-read-collaborative"]


def load_token(token_cache_path: str | Path | None = None) -> dict | None:
    """Lädt den gespeicherten Token aus dem Cache."""
    path = Path(token_cache_path) if token_cache_path else config.TOKEN_CACHE_PATH
    if path.exists():
        try:
            with open(path, encoding="utf-8") as f:
                return json.load(f)
        except json.JSONDecodeError, OSError:
            return None
    return None


def save_token(token_data: dict, token_cache_path: str | Path | None = None):
    """Speichert den Token im Cache."""
    path = Path(token_cache_path) if token_cache_path else config.TOKEN_CACHE_PATH
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(token_data, f, indent=2)


def delete_token(token_cache_path: str | Path | None = None):
    """Löscht den gespeicherten Token."""
    path = Path(token_cache_path) if token_cache_path else config.TOKEN_CACHE_PATH
    if path.exists():
        path.unlink()


def token_is_valid(token: dict | None) -> bool:
    """Prüft, ob ein Token vorhanden und nicht abgelaufen ist (60 s Puffer)."""
    if not token:
        return False
    return time.time() < token.get("expires_at", 0) - 60


def _token_response_to_dict(data: dict, refresh_token: str | None = None) -> dict:
    """Bringt eine Token-API-Antwort ins einheitliche Cache-Format."""
    return {
        "access_token": data["access_token"],
        "refresh_token": data.get("refresh_token", refresh_token),
        "token_type": data.get("token_type", "Bearer"),
        "scope": data.get("scope", " ".join(PLAYLIST_SCOPES)),
        "expires_at": time.time() + data.get("expires_in", 3600),
    }


def exchange_code_for_token(code: str, redirect_uri: str = REDIRECT_URI) -> dict:
    """Tauscht den Authorization Code gegen einen Access Token."""
    client_id, client_secret = config.get_credentials()
    response = httpx.post(
        SPOTIFY_TOKEN_URL,
        data={
            "grant_type": "authorization_code",
            "code": code,
            "redirect_uri": redirect_uri,
        },
        auth=(client_id, client_secret),
    )
    response.raise_for_status()
    return _token_response_to_dict(response.json())


def refresh_access_token(refresh_token: str) -> dict | None:
    """Erneuert den Access Token mit dem Refresh Token. None bei Fehler."""
    client_id, client_secret = config.get_credentials()
    try:
        response = httpx.post(
            SPOTIFY_TOKEN_URL,
            data={
                "grant_type": "refresh_token",
                "refresh_token": refresh_token,
            },
            auth=(client_id, client_secret),
        )
        response.raise_for_status()
        return _token_response_to_dict(response.json(), refresh_token=refresh_token)
    except httpx.HTTPError:
        return None


def get_valid_token() -> dict | None:
    """Holt einen gültigen Token, erneuert ihn falls nötig."""
    token = load_token()
    if not token:
        return None

    if token_is_valid(token):
        return token

    refresh_token = token.get("refresh_token")
    if refresh_token:
        new_token = refresh_access_token(refresh_token)
        if new_token:
            save_token(new_token)
            return new_token

    return None
