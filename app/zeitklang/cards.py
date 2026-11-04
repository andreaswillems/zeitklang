"""Generiert ein druckbares QR-Code-PDF für das Zeitklang-Spiel.

Erstellt Karten mit:
- Vorderseite: QR-Code (führt zur Spotify-URL)
- Rückseite: Song-Info (Jahr, Künstler, Titel)

Layout: 20 Karten pro A4-Seite (4 Spalten x 5 Reihen)
Doppelseitiger Druck: Seite 1 = QR-Codes, Seite 2 = Song-Infos

Verwendung:
    uv run zeitklang cards [input.json] [output.pdf]

Standard:
    uv run zeitklang cards data/songs.json output/zeitklang-karten.pdf
"""

import os
import sys
import tempfile
from pathlib import Path

import qrcode
from PIL import Image
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.pdfgen import canvas

from zeitklang import config
from zeitklang.songs import load_songs

# ─── Konfiguration ───────────────────────────────────────────────

# A4 in Punkten (1 Punkt = 1/72 Zoll)
PAGE_WIDTH, PAGE_HEIGHT = A4  # 595.27 x 841.89 Punkte

# Layout
MARGIN = 10 * mm  # Seitenrand
COLS = 4  # Spalten
ROWS = 5  # Reihen
CARDS_PER_PAGE = COLS * ROWS  # 20 Karten pro Seite

# Kartengröße (mit etwas Abstand)
CARD_WIDTH = (PAGE_WIDTH - 2 * MARGIN) / COLS
CARD_HEIGHT = (PAGE_HEIGHT - 2 * MARGIN) / ROWS

# QR-Code Größe (zentriert in der Karte)
QR_SIZE = min(CARD_WIDTH, CARD_HEIGHT) * 0.75

# Farben
COLOR_QR_BG = (1, 1, 1)  # Weiß
COLOR_TEXT = (0.1, 0.1, 0.1)  # Fast Schwarz
COLOR_YEAR = (0.8, 0.1, 0.1)  # Rot für das Jahr (Lösung)
COLOR_BORDER = (0.7, 0.7, 0.7)  # Grauer Rand


# ─── Hilfsfunktionen ─────────────────────────────────────────────


def load_card_songs(json_path: Path) -> list[dict]:
    """Lädt Songs aus der JSON-Datei (nur Songs mit Spotify-URL)."""
    all_songs = load_songs(json_path)
    songs_with_url = [s for s in all_songs if s.get("spotify_url")]
    print(f"📚 {len(all_songs)} Songs geladen, {len(songs_with_url)} mit Spotify-URL")
    return songs_with_url


def generate_qr_code(data: str, size: int = 300) -> Image.Image:
    """Generiert einen QR-Code als PIL Image."""
    qr = qrcode.QRCode(
        version=1,
        error_correction=qrcode.constants.ERROR_CORRECT_M,
        box_size=10,
        border=2,
    )
    qr.add_data(data)
    qr.make(fit=True)

    img = qr.make_image(fill_color="black", back_color="white")
    img = img.resize((size, size), Image.Resampling.LANCZOS)

    return img


def draw_qr_code_page(c: canvas.Canvas, songs: list[dict], page_num: int, total_pages: int):
    """Zeichnet eine Seite mit QR-Codes (Vorderseite der Karten)."""

    for idx, song in enumerate(songs):
        # Position im Grid berechnen
        col = idx % COLS
        row = idx // COLS

        # Position (von unten links, daher PAGE_HEIGHT - ...)
        x = MARGIN + col * CARD_WIDTH
        y = PAGE_HEIGHT - MARGIN - (row + 1) * CARD_HEIGHT

        # Karten-Hintergrund (weiß mit Rand)
        c.setFillColorRGB(*COLOR_QR_BG)
        c.setStrokeColorRGB(*COLOR_BORDER)
        c.setLineWidth(0.5)
        c.rect(x, y, CARD_WIDTH, CARD_HEIGHT, fill=1, stroke=1)

        # QR-Code generieren und einfügen
        qr_img = generate_qr_code(song["spotify_url"])

        # QR-Code zentriert in der Karte platzieren
        qr_x = x + (CARD_WIDTH - QR_SIZE) / 2
        qr_y = y + (CARD_HEIGHT - QR_SIZE) / 2

        # Temporäre Datei für das Bild (reportlab braucht einen Pfad)
        with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as tmp:
            qr_img.save(tmp.name, format="PNG")
            c.drawImage(tmp.name, qr_x, qr_y, QR_SIZE, QR_SIZE)
            os.unlink(tmp.name)

        # Kleine Nummer in der Ecke (zur Orientierung beim Ausschneiden)
        c.setFillColorRGB(0.5, 0.5, 0.5)
        c.setFont("Helvetica", 6)
        c.drawString(x + 2, y + 2, str(page_num * CARDS_PER_PAGE + idx + 1))

    # Seitenfuß
    c.setFillColorRGB(0.5, 0.5, 0.5)
    c.setFont("Helvetica", 8)
    c.drawCentredString(
        PAGE_WIDTH / 2,
        5 * mm,
        f"Zeitklang Karten — Vorderseite (QR-Codes) — Seite {page_num + 1}/{total_pages}",
    )


