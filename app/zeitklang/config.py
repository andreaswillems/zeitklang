"""Zentrale Pfade und Zugangsdaten für zeitklang.

Alle Pfade werden relativ zum Projektroot aufgelöst (dort liegt die
pyproject.toml), unabhängig davon, von wo aus der Code gestartet wird.
"""

import os
from pathlib import Path

from dotenv import load_dotenv


def _find_project_root() -> Path:
    """Sucht das Projektroot anhand der pyproject.toml."""
    for parent in Path(__file__).resolve().parents:
        if (parent / "pyproject.toml").exists():
            return parent
    # Fallback: aktuelles Arbeitsverzeichnis
    return Path.cwd()


PROJECT_ROOT = _find_project_root()

ENV_FILE = PROJECT_ROOT / ".env"
CACHE_DIR = PROJECT_ROOT / ".cache"
TOKEN_CACHE_PATH = CACHE_DIR / "spotify-token.json"

DATA_DIR = PROJECT_ROOT / "data"
OUTPUT_DIR = PROJECT_ROOT / "output"
WEB_DIR = PROJECT_ROOT / "web"  # statische Assets der PWA

DEFAULT_SONGS_FILE = DATA_DIR / "songs.json"
DEFAULT_CARDS_PDF = OUTPUT_DIR / "zeitklang-karten.pdf"


def get_credentials() -> tuple[str, str]:
    """Lädt SPOTIFY_CLIENT_ID und SPOTIFY_CLIENT_SECRET aus der .env.

    Raises:
        ValueError: Wenn die Credentials fehlen.
    """
    load_dotenv(ENV_FILE)
    client_id = os.getenv("SPOTIFY_CLIENT_ID")
    client_secret = os.getenv("SPOTIFY_CLIENT_SECRET")
    if not client_id or not client_secret:
        raise ValueError(
            f"SPOTIFY_CLIENT_ID und SPOTIFY_CLIENT_SECRET müssen in {ENV_FILE} gesetzt sein"
        )
    return client_id, client_secret
