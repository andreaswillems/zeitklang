"""Tests für die Discogs-Such-Logik (ohne Netzwerkzugriff)."""

from zeitklang.fetch_discogs_search import (
    build_spotify_query,
    clean_search_title,
    finalize_songs,
    icon_release_year,
    is_official_album,
    is_official_compilation,
    matches_series,
    normalize_key,
    parse_icon,
    pick_release_year,
    prefer_current_charts,
    rank_candidates,
    same_year,
    select_year_tracks,
    split_artist_title,
    strip_various,
    track_artist_title,
)


def _result(
    title: str, want: int, have: int = 0, fmt: list[str] | None = None, year="1994"
) -> dict:
    return {
        "title": title,
        "year": year,
        "format": fmt or ["CD", "Compilation", "Stereo"],
        "community": {"want": want, "have": have},
    }


def test_is_official_compilation():
    assert is_official_compilation(_result("Various - Bravo Hits 8", 38))
    assert not is_official_compilation(
        _result("Nirvana - Bootleg", 99, fmt=["CD", "Compilation", "Unofficial Release"])
    )
    assert not is_official_compilation(_result("Band - Album", 99, fmt=["CD", "Album"]))


def test_is_official_album():
    assert is_official_album(_result("Band - Album", 99, fmt=["CD", "Album"]))
    assert not is_official_album(_result("Band - Bootleg", 99, fmt=["CD", "Album", "Unofficial"]))
    assert not is_official_album(_result("Various - Bravo Hits", 99))


def test_matches_series():
    assert matches_series("Various - Bravo Hits 8", "Bravo Hits")
    assert matches_series(
        "Various - Now That's What I Call Music! 29", "Now That's What I Call Music"
    )
    assert not matches_series("Various - Techno Trax", "Bravo Hits")
    assert not matches_series("Various - DOME, Rendez-Vous", "The Dome")
    assert not matches_series("irgendwas", "")


def test_same_year():
    assert same_year(_result("X", 1, year="1994"), 1994)
    assert not same_year(_result("X", 1, year="1984"), 1999)
    assert not same_year(_result("X", 1, year=""), 1999)


def test_rank_candidates_want_first_priority_as_tiebreak():
    entries = [
        (1, _result("Various - Now! 29", 442)),  # höchster want -> zuerst
        (0, _result("Various - Bravo Hits 8", 38)),
        (0, _result("Various - Bravo Hits 7", 43)),
        (1, _result("Various - Now! 27", 426)),
        (0, _result("Various - Bravo Hits  8", 10)),  # Duplikat von Bravo Hits 8
        (0, _result("Bootleg", 999, fmt=["CD", "Compilation", "Unofficial"])),  # raus
    ]
    ranked = rank_candidates(entries, is_official_compilation)
    assert [r["title"] for r in ranked] == [
        "Various - Now! 29",
        "Various - Now! 27",
        "Various - Bravo Hits 7",
        "Various - Bravo Hits 8",
    ]


def test_rank_candidates_priority_tiebreak():
    entries = [
        (1, _result("Various - Now! 29", 100)),
        (0, _result("Various - Bravo Hits 8", 100)),  # gleicher want -> Priorität 0 zuerst
    ]
    ranked = rank_candidates(entries, is_official_compilation)
    assert [r["title"] for r in ranked] == ["Various - Bravo Hits 8", "Various - Now! 29"]


def test_rank_candidates_album_filter():
    entries = [
        (0, _result("Band - Album A", 10, fmt=["CD", "Album"])),
        (0, _result("Various - Comp", 5)),
    ]
    ranked = rank_candidates(entries, is_official_album)
    assert [r["title"] for r in ranked] == ["Band - Album A"]


def test_split_artist_title_various():
    assert split_artist_title("Nirvana - Smells Like Teen Spirit", "Various") == (
        "Nirvana",
        "Smells Like Teen Spirit",
    )


def test_split_artist_title_normal_release():
    assert split_artist_title("Smells Like Teen Spirit", "Nirvana") == (
        "Nirvana",
        "Smells Like Teen Spirit",
    )


def test_track_artist_title_prefers_track_artists():
    track = {"title": "Baby Come Back", "artists": [{"name": "Pato Banton"}]}
    assert track_artist_title(track, "Various") == ("Pato Banton", "Baby Come Back")


def test_track_artist_title_fallback_split():
    track = {"title": "Nirvana - Smells Like Teen Spirit"}
    assert track_artist_title(track, "Various") == ("Nirvana", "Smells Like Teen Spirit")


def test_track_artist_title_fallback_release_artist():
    track = {"title": "Smells Like Teen Spirit"}
    assert track_artist_title(track, "Nirvana") == ("Nirvana", "Smells Like Teen Spirit")


def test_strip_various():
    assert strip_various("Various - Bravo Hits 8") == "Bravo Hits 8"
    assert strip_various("Nirvana - Nevermind") == "Nirvana - Nevermind"


def test_normalize_key():
    assert normalize_key(" Nirvana ", "Smells  Like Teen Spirit") == (
        normalize_key("nirvana", "smells like teen spirit")
    )