def draw_info_page(c: canvas.Canvas, songs: list[dict], page_num: int, total_pages: int):
    """Zeichnet eine Seite mit Song-Infos (Rückseite der Karten)."""

    for idx, song in enumerate(songs):
        # Position im Grid berechnen (gleiche Anordnung wie Vorderseite!)
        col = idx % COLS
        row = idx // COLS

        x = MARGIN + col * CARD_WIDTH
        y = PAGE_HEIGHT - MARGIN - (row + 1) * CARD_HEIGHT

        # Karten-Hintergrund (weiß mit Rand)
        c.setFillColorRGB(*COLOR_QR_BG)
        c.setStrokeColorRGB(*COLOR_BORDER)
        c.setLineWidth(0.5)
        c.rect(x, y, CARD_WIDTH, CARD_HEIGHT, fill=1, stroke=1)

        # Karten-Nummer (oben links)
        c.setFillColorRGB(0.5, 0.5, 0.5)
        c.setFont("Helvetica", 6)
        c.drawString(x + 2, y + CARD_HEIGHT - 8, str(page_num * CARDS_PER_PAGE + idx + 1))

        # Jahr (groß, zentriert, rot)
        c.setFillColorRGB(*COLOR_YEAR)
        c.setFont("Helvetica-Bold", 18)
        year_str = str(song.get("release_year", "????"))
        c.drawCentredString(x + CARD_WIDTH / 2, y + CARD_HEIGHT / 2 + 5, year_str)

        # Künstler (kleiner, unter dem Jahr)
        c.setFillColorRGB(*COLOR_TEXT)
        c.setFont("Helvetica-Bold", 7)
        artist = song.get("artist", "Unknown")
        # Künstler kürzen falls zu lang
        if len(artist) > 25:
            artist = artist[:22] + "..."
        c.drawCentredString(x + CARD_WIDTH / 2, y + CARD_HEIGHT / 2 - 12, artist)

        # Titel (noch kleiner, darunter)
        c.setFont("Helvetica", 6)
        title = song.get("title", "Unknown")
        if len(title) > 30:
            title = title[:27] + "..."
        c.drawCentredString(x + CARD_WIDTH / 2, y + CARD_HEIGHT / 2 - 20, title)

    # Seitenfuß
    c.setFillColorRGB(0.5, 0.5, 0.5)
    c.setFont("Helvetica", 8)
    c.drawCentredString(
        PAGE_WIDTH / 2,
        5 * mm,
        f"Zeitklang Karten — Rückseite (Lösung) — Seite {page_num + 1}/{total_pages}",
    )


# ─── Hauptprogramm ───────────────────────────────────────────────


def run(
    input_file: str | Path = config.DEFAULT_SONGS_FILE,
    output_file: str | Path = config.DEFAULT_CARDS_PDF,
):
    """Generiert das Karten-PDF aus einer Song-JSON."""
    input_file = Path(input_file)
    output_file = Path(output_file)
    output_file.parent.mkdir(parents=True, exist_ok=True)

    if not input_file.exists():
        print(f"❌ Datei nicht gefunden: {input_file}")
        sys.exit(1)

    print("=" * 60)
    print("  🎴 Zeitklang QR-Code Karten Generator")
    print("=" * 60)
    print()
    print(f"📥 Eingabe:  {input_file}")
    print(f"📤 Ausgabe:  {output_file}")
    print(f"📐 Layout:   {COLS}x{ROWS} = {CARDS_PER_PAGE} Karten pro Seite (A4)")
    print()

    # Songs laden
    songs = load_card_songs(input_file)
    if not songs:
        print("❌ Keine Songs mit Spotify-URL gefunden!")
        sys.exit(1)

    # Anzahl Seiten berechnen (jeweils Vorder- + Rückseite)
    num_batches = (len(songs) + CARDS_PER_PAGE - 1) // CARDS_PER_PAGE
    total_pdf_pages = num_batches * 2  # Vorder- und Rückseite

    print(f"📄 Erstelle {num_batches} Karten-Sets ({total_pdf_pages} PDF-Seiten)...")
    print()

    # PDF erstellen
    c = canvas.Canvas(str(output_file), pagesize=A4)
    c.setTitle("Zeitklang Karten — Metalcore Edition")
    c.setAuthor("Zeitklang")

    for batch_idx in range(num_batches):
        start = batch_idx * CARDS_PER_PAGE
        end = min(start + CARDS_PER_PAGE, len(songs))
        batch_songs = songs[start:end]

        print(
            f"  Seite {batch_idx * 2 + 1}-{batch_idx * 2 + 2}: "
            f"Songs {start + 1}-{end} ({len(batch_songs)} Karten)"
        )

        # Vorderseite (QR-Codes)
        draw_qr_code_page(c, batch_songs, batch_idx, num_batches)
        c.showPage()

        # Rückseite (Song-Infos)
        draw_info_page(c, batch_songs, batch_idx, num_batches)
        c.showPage()

    c.save()

    print()
    print("=" * 60)
    print("  ✅ PDF erfolgreich erstellt!")
    print("=" * 60)
    print()
    print(f"📁 Gespeichert: {output_file.absolute()}")
    print()
    print("📋 Druck-Anleitung:")
    print("   1. PDF doppelseitig drucken (Rückseite wenden: 'an langer Kante wenden')")
    print("   2. Karten entlang der Linien ausschneiden")
    print("   3. QR-Codes mit Smartphone scannen → Song wird auf Spotify abgespielt")
    print("   4. Karten chronologisch nach Jahr sortieren (Jahr steht auf der Rückseite)")
    print()


if __name__ == "__main__":
    run(*sys.argv[1:])
