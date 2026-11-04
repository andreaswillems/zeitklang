"""Einfache Webanwendung zur Steuerung des Spotify Auth-Flows.

Starten mit:
    uv run zeitklang web

Dann im Browser öffnen: http://127.0.0.1:8080

Die App läuft auf Port 8080, damit der OAuth-Callback unter
http://127.0.0.1:8080/callback empfangen werden kann.
"""

import secrets
from urllib.parse import urlencode

import httpx
from flask import Flask, redirect, render_template_string, request, session

from zeitklang import config, spotify_auth

app = Flask(__name__)
app.secret_key = secrets.token_hex(32)  # Für Session/CSRF-Schutz

REDIRECT_URI = spotify_auth.REDIRECT_URI
SCOPES = spotify_auth.PLAYLIST_SCOPES

# Aliase für die bestehenden Aufrufe in den Routes
get_valid_token = spotify_auth.get_valid_token
token_is_valid = spotify_auth.token_is_valid
save_token = spotify_auth.save_token
delete_token = spotify_auth.delete_token
exchange_code_for_token = spotify_auth.exchange_code_for_token


# ─── HTML Template ───────────────────────────────────────────────

HTML_TEMPLATE = """
<!DOCTYPE html>
<html lang="de">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Zeitklang — Spotify Auth</title>
    <style>
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: linear-gradient(135deg, #1db954 0%, #191414 100%);
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 20px;
        }
        .card {
            background: white;
            border-radius: 16px;
            padding: 40px;
            max-width: 480px;
            width: 100%;
            box-shadow: 0 20px 60px rgba(0,0,0,0.3);
        }
        h1 {
            font-size: 28px;
            margin-bottom: 8px;
            color: #191414;
        }
        .subtitle {
            color: #666;
            margin-bottom: 32px;
        }
        .status {
            display: flex;
            align-items: center;
            gap: 12px;
            padding: 16px 20px;
            border-radius: 12px;
            margin-bottom: 24px;
            font-weight: 500;
        }
        .status.connected {
            background: #e8f5e9;
            color: #2e7d32;
        }
        .status.disconnected {
            background: #fff3e0;
            color: #e65100;
        }
        .status-dot {
            width: 12px;
            height: 12px;
            border-radius: 50%;
        }
        .status.connected .status-dot { background: #4caf50; }
        .status.disconnected .status-dot { background: #ff9800; }
        .btn {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            gap: 10px;
            padding: 14px 28px;
            border-radius: 50px;
            font-size: 16px;
            font-weight: 600;
            text-decoration: none;
            cursor: pointer;
            border: none;
            transition: transform 0.2s, box-shadow 0.2s;
            width: 100%;
        }
        .btn:hover {
            transform: translateY(-2px);
            box-shadow: 0 8px 24px rgba(0,0,0,0.15);
        }
        .btn-primary {
            background: #1db954;
            color: white;
        }
        .btn-secondary {
            background: #f5f5f5;
            color: #333;
            margin-top: 12px;
        }
        .btn-danger {
            background: #ffebee;
            color: #c62828;
            margin-top: 12px;
        }
        .spotify-logo {
            width: 24px;
            height: 24px;
        }
        .info {
            margin-top: 24px;
            padding: 16px;
            background: #f5f5f5;
            border-radius: 12px;
            font-size: 14px;
            color: #666;
        }
        .info code {
            background: #e0e0e0;
            padding: 2px 6px;
            border-radius: 4px;
            font-size: 13px;
        }
        .message {
            padding: 12px 16px;
            border-radius: 8px;
            margin-bottom: 20px;
            font-size: 14px;
        }
        .message.success { background: #e8f5e9; color: #2e7d32; }
        .message.error { background: #ffebee; color: #c62828; }
        .token-info {
            font-size: 13px;
            color: #888;
            margin-top: 8px;
        }
    </style>
</head>
<body>
    <div class="card">
        <h1>🎵 Zeitklang</h1>
        <p class="subtitle">Spotify-Verbindung verwalten</p>

        {% if message %}
        <div class="message {{ message_type }}">{{ message }}</div>
        {% endif %}

        {% if connected %}
        <div class="status connected">
            <span class="status-dot"></span>
            <span>Mit Spotify verbunden</span>
        </div>
        {% if token_info %}
        <div class="token-info">
            Token gültig bis: {{ token_info }}
        </div>
        {% endif %}

        <a href="/fetch-playlist" class="btn btn-primary">
            <svg class="spotify-logo" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.42 1.56-.299.421-1.02.599-1.559.3z"/>
            </svg>
            Playlist abrufen
        </a>
        <a href="/logout" class="btn btn-danger">Verbindung trennen</a>
        {% else %}
        <div class="status disconnected">
            <span class="status-dot"></span>
            <span>Nicht mit Spotify verbunden</span>
        </div>

        <a href="/login" class="btn btn-primary">
            <svg class="spotify-logo" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.42 1.56-.299.421-1.02.599-1.559.3z"/>
            </svg>
            Mit Spotify verbinden
        </a>
        {% endif %}

        <div class="info">
            <strong>Hinweis:</strong> Beim ersten Verbinden öffnet sich ein neuer Tab
            für die Spotify-Anmeldung. Danach ist der Token in
            <code>.cache/spotify-token.json</code> gespeichert und wird von
            <code>zeitklang fetch-playlist</code> und <code>zeitklang fetch-discogs</code> wiederverwendet.
        </div>
    </div>
</body>
</html>
"""


