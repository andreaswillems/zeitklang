"""Tests für den QR-Karten-Generator (ohne PDF-Schreiben)."""

from zeitklang.cards import COLS, draw_info_page, draw_qr_code_page, generate_qr_code


class _RecordingCanvas:
    """Minimaler Canvas-Stub, der nur rect()-Aufrufe mitschreibt."""

    def __init__(self):
        self.rects = []

    def __getattr__(self, name):
        return lambda *args, **kwargs: None

    def rect(self, x, y, w, h, **kwargs):
        self.rects = getattr(self, "rects", []) + [(x, y)]


def test_info_page_mirrors_columns_for_duplex():
    songs = [{"spotify_url": f"https://s/{i}", "release_year": 2000 + i} for i in range(COLS)]
    front, back = _RecordingCanvas(), _RecordingCanvas()
    draw_qr_code_page(front, songs, 0, 1)
    draw_info_page(back, songs, 0, 1)
    # Rückseite muss spiegelverkehrt über der Vorderseite liegen
    assert [x for x, _ in back.rects] == list(reversed([x for x, _ in front.rects]))
    assert [y for _, y in back.rects] == [y for _, y in front.rects]


def test_generate_qr_code_size():
    img = generate_qr_code("https://open.spotify.com/track/abc", size=200)
    assert img.size == (200, 200)


def test_generate_qr_code_differs_per_url():
    img_a = generate_qr_code("https://open.spotify.com/track/a", size=100)
    img_b = generate_qr_code("https://open.spotify.com/track/b", size=100)
    assert img_a.tobytes() != img_b.tobytes()