def test_clean_search_title():
    assert clean_search_title("Das Boot (Techno Version)") == "Das Boot"
    assert clean_search_title("Don't Go Away (Radio Walk)") == "Don't Go Away"
    assert clean_search_title("Song (A) (B)") == "Song"
    assert clean_search_title("Ohne Dich (Schlaf ich heut Nacht nicht)") == "Ohne Dich"
    # Klammern mitten im Titel bleiben erhalten, wenn etwas stehen bleibt
    assert clean_search_title("(What Is Love)") == "(What Is Love)"


def test_prefer_current_charts():
    ranked = [
        _result("Various - Bravo Hits Best Of '93", 44),
        _result("Various - Bravo Hits 13", 42),
        _result("Various - Bravo Hits 14", 38),
    ]
    out = prefer_current_charts(ranked)
    assert [r["title"] for r in out] == [
        "Various - Bravo Hits 13",
        "Various - Bravo Hits 14",
        "Various - Bravo Hits Best Of '93",
    ]


def test_build_spotify_query():
    assert build_spotify_query("Nirvana", "Smells Like Teen Spirit") == (
        "track:Smells Like Teen Spirit artist:Nirvana"
    )
    # Klammerzusätze werden für die Suche entfernt
    assert build_spotify_query("U96", "Das Boot (Techno Version)") == "track:Das Boot artist:U96"
    # Various-Compilation: Track-Titel ohne Künstler -> nur Titelsuche
    assert build_spotify_query("Various", "Close To You") == "track:Close To You"
    assert build_spotify_query("", "Close To You") == "track:Close To You"


def test_pick_release_year():
    # Original-Jahr laut Spotify im sinnvollen Bereich -> nehmen
    assert pick_release_year(1991, 1994, 1990) == 1991
    # Spotify-Match ist ein späteres Re-Release -> Compilation-Jahr nehmen
    assert pick_release_year(2015, 1994, 1990) == 1994
    # Spotify-Jahr vor dem Such-Zeitraum -> Compilation-Jahr nehmen
    assert pick_release_year(1987, 1994, 1990) == 1994


def test_select_year_tracks_dedupes_and_caps():
    tracks = [
        {"artist": "A", "title": "Hit 1"},
        {"artist": "B", "title": "Hit 2"},
        {"artist": "a", "title": "hit 1"},  # Duplikat, erste Fundstelle gewinnt
        {"artist": "C", "title": "Hit 3"},
    ]
    selected = select_year_tracks(tracks, per_year=2)
    assert [(t["artist"], t["title"]) for t in selected] == [("A", "Hit 1"), ("B", "Hit 2")]


def test_parse_icon():
    assert parse_icon("Nirvana - Smells Like Teen Spirit") == (
        "Nirvana",
        "Smells Like Teen Spirit",
    )
    assert parse_icon("Michael Jackson - Black or White - Remix") == (
        "Michael Jackson",
        "Black or White - Remix",
    )


def test_parse_icon_invalid():
    import pytest

    with pytest.raises(ValueError):
        parse_icon("NurTitel")
    with pytest.raises(ValueError):
        parse_icon(" - ")


def test_icon_release_year():
    # Discogs-Jahr im Zeitraum -> Discogs-Jahr
    assert icon_release_year(1991, 1991, 1990, 1999) == 1991
    # Discogs-Jahr außerhalb -> Spotify-Jahr, falls im Zeitraum
    assert icon_release_year(1983, 1991, 1990, 1999) == 1991
    assert icon_release_year(None, 1995, 1990, 1999) == 1995
    # beides außerhalb -> None (Icon wird übersprungen)
    assert icon_release_year(1983, 1983, 1990, 1999) is None
    assert icon_release_year(None, 0, 1990, 1999) is None


def test_enrich_song_fills_spotify_fields_and_fixes_year():
    from zeitklang.enrich_spotify import enrich_song

    song = {
        "title": "Das Boot (Techno Version)",
        "artist": "U96",
        "release_year": 1992,
        "spotify_url": "",
    }
    spotify_track = {
        "title": "Das Boot",
        "artist": "U96",
        "release_year": 1991,
        "spotify_url": "https://open.spotify.com/track/abc",
        "spotify_id": "abc",
        "duration_ms": 250000,
        "preview_url": None,
    }
    out = enrich_song(song, spotify_track, year_floor=1990)
    assert out["spotify_url"] == "https://open.spotify.com/track/abc"
    assert out["spotify_id"] == "abc"
    assert out["title"] == "Das Boot"
    # Original-Jahr 1991 liegt im Zeitraum und vor dem Compilation-Jahr 1992
    assert out["release_year"] == 1991

    # Original-Jahr vor year_floor -> Compilation-Jahr behalten
    old_track = {**spotify_track, "release_year": 1982}
    out2 = enrich_song(song, old_track, year_floor=1990)
    assert out2["release_year"] == 1992


def test_finalize_songs_keeps_earliest_year_and_sorts():
    songs = [
        {"artist": "A", "title": "Song", "release_year": 1995},
        {"artist": "A", "title": "Song", "release_year": 1991},  # Duplikat, früheres Jahr gewinnt
        {"artist": "A", "title": "Song", "release_year": 1993},
    ]
    out = finalize_songs(songs)
    assert len(out) == 1
    assert out[0]["release_year"] == 1991

    songs2 = [
        {"artist": "B", "title": "X", "release_year": 1994},
        {"artist": "A", "title": "Y", "release_year": 1990},
    ]
    out2 = finalize_songs(songs2)
    assert [s["artist"] for s in out2] == ["A", "B"]