# ─── Routes ──────────────────────────────────────────────────────


@app.route("/")
def index():
    """Hauptseite mit Verbindungsstatus."""
    token = get_valid_token()
    connected = token is not None

    token_info = None
    if connected and token:
        expires_at = token.get("expires_at", 0)
        from datetime import datetime

        token_info = datetime.fromtimestamp(expires_at).strftime("%d.%m.%Y %H:%M:%S")

    message = request.args.get("message")
    message_type = request.args.get("type", "success")

    return render_template_string(
        HTML_TEMPLATE,
        connected=connected,
        token_info=token_info,
        message=message,
        message_type=message_type,
    )


@app.route("/login")
def login():
    """Startet den OAuth-Flow: Leitet zu Spotify weiter."""
    try:
        client_id, _ = config.get_credentials()
    except ValueError:
        return redirect("/?message=Fehlende Spotify-Credentials in .env&type=error")

    # State für CSRF-Schutz generieren und in Session speichern
    state = secrets.token_urlsafe(32)
    session["oauth_state"] = state

    params = {
        "client_id": client_id,
        "response_type": "code",
        "redirect_uri": REDIRECT_URI,
        "scope": " ".join(SCOPES),
        "state": state,
        "show_dialog": "true",  # Immer Zustimmungs-Dialog anzeigen
    }
    auth_url = f"{spotify_auth.SPOTIFY_AUTH_URL}?{urlencode(params)}"

    return redirect(auth_url)


@app.route("/callback")
def callback():
    """OAuth-Callback: Empfängt den Code von Spotify."""
    # Fehler von Spotify abfangen
    error = request.args.get("error")
    if error:
        return redirect(f"/?message=Spotify-Fehler: {error}&type=error")

    # State validieren (CSRF-Schutz)
    returned_state = request.args.get("state")
    expected_state = session.pop("oauth_state", None)
    if not expected_state or returned_state != expected_state:
        return redirect("/?message=Ungültiger State-Parameter (CSRF-Schutz)&type=error")

    # Code empfangen
    code = request.args.get("code")
    if not code:
        return redirect("/?message=Kein Authorization Code erhalten&type=error")

    # Code gegen Token tauschen
    try:
        token = exchange_code_for_token(code)
        save_token(token)
        return redirect("/?message=Erfolgreich mit Spotify verbunden!&type=success")
    except httpx.HTTPError as e:
        return redirect(f"/?message=Token-Austausch fehlgeschlagen: {e}&type=error")


@app.route("/logout")
def logout():
    """Trennt die Verbindung (löscht den Token)."""
    delete_token()
    session.clear()
    return redirect("/?message=Verbindung getrennt&type=success")


