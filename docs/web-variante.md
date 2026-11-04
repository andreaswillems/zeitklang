# Web-Variante — Digitale, verteilte Web-Variante des Spiels

> **Status:** Recherche- und Entscheidungsvorlage (kein implementierter Code).
> **Datum der Recherche:** 24.10.2026. Alle sachlichen Aussagen sind mit Primärquellen (offizielle Dokumentationen, First-Party-APIs, offizielle Terms) belegt; Quellenverweise in eckigen Klammern `[n]`, Auflösung im [Quellenverzeichnis](#quellenverzeichnis) am Ende.
> **Forschungsfrage:** „Kann ich anstelle der physischen Variante auch eine digitale, verteilte Web-Variante des Spiels erzeugen?"

---

## 1. Kurzfazit (TL;DR)

**Ja, technisch ist das gut machbar — und der bestehende Python-Stack passt dafür sehr gut.** Die pragmatischste Variante ist:

- **Wiedergabe:** Spotify-**Embeds** (iframe, ohne App-Registrierung, ohne Login, ohne Premium). Nicht eingeloggte Spieler hören eine **30-Sekunden-Vorschau** — das reicht fürs „Song anhören und einordnen"-Gameplay. Volle Tracks wären nur über das Web Playback SDK möglich, das aber **für jeden Spieler einen eigenen Spotify-Premium-Account + OAuth-Login** erfordert [1][3][6][10] — für ein Partyspiel mit beliebigen Spielern unpraktisch.
- **Multiplayer:** **FastAPI + native WebSockets** (server-autoritativer Spielzustand) mit **Raum-Code-Lobby** nach dem bewährten Jackbox-Muster [13][14][15]. Optional `python-socketio` für Socket.IO-Features (Auto-Reconnect, Rooms) [16].
- **Wiederverwendung:** `data/songs.json` (117 Songs inkl. `spotify_url`/`spotify_id`) ist direkt weiterverwendbar; `preview_url` ist obsolet (Spotify-Deprecation seit 27.11.2024) [8]. `app/zeitklang/cards.py` bleibt für die physische Variante parallel bestehen.
- **Wichtigste Einschränkung (rechtlich):** Die Spotify Developer Policy sagt ausdrücklich **„Do not create a game, including trivia quizzes"** [4], und die Widget Terms verbieten die Einbettung von Spotify-Content in Spielfunktionalität ohne schriftliche Zustimmung [5]. Für ein **rein privates Spiel unter Freunden** ist das ein bewusst einzugehendes Restrisiko; für **öffentliche/kommerzielle** Nutzung bräuchte es Spottys schriftliche Zustimmung. Auch Apples iTunes-Previews sind laut Apple-Terms nur zur Promotion, „not for entertainment purposes" gedacht [7]. Details in Abschnitt 6.

**Empfohlener Weg (MVP):** „Spotify-Embed-Previews + FastAPI/WebSocket-Lobby" — siehe Abschnitt 7.

---

## 2. Musikwiedergabe im Browser — die Optionen

### 2.1 Spotify Embeds / oEmbed (iframe) — *empfohlene Basis*

Embeds sind iframes, die Spotify-Content (Tracks, Alben, Playlists, Podcasts, Künstler) direkt auf der eigenen Website abspielbar machen [2]. Drei Integrationswege laut offizieller Doku [2]:

1. Fertiges iframe-HTML (aus dem Spotify-Client kopieren oder direkt konstruiert: `https://open.spotify.com/embed/track/{id}`),
2. **iFrame API** (`createController`, `loadEntity`, `play`, `pause`, `seek` — dynamisches Laden und Steuern von Embeds per JavaScript) [10],
3. **oEmbed API** (`https://open.spotify.com/oembed?url=…`) — liefert für eine Spotify-URL das fertige iframe-HTML plus Metadaten (Titel, Cover) [9].

**Zentrale Eigenschaften (mit Beleg):**

| Eigenschaft | Aussage | Quelle |
|---|---|---|
| Auth nötig? | **Nein.** Der oEmbed-Endpoint verlangt keine Authentifizierung; die Referenz definiert nur den `url`-Parameter. **Live-Test am 24.10.2026:** `https://open.spotify.com/oembed?url=…` (Track aus `data/songs.json`, „Fixation on the Darkness") lieferte ohne Token das iframe-HTML | [9] + eigener Test |
| Premium nötig? | Nein. Spotifys Developer Policy stellt Widgets und Audio Preview Clips ausdrücklich auch Nutzern ohne Premium zur Verfügung („Widgets and Audio Preview Clips may be made available to Spotify users who do not subscribe to the Premium service") | [4, §IV.1] |
| Was wird gespielt? | In unterstützten Browsern (Chrome, Firefox, Edge, Opera, Safari) streamen Embeds **vollständige Songs und Episoden**, sofern das iframe `allow="encrypted-media"` enthält; andernfalls „only stream a preview" (< 30 s) | [11] |
| 30-s-Previews | Spotify-Staff im offiziellen Developer-Community-Forum: Für **nicht eingeloggte** Nutzer spielt der Play Button eine **30-Sekunden-Vorschau** (nicht eingeloggte/free Nutzer ohne volle Wiedergaberechte); „In the cases where full track playback is not supported, we will play 30 second preview clips" | [6] (Community-Beleg, Zusatz zur Doku [11]) |
| Steuerbarkeit | iFrame API kann `play()`/`pause()`/`seek()` aufrufen — **aber:** „The iFrame API's `play` method, which starts playback of the Embed player without user interaction, might not be supported in all browsers and for all users. For instance, Safari blocks autoplay without user interaction." → Jeder Spieler muss die Wiedergabe selbst per Klick starten | [10] |
| Content-Typen | Tracks, Alben, Playlists, Episoden, Shows, Künstler; oEmbed akzeptiert „Spotify podcast show, episode, artist, album or track"-URLs | [2][9] |

**Bewertung für das Spiel:** Perfekte Basis. Kein API-Key, kein Login, kein Premium für die Spieler; die `spotify_id`s aus `data/songs.json` lassen sich direkt in Embed-URLs verwandeln (`open.spotify.com/embed/track/{spotify_id}`). Die 30-Sekunden-Vorschau genügt fürs Gameplay (Jahr einordnen — *Design-Urteil des Projekts, kein Fakt*). Einziger HTTP-Aufwand: oEmbed-Fetch (optional) bzw. reines iframe-Konstruieren im Frontend.

### 2.2 Spotify Web Playback SDK — *technisch möglich, aber für dieses Spiel unpraktisch*

Das Web Playback SDK ist eine client-seitige JavaScript-Bibliothek, die im Browser ein Spotify-Connect-Gerät erzeugt und echtes Streaming ermöglicht [1]. Restriktionen laut offizieller Doku:

- **Premium-Pflicht:** „The Web Playback SDK requires a Spotify Premium subscription (mobile only types of premium subscriptions are excluded)" [1].
- **Eigener Token pro Spieler:** „The Web Playback SDK needs an access token from your personal Spotify Premium account" [3]. Für ein Multiplayer-Spiel mit beliebigen Spielern hieße das: **jeder Spieler** müsste sich per OAuth mit **seinem eigenen Premium-Account** in der App authentifizieren. Partygäste ohne Premium fallen aus.
- **Keine kommerzielle Nutzung:** „This SDK must not be used in commercial projects without Spotify's prior written approval" [1]; „Streaming applications may not be commercial" [3].
- **iOS-Einschränkung:** „The playback does not start automatically after transferring playback. The user must interact with the SDK events to play audio" [1].

**Bewertung:** Nur sinnvoll, wenn alle Spieler garantiert Premium haben (z. B. enger Freundeskreis mit Vollständigkeit). Für „beliebige Spieler" (Kern der Frage) ungeeignet. Als Aufbaustufe denkbar, aber kein MVP.

### 2.3 Spotify Web API `preview_url` — *entfallen*

Bis November 2024 lieferte die Web API direkte 30-Sekunden-Preview-URLs pro Track. Spotify hat das für neue Apps abgeschafft — offizielles Announcement (27.11.2024): „new Web API use cases will no longer be able to access or use the following endpoints and functionality […], 7. **30-second preview URLs** (SimpleTrack object), 8. Algorithmic and Spotify-owned editorial playlists"; betroffen sind „Existing apps that are still in development mode […] New apps that are registered on or after today's date" [8]. Das erklärt sowohl das `403` auf Playlist-Items (siehe `docs/workflow.md`, Abschnitt „Bekannte Einschränkungen") als auch das Feld `preview_url: null` in unserer `data/songs.json`.

**Konsequenz:** Das `preview_url`-Feld in `data/songs.json`/`app/zeitklang/spotify_client.py` ist tot und sollte für die Web-Variante ignoriert werden (Feld kann drinbleiben). Vorschau-Wiedergabe läuft über Embeds, nicht über die Web API.

### 2.4 Apple iTunes Search API — *technisch attraktiv, rechtlich eng*

Die offizielle iTunes Search API (Apple Services Performance Partner Program) liefert ohne Authentifizierung Track-Metadaten inkl. `previewUrl` — laut Doku „A URL referencing the **30-second preview file** for the content" [7]. Praktische Einschränkungen:

- **Rate Limit:** „The Search API is limited to approximately 20 calls per minute (subject to change)" [7]. Für ein Spiel, das pro Runde 1–3 Songs sucht, unkritisch — v. a. weil sich Results cachen lassen.
- **Rechtliche Bindung (Apple-Legal, wörtlich):** „Developers may use promotional content in the API, including previews of songs, music videos, album art and App icons **only to promote store content and not for entertainment purposes**." Und genauer: Previews dürfen nur (i) auf Seiten platziert werden, die den beworbenen Content promoten, (ii) in der Nähe eines „Download on iTunes"-Badges, (iii) mit Attribution „provided courtesy of iTunes", (iv) nur gestreamt (nicht heruntergeladen/gespeichert), (v) **„not used for independent entertainment value apart from its promotional purpose"**, (vi) nicht zur Bewerbung anderer Waren/Dienste [7].

**Bewertung:** Technisch die einfachste Preview-Quelle (kein Auth, stabile URLs, CDN-Hosted). Aber ein Musik-Quiz ist per Definition „entertainment purpose / independent entertainment value" — die Apple-Terms decken diese Nutzung **nicht** ab. Allenfalls als private Grauzonen-Fallback-Lösung realistisch; für die Dokumentation: nicht terminkonform [7].

### 2.5 Deezer API — *funktioniert, Doku/Terms prüfungsbedürftig*

- **Live-Test am 24.10.2026:** `https://api.deezer.com/search?q=…` antwortet **ohne Authentifizierung** mit Track-Objekten, die ein `preview`-Feld mit einer **30-Sekunden-MP3-URL** enthalten (CDN `cdnt-preview.dzcdn.net`). Die URLs sind **signiert und zeitlich begrenzt** (`hdnea=exp=…`-Parameter, im Test ~30 Tage Gültigkeit) → Previews müssen zur Spielzeit frisch abgerufen, nicht dauerhaft in `data/songs.json` gespeichert werden. (Ergebnis des eigenen First-Party-API-Tests; Deezer-API-Endpunkte sind öffentlich erreichbar.)
- **Doku-Zugang:** Die offizielle Entwickler-Dokumentation (developers.deezer.com, inkl. API-Guidelines und Terms of Use) ist **hinter einem Deezer-Login mit akzeptierten Terms of Use versteckt** — ein Abruf ohne Konto war bei der Recherche nicht möglich (explizit vermerkt: Quelle [12] nicht öffentlich einsehbar). Die genauen Nutzungsbedingungen für Previews (Verbot von Entertainment-/Spielnutzung o. Ä.) **müssen vor einem Produktionseinsatz nach Login geprüft werden**.

**Bewertung:** Technisch gangbar (30-s-Previews ohne Auth), aber rechtlich nicht bewertbar ohne Einsicht in die login-gesteuerten Deezer-Terms. Für das MVP nicht nötig.

### 2.6 Vergleichstabelle Wiedergabe-Optionen

| Option | Auth/Account nötig? | Was wird abgespielt? | Aufwand | Wichtigste Einschränkung | Lizenz/Quelle |
|---|---|---|---|---|---|
| **Spotify Embed (iframe/oEmbed/iFrame API)** | Keiner | 30-s-Preview (nicht eingeloggt) bzw. voller Track (eingeloggt, unterstützter Browser) | **Gering** — iframe bauen, fertig | Autoplay braucht User-Klick (Safari) [10]; nicht kommerziell nutzbar (Widget Terms) [5] | Widget Terms [5], Embeds-Doku [2] |
| **Spotify Web Playback SDK** | Premium + eigener OAuth-Token **pro Spieler** [1][3] | Voller Track (Streaming) | Hoch (OAuth-Frontend je Spieler) | Premium-Pflicht, kein Kommerz, iOS-Autoplay [1][3] | Developer Terms/Policy [4] |
| **Spotify Web API `preview_url`** | Client-Credentials | 30-s-Preview | — | **Deprecation seit 27.11.2024 für neue/Dev-Mode-Apps** [8] | Spotify-Blog [8] |
| **Apple iTunes Search API** | Keiner | 30-s-Preview (`previewUrl`) [7] | Gering | ~20 Calls/min [7]; laut Apple-Terms **nur Promotion, „not for entertainment purposes"** [7] | Apple Legal [7] |
| **Deezer API** | Keiner (öffentliche Endpunkte; Doku erfordert Login) | 30-s-Preview (signiert, ablaufend) | Gering–mittel | Deezer-Terms/Guidelines login-gated, ungeprüft [12]; Previews müssen frisch geholt werden | Deezer [12] |

**Zwischenfazit Wiedergabe:** Für ein „Song anhören und einordnen"-Spiel sind 30-Sekunden-Proben ausreichend (*Design-Urteil*; die Identifikation eines Songs/jahres gelingt in der Regel in den ersten Sekunden). Damit ist der Spotify-Embed die Option mit dem kleinsten Aufwand und den wenigsten Spieler-Voraussetzungen. Kritisch ist allein der Policy-Layer (Abschnitt 6), der **alle drei Content-Quellen** betrifft.

---

## 3. Verteiltes Multiplayer — bewährte Muster

### 3.1 Raum-Code-Lobby (Referenzmuster Jackbox)

Das etablierte Partyspiel-Muster: **Ein Host-Gerät zeigt die Lobby, Spieler joiningen von ihren eigenen Geräten über einen Raum-Code.** Offizielle Jackbox-Anleitung: „Players can join the lobby room by visiting jackbox.tv using the room code on the host's screen. If you're playing in person, the host screen should be visible to the whole room. If you're playing remote, the host can use a screen sharing app like Discord or Zoom." Und: „Use phones as controllers" [13]. Jackbox.tv selbst ist nichts anderes als die Web-Controller-Seite, auf der Raum-Code + Name eingegeben werden [14].

**Übertrag auf unser Spiel:** `POST /lobby` → 4–5-stelliger Raum-Code (z. B. `AB3F7`); Spieler öffnen `https://<host>/room/AB3F7`, Name eingeben, fertig. Das ersetzt QR-Code-Scannen durch URL-Eingeben/QR-Link.

### 3.2 Server-autoritativer Spielzustand + WebSocket-Synchronisation

- **WebSockets** sind der Browser-Standard für Echtzeit-Bidirektional-Kommunikation: „The WebSocket API makes it possible to open a two-way interactive communication session between the user's browser and a server. With this API, you can send messages to a server and receive responses without having to poll the server for a reply." [15]. Für Spielzustand (wer hat platziert, Punkte, nächste Runde) ist genau das nötig — Polling wäre eine schlechtere Alternative (Latenz, Last), **WebRTC** (P2P) ist für ein autoritatives Spielmodell ungeeignet, weil man einen zentralen Schiedsrichter für Validierung und Punktzählung will; WebRTC löst Transport, keine Autorität.
- **FastAPI hat natives WebSocket-Support** (`@app.websocket("/ws")`, `websocket.accept()`, `receive_text`/`send_text`, binär/JSON möglich) und zeigt in der offiziellen Doku genau das benötigte Muster: ein `ConnectionManager` mit `connect`/`disconnect`/`send_personal_message`/`broadcast`, Behandlung von `WebSocketDisconnect`, und der Hinweis, dass In-Memory-Verwaltung nur für **einen Prozess** funktioniert („as everything is handled in memory […] it will only work while the process is running, and will only work with a single process") — für mehr Robustheit wird `encode/broadcaster` (Redis/Postgres-Backend) empfohlen [15a]. 
- **Socket.IO-Rooms** sind dasraumweise Broadcast-Muster: „A room is an arbitrary channel that sockets can join and leave. It can be used to broadcast events to a subset of clients" — `socket.join("room")`, `io.to("room").emit(...)`; Rooms sind ein rein serverseitiges Konzept, Multi-Server-Setups brauchen den Redis-Adapter [16]. Wer Socket.IO statt roher WebSockets will, kann in Python **`python-socketio`** nutzen: offiziell unterstützt es „Broadcasting of messages to all connected clients, or to subsets of them assigned to 'rooms'", Auto-Reconnect, optionale Multi-Server-Anbindung „through a messaging queue such as Redis", und die Integration „with […] FastAPI […] asyncio applications" [17].

**Zwei Spielmodi, beide mit demselben Backend:**

1. **„Jackbox-Modus" (einfachst):** Host-Bildschirm (Laptop/TV) spielt den Song via Embed/WEB-SDK; Spieler-Geräte sind reine Controller (platzieren, raten). Remote-Spielen via Screenshare [13]. Geringste Sync-Komplexität.
2. **„Dezentraler Modus":** Jeder Spieler hört auf seinem eigenen Gerät (Spotify-Embed, 30-s-Preview genügt). Der Server kann den Play-Start **nicht** remote erzwingen (Autoplay-Policies: „Safari blocks autoplay without user interaction" [10]) — stattdessen sendet der Server „neue Karte aktiv"-Events, und jeder Spieler startet die Wiedergabe durch eigenen Klick. Für ein zeitversetztes Quiz ohne Reaktionszeit-Wettbewerb akzeptabel.

### 3.3 Architektur-Empfehlung (passend zum Python-Stack)

**Empfehlung: FastAPI + native WebSockets, kein Socket.IO im MVP.**

- Begründung: FastAPI deckt HTTP-Endpunkte (Lobby-Erstellung, Songdaten) und WebSockets in **einem** Framework ab [15a]; die offizielle Doku enthält ein nahezu 1:1 wiederverwendbares Lobby/Chat-Beispiel (`ConnectionManager`, `broadcast`) [15a]. Socket.IO/python-socketio lohnt sich erst, wenn man Auto-Reconnect, Event-Acknowledgements oder Multi-Server-Scalierung via Redis-Adapter braucht [16][17].
- **Spielzustand server-autoritativ:** Server hält pro Raum: Deck (gemischte Songs aus `data/songs.json`), aktuelle Karte, Reihenfolge-Validierung (korrekte chronologische Position = `release_year`-Vergleich), Punktestände, Rundenzustand. Clients senden nur Aktionen (`place_card`, `guess_year`), Server validiert und broadcastet den Zustand.
- **Hosting:** FastAPI-Doku „Deployments Concepts" nennt als Werkzeuge Uvicorn (mit `--workers`), Docker/Containers, Systemd/Supervisor und Cloud-Provider; für TLS empfehlen die Docs Traefik oder Caddy als Termination-Proxy mit automatischer Zertifikats-Erneuerung [18]. Für ein privates Spiel reicht ein kleiner VPS/Container (z. B. 1 Uvicorn-Prozess — In-Memory-Rooms funktionieren dann zuverlässig [15a]); für verteilte Spieler zwingend HTTPS (WSS), da autoplay-/media-Policies der Browser und Spotify-Embeds auf sicheren Kontext angewiesen sind (Embeds nutzen `encrypted-media` [11]).

---

## 4. Wiederverwendung bestehender Assets

| Bestand | Status für Web-Variante | Anmerkung |
|---|---|---|
| **`data/songs.json`** (117 Songs; Titel, Künstler, `release_year`, `spotify_url`, `spotify_id`, Album, Discogs-ID) | ✅ **1:1 weiterverwendbar** | Der zentrale Datenschatz. `spotify_id` ist der Schlüssel für Embed-URLs (`open.spotify.com/embed/track/{id}`) [2][9]. Das Feld `preview_url` ist durchweg `null` (Deprecation [8]) und wird nicht mehr gebraucht. |
| **`app/zeitklang/spotify_client.py`** | ✅ bleibt (legacy) für Datenerhebung | `search_tracks()` liefert weiterhin Metadaten + `spotify_url`/`spotify_id` (nur eben keine Preview-URLs mehr) [8]. `Song`-Modell muss `preview_url` nicht mehr pflegen. |
| **`app/zeitklang/discogs.py`** | ✅ bleibt für neue Playlists/Genres | Workflow (Discogs fürs Jahr, Spotify für die IDs) unverändert — die Web-Variante konsumiert nur das Ergebnis. |
| **`app/zeitklang/cards.py` + `output/zeitklang-karten.pdf`** | ✅ bleibt parallel bestehen | Physische Variante (QR-Codes) wird nicht ersetzt — physisch und digital können dasselbe `data/songs.json` teilen. |
| **`app/zeitklang/auth/app.py`** | ⚠️ begrenzt | Nur Auth-Helfer (Legacy); in der Embed-Variante wird keine Spotify-App-Registrierung und kein OAuth mehr fürs Gameplay gebraucht (oEmbed ohne Auth [9]). Die PWA selbst liegt künftig in `web/` (Top-Level, statisch). |
| **Neu zu bauen** | 🆕 | 1) `game_server.py` (FastAPI: Lobby/Raum-Codes, WebSocket-Manager, Spiellogik: Mischen, Karten-Zug, Reihenfolge-Validierung, Punkte, Broadcasts). 2) Frontend (statisches HTML/JS oder Mini-Framework): Lobby-Screen mit Raum-Code, Spieler-Ansicht mit Spotify-Embed [10] + Drag&Drop-Timeline, Host-Scoreboard. 3) Optional: Docker-Deployment [18]. |

**Hinweis zu Spotify-Datenhaltung:** Die Developer Terms erlauben das Speichern von Spotify-Content nur, „other than as strictly necessary to operate your SDA", und verlangen: „Do not store Spotify Content indefinitely" [19, §IV.3.1.a.i]. Die Metadaten in `data/songs.json` (Titel/Künstler/Jahr/URL) sind für den Spielbetrieb erforderlich — das Feld sollte aber nicht als „auf ewig abgeschlossene Kopie" verstanden, sondern bei Bedarf aktualisiert werden; das deckt sich mit dem bestehenden Workflow.

---

## 5. Rechtliche und Policy-Einschränkungen (Kurzfassung)

> ⚠️ **Kein Rechtsrat.** Dies ist eine Zusammenfassung der Primärquellen. Für eine verbindliche Bewertung (insbesondere bei Veröffentlichung/Monetarisierung) ist anwaltliche Prüfung nötig.

1. **Spotify-Spiele-Verbot (kritischster Punkt):** Developer Policy §III: „**Do not create a game, including trivia quizzes.**" [4]. Und die Widget Terms §IV.2.d (die ausdrücklich für Embeds/Play Button gelten): „**Games and Trivia Quizzes.** Unless you receive Spotify's written approval, you may not use the Spotify Platform to incorporate Spotify Content into any game functionality (including trivia quizzes)." [5]. Ein Musik-Quiz mit eingebetteten Spotify-Playern fällt dem Worte nach unter beide Klauseln. *Einordnung:* Die physische Variante (QR-Code → Link auf `open.spotify.com`) bewegt sich in einer Grauzone (Weiterleiten, kein Einbetten von Content in Spielfunktionalität); die Embed-Variante mit integriertem Player liegt näher am Klauselwortlaut. Für ein **nicht veröffentlichtes, privates Hobbyprojekt** ist das ein abwägbares Restrisiko; jede **öffentliche Bereitstellung** würde dagegen verstoßen, solange keine schriftliche Zustimmung von Spotify vorliegt.
2. **Premium-/Streaming-Regeln:** Streaming (Web Playback SDK) nur für Premium-Abonnenten; Widgets und Audio Preview Clips dagegen auch für Free-/Nicht-Nutzer [4, §IV.1]. „Widgets" sind dabei laut Developer Terms ein eigener Katalog (Play Button, Follow Button), **nicht** Teil der SDA-Definition, und folgen den separaten Widget Terms [19, §II.9/§II.17].
3. **Kommerzielle Nutzung:** Für Streaming-SDAs sind Verkauf, E-Commerce und Werbung auf dem Produkt verboten [4, §IV.2]; das Web Playback SDK darf ohne schriftliche Zustimmung gar nicht kommerziell genutzt werden [1]; der Spotify Play Button „may not be used for commercial purposes" [5, §IV.3.e]. Erlaubte kommerzielle Nutzung gibt es nur für Non-Streaming-SDAs (Werbung/Verkauf auf der App selbst) [4, §IV.3] — auf unser Spiel (Streaming-frei über Embeds) allenfalls technisch anwendbar, scheitert aber am Spiele-Verbot aus Punkt 1.
4. **Private Nutzung / DE-Kontext:** Die Lizenz der Developer Terms gilt nur „for private personal use" [19, §III.1.a.i]; Spotify ist laut Policy für „personal, non-commercial use" gedacht und darf z. B. nicht in Unternehmen/Geschäften abgespielt werden [4, §III.10]. Für eine private Freundesrunde (ob lokal oder remote über das eigene Web-Hosting) ist das der passende Rahmen; sobald das Spiel öffentlich beworben, abonniert oder monetarisiert wird, verlässt man ihn.
5. **Keine Downloads, kein Sync, keine Bearbeitung:** Verboten sind u. a. das lokale Cachen von Content, „stream ripping", das Synchronisieren von Aufnahmen mit visuellen Medien und das Erstellen von Derivaten [5, §IV.2.a–e; 4, §III.6–7]. Für die Web-Variante heißt das konkret: Embeds unverändert und sichtbar lassen (nicht obfuscieren, nicht verhüllen [5, §IV.3.b]), keine Audiodateien speichern/weiterreichen, Attribution über die Spotify-Bekennung im Player selbst (Embeds zeigen Cover + Spotify-Branding) und Link-Zurück-Verpflichtung bei Vorschau-Clips ist durch den Embed abgedeckt [4, §V.3].
6. **Apple:** Previews aus der iTunes Search API sind „only to promote store content and not for entertainment purposes"; „Download on iTunes"-Badge und „provided courtesy of iTunes"-Attribution sind Pflicht [7] → für ein Quiz nicht abgedeckt (s. 2.4).
7. **Deezer:** Terms/Guidelines login-gated — vor Produktionseinsatz zu prüfen [12].

---

## 6. Multiplayer-/Architektur-Empfehlung (Zusammenfassung)

**MVP-Architektur „Raum-Code-Quiz mit Spotify-Embeds":**

```
                    ┌──────────────────────────────┐
                    │  FastAPI-Server (game_server)│
                    │  - Lobby: Raum-Codes (4-5 Z.) │
                    │  - Deck/Mischen aus data/songs.json│
                    │  - Validierung: release_year  │
                    │  - Punkte, Rundenzustand      │
                    │  - WebSocket-Broadcast [15a] │
                    └───────────┬──────────────────┘
             WebSocket (WSS)    │    statisches Frontend (HTML/JS)
        ┌──────────────┬────────┴────────┬──────────────┐
        │ Spieler A     │ Spieler B       │ Spieler C     │  …
        │ Embed: 30-s-  │ Embed: 30-s-    │ Embed: 30-s-  │
        │ Preview [10]  │ Preview        │ Preview       │
        │ + Timeline-UI│ + Timeline-UI  │ + Timeline-UI │
        └──────────────┴─────────────────┴──────────────┘
```

- **Spielablauf:** Lobby (Raum-Code wie bei Jackbox [13]) → Server zieht Karte und broadcastet `card_revealed` → jeder Spieler startet auf seinem Gerät die Embed-Wiedergabe (Autoplay braucht User-Klick [10]) → Spieler platzieren/ordnen ein → Server validiert anhand `release_year` → Punkte-Broadcast → nächster Zug bis 10 Punkte (unveränderte Siegbedingung aus `README.md`).
- **Skalierung:** Ein Uvicorn-Prozess reicht für private Runden; mehrere Prozesse/Server erfordern einen geteilten Zustand (Redis) [15a][16][17]. Hosting über Docker/VPS/Cloud mit HTTPS via Traefik/Caddy [18].
- **Ausbauoptionen:** (a) „Host-Modus" mit einem großen Bildschirm und reinen Controller-Geräten (Jackbox-Muster, auch remote via Screenshare [13]); (b) Web Playback SDK für Premium-Runden mit vollen Tracks [1]; (c) `python-socketio` statt nativer WebSockets, sobald Auto-Reconnect/Redis-Rooms gebraucht werden [17].

---

## 7. Konkrete Empfehlung (Entscheidungsvorlage)

**Machbarkeits-Urteil: Ja — eine digitale, verteilte Web-Variante ist mit vertretbarem Aufwand baubar.**

Der pragmatischste Weg für dieses Projekt:

1. **MVP (empfohlen):** **FastAPI + native WebSockets** (Raum-Code-Lobby nach Jackbox-Muster [13][15a]) + **Spotify-Embeds ohne Auth/Premium** als Wiedergabe (30-s-Preview reicht fürs Einordnen) [2][9][10][11] + **`data/songs.json` unverändert** als Datenquelle. Neu: `game_server.py` + einfaches Web-Frontend. ~eine Woche Bastelaufwand für ein spielbares MVP, alle Kerntechnologien offiziell dokumentiert und ohne Zusatz-Accounts für die Spieler.
2. **Zweitoption (wenn alle Spieler Premium haben):** Web Playback SDK für volle Tracks — aber nur mit OAuth pro Spieler und ohne kommerzielle Ambitionen [1][3].
3. **Bewusst nicht empfohlen:** iTunes-/Deezer-Previews als Hauptquelle — Apple deckt Quiz-Nutzung termswidrig nicht ab [7], Deezer ist rechtlich ungeprüft (login-gated) [12].
4. **Vor jeder Veröffentlichung (über den privaten Kreis hinaus):** Das Spotify-Spiele-/Trivia-Verbot [4, §III.2; 5, §IV.2.d] klären — entweder schriftliche Zustimmung von Spotify einholen oder das Wiedergabemodell ändern (z. B. selbst lizenzierte Audio-Dateien, was außerhalb dieser Recherche liegt).

**Bottom Line:** *Technisch: machbar — klar ja. Rechtlich: privat vertretbar, öffentlich/kommerziell ohne Spottys Zustimmung ausgeschlossen.* Die Web-Variante ist sogar ein natürlicherer Fit als die physische Variante (kein Druck, kein Scannen, remote-tauglich), solange sie privat bleibt.

---

## Quellenverzeichnis

**Spotify (offizielle Developer-Dokumentation & Terms):**

1. Spotify, *Web Playback SDK — Overview* (Premium-Pflicht, iOS-Limiten, „must not be used in commercial projects without Spotify's prior written approval"): https://developer.spotify.com/documentation/web-playback-sdk
2. Spotify, *Embeds — Overview* (Integrationswege, Content-Typen): https://developer.spotify.com/documentation/embeds
3. Spotify, *Web Playback SDK — Getting Started* („needs an access token from your personal Spotify Premium account", Policy-Hinweise): https://developer.spotify.com/documentation/web-playback-sdk/tutorials/getting-started
4. Spotify, *Developer Policy* (eff. 15.05.2025; insb. §III.2 „Do not create a game, including trivia quizzes", §IV Streaming/Kommerz, §V Widgets & Audio Preview Clips, §III.10 personal non-commercial use): https://developer.spotify.com/policy
5. Spotify, *Widget Terms of Use* (v2.0, eff. 27.05.2014; insb. §IV.2.d „Games and Trivia Quizzes", §IV.2.e/g, §IV.3.b/e): https://developer.spotify.com/documentation/embeds/terms
6. Spotify-Staff-Antwort im offiziellen Developer-Community-Forum (Zusatzkontext zur 30-s-Preview für nicht eingeloggte Nutzer): https://community.spotify.com/forum/discussion/4552931/spotify-play-button-30-second-limit und https://community.spotify.com/t5/Other-Podcasts-Partners-etc/Spotify-Play-Button-only-preview/td-p/4501924
7. Apple, *iTunes Search API* (offizielle Doku; `previewUrl` = 30-s-Preview, ~20 Calls/Minute, Legal-Bedingungen „only to promote store content and not for entertainment purposes"): https://performance-partners.apple.com/search-api
8. Spotify, *Introducing some changes to our Web API* (27.11.2024 — Deprecation 30-s-Preview-URLs & Spotify-owned Playlists für neue/Dev-Mode-Apps): https://developer.spotify.com/blog/2024-11-27-changes-to-the-web-api
9. Spotify, *Embeds Reference — oEmbed API* (Endpoint `open.spotify.com/oembed`, keine Auth-Parameter): https://developer.spotify.com/documentation/embeds/reference/oembed — **Live-Test am 24.10.2026 erfolgreich** (Track aus `data/songs.json`, Antwort ohne Token).
10. Spotify, *Embeds Reference — iFrame API* (`createController`, `loadEntity`, `play`, Autoplay-/Safari-Einschränkung): https://developer.spotify.com/documentation/embeds/references/iframe-api
11. Spotify, *Embeds — Troubleshooting* (vollständige Songs in unterstützten Browsern; ohne `allow="encrypted-media"` nur < 30-s-Preview): https://developer.spotify.com/documentation/embeds/tutorials/troubleshooting
12. Deezer, *Developer Portal* (API-Doku/Guidelines/Terms — **login-gated, ohne Deezer-Konto nicht abrufbar**; am 24.10.2026 geprüft): https://developers.deezer.com/api — ergänzend: eigener Live-Test `https://api.deezer.com/search?q=…` (Preview-Feld mit signierter, zeitlich begrenzter 30-s-MP3, ohne Auth abrufbar).

**Multiplayer-/Architektur-Primärquellen:**

13. Jackbox Games, *How to Play* (Raum-Code-Lobby, phones as controllers, Remote via Screenshare): https://www.jackboxgames.com/how-to-play
14. Jackbox Games, *Jackbox.tv* (Controller-Seite mit Raum-Code-Eingabe): https://www.jackboxgames.com/play
15. MDN Web Docs, *WebSocket API* (Bidirektionale Echtzeitkommunikation ohne Polling): https://developer.mozilla.org/en-US/docs/Web/API/WebSockets_API
    - 15a. FastAPI, *WebSockets* (offizielle Doku: `@app.websocket`, `ConnectionManager`, `broadcast`, Single-Process-In-Memory-Caveat, `encode/broadcaster`-Hinweis): https://fastapi.tiangolo.com/advanced/websockets/
16. Socket.IO, *Rooms* (offizielle Doku; server-only Konzept, Redis-Adapter für Multi-Server): https://socket.io/docs/v4/rooms/
17. python-socketio, *Getting Started* (offizielle Library-Doku; FastAPI-Integration, Rooms-Broadcast, Redis-Queue-Option): https://python-socketio.readthedocs.io/en/latest/intro.html
18. FastAPI, *Deployments Concepts* (Uvicorn/Docker/Systemd/Cloud, TLS via Traefik/Caddy): https://fastapi.tiangolo.com/deployment/concepts/

**Spotify Developer Terms:**

19. Spotify, *Developer Terms of Service* (Version 10, eff. 15.05.2025; insb. §II Definitionen „Audio Preview Clips"/„Widgets"/„Spotify Platform", §III.1.a.i Lizenz „for private personal use", §IV.3 Datenhaltung, §VI Quotas): https://developer.spotify.com/terms

**Projekt-intern (Repo):**

20. `README.md` (Spielidee, Siegbedingung „10 korrekte Karten") und `docs/workflow.md` (Datenerhebung Discogs+Spotify, bekannte `403`-Einschränkung) sowie `data/songs.json` (`total_songs: 117`, `preview_url` durchweg `null`) im Repo.
