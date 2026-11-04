# Durchstich (Spike): QR-Scan im lokalen Netzwerk

> **Status:** Plan (noch kein Code). Erster Umsetzungsschritt zur
> [PWA-Spezifikation](pwa-spezifikation.md) — der kleinste end-to-end-Schnitt durch
> Hosting (§2) und QR-Scan (§4), **ohne** Spotify-Login und Wiedergabe.
> Alles, was der Durchstich anlegt, ist Keimzelle der vollen PWA — nichts davon ist Wegwerfcode.

## 1. Ziel & Scope

**Nachgewiesen wird die Kette:**

LAN-Hosting → auf dem Smartphone geöffnet → QR-Code einer gedruckten Karte gescannt →
dekodierter String (`https://open.spotify.com/track/<id>`) auf dem Handy angezeigt.

**Bewusst draußen (kommt aus der Spec, nicht aus dem Spike):** Spotify-Auth/PKCE (§3),
Web Playback SDK (§5), UI-Zustände Login/Player (§6), `manifest`/`sw.js`/Icons (§7),
`config.js`, Pages-Workflow (§11).

## 2. Neue Dateien

| Datei | Inhalt |
|---|---|
| `web/index.html` | Minimalseite: „Scan starten“-Button, `<div id="reader">`, Ergebnisbereich |
| `web/app.js` | nur Scanner-Logik: Tap → `Html5Qrcode.start()` (Aufruf exakt wie Spec §4), `onScanSuccess` → String anzeigen. Keimzelle des späteren `app.js` (Spec §2) |
| `web/vendor/html5-qrcode.min.js` | vendored, gepinntes Release-Tag (bleibt für die PWA, Spec §1); Tag im `web/README.md` notieren |
| `app/zeitklang/serve.py` | Flask (Dep vorhanden): serviert `web/` statisch + SPA-Fallback (Spec §2), bindet `0.0.0.0:8080`, ermittelt die LAN-IPv4 und druckt die URL als ASCII-QR ins Terminal (`qrcode`-Dep ist vorhanden) |
| `app/zeitklang/cli.py` | Subcommand `serve` nach bestehendem Muster (`cmd_serve` + Parser-Eintrag) |
| `app/tests/test_serve.py` | 1 Test (Flask-Testclient): `GET /` liefert die index.html |

Kein `manifest`, kein `sw.js`, kein `config.js`, keine Icons — erst mit der vollen PWA.

Zum Binding: `0.0.0.0` ist gewollt — serve stellt nur statische, öffentliche Dateien
bereit (Dev-Werkzeug; Produktiv-Hosting bleibt Pages, §11). Nicht gleichzeitig mit
`zeitklang web` betreiben (beide Port 8080).

## 3. Ablauf beim Durchstich

1. `uv run zeitklang serve` → Terminal zeigt `http://<lan-ip>:8080` als QR-Code.
2. Handy-Kamera (native QR-Erkennung) scannt den Terminal-QR → Seite öffnet sich
   (alternativ URL eintippen).
3. Tap auf „Scan starten“ → Kamera-Freigabe → QR-Code einer gedruckten Karte aus
   `output/zeitklang-karten.pdf` scannen.
4. Der dekodierte String erscheint auf dem Handy: `https://open.spotify.com/track/<id>`.

## 4. Hauptrisiko: Kamera braucht einen sicheren Kontext

`getUserMedia` (Kamera via html5-qrcode) läuft nur unter HTTPS oder auf `localhost`
(Spec §4). `http://<lan-ip>:8080` ist beides nicht → die Kamera wird vom Browser
blockiert. Das ist der bekannte Stolperstein dieses Durchstichs; Lösungen je Gerät:

| Gerät | Lösung | Aufwand |
|---|---|---|
| Desktop (Vortest) | `http://localhost:8080` ist sicherer Kontext → Scan zuerst direkt am Mac testen | 0 min |
| Android Chrome | `chrome://flags/#unsafely-treat-insecure-origin-as-secure` → dort `http://<lan-ip>:8080` eintragen, Browser-Relaunch | 2 min |
| iOS Safari | kein Flag. (a) LAN-pur: `mkcert`-Zertifikat für die LAN-IP, CA aufs iPhone installieren (Profil + volle Vertrauensstellung), serve mit TLS starten; oder (b) `cloudflared tunnel --url http://localhost:8080` → echtes HTTPS ohne CA-Install | 5–10 min |

Fallback, falls die Kamera partout nicht will (beweist trotzdem den Dekodier-Pfad):
Foto des QR-Codes wählen und über `html5-qrcode.scanFile()` dekodieren —
Spike-Werkzeug, nicht Teil der PWA-Spec.

Einmalig beim ersten Start: macOS-Firewall fragt nach eingehenden Verbindungen für
Python → erlauben.

## 5. Akzeptanzkriterien

1. `zeitklang serve` läuft; das Smartphone öffnet die Seite über die LAN-URL.
2. Nach dem Tap startet die Kamera (Gerät gem. §4).
3. Der QR-Code einer gedruckten Karte wird dekodiert; der String
   `open.spotify.com/track/…` erscheint lesbar auf dem Handy-Display.
4. Fallback: Foto-Scan dekodiert denselben String.

Nicht geprüft (bewusst): Login, Wiedergabe, Offline-Fähigkeit, Installierbarkeit.

## 6. Aufwand

≈ 1–2 h inkl. Handy-Setup (§4).