def fetch_playlist_data(access_token: str, playlist_id: str) -> dict:
    """Ruft Playlist-Daten direkt über die Spotify API ab (httpx).

    Args:
        access_token: Gültiger Spotify Access Token.
        playlist_id: Die Spotify-ID der Playlist.

    Returns:
        Dictionary mit "playlist" (Metadaten) und "songs" (Liste).
    """
    headers = {"Authorization": f"Bearer {access_token}"}
    base_url = "https://api.spotify.com/v1"

    # 1. Playlist-Informationen abrufen
    response = httpx.get(
        f"{base_url}/playlists/{playlist_id}",
        headers=headers,
        params={
            "fields": "id,name,description,owner(display_name),public,collaborative,external_urls(spotify)"
        },
    )
    response.raise_for_status()
    playlist_data = response.json()

    playlist_info = {
        "id": playlist_data.get("id"),
        "name": playlist_data.get("name"),
        "description": playlist_data.get("description"),
        "owner": playlist_data.get("owner", {}).get("display_name"),
        "public": playlist_data.get("public"),
        "collaborative": playlist_data.get("collaborative"),
        "spotify_url": playlist_data.get("external_urls", {}).get("spotify"),
    }

    # 2. Tracks abrufen (mit Paginierung)
    songs = []
    offset = 0
    limit = 50

    while True:
        response = httpx.get(
            f"{base_url}/playlists/{playlist_id}/items",
            headers=headers,
            params={
                "limit": limit,
                "offset": offset,
                "fields": "items(track(id,name,artists(name),album(release_date),duration_ms,external_urls(spotify),preview_url)),next",
            },
        )
        response.raise_for_status()
        data = response.json()

        for item in data.get("items", []):
            track = item.get("track")
            if not track or track.get("id") is None:
                continue  # Lokale Tracks oder ungültige Einträge überspringen

            # Künstler zusammenfügen
            artists = ", ".join(a.get("name", "") for a in track.get("artists", []))

            # Release-Jahr aus dem Album extrahieren
            release_year = 0
            album = track.get("album", {})
            release_date = album.get("release_date", "")
            if release_date:
                try:
                    release_year = int(release_date[:4])
                except ValueError, IndexError:
                    release_year = 0

            songs.append(
                {
                    "title": track.get("name", ""),
                    "artist": artists,
                    "release_year": release_year,
                    "spotify_url": track.get("external_urls", {}).get("spotify", ""),
                    "spotify_id": track.get("id", ""),
                    "duration_ms": track.get("duration_ms", 0),
                    "preview_url": track.get("preview_url"),
                }
            )

        # Prüfen, ob weitere Seiten vorhanden sind
        if data.get("next") is None:
            break
        offset += limit

    return {
        "playlist": playlist_info,
        "songs": songs,
    }


@app.route("/fetch-playlist")
def fetch_playlist():
    """Ruft die Playlist ab (nach erfolgreicher Autorisierung)."""
    token = get_valid_token()
    if not token:
        return redirect("/?message=Bitte zuerst mit Spotify verbinden&type=error")

    # Playlist-ID aus Query-Parameter oder Default
    playlist_id = request.args.get("playlist_id", "1GKqC6Rq1O3o97UwWMuiq6")

    try:
        data = fetch_playlist_data(token["access_token"], playlist_id)

        # Als JSON speichern
        from zeitklang.songs import save_songs

        output = save_songs(config.DEFAULT_SONGS_FILE, data["songs"], playlist=data["playlist"])

        playlist_name = data["playlist"]["name"]
        song_count = len(data["songs"])

        return redirect(
            f"/?message=Playlist '{playlist_name}' mit {song_count} Songs gespeichert in {output}&type=success"
        )

    except httpx.HTTPStatusError as e:
        # Detaillierte Fehlerinformationen von Spotify
        error_detail = ""
        try:
            error_detail = e.response.json().get("error", {}).get("message", str(e))
        except Exception:
            error_detail = str(e)
        return redirect(
            f"/?message=Spotify API Fehler ({e.response.status_code}): {error_detail}&type=error"
        )

    except Exception as e:
        return redirect(f"/?message=Fehler: {str(e)}&type=error")


@app.route("/status")
def status():
    """JSON-Status für API-Calls."""
    token = get_valid_token()
    return {
        "connected": token is not None,
        "token_valid": token_is_valid(token),
        "expires_at": token.get("expires_at") if token else None,
    }


# ─── Main ────────────────────────────────────────────────────────


def run(host: str = "127.0.0.1", port: int = 8080):
    """Startet die Webapp (Port 8080 = Redirect-URI für den OAuth-Callback)."""
    print()
    print("=" * 50)
    print("  🎵 Zeitklang — Spotify Auth Webapp")
    print("=" * 50)
    print()
    print(f"  Öffne im Browser: http://{host}:{port}")
    print()
    print(f"  Redirect URI:     {REDIRECT_URI}")
    print()
    print("  Drücke Strg+C zum Beenden")
    print()
    print("=" * 50)
    print()

    app.run(host=host, port=port, debug=True)


if __name__ == "__main__":
    run()
