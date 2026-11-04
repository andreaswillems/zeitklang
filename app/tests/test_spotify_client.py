"""Tests für den Spotify-Client (ohne Netzwerkzugriff)."""

import pytest

from zeitklang.spotify_client import Song, extract_playlist_id


@pytest.mark.parametrize(
    ("input_val", "expected"),
    [
        (
            "https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M?si=abc123",
            "37i9dQZF1DXcBWIGoYBM5M",
        ),
        ("https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M", "37i9dQZF1DXcBWIGoYBM5M"),
        (
            "https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M/extra",
            "37i9dQZF1DXcBWIGoYBM5M",
        ),
        ("spotify:playlist:37i9dQZF1DXcBWIGoYBM5M", "37i9dQZF1DXcBWIGoYBM5M"),
        ("spotify:playlist:37i9dQZF1DXcBWIGoYBM5M?si=xyz", "37i9dQZF1DXcBWIGoYBM5M"),
        ("37i9dQZF1DXcBWIGoYBM5M", "37i9dQZF1DXcBWIGoYBM5M"),
        ("  37i9dQZF1DXcBWIGoYBM5M  ", "37i9dQZF1DXcBWIGoYBM5M"),
    ],
)
def test_extract_playlist_id_formats(input_val: str, expected: str):
    assert extract_playlist_id(input_val) == expected


@pytest.mark.parametrize(
    "input_val",
    [
        "",
        "https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC",
        "spotify:track:4uLU6hMCjMI75M1A2tKUQC",
        "keine-id",
    ],
)
def test_extract_playlist_id_invalid(input_val: str):
    with pytest.raises(ValueError):
        extract_playlist_id(input_val)


def test_song_to_dict():
    song = Song(
        title="Fixation on the Darkness",
        artist="Killswitch Engage",
        release_year=2002,
        spotify_url="https://open.spotify.com/track/abc",
        spotify_id="abc",
        duration_ms=207000,
        preview_url=None,
    )
    assert song.to_dict() == {
        "title": "Fixation on the Darkness",
        "artist": "Killswitch Engage",
        "release_year": 2002,
        "spotify_url": "https://open.spotify.com/track/abc",
        "spotify_id": "abc",
        "duration_ms": 207000,
        "preview_url": None,
    }
