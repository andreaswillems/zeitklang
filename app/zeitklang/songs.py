"""Laden und Speichern von Song-Sammlungen als JSON.

Unterstützte Formate:
- {"songs": [...], "source": ..., "genre": ...}  (mit Metadaten)
- [...]                                            (reines Array)
"""

import json
from pathlib import Path


def load_songs(json_path: str | Path, require_spotify_url: bool = False) -> list[dict]:
    """Lädt Songs aus einer JSON-Datei.

    Args:
        json_path: Pfad zur JSON-Datei.
        require_spotify_url: Wenn True, werden Songs ohne Spotify-URL
            herausgefiltert (z. B. für QR-Karten nötig).

    Returns:
        Liste von Song-Dictionaries.

    Raises:
        ValueError: Bei ungültigem JSON-Format.
    """
    with open(json_path, encoding="utf-8") as f:
        data = json.load(f)

    if isinstance(data, dict) and "songs" in data:
        songs = data["songs"]
    elif isinstance(data, list):
        songs = data
    else:
        raise ValueError("Ungültiges JSON-Format: erwartet 'songs' Array")

    if require_spotify_url:
        songs = [s for s in songs if s.get("spotify_url")]

    return songs


def save_songs(json_path: str | Path, songs: list[dict], **metadata) -> Path:
    """Speichert Songs als JSON-Datei mit Metadaten (source, genre, playlist, ...).

    Returns:
        Der absolute Pfad der geschriebenen Datei.
    """
    path = Path(json_path)
    path.parent.mkdir(parents=True, exist_ok=True)
    data = {**metadata, "total_songs": len(songs), "songs": songs}
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
    return path.resolve()
