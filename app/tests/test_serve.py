"""Tests für den statischen PWA-Server (zeitklang serve)."""

from zeitklang.serve import create_app, ensure_cert


def test_index_served():
    client = create_app().test_client()
    response = client.get("/")
    assert response.status_code == 200
    assert b'id="reader"' in response.data


def test_spa_fallback_for_unknown_path():
    client = create_app().test_client()
    response = client.get("/callback")
    assert response.status_code == 200
    assert b'id="reader"' in response.data


def test_ensure_cert_returns_none_without_mkcert(tmp_path, monkeypatch):
    monkeypatch.setattr("shutil.which", lambda _: None)
    assert ensure_cert("192.168.1.2", tmp_path) is None


def test_ensure_cert_reuses_existing_files(tmp_path, monkeypatch):
    cert, key = tmp_path / "serve-10.0.0.1.pem", tmp_path / "serve-10.0.0.1-key.pem"
    cert.touch()
    key.touch()

    def _fail(_name):
        raise AssertionError("mkcert sollte nicht aufgerufen werden")

    monkeypatch.setattr("shutil.which", _fail)
    assert ensure_cert("10.0.0.1", tmp_path) == (cert, key)
