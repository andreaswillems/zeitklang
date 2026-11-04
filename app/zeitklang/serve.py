"""Statischer Server für die PWA in web/.

Starten mit:
    uv run zeitklang serve

Liefert die Dateien aus web/ aus; jeder Pfad ohne existierende Datei bekommt
die index.html (SPA-Fallback, Spec §2). Bindet 0.0.0.0:8080, damit die Seite
im LAN auf dem Smartphone geöffnet werden kann, und druckt die LAN-URL als
QR-Code ins Terminal.

TLS via mkcert, sofern installiert: Die Kamera-Freigabe im Browser braucht
einen sicheren Kontext (HTTPS oder localhost, docs/durchstich.md §4). Das
Zertifikat wird pro LAN-IP einmalig in .cache/ erzeugt; die mkcert-CA muss
einmalig auf dem Smartphone installiert sein (iPhone: Profil installieren +
volle Vertrauensstellung).

Nicht gleichzeitig mit `zeitklang web` betreiben (beide Port 8080).
"""

import shutil
import socket
import subprocess
from pathlib import Path

import qrcode
from flask import Flask, send_from_directory
from werkzeug.exceptions import NotFound

from zeitklang import config

PORT = 8080


def create_app() -> Flask:
    app = Flask(__name__, static_folder=None)

    @app.route("/", defaults={"path": ""})
    @app.route("/<path:path>")
    def serve(path: str):
        if path:
            try:
                return send_from_directory(config.WEB_DIR, path)
            except NotFound:
                pass
        return send_from_directory(config.WEB_DIR, "index.html")

    return app


def get_lan_ip() -> str:
    """Ermittelt die LAN-IPv4 ohne Pakete zu versenden (UDP-Connect-Trick)."""
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            s.connect(("8.8.8.8", 80))
            return s.getsockname()[0]
    except OSError:
        return "127.0.0.1"


def ensure_cert(ip: str, cache_dir: Path = config.CACHE_DIR) -> tuple[Path, Path] | None:
    """Erzeugt einmalig pro LAN-IP ein mkcert-Zertifikat in cache_dir.

    Rückgabe: (cert, key) — oder None, wenn mkcert nicht installiert ist.
    """
    cert = cache_dir / f"serve-{ip}.pem"
    key = cache_dir / f"serve-{ip}-key.pem"
    if cert.exists() and key.exists():
        return cert, key
    if shutil.which("mkcert") is None:
        return None
    cache_dir.mkdir(exist_ok=True)
    sans = list(dict.fromkeys([ip, "localhost", "127.0.0.1"]))
    subprocess.run(
        ["mkcert", "-cert-file", str(cert), "-key-file", str(key), *sans],
        check=True,
        capture_output=True,
    )
    return cert, key


def run() -> None:
    ip = get_lan_ip()
    cert = ensure_cert(ip)
    if cert:
        url = f"https://{ip}:{PORT}"
        ssl_context = (str(cert[0]), str(cert[1]))
        print(f"\n  PWA im LAN (TLS): {url}")
        if shutil.which("mkcert"):
            caroot = subprocess.run(
                ["mkcert", "-CAROOT"], capture_output=True, text=True
            ).stdout.strip()
            print(f"  CA fürs Handy (einmalig installieren): {caroot}/rootCA.pem")
    else:
        url = f"http://{ip}:{PORT}"
        ssl_context = None
        print("\n  mkcert fehlt — nur HTTP, die Handy-Kamera wird blockiert.")
        print("  Fix: brew install mkcert && mkcert -install")
        print(f"\n  PWA im LAN: {url}")
    qr = qrcode.QRCode()
    qr.add_data(url)
    qr.print_ascii(invert=True)
    print("\n  Beenden mit Ctrl+C\n")
    create_app().run(host="0.0.0.0", port=PORT, ssl_context=ssl_context)
