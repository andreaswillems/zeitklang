"""Sucht Radio-Hits eines Zeitraums über die Discogs-Datenbank und reichert sie mit Spotify-URLs an.

Workflow:
1. Pro Jahr: Discogs-Suche nach bekannten Chart-Compilations (z. B. „Bravo Hits“,
   „Now That's What I Call Music“). Eine ungefilterte Compilation-Suche liefert vor
   allem Sammler-Kompilations — deshalb wird gezielt nach Chart-Reihen gesucht,
   Treffer werden am Titel und am Release-Jahr geprüft.
2. Die meistgewollten Compilations pro Jahr (Community-Want als Popularitäts-Signal,
   die Reihen-Reihenfolge nur als Tiebreaker) liefern ihre Tracklists —
   die Tracklist-Reihenfolge einer Chart-Compilation entspricht der Hit-Reihenfolge.
   Der Künstler steht pro Track im Tracklist-Eintrag (`artists`).
3. Pro Jahr die ersten `--per-year` Tracks auswählen und jeden auf Spotify suchen
   (Spotify-URL fürs QR-Kärtchen). Release-Jahr: Original-Jahr laut Spotify, sofern es
   nicht nach dem Compilation-Jahr liegt, sonst das Compilation-Jahr.
4. Ergebnis als eigene Song-JSON speichern (z. B. data/songs-90s.json) — die Ausgabedatei
   ist Pflicht-Parameter, damit bestehende Sammlungen (data/songs.json) nie überschrieben
   werden.

Verwendung:
    uv run zeitklang fetch-discogs-search data/songs-90s.json \
        --year-start 1990 --year-end 1999 --per-year 10 --name "90er Radio Hits"

    uv run zeitklang cards data/songs-90s.json output/90s-karten.pdf
"""

import re
import time
from pathlib import Path

import httpx

from zeitklang import config
from zeitklang import discogs as discogs_api
from zeitklang.songs import save_songs

SPOTIFY_API_BASE = discogs_api.SPOTIFY_API_BASE
SPOTIFY_TOKEN_URL = "https://accounts.spotify.com/api/token"

# Bekannte Chart-Compilations (Radio-Hits-Reihen), die pro Jahr gesucht werden.
# Reihenfolge = Priorität (erste Reihe, die Treffer liefert, gewinnt).
DEFAULT_SERIES = [
    "Bravo Hits",
    "Now That's What I Call Music",
    "Hit Collection",
    "Top of the Pops",
    "Smash Hits",
    "Mega Hits",
]

# Fallback-Genres, falls für ein Jahr keine Chart-Compilation gefunden wird
DEFAULT_GENRES = ["Pop", "Rock", "Electronic", "Hip Hop", "Funk / Soul", "Reggae"]

# Discogs-Limit ohne Token: 25 Requests/Minute -> 2.5 s Abstand (siehe discogs.py)
DISCOGS_DELAY = discogs_api.DISCOGS_DELAY
SPOTIFY_DELAY = discogs_api.SPOTIFY_DELAY


# ─── Reine Hilfsfunktionen (testbar, ohne Netzwerk) ──────────────


def normalize_key(artist: str, title: str) -> str:
    """Normalisiert Künstler+Titel für Deduplizierung."""

    def norm(s: str) -> str:
        return re.sub(r"\s+", " ", s.lower()).strip()

    return f"{norm(artist)}|{norm(title)}"


def _norm_text(s: str) -> str:
    """Kollabiert zu Kleinbuchstaben + nur [a-z0-9] (für Titel-Vergleiche)."""
    return re.sub(r"[^a-z0-9]+", "", s.lower())


def matches_series(title: str, series: str) -> bool:
    """True, wenn der Release-Titel die Chart-Reihe enthält (z. B. „Bravo Hits 8“)."""
    return bool(_norm_text(series)) and _norm_text(series) in _norm_text(title)


def same_year(result: dict, year: int) -> bool:
    """True, wenn das Suchergebnis aus genau diesem Jahr stammt (clientseitiger Filter)."""
    try:
        return int(result.get("year") or 0) == year
    except ValueError, TypeError:
        return False


def _has_unofficial(result: dict) -> bool:
    return any("unofficial" in f.lower() for f in result.get("format", []))


