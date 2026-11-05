// Spotify-Login (PKCE) + QR-Scan + Wiedergabe per Web Playback SDK
// — docs/pwa-spezifikation.md §3/§4/§5.

const AUTHORIZE_URL = "https://accounts.spotify.com/authorize";
const TOKEN_URL = "https://accounts.spotify.com/api/token";
const PLAY_URL = "https://api.spotify.com/v1/me/player/play";
// Access-Token flüchtig in sessionStorage, Refresh-Token dauerhaft in
// localStorage (shortcut §8: bei XSS auslesbar — nur privat auf eigenem Gerät).
const KEYS = {
    access: "zeitklang_access",
    expiresAt: "zeitklang_expires_at",
    refresh: "zeitklang_refresh",
    verifier: "zeitklang_verifier",
    state: "zeitklang_state",
};

const loginSection = document.getElementById("login");
const scanSection = document.getElementById("scan");
const playerSection = document.getElementById("player-view");
const statusEl = document.getElementById("status");
const resultEl = document.getElementById("result");
const spoilerEl = document.getElementById("spoiler");
const playPauseEl = document.getElementById("toggle");
const cardEl = document.getElementById("now-playing");
const coverEl = document.getElementById("cover");
const titleEl = document.getElementById("np-title");
const artistEl = document.getElementById("np-artist");
const counterEl = document.getElementById("counter");
const scanner = new Html5Qrcode("reader");

// ---------- Auth (PKCE), Spezifikation §3 ----------

function randomString(length) {
    const chars =
        "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~";
    const bytes = crypto.getRandomValues(new Uint8Array(length));
    return Array.from(bytes, (b) => chars[b % chars.length]).join("");
}

function base64url(buffer) {
    return btoa(String.fromCharCode(...new Uint8Array(buffer)))
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/, "");
}

async function pkceChallenge(verifier) {
    const hash = await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(verifier),
    );
    return base64url(hash);
}

async function login() {
    statusEl.textContent = "";
    const verifier = randomString(64);
    const state = randomString(16);
    sessionStorage.setItem(KEYS.verifier, verifier);
    sessionStorage.setItem(KEYS.state, state);
    const params = new URLSearchParams({
        client_id: SPOTIFY_CLIENT_ID,
        response_type: "code",
        redirect_uri: redirectUri(),
        scope: AUTH_SCOPES,
        code_challenge_method: "S256",
        code_challenge: await pkceChallenge(verifier),
        state,
    });
    location.href = `${AUTHORIZE_URL}?${params}`;
}

async function requestToken(body) {
    const response = await fetch(TOKEN_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams(body).toString(),
    });
    if (!response.ok) {
        const err = new Error(`Token-Endpunkt antwortete mit ${response.status}`);
        err.status = response.status;
        throw err;
    }
    const tokens = await response.json();
    sessionStorage.setItem(KEYS.access, tokens.access_token);
    // 30 s Puffer, damit ein Token kurz vor Ablauf nicht mehr verwendet wird
    sessionStorage.setItem(
        KEYS.expiresAt,
        String(Date.now() + (tokens.expires_in - 30) * 1000),
    );
    if (tokens.refresh_token) {
        localStorage.setItem(KEYS.refresh, tokens.refresh_token);
    }
}

// Wertet ?code=…/?error=… aus, egal auf welchem Pfad (§3.3: lokal /callback,
// auf Pages die Site-Root).
async function handleRedirect() {
    const params = new URLSearchParams(location.search);
    const code = params.get("code");
    const error = params.get("error");
    if (!code && !error) return;
    history.replaceState(null, "", location.pathname); // Code ist einmalig
    if (error) throw new Error(`Spotify: ${error}`);
    if (params.get("state") !== sessionStorage.getItem(KEYS.state)) {
        throw new Error("Ungültiger state (CSRF-Schutz) — Login abgebrochen");
    }
    const verifier = sessionStorage.getItem(KEYS.verifier);
    sessionStorage.removeItem(KEYS.state);
    sessionStorage.removeItem(KEYS.verifier);
    await requestToken({
        grant_type: "authorization_code",
        code,
        redirect_uri: redirectUri(),
        client_id: SPOTIFY_CLIENT_ID,
        code_verifier: verifier,
    });
}

