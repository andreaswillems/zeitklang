"""Tests für das Laden/Speichern von Song-Sammlungen."""

import json

import pytest

from zeitklang.songs import load_songs, save_songs

SONGS = [
    {
        "title": "Song A",
        "artist": "Artist A",
        "release_year": 2002,
        "spotify_url": "https://open.spotify.com/track/a",
    },
    {"title": "Song B", "artist": "Artist B", "release_year": 2007, "spotify_url": ""},
]


def test_load_songs_with_metadata(tmp_path):
    path = tmp_path / "songs.json"
    path.write_text(json.dumps({"source": "Test", "songs": SONGS}), encoding="utf-8")
    assert load_songs(path) == SONGS


def test_load_songs_plain_list(tmp_path):
    path = tmp_path / "songs.json"
    path.write_text(json.dumps(SONGS), encoding="utf-8")
    assert load_songs(path) == SONGS


def test_load_songs_require_spotify_url(tmp_path):
    path = tmp_path / "songs.json"
    path.write_text(json.dumps({"songs": SONGS}), encoding="utf-8")
    songs = load_songs(path, require_spotify_url=True)
    assert songs == [SONGS[0]]


def test_load_songs_invalid_format(tmp_path):
    path = tmp_path / "songs.json"
    path.write_text(json.dumps({"foo": "bar"}), encoding="utf-8")
    with pytest.raises(ValueError, match="songs"):
        load_songs(path)


def test_save_songs_roundtrip(tmp_path):
    path = tmp_path / "out" / "songs.json"  # Unterordner wird angelegt
    result = save_songs(path, SONGS, source="Test", genre="Metalcore")

    assert result == path.resolve()
    data = json.loads(path.read_text(encoding="utf-8"))
    assert data["source"] == "Test"
    assert data["genre"] == "Metalcore"
    assert data["total_songs"] == 2
    assert data["songs"] == SONGS
