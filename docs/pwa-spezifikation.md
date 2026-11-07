# PWA-Spezifikation — Spotify-Login, QR-Scan, Wiedergabe (Web Playback SDK)

> **Status:** Spezifikation (noch kein Code). Ziel: kleinste PWA in `web/`, die
> a) sich bei Spotify anmeldet, b) die QR-Codes der bestehenden Karten scannt und
> c) den Song per Spotify Web Playback SDK abspielt.
> Recherche-Hintergrund: `docs/web-variante.md` Abschnitt 2.2. Verifiziert gegen die
> offizielle SDK-Doku (Stand 2026): [Overview](https://developer.spotify.com/documentation/web-playback-sdk),
> [Getting started](https://developer.spotify.com/documentation/web-playback-sdk/tutorials/getting-started),
> [HowTo „Web-App-Player"](https://developer.spotify.com/documentation/web-playback-sdk/howtos/web-app-player),
> [Referenz](https://developer.spotify.com/documentation/web-playback-sdk/reference).
> **Korrektur gegenüber `web-variante.md`:** iOS-Safari wird vom SDK inzwischen unterstützt — siehe §8.

## 1. Kurzentscheidungen

| Frage | Entscheidung |
|---|---|
| Wo liegt die App? | Statisch in `web/`, ausgeliefert per neuem CLI-Befehl `zeitklang serve` |
| Redirect-URIs | Lokal: `https://127.0.0.1:8080/callback` (`zeitklang serve` liefert seit dem Durchstich TLS via mkcert, Port 8080). Pages: `https://andreaswillems.github.io/zeitklang/` (Site-Root, siehe §11) — beide URIs in einer Spotify-App registriert |
| Auth-Flow | Authorization Code + **PKCE** (Public Client; ein Client Secret gibt es im Browser nicht) |
| Scopes | `streaming user-read-playback-state user-modify-playback-state user-read-private` |
| QR-Inhalt | unverändert `https://open.spotify.com/track/<id>` (wie `cards.py` heute druckt) — die PWA extrahiert die Track-ID per Regex, `cards.py` bleibt unangetastet |
| Scan-Mechanismus | [`html5-qrcode`](https://github.com/mebjas/html5-qrcode), vendored als `web/vendor/html5-qrcode.min.js` (Release-Tag pinnen) — läuft auch auf iOS-Safari, wo `BarcodeDetector` fehlt |
| Wiedergabe | Web Playback SDK (`sdk.scdn.co/spotify-player.js`) als Spotify-Connect-Gerät; Play über Web API `PUT /v1/me/player/play?device_id=…` |
| PWA-Shell | `manifest.webmanifest` + minimaler Service Worker (nur statische Assets, Cache-first; Navigationen immer network) |

## 2. Dateien

```
web/
├── index.html            # eine Seite, drei Zustände (siehe §6)
├── app.js                # Auth (PKCE) + Scan + Player
├── config.js             # clientId + redirectUri (committed, nur öffentliche Werte — §3)
├── manifest.webmanifest  # installierbar, display: standalone
├── sw.js                 # precacht die statischen Dateien
├── vendor/
│   └── html5-qrcode.min.js  # gepinnter Release-Tag, lokal vendored (SW precacht sie)
└── icons/
    ├── icon-192.png
    └── icon-512.png
```

Serverseitig: `app/zeitklang/serve.py` + CLI-Befehl `zeitklang serve` — Flask
(bereits Abhängigkeit): `send_from_directory(web/)`, jeder Nicht-Datei-Pfad liefert
`index.html` (SPA-Fallback, damit `/callback` vom JS behandelt werden kann), Port 8080.
Die bestehende Auth-Webapp (`zeitklang web`) bleibt unverändert für `fetch-playlist`.

Warum nicht `zeitklang web` erweitern: Der Web-Playback-Token gehört dem Browser
(PKCE-Public-Client). Der Server-Token in `.cache/spotify-token.json` ist ein anderer
Flow und darf nicht an den Browser weitergereicht werden.

## 3. Auth-Flow (a)

1. `config.js` ist committed und enthält nur öffentliche Werte (kein Secret):
   `clientId` und die `redirectUri`, gewählt anhand von `location.hostname` —
   `127.0.0.1`/`localhost` → `https://127.0.0.1:8080/callback` (serve stellt
   TLS bereit), sonst die Pages-Root-URL (§11).
2. Login-Button baut die Authorize-URL: `response_type=code`,
   `code_challenge = base64url(SHA-256(code_verifier))`; der `code_verifier`
   (64 zufällige Zeichen) liegt in `sessionStorage`, `state` zufällig gegen CSRF.
3. Spotify leitet zurück mit `?code=…&state=…` — lokal auf `/callback` (statischer
   Server liefert dafür `index.html`), auf Pages auf der Site-Root (Pages liefert dort
   direkt `index.html`, kein SPA-Fallback nötig). `app.js` wertet `location.search` auf
   `code`/`error` aus, egal welcher Pfad; `state` wird validiert; der Code wird per
   `POST https://accounts.spotify.com/api/token` (`grant_type=authorization_code` +
   `code_verifier`, ohne Secret) gegen die Token getauscht.
4. Speicherung: Access Token + `expires_at` in `sessionStorage`; Refresh Token in
   `localStorage` (siehe shortcut §8).
5. Beim Laden: gültiges Access Token → startklar; abgelaufen + Refresh Token vorhanden
   → `grant_type=refresh_token`; sonst Login-Button.
6. Logout löscht den Access Token (Session auf diesem Gerät) und ruft
   `player.disconnect()`; der Refresh Token bleibt gespeichert — Spotify stellt ihn
   nur bei neuer Zustimmung aus, Löschen würde das Auto-Login dauerhaft brechen.
   Ein ungültiger Refresh Token (HTTP 400) wird beim Laden verworfen.

## 4. QR-Scan (b)

- Bibliothek: `html5-qrcode` (vendored, siehe §2) — `new Html5Qrcode("reader")` +
  `start({ facingMode: "environment" }, { fps: 10, qrbox: 250 }, onSuccess, onError)`.
  Deckt iOS-Safari ab (dort fehlt `BarcodeDetector`); Kamera braucht HTTPS (Pages)
  oder `127.0.0.1` (lokal).
- Akzeptierte Inhalte: `https://open.spotify.com/track/<22-stellige-ID>…`,
  `spotify:track:<ID>` und vorsorglich die künftige Route `/play/<ID>` — ein Regex
  extrahiert die ID aus dem gescannten Text.
- Ergebnis: Track-ID → Wiedergabe (§5).

## 5. Wiedergabe (c)

1. SDK laden (`https://sdk.scdn.co/spotify-player.js`), Player im Callback
   `window.onSpotifyWebPlaybackSDKReady` erzeugen:
   `new Spotify.Player({ name: "Zeitklang PWA", getOAuthToken: cb => cb(accessToken), volume: 0.8 })`.
2. `ready`-Event liefert `device_id`; danach `player.connect()`. Fehler-Events abonnieren:
   `initialization_error`, `authentication_error`, `account_error` (u. a. „kein Premium").
3. Play: `PUT https://api.spotify.com/v1/me/player/play?device_id=<id>` mit
   `Authorization: Bearer <token>`, Body `{"uris": ["spotify:track:<id>"]}`
   (Scope `user-modify-playback-state` nötig).
4. Anzeige: `player_state_changed` → Titel/Künstler/Paused; Play/Pause-Button
   (`player.togglePlay()`). Nur der erste State nach einem angenommenen
   Play-Command wechselt zur Player-Ansicht — Pause-Events („Weitere Karte
   scannen") springen nicht zurück. Titel/Künstler liegen hinter einem Spoiler
   (`<details>`): Titel und Interpret dürfen nicht sofort sichtbar sein — Tippen
   deckt auf, ein neuer Play macht den Spoiler wieder zu.
5. iOS/mobile: beim Scan-Tap `player.activateElement()` aufrufen; nach dem Transfer
   startet die Wiedergabe auf iOS ggf. pausiert → Nutzer tippt Play (§8).
6. Fehler-Mapping (ein Fall pro Zeile): SDK `account_error` oder Web-API `412` →
   „Spotify Premium erforderlich"; `404` → „kein aktives Gerät — SDK verbinden";
   `403` → „fehlende Scopes — neu anmelden"; `401` → Token abgelaufen (Tokens laufen
   nach 1 h ab) → refreshen und wiederholen.

Voraussetzung, die dem Nutzer angezeigt wird: **Spotify Premium** — das Web Playback
SDK streamt ohne Premium nicht.

## 6. UI-Zustände (eine Seite `index.html`)

1. **Nicht angemeldet** → Login-Button.
2. **Angemeldet, nichts gescannt** → Kamera-Vorschau.
3. **Gescannt** → Track-ID + Play/Pause + Fehlermeldung, falls zutreffend.

## 7. PWA-Shell

- `manifest.webmanifest`: `start_url: "./"`, `display: "standalone"`, Name, Theme-Farbe,
  Icons 192 + 512.
- `sw.js`: precacht `./, index.html, style.css, app.js, config.js, manifest.webmanifest, vendor/html5-qrcode.min.js, icons/*`
  (Cache-Name mit Versionskonstante); Cache-first nur für diese Dateien, Navigationen
  und API-Calls gehen immer ans Netz. Registriert in `app.js`
  (`navigator.serviceWorker.register("sw.js")`).
- `web/config.js` ist committed (nur öffentliche Werte: Client-ID + Redirect-URIs); das
  Client Secret bleibt ausschließlich serverseitig in `.env`.

## 8. Bekannte Vereinfachungen (shortcuts)

- `shortcut:` Refresh Token in `localStorage` — Ceiling: bei XSS auslesbar; Nutzung nur
  privat auf dem eigenen Gerät. Upgrade: Token-Tausch serverseitig (Client Secret bleibt
  im Backend, z. B. `zeitklang serve` als Proxy).
  **Entscheidung (7. November 2026, Issue #81, Option a):** Restrisiko formal akzeptiert.
  Mitigation: Meta-CSP live (#78; `script-src 'self' https://sdk.scdn.co`, keine Inline-Scripts,
  kein 'unsafe-eval'), alle dynamischen Texte in `app.js` über `textContent` (keine
  XSS-Sinks im App-Code), Nutzung rein privat auf dem eigenen Gerät (Risiko-Owner:
  Andreas). Alternativen (b) sessionStorage (Auto-Login nur pro Session) und
  (c) Re-Login-Kadenz bewusst abgelehnt — UX-Einbuße bzw. Aufwand ohne nennenswerten
  Gewinn.
- `shortcut:` QR-Codes bleiben `open.spotify.com/track/…` — Ceiling: Scannen öffnet
  nicht direkt die PWA. Upgrade: `cards.py` druckt künftig `…/play/<id>` (Route der PWA).
- `shortcut:` Service Worker cacht nur die Shell, keine Audiodaten — Ceiling: Wiedergabe
  braucht immer Netz (Streaming läuft ohnehin serverseitig).
- **Plattformlimit (kein shortcut, Stand 2026):** iOS-Safari wird vom SDK inzwischen
  unterstützt (offizielle Overview: Chrome/Firefox/Safari/Edge, mobil inkl. iOS), aber
  „playback does not start automatically after transferring playback" — nach unserem
  Web-API-Play startet die Wiedergabe auf iOS ggf. pausiert. Workaround in §5.5
  (`activateElement()` beim Tap + Play/Pause-Button). Ceiling: auf iOS evtl. ein
  zusätzlicher Tap nötig; kein Upgrade nötig. SDK v1.10 meldet den Autoplay-Block
  des Browsers als eigenes Event `autoplay_failed` (in `app.js` bewusst unbeachtet —
  `activateElement()` beim Tap löst das, §5.5). `authentication_error` feuert zudem
  spurisch beim Connect („Invalid token scopes."), obwohl `ready` nachkommt —
  `app.js` zeigt den Hinweis deshalb erst, wenn nicht binnen 3 s `ready` folgt,
  und räumt ihn beim `ready` wieder ab.

## 9. Out of Scope (YAGNI — bewusst nicht in dieser PWA)

- Spiellogik (Timeline, Platzieren, Punkte) und Multiplayer/Lobby → `docs/web-variante.md`.
- Playlist-Verwaltung in der PWA (weiterhin `zeitklang fetch-playlist`).
- Offline-Wiedergabe, Push-Benachrichtigungen, mehrere Geräte gleichzeitig.

## 10. Abnahmekriterien (manueller Smoke-Test)

1. `uv run zeitklang serve` → `http://127.0.0.1:8080` öffnet die PWA.
2. Login-Button → Spotify-Consent (Scopes aus §1) → zurück auf `/`, „angemeldet".
3. QR-Code einer Karte aus `output/zeitklang-karten.pdf` scannen →
   Song spielt über das Web Playback SDK (Premium-Account).
4. Seiten-Reload → dank Refresh Token ohne erneuten Login startklar.
5. Ohne Premium: Scan → Play → lesbare Meldung „Premium erforderlich".
6. PWA installierbar (Manifest + Icons + SW aktiv; `127.0.0.1` gilt als sicherer Kontext).
7. Nach Merge auf `main`: `https://andreaswillems.github.io/zeitklang/` lädt die PWA per HTTPS
   (Pages), Login mit der Pages-Redirect-URI funktioniert, Scan + Play wie lokal.
8. iOS-Safari (Pages-URL): Login + QR-Scan (`html5-qrcode`) + Wiedergabe funktionieren;
   ggf. nach dem Scan ein Tap auf Play nötig (§8).

## 11. Hosting auf GitHub Pages (HTTPS)

Ziel: die statische PWA unter `https://andreaswillems.github.io/zeitklang/` — HTTPS automatisch,
damit sicherer Kontext (Kamera + Service Worker) gegeben ist.

1. **Workflow** `.github/workflows/pages.yml` — deployed `web/` bei jedem Push auf `main`:

   ```yaml
   name: Deploy PWA to Pages
   on:
     push:
       branches: [main]
   permissions:
     contents: read
     pages: write
     id-token: write
   concurrency:
     group: pages
     cancel-in-progress: true
   jobs:
     deploy:
       environment:
         name: github-pages
         url: ${{ steps.deployment.outputs.page_url }}
       runs-on: ubuntu-latest
       steps:
         - uses: actions/checkout@v4
         - uses: actions/upload-pages-artifact@v3
           with:
             path: ./web
         - id: deployment
           uses: actions/deploy-pages@v4
   ```

   Einmalig im Repo: Settings → Pages → Source: „GitHub Actions".
2. **Redirect-URI**: `https://andreaswillems.github.io/zeitklang/` zusätzlich im Spotify-Dashboard
   registrieren. Spotify hängt `?code=…` an die Root-URL an; Pages liefert dafür direkt
   `index.html` — `app.js` fängt den Code dort ab (siehe §3).
3. **Base-Pfad**: Projekt-Pages liegen unter `/<repo>/` — deshalb überall relative Pfade
   (`start_url: "./"`, `register("./sw.js")`, Precache `./…`).

Alternative GitLab Pages: `.gitlab-ci.yml` mit `pages:` und `public: web/`;
Redirect-URI analog `https://<user>.gitlab.io/<repo>/`.