// §3.5: gültiges Access-Token → startklar; abgelaufen + Refresh-Token →
// refreshen; sonst null (Login-Button zeigen).
async function getValidToken() {
    const access = sessionStorage.getItem(KEYS.access);
    if (access && Date.now() < Number(sessionStorage.getItem(KEYS.expiresAt))) {
        return access;
    }
    const refresh = localStorage.getItem(KEYS.refresh);
    if (!refresh) return null;
    try {
        await requestToken({
            grant_type: "refresh_token",
            refresh_token: refresh,
            client_id: SPOTIFY_CLIENT_ID,
        });
    } catch (err) {
        // Ungültiger Refresh-Token (400) verwerfen — sonst retryed jeder Start
        // bis in alle Ewigkeit (Spotify-Doku: discard + neu autorisieren).
        if (err.status === 400) localStorage.removeItem(KEYS.refresh);
        throw err;
    }
    return sessionStorage.getItem(KEYS.access);
}

function logout() {
    clearTimeout(authErrorTimer);
    sessionStorage.removeItem(KEYS.access);
    sessionStorage.removeItem(KEYS.expiresAt);
    // Refresh-Token bleibt: Spotify stellt ihn nur bei neuer Zustimmung aus —
    // löschen würde das Auto-Login dauerhaft brechen (Spec §3.6).
    accessToken = null;
    window.deviceId = null;
    window.player?.disconnect();
    window.player = null;
    show(loginSection);
}

// ---------- Web Playback SDK, Spezifikation §5 ----------

let sdkReady = false;
let accessToken = null;
// Auth-Fehler-Hinweis verzögert zeigen: SDK v1.10 feuert authentication_error
// auch spurisch beim Connect („Invalid token scopes."), obwohl ready folgt.
const AUTH_ERROR_MSG = "Authentifizierung fehlgeschlagen — bitte neu anmelden.";
let authErrorTimer = null;
// Play-Command angenommen → der NÄCHSTE State-Event gehört zum neuen Track und
// zeigt die Player-Ansicht. Pause-Events (z. B. „Weitere Karte scannen")
// springen sonst asynchron zurück und erforden einen zweiten Klick.
let awaitingTrackState = false;

// Muss global sein, bevor das SDK-Script lädt (Script-Tag steht nach app.js).
window.onSpotifyWebPlaybackSDKReady = () => {
    sdkReady = true;
    createPlayer();
};

function createPlayer() {
    if (!sdkReady || !accessToken || window.player) return;
    window.player = new Spotify.Player({
        name: "Zeitklang PWA",
        getOAuthToken: (cb) => getValidToken().then(cb),
        volume: 0.8,
    });
    window.player.addListener("ready", ({ device_id }) => {
        clearTimeout(authErrorTimer);
        if (statusEl.textContent === AUTH_ERROR_MSG) statusEl.textContent = "";
        window.deviceId = device_id;
    });
    window.player.addListener("player_state_changed", renderPlayerState);
    window.player.addListener("initialization_error", ({ message }) => {
        statusEl.textContent = "Player-Fehler: " + message;
    });
    window.player.addListener("authentication_error", () => {
        // Spurischer Fehler (Connect wird trotzdem fertig) oder echter Tot:
        // Hinweis erst zeigen, wenn nicht binnen 3 s ready nachkommt.
        clearTimeout(authErrorTimer);
        authErrorTimer = setTimeout(() => {
            statusEl.textContent = AUTH_ERROR_MSG;
        }, 3000);
    });
    window.player.addListener("account_error", () => {
        statusEl.textContent = "Spotify Premium erforderlich.";
    });
    window.player.addListener("playback_error", ({ message }) => {
        statusEl.textContent = "Wiedergabe-Fehler: " + message;
    });
    window.player.connect();
}

function renderPlayerState(state) {
    if (!state) return;
    const track = state.track_window.current_track;
    titleEl.textContent = track.name;
    artistEl.textContent = track.artists.map((a) => a.name).join(", ");
    const img = track.album.images[0];
    coverEl.hidden = !img;
    if (img) coverEl.src = img.url;
    cardEl.classList.toggle("playing", !state.paused);
    playPauseEl.hidden = false;
    // Icons + aria-label per Klasse/CSS wechseln (#1): ▶/▮▮/⏸ renderten je
    // nach Plattform als Emoji, Screenreader hatten keinen sinnvollen Text.
    playPauseEl.classList.toggle("paused", state.paused);
    playPauseEl.setAttribute(
        "aria-label",
        state.paused ? "Wiedergabe fortsetzen" : "Wiedergabe pausieren",
    );
    // Nur der erste State nach einem Play-Command zeigt die Player-Ansicht (§6.3)
    if (awaitingTrackState) {
        awaitingTrackState = false;
        show(playerSection);
    }
}

// Spoiler-Mechanik: Text der Karte bleibt unscharf, bis details offen ist
spoilerEl.addEventListener("toggle", () => {
    cardEl.classList.toggle("revealed", spoilerEl.open);
    spoilerEl.querySelector("summary").textContent = spoilerEl.open
        ? "Titel & Interpret verbergen"
        : "Titel & Interpret anzeigen";
});

