# Web-App (PWA) — Platzhalter

Hier entsteht die zukünftige **PWA**, mit der die QR-Codes der Karten gescannt und die verlinkten Songs abgespielt werden.

**Spezifikation (verbindlich): `docs/pwa-spezifikation.md`** — Spotify-Login (OAuth + PKCE), QR-Scan (`html5-qrcode`), Wiedergabe per Web Playback SDK. Konzept-Hintergrund: `docs/web-variante.md`.

**Umgesetzt:** Durchstich (LAN-Hosting + QR-Scan), Spotify-Login (§3) und Wiedergabe per Web Playback SDK (§5). Offen: PWA-Shell (§7) und Hosting auf GitHub Pages (§11).

Dateien laut Spezifikation (alles statisch; lokal via `zeitklang serve` auf Port 8080, produktiv via GitHub Pages: https://andreaswillems.github.io/zeitklang/ — Spezifikation §11):

```
web/
├── index.html            # eine Seite: Login / Kamera-Scan / Player
├── app.js                # Auth (PKCE) + Scan + Web-Playback-SDK
├── config.js             # clientId + redirectUri (committed, nur öffentliche Werte)
├── manifest.webmanifest  # PWA-Manifest (installierbar, standalone)
├── sw.js                 # Service Worker (Cache nur für statische Assets)
├── vendor/               # html5-qrcode, lokal vendored
│   └── html5-qrcode.min.js  # gepinnt auf Release-Tag v2.3.8
└── icons/                # PWA-Icons (192 + 512)
```

MVP laut Spezifikation: Die QR-Codes auf den Karten bleiben `open.spotify.com/track/<id>` (wie `cards.py` druckt); die PWA extrahiert die Track-ID selbst. Die künftige Route `/play/<spotify_id>` (damit Scannen direkt die PWA öffnet) ist optionaler Ausbau.

Bis dahin dient `app/zeitklang/auth/` als schlanke Spotify-Auth-Webapp (`zeitklang web`, Port 8080).