def is_official_compilation(result: dict) -> bool:
    """True, wenn das Suchergebnis eine offizielle Compilation ist (kein Bootleg)."""
    fmt = [f.lower() for f in result.get("format", [])]
    return "compilation" in fmt and not _has_unofficial(result)


def is_official_album(result: dict) -> bool:
    """True, wenn das Suchergebnis ein offizielles Album ist (kein Bootleg)."""
    fmt = [f.lower() for f in result.get("format", [])]
    return "album" in fmt and not _has_unofficial(result)


def rank_candidates(entries: list[tuple[int, dict]], keep_filter) -> list[dict]:
    """Sortiert (Community-Want, Community-Have, Reihen-Priorität) und dedupliziert nach Titel.

    `entries` sind (priority, result)-Paare; die Priorität (Reihenfolge in `--series`)
    ist nur Tiebreaker, damit bei gleichem Want die „wichtigere" Reihe vorne landet.
    Duplikate (gleicher Titel) werden nach dem Sortieren verworfen.
    """
    seen: set[str] = set()
    filtered = [e for e in entries if keep_filter(e[1])]
    filtered.sort(
        key=lambda e: (
            -e[1].get("community", {}).get("want", 0),
            -e[1].get("community", {}).get("have", 0),
            e[0],
        )
    )
    out: list[dict] = []
    for _, r in filtered:
        key = re.sub(r"\s+", " ", r.get("title", "").lower()).strip()
        if key in seen:
            continue
        seen.add(key)
        out.append(r)
    return out


def split_artist_title(track_title: str, release_artist: str) -> tuple[str, str]:
    """Spaltet „Künstler - Titel" bei Various-Compilations in (Künstler, Titel)."""
    if release_artist.strip().lower() == "various" and " - " in track_title:
        artist, title = track_title.split(" - ", 1)
        return artist.strip(), title.strip()
    return release_artist.strip(), track_title.strip()


def track_artist_title(track: dict, release_artist: str) -> tuple[str, str]:
    """Ermittelt (Künstler, Titel) eines Tracklist-Eintrags.

    Bevorzugt das pro Track gepflegte `artists`-Feld (Various-Compilations), dann
    „Künstler - Titel“ im Titel, sonst den Release-Künstler.
    """
    title = track.get("title", "")
    artists = [a.get("name", "") for a in track.get("artists") or [] if a.get("name")]
    if artists:
        return ", ".join(artists), title
    return split_artist_title(title, release_artist)


def strip_various(release_title: str) -> str:
    """Entfernt das „Various - "-Präfix eines Compilation-Titels."""
    return re.sub(r"^various\s*-\s*", "", release_title, flags=re.IGNORECASE).strip()


def clean_search_title(title: str) -> str:
    """Räumt einen Track-Titel für die Spotify-Suche auf.

    Entfernt Klammerzusätze wie „(Techno Version)“ / „(Radio Edit)“ am Ende —
    die machen die Suche unnötig spezifisch.
    """
    cleaned = title.strip()
    while True:
        new = re.sub(r"\s*\([^)]*\)\s*$", "", cleaned).strip()
        if new == cleaned or not new:
            break
        cleaned = new
    return cleaned or title.strip()


def build_spotify_query(artist: str, title: str) -> str:
    """Baut die Spotify-Suchanfrage.

    Bei Various-Compilations ohne Track-Künstler wird nur nach dem Titel gesucht.
    """
    if artist and artist.strip().lower() != "various":
        return f"track:{clean_search_title(title)} artist:{artist}"
    return f"track:{clean_search_title(title)}"


def prefer_current_charts(ranked: list[dict]) -> list[dict]:
    """Sortiert „Best Of"-Compilations ans Ende (aktuelle Chart-Volumes zuerst).

    Stable: Reihenfolge innerhalb der Gruppen bleibt erhalten.
    """
    current = [r for r in ranked if "best of" not in r.get("title", "").lower()]
    bestof = [r for r in ranked if "best of" in r.get("title", "").lower()]
    return current + bestof


def pick_release_year(spotify_year: int, compilation_year: int, year_floor: int) -> int:
    """Wählt das Release-Jahr eines Songs.

    Bevorzugt das Original-Jahr laut Spotify, sofern es Sinn ergibt (nicht vor
    `year_floor` und nicht nach dem Compilation-Jahr); sonst das Compilation-Jahr.
    """
    if year_floor <= spotify_year <= compilation_year:
        return spotify_year
    return compilation_year


