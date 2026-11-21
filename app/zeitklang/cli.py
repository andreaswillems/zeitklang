"""Kommandozeilen-Einstieg für zeitklang.

Verwendung:
    uv run zeitklang fetch-playlist <playlist-url> [output.json]
    uv run zeitklang fetch-discogs [output.json]
    uv run zeitklang fetch-discogs-search <output.json> [--year-start N] [--year-end N]
    uv run zeitklang enrich-spotify <songs.json>   # Spotify-URLs in Song-JSON nachpflegen
    uv run zeitklang cards [input.json] [output.pdf]
    uv run zeitklang web
    uv run zeitklang serve
"""

import argparse
import sys
from pathlib import Path

from zeitklang import config


def cmd_fetch_playlist(args: argparse.Namespace) -> int:
    from zeitklang.fetch_playlist import run

    run(args.playlist_url, Path(args.output))
    return 0


def cmd_fetch_discogs(args: argparse.Namespace) -> int:
    from zeitklang.discogs import run

    run(Path(args.output))
    return 0


def cmd_fetch_discogs_search(args: argparse.Namespace) -> int:
    from zeitklang.fetch_discogs_search import run

    run(
        Path(args.output),
        year_start=args.year_start,
        year_end=args.year_end,
        per_year=args.per_year,
        compilations_per_year=args.compilations_per_year,
        series=args.series,
        genres=args.genres,
        icons=args.icons,
        name=args.name,
        spotify_delay=args.spotify_delay,
        playlist_only=args.playlist_only,
    )
    return 0


def cmd_enrich_spotify(args: argparse.Namespace) -> int:
    from zeitklang.enrich_spotify import run

    run(Path(args.songs), spotify_delay=args.spotify_delay)
    return 0


def cmd_cards(args: argparse.Namespace) -> int:
    from zeitklang.cards import run

    run(Path(args.input), Path(args.output))
    return 0


def cmd_web(args: argparse.Namespace) -> int:
    from zeitklang.auth.app import run

    run()
    return 0


def cmd_serve(args: argparse.Namespace) -> int:
    from zeitklang.serve import run

    run()
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="zeitklang",
        description=("Musik-Quiz: Song-Sammlungen abrufen und QR-Karten-PDFs generieren."),
    )
    sub = parser.add_subparsers(dest="command", required=True)

    p = sub.add_parser(
        "fetch-playlist",
        help=(
            "Spotify-Playlist abrufen und als JSON speichern "
            "(erfordert Browser-Login beim ersten Aufruf)"
        ),
    )
    p.add_argument("playlist_url", help="Spotify-Playlist-URL, -URI oder -ID")
    p.add_argument(
        "output",
        nargs="?",
        default=str(config.DEFAULT_SONGS_FILE),
        help=f"Ausgabedatei (Standard: {config.DEFAULT_SONGS_FILE})",
    )
    p.set_defaults(func=cmd_fetch_playlist)

    p = sub.add_parser(
        "fetch-discogs",
        help="Metalcore-Songs von Discogs + Spotify abrufen und als JSON speichern",
    )
    p.add_argument(
        "output",
        nargs="?",
        default=str(config.DEFAULT_SONGS_FILE),
        help=f"Ausgabedatei (Standard: {config.DEFAULT_SONGS_FILE})",
    )
    p.set_defaults(func=cmd_fetch_discogs)

    p = sub.add_parser(
        "fetch-discogs-search",
        help=(
            "Radio-Hits eines Zeitraums über Discogs-Suche (Chart-Compilations nach "
            "Community-Want) + Spotify-URLs als eigene JSON speichern"
        ),
    )
    p.add_argument(
        "output",
        help=(
            "Ausgabedatei (Pflicht, z. B. data/songs-90s.json), damit bestehende "
            "Sammlungen wie data/songs.json nicht überschrieben werden"
        ),
    )
    p.add_argument("--year-start", type=int, default=1990, help="erstes Jahr (Standard: 1990)")
    p.add_argument("--year-end", type=int, default=1999, help="letztes Jahr (Standard: 1999)")
    p.add_argument("--per-year", type=int, default=10, help="max. Songs pro Jahr (Standard: 10)")
    p.add_argument(
        "--compilations-per-year",
        type=int,
        default=2,
        help="max. Compilations pro Jahr (Standard: 2)",
    )
    p.add_argument(
        "--series",
        dest="series",
        action="append",
        default=None,
        help=(
            "Chart-Compilation-Reihe, die pro Jahr gesucht wird, mehrfach angebbar "
            "(Standard: Bravo Hits, Now That's What I Call Music, The Dome, ...)"
        ),
    )
    p.add_argument(
        "--genre",
        dest="genres",
        action="append",
        default=None,
        help="Fallback-Discogs-Genre, mehrfach angebbar (nur ohne Chart-Compilation-Treffer)",
    )
    p.add_argument(
        "--add",
        dest="icons",
        action="append",
        default=None,
        metavar='"Künstler - Titel"',
        help=(
            "Icon-Track, der garantiert in die Reihe aufgenommen wird "
            "(Discogs-Jahr + Spotify-URL), mehrfach angebbar — z. B. "
            '--add "Nirvana - Smells Like Teen Spirit"'
        ),
    )
    p.add_argument(
        "--spotify-delay",
        type=float,
        default=None,
        help="Wartezeit zwischen Spotify-Suchen in Sekunden (Standard: 0.2; bei 429 erhöhen)",
    )
    p.add_argument(
        "--playlist-only",
        action="store_true",
        help=(
            "Nur Discogs abfragen und die Playlist-JSON schreiben (ohne Spotify-URLs); "
            "URLs später mit `zeitklang enrich-spotify` nachpflegen"
        ),
    )
    p.add_argument(
        "--name",
        default="Radio Hits",
        help='Anzeigename der Reihe, z. B. "90er Radio Hits" (Standard: "Radio Hits")',
    )
    p.set_defaults(func=cmd_fetch_discogs_search)

    p = sub.add_parser(
        "enrich-spotify",
        help=(
            "Song-JSON mit Spotify-URLs anreichern (für Songs ohne URL), "
            "z. B. nach `fetch-discogs-search --playlist-only`"
        ),
    )
    p.add_argument("songs", help="Song-JSON (z. B. data/songs-90s.json)")
    p.add_argument(
        "--spotify-delay",
        type=float,
        default=None,
        help="Wartezeit zwischen Spotify-Suchen in Sekunden (Standard: 0.2; bei 429 erhöhen)",
    )
    p.set_defaults(func=cmd_enrich_spotify)

    p = sub.add_parser(
        "cards",
        help="Druckbares QR-Code-PDF aus einer Song-JSON generieren",
    )
    p.add_argument(
        "input",
        nargs="?",
        default=str(config.DEFAULT_SONGS_FILE),
        help=f"Song-JSON (Standard: {config.DEFAULT_SONGS_FILE})",
    )
    p.add_argument(
        "output",
        nargs="?",
        default=str(config.DEFAULT_CARDS_PDF),
        help=f"PDF-Ausgabe (Standard: {config.DEFAULT_CARDS_PDF})",
    )
    p.set_defaults(func=cmd_cards)

    p = sub.add_parser(
        "web",
        help="Spotify-Auth-Webapp starten (http://127.0.0.1:8080)",
    )
    p.set_defaults(func=cmd_web)

    p = sub.add_parser(
        "serve",
        help="Statische PWA aus web/ im LAN ausliefern (0.0.0.0:8080)",
    )
    p.set_defaults(func=cmd_serve)

    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
