"""Kommandozeilen-Einstieg für zeitklang.

Verwendung:
    uv run zeitklang fetch-playlist <playlist-url> [output.json]
    uv run zeitklang fetch-discogs [output.json]
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