def select_year_tracks(tracks: list[dict], per_year: int) -> list[dict]:
    """Dedupliziert die Tracks eines Jahres (erste Fundstelle = Chart-Position) und
    begrenzt auf `per_year` Tracks."""
    seen: set[str] = set()
    out: list[dict] = []
    for t in tracks:
        key = normalize_key(t["artist"], t["title"])
        if key in seen:
            continue
        seen.add(key)
        out.append(t)
        if len(out) >= per_year:
            break
    return out


def finalize_songs(songs: list[dict]) -> list[dict]:
    """Dedupliziert global (frühestes Jahr gewinnt) und sortiert nach Jahr/Künstler/Titel."""
    best: dict[str, dict] = {}
    for s in songs:
        key = normalize_key(s["artist"], s["title"])
        if key not in best or s["release_year"] < best[key]["release_year"]:
            best[key] = s
    return sorted(best.values(), key=lambda s: (s["release_year"], s["artist"], s["title"]))


def parse_icon(spec: str) -> tuple[str, str]:
    """Parst „Künstler - Titel“ aus einem --add-Argument."""
    if " - " in spec:
        artist, title = spec.split(" - ", 1)
        if artist.strip() and title.strip():
            return artist.strip(), title.strip()
    raise ValueError(f"Ungültiges Icon-Format (erwartet 'Künstler - Titel'): {spec!r}")


def icon_release_year(
    discogs_year: int | None, spotify_year: int, year_start: int, year_end: int
) -> int | None:
    """Release-Jahr eines Icon-Tracks: Discogs-Jahr, wenn im Zeitraum, sonst
    Spotify-Jahr, wenn im Zeitraum, sonst None (Icon wird übersprungen)."""
    if discogs_year is not None and year_start <= discogs_year <= year_end:
        return discogs_year
    if year_start <= spotify_year <= year_end:
        return spotify_year
    return None


# ─── Netzwerk-Zugriff ────────────────────────────────────────────


def get_client_credentials_token() -> str:
    """Holt ein Spotify Access Token via Client Credentials (reicht für die Suche)."""
    client_id, client_secret = config.get_credentials()
    response = httpx.post(
        SPOTIFY_TOKEN_URL,
        data={"grant_type": "client_credentials"},
        auth=(client_id, client_secret),
        timeout=30,
    )
    response.raise_for_status()
    return response.json()["access_token"]


def discogs_search(
    year: int, query: str, fmt: str, genre: str | None = None, per_page: int = 25
) -> list[dict]:
    """Sucht Releases eines Jahres bei Discogs (q + Format + optional Genre)."""
    params = {
        "type": "release",
        "year": str(year),
        "format": fmt,
        "per_page": per_page,
    }
    if query:
        params["q"] = query
    if genre:
        params["genre"] = genre
    response = httpx.get(
        f"{discogs_api.DISCOGS_BASE}/database/search",
        headers=discogs_api.DISCOGS_HEADERS,
        params=params,
        timeout=30,
    )
    response.raise_for_status()
    return response.json().get("results", [])


def get_release_tracklist(release_id: int) -> list[dict]:
    """Holt die Tracklist eines Discogs-Releases inkl. Künstler pro Track."""
    response = httpx.get(
        f"{discogs_api.DISCOGS_BASE}/releases/{release_id}",
        headers=discogs_api.DISCOGS_HEADERS,
        timeout=30,
    )
    response.raise_for_status()
    data = response.json()

    artists = data.get("artists", [])
    release_artist = artists[0].get("name", "Unknown") if artists else "Unknown"
    try:
        year = int(data.get("year") or 0)
    except ValueError, TypeError:
        year = 0
    album_title = data.get("title", "Unknown Album")

    tracklist: list[dict] = []
    for t in data.get("tracklist", []):
        duration = t.get("duration", "")
        # Sehr kurze Tracks (Intros/Interludes) überspringen — wie discogs.py
        if duration and tracklist:
            try:
                if int(duration.split(":")[0]) < 1:
                    continue
            except ValueError, IndexError:
                pass
        artist, title = track_artist_title(t, release_artist)
        tracklist.append(
            {
                "artist": artist,
                "title": title,
                "album": album_title,
                "release_year": year,
                "duration": duration,
                "discogs_release_id": release_id,
            }
        )
    return tracklist


