"""Tests für den QR-Karten-Generator (ohne PDF-Schreiben)."""

from zeitklang.cards import generate_qr_code


def test_generate_qr_code_size():
    img = generate_qr_code("https://open.spotify.com/track/abc", size=200)
    assert img.size == (200, 200)


def test_generate_qr_code_differs_per_url():
    img_a = generate_qr_code("https://open.spotify.com/track/a", size=100)
    img_b = generate_qr_code("https://open.spotify.com/track/b", size=100)
    assert img_a.tobytes() != img_b.tobytes()
