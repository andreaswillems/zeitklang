"""Vertrauensgrenze web/: Die PWA darf nur öffentliche Werte enthalten.

config.js ist bewusst committed (Client-ID + Redirect-URIs, Spezifikation §3)
— das Client Secret darf niemals in irgendeine Datei unter web/ gelangen.
"""

from zeitklang.config import WEB_DIR, get_credentials


def test_web_enthaelt_kein_client_secret():
    _, client_secret = get_credentials()
    for path in WEB_DIR.rglob("*"):
        if path.is_file():
            assert client_secret.encode() not in path.read_bytes(), (
                f"Client Secret gefunden in {path}"
            )