def search_discogs_icon_year(artist: str, title: str) -> int | None:
    """Frühestes Release-Jahr eines Songs bei Discogs (als Original-Jahr des Icons)."""
    try:
        response = httpx.get(
            f"{discogs_api.DISCOGS_BASE}/database/search",
            headers=discogs_api.DISCOGS_HEADERS,
            params={"type": "release", "q": f"{artist} {title}", "per_page": 10},
            timeout=30,
        )
        response.raise_for_status()
    except httpx.HTTPError as e:
        print(f"   ⚠️  Discogs-Suche fehlgeschlagen für Icon '{title}': {e}")
        return None
    years = []
    for r in response.json().get("results", []):
        try:
            years.append(int(r.get("year") or 0))
        except ValueError, TypeError:
            continue
    years = [y for y in years if y > 0]
    return min(years) if years else None


def add_icon_songs(
    access_token: str,
    icons: list[str],
    year_start: int,
    year_end: int,
    spotify_delay: float = SPOTIFY_DELAY,
    playlist_only: bool = False,
) -> list[dict]:
    """Sucht explizit vorgegebene Icon-Tracks („Künstler - Titel“) über Discogs + Spotify."""
    songs: list[dict] = []
    for spec in icons:
        artist, title = parse_icon(spec)
        print(f"   ⭐ {artist} - {title[:40]}", end=" ", flush=True)
        discogs_year = search_discogs_icon_year(artist, title)
        time.sleep(DISCOGS_DELAY)
        if playlist_only:
            # Ohne Spotify-Lookup: Discogs-Jahr direkt übernehmen (falls im Zeitraum)
            release_year = (
                discogs_year if discogs_year and year_start <= discogs_year <= year_end else None
            )
            if release_year is None:
                print(f"⏭️ außerhalb {year_start}-{year_end} (Discogs: {discogs_year})")
                continue
            songs.append(
                {
                    "title": title,
                    "artist": artist,
                    "release_year": release_year,
                    "spotify_url": "",
                    "spotify_id": "",
                    "duration_ms": 0,
                    "preview_url": None,
                    "album": "",
                    "icon": True,
                }
            )
            print(f"✅ ({release_year}, nur Discogs)")
            continue
        spotify_track = spotify_search_track(access_token, artist, title)
        if not spotify_track or not spotify_track.get("spotify_url"):
            print("❌ nicht auf Spotify gefunden")
            continue
        release_year = icon_release_year(
            discogs_year, spotify_track["release_year"], year_start, year_end
        )
        if release_year is None:
            print(f"⏭️ außerhalb {year_start}-{year_end} (Discogs: {discogs_year})")
            continue
        songs.append(
            {
                "title": spotify_track["title"],
                "artist": spotify_track["artist"],
                "release_year": release_year,
                "spotify_url": spotify_track["spotify_url"],
                "spotify_id": spotify_track["spotify_id"],
                "duration_ms": spotify_track["duration_ms"],
                "preview_url": spotify_track["preview_url"],
                "album": spotify_track.get("album", ""),
                "icon": True,
            }
        )
        print(f"✅ ({release_year})")
        time.sleep(spotify_delay)
    return songs


