# Zeitklang Web-App (PWA)

Scanner-Player als PWA: QR-Codes auf den physischen Kärtchen scannen, der verlinkte Song spielt auf dem Handy; Titel und Interpret bleiben hinter einem Blur-Spoiler versteckt.

- **Live:** https://andreaswillems.github.io/zeitklang/
- **Spezifikation (verbindlich):** [`docs/pwa-spezifikation.md`](../docs/pwa-spezifikation.md), Konzept-Hintergrund: [`docs/web-variante.md`](../docs/web-variante.md)
- **Voraussetzung:** Spotify Premium (Web Playback SDK)
- **Backlog & Projektstand:** [GitHub-Issues](https://github.com/andreaswillems/zeitklang/issues) (verbindliche Quelle)

## Technik

Statische PWA **ohne Build-Schritt**; Deploy über GitHub Pages (Actions-Workflow, automatisch bei Push auf `main`). Spotify-OAuth mit PKCE, Wiedergabe per Web Playback SDK, QR-Scan per `html5-qrcode`. Dunkles Theme mit blauem Akzent, mobil zuerst, Haupt-Buttons in der Daumenzone (iOS-Safe-Areas beachtet).

```
web/
├── index.html            # eine Seite: Login / Ladezustand / Scan (Player als Bottom-Sheet)
├── style.css             # dunkles Theme, mobil zuerst
├── app.js                # Auth (PKCE) + Scan + Web-Playback-SDK + Sheet-/Mini-Player-Logik
├── config.js             # clientId + redirectUri (committed, nur öffentliche Werte)
├── manifest.webmanifest  # PWA-Manifest (installierbar, standalone)
├── sw.js                 # Service Worker (App-Shell offline, Navigation network-first)
├── icon.png              # Favicon
├── vendor/               # html5-qrcode, lokal vendored
│   └── html5-qrcode.min.js  # gepinnt auf Release-Tag v2.3.8
└── icons/                # PWA-Icons (192, 512, maskable-512)
```

## Umsetzungsstand (7. November 2026)

**Login**
- Spotify-Branding: grüner Login-Button mit Logo, zentrierte Wortmarke mit animiertem Farbverlauf, Equalizer-Deko, Premium-Badge
- Login-Button fix unten in der Daumenzone
- Weiterleitungszustand „Weiterleitung zu Spotify…“ mit Doppeltipp-Schutz, Fehlerbereich mit „Erneut versuchen“, gezielte Meldungen (u. a. fehlendes Premium)
- Ladezustand nach dem Spotify-Redirect („Anmeldung läuft…“) statt leerem Screen

**Scan**
- Kontinuierlicher Scanner: Kamera bleibt zwischen den Karten an, Dubletten-Guard (5-s-Cooldown) hält Frame-Wiederholungen derselben Karte fern
- „Scannen“-Button in der Daumenzone (QR-Icon); Torch- und Stopp-Overlay über dem Kamerabild
- Vibrations-Feedback bei Scan-Erfolg; Meldungen nur noch im Fehlerfall
- Track-Queue: Ein Scan vor fertig verbundener Wiedergabe wird automatisch nachgeholt
- Onboarding-Kurzanleitung („So funktioniert's“) bei gestopptem Scanner

**Player**
- Mini-Player-Leiste fix am unteren Rand (Now-Playing, Play/Pause, Spoiler-Blur synchron)
- Player als **Bottom-Sheet über dem Scanner**; Chevron oder Tap auf den abgedunkelten Bereich schließt, ein neuer Scan ebenfalls
- Spoiler folgt dem Sheet: geöffnet = enthüllt (Cover wächst per Transition auf volle Kartenbreite), geschlossen = verblurt
- Abmelden als Icon-Button oben rechts

**PWA**
- Service Worker: App-Shell offline verfügbar (Flugmodus), Navigationen network-first, Updates still aktiv
- Installationshinweis auf Android/Desktop-Chrome (`beforeinstallprompt`, Ghost-Buttons in Login und Guide-Karte)
- Meta-/Open-Graph-Tags für Link-Vorschauen

**Offen im Backlog:** #10 (Fehlermeldungen final formulieren). Eine Quiz-Funktion oder ähnliche Spielmechanik ist vorerst nicht geplant.

## Hinweise für die Entwicklung

- **Lokal:** `zeitklang serve` (Port 8080) oder ein beliebiger statischer Server für `web/`.
- **OAuth-Endpunkte (Konstanten in `app.js`):** Authorisierung `https://accounts.spotify.com/authorize`, Token-Austausch `https://accounts.spotify.com/api/token`, Play-Command `https://api.spotify.com/v1/me/player/play`. Achtung: Der Token-Austausch läuft ausschließlich über `accounts.spotify.com/api/token`; `api.spotify.com/api/token` existiert nicht.
- **Relative Pfade überall** wegen der `/zeitklang/`-Base unter GitHub Pages (Spezifikation §11).
- **Service Worker:** Bei jeder Änderung an `web/`-Dateien `CACHE_VERSION` in `sw.js` bumpen; sonst bleibt der alte Stand im Cache hängen (Cleanup in `activate` entsorgt alte Versionen).
- Die QR-Codes auf den Kärtchen bleiben `open.spotify.com/track/<id>` (wie `cards.py` sie druckt); die PWA extrahiert die Track-ID selbst. Die Route `/play/<spotify_id>` ist optionaler Ausbau.