// ---------- Zähler (kleines Spielgefühl, persistiert wie §8 die Tokens) ----------

const COUNT_KEY = "zeitklang_count";

function renderCount() {
    const n = Number(localStorage.getItem(COUNT_KEY) ?? 0);
    counterEl.textContent = n ? `🎵 ${n} Songs gehört` : "";
}

// §4: Track-ID aus open.spotify.com/track/<id>, spotify:track:<id>
// oder der künftigen Route /play/<id> extrahieren.
function trackIdFrom(text) {
    const match = text.match(
        /(?:open\.spotify\.com\/track\/|spotify:track:|\/play\/)([A-Za-z0-9]{22})/,
    );
    return match ? match[1] : null;
}

async function playTrack(trackId) {
    if (!window.deviceId) {
        statusEl.textContent = "Player noch nicht verbunden — kurz warten, dann erneut.";
        return;
    }
    spoilerEl.open = false; // neuer Track → Lösung wieder verdecken
    const play = async () =>
        fetch(`${PLAY_URL}?device_id=${window.deviceId}`, {
            method: "PUT",
            headers: {
                Authorization: `Bearer ${await getValidToken()}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify({ uris: [`spotify:track:${trackId}`] }),
        });
    let response = await play();
    if (response.status === 401) {
        // Token lief unterwegs ab — Access-Token verwerfen, getValidToken
        // greift dann zum Refresh-Token, einmal wiederholen (§5.6).
        sessionStorage.removeItem(KEYS.access);
        sessionStorage.removeItem(KEYS.expiresAt);
        response = await play();
    }
    if (response.ok) {
        statusEl.textContent = "";
        awaitingTrackState = true;
        return;
    }
    const messages = {
        401: "Session abgelaufen — bitte neu anmelden.",
        403: "Fehlende Scopes — bitte neu anmelden.",
        404: "Kein aktives Gerät — Player verbindet noch, bitte erneut versuchen.",
        412: "Spotify Premium erforderlich.",
    };
    statusEl.textContent =
        messages[response.status] ??
        `Wiedergabe fehlgeschlagen (HTTP ${response.status}).`;
}

function playScannedText(text) {
    const trackId = trackIdFrom(text);
    if (!trackId) {
        resultEl.textContent = "Kein Spotify-Track erkannt: " + text;
        return;
    }
    resultEl.textContent = "✓ Track erkannt";
    localStorage.setItem(
        COUNT_KEY,
        String(Number(localStorage.getItem(COUNT_KEY) ?? 0) + 1),
    );
    renderCount();
    playTrack(trackId);
}

// ---------- UI-Zustände (§6) ----------

function show(section) {
    loginSection.hidden = section !== loginSection;
    scanSection.hidden = section !== scanSection;
    playerSection.hidden = section !== playerSection;
}

async function init() {
    try {
        await handleRedirect();
        accessToken = await getValidToken();
        if (accessToken) {
            createPlayer();
            show(scanSection);
            renderCount();
        } else {
            show(loginSection);
        }
    } catch (err) {
        show(loginSection);
        statusEl.textContent = "Login fehlgeschlagen: " + err.message;
    }
}

document.getElementById("login-button").addEventListener("click", login);
document.getElementById("logout").addEventListener("click", logout);
document
    .getElementById("next-card")
    .addEventListener("click", () => {
        window.player?.pause(); // Karte ist durch → Wiedergabe aus
        resultEl.textContent = ""; // altes Scan-Ergebnis zurücksetzen
        show(scanSection);
    });
playPauseEl.addEventListener("click", () => window.player?.togglePlay());
init();

// ---------- QR-Scan (§4, aus dem Durchstich) ----------

document.getElementById("start").addEventListener("click", () => {
    window.player?.activateElement(); // iOS: Wiedergabe braucht einen User-Tap (§5.5)
    scanner
        .start(
            { facingMode: "environment" },
            {
                fps: 10,
                // #2: Scan-Rahmen dynamisch an die Videofläche anpassen
                // (max. 250 px), sonst ist er auf schmalen Geräten breiter
                // als das Kamerabild. min(w, h) schützt im Querformat.
                qrbox: (w, h) => {
                    const size = Math.min(250, Math.floor(Math.min(w, h) * 0.7));
                    return { width: size, height: size };
                },
            },
            (decodedText) => {
                playScannedText(decodedText);
                scanner.stop();
            },
            () => {
                // pro Frame ohne Treffer — ignorieren
            },
        )
        .catch((err) => {
            // Kamera braucht HTTPS oder localhost, docs/durchstich.md §4.
            resultEl.textContent = "Kamera nicht verfügbar: " + err;
        });
});