def spotify_search_track(access_token: str, artist: str, title: str) -> dict | None:
    """Sucht einen Track auf Spotify (Top-Ergebnisse) und parst ihn.

    Fällt bei Misserfolg auf eine reine Titelsuche zurück. Liefert das Dictionary
    aus discogs.parse_spotify_track oder None.
    """
    headers = {"Authorization": f"Bearer {access_token}"}

    def _search(query: str, max_attempts: int = 6) -> list[dict]:
        for attempt in range(max_attempts):
            try:
                response = httpx.get(
                    f"{SPOTIFY_API_BASE}/search",
                    headers=headers,
                    params={"q": query, "type": "track", "limit": 3},
                    timeout=15,
                )
            except httpx.HTTPError as e:
                print(f"   ⚠️  Spotify-Suche fehlgeschlagen für '{title}': {e}")
                return []
            if response.status_code == 429 and attempt < max_attempts - 1:
                # Rate Limit: Retry-After respektieren (gedeckelt auf 120 s)
                try:
                    retry_after = int(response.headers.get("Retry-After", "5"))
                except ValueError:
                    retry_after = 5
                wait = min(retry_after, 120)
                print(f"   ⏳ Spotify-Rate-Limit (429), warte {wait}s...")
                time.sleep(wait)
                continue
            if response.status_code == 429:
                print(f"   ⚠️  Spotify-Suche für '{title}': dauerhaftes Rate Limit (429)")
                return []
            response.raise_for_status()
            return response.json().get("tracks", {}).get("items", [])
        return []

    has_artist = bool(artist) and artist.strip().lower() != "various"
    tracks = _search(build_spotify_query(artist, title))
    if not tracks and has_artist:
        # Fallback: nur nach dem Titel suchen
        tracks = _search(f"track:{clean_search_title(title)}")
    if not tracks:
        return None
    # Bestes Ergebnis: exakter Titel-Match bevorzugen
    for track in tracks:
        track_name = track.get("name", "").lower()
        if title.lower() in track_name or track_name in title.lower():
            return discogs_api.parse_spotify_track(track)
    return discogs_api.parse_spotify_track(tracks[0])


# ─── Hauptprogramm ───────────────────────────────────────────────


def run(
    output_file: str | Path,
    year_start: int = 1990,
    year_end: int = 1999,
    per_year: int = 10,
    compilations_per_year: int = 2,
    series: list[str] | None = None,
    genres: list[str] | None = None,
    icons: list[str] | None = None,
    name: str = "Radio Hits",
    year_floor: int | None = None,
    spotify_delay: float | None = None,
    playlist_only: bool = False,
):
    """Sucht Radio-Hits pro Jahr über Discogs und speichert sie als Song-JSON."""
    output_file = Path(output_file)
    series = series or DEFAULT_SERIES
    genres = genres or DEFAULT_GENRES
    if year_floor is None:
        year_floor = year_start
    if spotify_delay is None:
        spotify_delay = SPOTIFY_DELAY

    print("=" * 60)
    print(f"  📻 Discogs-Suche: {name} ({year_start}-{year_end})")
    print("=" * 60)
    print()

    if playlist_only:
        access_token = ""
        print(
            "📋 Playlist-only-Modus: nur Discogs, kein Spotify-Lookup "
            "(URLs später via `zeitklang enrich-spotify`)"
        )
    else:
        print("🔐 Lade Spotify-Token (Client Credentials)...")
        access_token = get_client_credentials_token()
        print("   ✅ Token geladen")
    print()

    all_songs: list[dict] = []

    for year in range(year_start, year_end + 1):
        print(f"📅 Jahr {year}: suche Chart-Compilations ({', '.join(series)})...")

        # 1. Pro Reihe suchen; Treffer müssen Titel + Jahr passen
        entries: list[tuple[int, dict]] = []
        for idx, s in enumerate(series):
            try:
                results = discogs_search(year, s, "Compilation")
            except httpx.HTTPError as e:
                print(f"   ⚠️  Discogs-Suche fehlgeschlagen ({s}): {e}")
                continue
            for r in results:
                if same_year(r, year) and matches_series(r.get("title", ""), s):
                    entries.append((idx, r))
            time.sleep(DISCOGS_DELAY)

        # 2. Nach Community-Want ranken (Reihe nur als Tiebreaker); „Best Of“-
        #    Compilations hinten anstellen (liefern ältere Songs statt aktueller Charts)
        ranked = prefer_current_charts(rank_candidates(entries, is_official_compilation))
        if not ranked:
            # Fallback: keine Chart-Compilation gefunden -> meistgewollte Alben des Jahres
            print("   ℹ️  Keine Chart-Compilation gefunden, suche Alben...")
            entries = []
            for genre in genres:
                try:
                    results = discogs_search(year, "", "Album", genre=genre, per_page=50)
                except httpx.HTTPError as e:
                    print(f"   ⚠️  Discogs-Suche fehlgeschlagen ({genre}): {e}")
                    continue
                for r in results:
                    if same_year(r, year):
                        entries.append((0, r))
                time.sleep(DISCOGS_DELAY)
            ranked = prefer_current_charts(rank_candidates(entries, is_official_album))

        chosen = ranked[:compilations_per_year]
        if not chosen:
            print("   ❌ Nichts gefunden")
            continue
        for r in chosen:
            print(
                f"   💿 {r.get('title', '?')} "
                f"(want={r.get('community', {}).get('want', 0)}, "
                f"have={r.get('community', {}).get('have', 0)})"
            )

        # 3. Tracklists holen, in Chart-Reihenfolge sammeln
        year_tracks: list[dict] = []
        for rel in chosen:
            tracklist = get_release_tracklist(rel["id"])
            time.sleep(DISCOGS_DELAY)
            album_title = strip_various(rel.get("title", "Unknown"))
            for t in tracklist:
                year_tracks.append({**t, "album": album_title})

        # 4. Pro Jahr auf die ersten `per_year` Hits begrenzen
        selected = select_year_tracks(year_tracks, per_year)
        print(f"   🎵 {len(selected)} Tracks ausgewählt (Chart-Reihenfolge)")

        # 5. Jeden Track auf Spotify suchen (im --playlist-only-Modus übersprungen —
        #    das erledigt später `zeitklang enrich-spotify`)
        for i, t in enumerate(selected, 1):
            if playlist_only:
                all_songs.append(
                    {
                        "title": t["title"],
                        "artist": t["artist"],
                        "release_year": t["release_year"],
                        "spotify_url": "",
                        "spotify_id": "",
                        "duration_ms": 0,
                        "preview_url": None,
                        "album": t["album"],
                        "discogs_release_id": t["discogs_release_id"],
                    }
                )
                continue
            print(f"      [{i}/{len(selected)}] 🔎 {t['artist']} - {t['title'][:40]}", end=" ")
            spotify_track = spotify_search_track(access_token, t["artist"], t["title"])
            if not spotify_track or not spotify_track.get("spotify_url"):
                print("❌ nicht auf Spotify gefunden")
                continue
            song = {
                "title": spotify_track["title"],
                "artist": spotify_track["artist"],
                "release_year": pick_release_year(
                    spotify_track["release_year"], t["release_year"], year_floor
                ),
                "spotify_url": spotify_track["spotify_url"],
                "spotify_id": spotify_track["spotify_id"],
                "duration_ms": spotify_track["duration_ms"],
                "preview_url": spotify_track["preview_url"],
                "album": t["album"],
                "discogs_release_id": t["discogs_release_id"],
            }
            all_songs.append(song)
            print(f"✅ ({song['release_year']})")
            time.sleep(spotify_delay)
        print()

    # ─── Optional: explizite Icon-Tracks (z. B. Grunge/Rock/MJ) ────
    if icons:
        print(f"⭐ Icons nachpflegen ({len(icons)} Stück)...")
        all_songs += add_icon_songs(
            access_token, icons, year_start, year_end, spotify_delay, playlist_only
        )
        print()

    # ─── Ergebnisse aufbereiten und speichern ────────────────────
    songs = finalize_songs(all_songs)

    print("=" * 60)
    print(f"  ✅ Fertig! {len(songs)} Songs gesammelt")
    print("=" * 60)

    years = sorted({s["release_year"] for s in songs})
    print("📊 Statistik:")
    print(f"   Gesamt: {len(songs)} Songs")
    print(f"   Jahre: {years[0]} - {years[-1]}" if years else "   Keine Jahre gefunden")
    print()

    output = save_songs(
        output_file,
        songs,
        source="Discogs" if playlist_only else "Discogs + Spotify",
        genre=name,
        query=f"year:{year_start}-{year_end} chart compilations ({', '.join(series)})",
        year_start=year_start,
        year_end=year_end,
        playlist_only=playlist_only,
    )
    print(f"💾 Gespeichert in: {output}")
    print()

    print("🎧 Vorschau (nach Jahr sortiert):")
    for i, song in enumerate(songs[:15], 1):
        print(f"   {i:2d}. [{song['release_year']}] {song['title']} - {song['artist']}")
    if len(songs) > 15:
        print(f"   ... und {len(songs) - 15} weitere")


if __name__ == "__main__":
    import sys

    run(sys.argv[1] if len(sys.argv) > 1 else "data/songs-suche.json")
