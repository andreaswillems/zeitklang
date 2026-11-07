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
// #37: Player als Bottom-Sheet — kein View-Wechsel mehr, show() kennt keine
// Player-Sektion. Das Sheet öffnet/schließt sich unabhängig vom Ansichts-
// Zustand (openSheet/closeSheet unten bei den #7-Handlern).
const playerSheet = document.getElementById("player-sheet");
const sheetBackdrop = document.getElementById("sheet-backdrop");
const sheetCloseBtn = document.getElementById("sheet-close");
let sheetOpen = false;
// #8: Ladezustand — in index.html als einziger Bereich ohne hidden direkt
// sichtbar (schon ab First Paint, ohne JS); show() blendet ihn mit der
// ersten Ziel-Ansicht wieder aus.
const loadingSection = document.getElementById("loading");
const statusEl = document.getElementById("status");
const resultEl = document.getElementById("result");
const spoilerEl = document.getElementById("spoiler");
const playPauseEl = document.getElementById("toggle");
const cardEl = document.getElementById("now-playing");
const coverEl = document.getElementById("cover");
const titleEl = document.getElementById("np-title");
const artistEl = document.getElementById("np-artist");
const scanner = new Html5Qrcode("reader");
// #3: Torch-Button — bleibt hidden, bis Torch-Support erkannt wurde.
const torchBtn = document.getElementById("torch");
// #45: „Scan starten“ unten in der Daumenzone — ausgeblendet, solange der
// Scanner läuft; Overlay-Button „Scan stoppen“ über dem Kamerabild ist nur
// bei aktivem Scanner sichtbar (Toggles in startScan/stopScan).
const startBtn = document.getElementById("start");
const stopScanBtn = document.getElementById("scan-stop");
// #38: Abmelden-Icon-Button im Header — show() blendet ihn nur in der
// Scan-Ansicht ein; in Login/Ladezustand bleibt er versteckt.
const logoutBtn = document.getElementById("logout");
// #58: Login-Flow — Weiterleitungs-Zustand, Doppeltipp-Schutz und
// Fehlerbereich mit „Erneut versuchen“ (Details bei login()/showLoginError).
const loginBtn = document.getElementById("login-button");
const loginLabelEl = document.getElementById("login-label");
const loginErrorEl = document.getElementById("login-error");
const loginErrorTextEl = document.getElementById("login-error-text");
const loginRetryBtn = document.getElementById("login-retry");
// #58: Doppeltipp-Schutz — disabled greift erst im nächsten Frame, das
// Flag deckt auch das await-Fenster bis zum Redirect ab (s. login()).
let redirecting = false;
// #7: Persistenter Mini-Player — kompakte Now-Playing-Leiste, solange ein
// Track geladen ist. Tap auf die Infos öffnet das Player-Sheet (#37), der
// Play/Pause-Button nutzt dieselbe Icon-Mechanik wie #1 im Player-Sheet.
const miniPlayerEl = document.getElementById("mini-player");
const miniOpenEl = document.getElementById("mini-open");
const miniCoverEl = document.getElementById("mini-cover");
const miniTitleEl = document.getElementById("mini-title");
const miniArtistEl = document.getElementById("mini-artist");
const miniToggleEl = document.getElementById("mini-toggle");

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

// #58: Gezielte Login-Fehlermeldungen (#10: Ursache + nächster Schritt,
// keine Fachsprache, HTTP-Status nur via console.error in der Konsole).
const LOGIN_GENERIC_MSG =
    "Anmeldung fehlgeschlagen. Bitte Internetverbindung prüfen und erneut versuchen.";
const LOGIN_DENIED_MSG =
    "Anmeldung bei Spotify wurde abgebrochen. Tippe auf „Erneut versuchen“ und schließe die Anmeldung bei Spotify ab.";
const LOGIN_STATE_MSG =
    "Anmeldung aus Sicherheitsgründen abgebrochen. Bitte erneut versuchen.";
const LOGIN_PREMIUM_MSG =
    "Dein Account hat kein Spotify Premium. Zeitklang braucht Premium, damit die Musik auf deinem Handy spielt.";

// #58: Login-Fehler im eigenen Bereich mit „Erneut versuchen“ zeigen statt
// reiner Statuszeile — statusEl bleibt Queue-/SDK-Meldungen (#9) und dem
// Auth-Hinweis vorbehalten.
function showLoginError(message) {
    statusEl.textContent = "";
    loginErrorTextEl.textContent = message;
    loginErrorEl.hidden = false;
}

async function login() {
    // #58: Weiterleitungs-Zustand + Doppeltipp-Schutz — disabled/Flag als
    // erste Aktion, damit auch das await-Fenster bis zum Redirect (PKCE-
    // Challenge) gegen Doppeltaps geschützt ist. Zurückgesetzt wird der
    // Zustand nur bei bfcache-Rückkehr (pageshow unten bei den Listenern).
    if (redirecting) return;
    redirecting = true;
    loginBtn.disabled = true;
    loginLabelEl.textContent = "Weiterleitung zu Spotify…";
    loginErrorEl.hidden = true; // früheren Fehler verbergen
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
    if (error) {
        // #58: access_denied = Zustimmung bei Spotify abgebrochen — gezielte
        // Meldung statt generischem „Login fehlgeschlagen“ (init() wählt
        // err.userMsg für den Fehlerbereich aus).
        const err = new Error(`Spotify: ${error}`);
        err.userMsg =
            error === "access_denied" ? LOGIN_DENIED_MSG : LOGIN_GENERIC_MSG;
        throw err;
    }
    if (params.get("state") !== sessionStorage.getItem(KEYS.state)) {
        const err = new Error("Ungültiger state (CSRF-Schutz) — Login abgebrochen");
        err.userMsg = LOGIN_STATE_MSG; // #58
        throw err;
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
    clearTimeout(queueTimer); // #9: wartenden Scan nicht in die neue Session rutschen lassen
    queuedTrackId = null;
    // #6 Stufe 2/#45: kontinuierlichen Scanner stoppen — die Kamera darf in
    // der Login-Ansicht nicht weiterlaufen. stopScan() blendet die Overlay-
    // Buttons aus und „Scan starten“ wieder ein; Torch-Zustand bleibt (#3).
    if (scannerActive) stopScan();
    sessionStorage.removeItem(KEYS.access);
    sessionStorage.removeItem(KEYS.expiresAt);
    // Refresh-Token bleibt: Spotify stellt ihn nur bei neuer Zustimmung aus —
    // löschen würde das Auto-Login dauerhaft brechen (Spec §3.6).
    accessToken = null;
    window.deviceId = null;
    window.player?.disconnect();
    window.player = null;
    trackLoaded = false; // #7: Mini-Player verschwindet mit der Session
    // #37: offenes Sheet endet mit der Session — sofort, ohne Animation.
    closeSheet(true);
    show(loginSection);
}

// ---------- Web Playback SDK, Spezifikation §5 ----------

let sdkReady = false;
let accessToken = null;
// Auth-Fehler-Hinweis verzögert zeigen: SDK v1.10 feuert authentication_error
// auch spurisch beim Connect („Invalid token scopes."), obwohl ready folgt.
const AUTH_ERROR_MSG = "Authentifizierung fehlgeschlagen — bitte neu anmelden.";
let authErrorTimer = null;
// #9: Statuszeilen der Track-Queue (Scan vor SDK-ready). Die Konstanten
// erlauben es, die eigene Wartemeldung gezielt wieder zu ersetzen, ohne
// eine spezifischere SDK-Fehlermeldung (z. B. AUTH_ERROR_MSG) zu übergehen.
const QUEUE_WAIT_MSG = "Verbinde mit Spotify — der Titel startet in Kürze.";
const QUEUE_FAIL_MSG = "Verbindung zu Spotify fehlgeschlagen — bitte Seite neu laden.";
// #17: Offline-Hinweise, #10-konform (kein Fachjargon, je ein nächster
// Schritt): OFFLINE_MSG läuft über die globale Statuszeile (#status, in
// Login und Scan sichtbar), OFFLINE_SCAN_MSG über #result beim Scan-Start
// (#53-Muster: #result nur im Fehlerfall).
const OFFLINE_MSG =
    "Keine Internetverbindung. Scannen und Wiedergabe brauchen Internet — bitte WLAN oder Mobilfunk prüfen.";
const OFFLINE_SCAN_MSG =
    "Keine Internetverbindung — bitte wieder verbinden und erneut scannen.";
// #6 Stufe 2: Nach dem Scan bleibt die App in der Scan-Ansicht (kontinuierlicher
// Loop, das Player-Sheet (#37) öffnet sich nur über den Mini-Player). Der frühere
// Auto-Wechsel (awaitingTrackState) ist entfallen — ein expliziter
// „Runde fertig“-Moment ist laut Spielrunden-Feedback nicht nötig.
// #7: Erster State-Event = erster Track geladen → Mini-Player darf erscheinen.
let trackLoaded = false;
// #9: Track-Queue — ein Scan, bevor das SDK ready ist, bricht nicht mehr ab,
// sondern wird zwischengespeichert und im ready-Event automatisch abgespielt.
let queuedTrackId = null;
let queueTimer = null;
// #6 Stufe 2: kontinuierlicher Scanner — die Kamera bleibt zwischen den Karten
// an; scannerActive verhindert Doppel-Starts (html5-qrcode wirft sonst).
let scannerActive = false;
// #6 Stufe 2: Dubletten-Guard — im kontinuierlichen Modus feuert der
// Decoder für dieselbe Karte jeden Frame. Gleicher Track innerhalb des
// Zeitfensters wird ignoriert: kein Vibrieren, kein Re-Play.
let lastScanTrackId = null;
let lastScanAt = 0;
let lastInvalidScan = null;
let lastInvalidAt = 0;
const SCAN_COOLDOWN_MS = 5000;

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
        if (
            statusEl.textContent === AUTH_ERROR_MSG ||
            statusEl.textContent === QUEUE_FAIL_MSG
        ) {
            statusEl.textContent = "";
        }
        window.deviceId = device_id;
        // #9: Wartenden Scan nachziehen — der erste Scan nach dem Login darf
        // keine Sackgasse sein, auch wenn er vor SDK-ready passiert ist.
        if (queuedTrackId) {
            const trackId = queuedTrackId;
            queuedTrackId = null;
            clearTimeout(queueTimer);
            playTrack(trackId);
        }
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
        // #58: Definitives SDK-Ergebnis (Account ohne Premium — anders als der
        // spurious authentication_error oben keine Verzögerung nötig): zurück
        // auf den Login mit gezielter Meldung (Andreas-Entscheidung); logout()
        // hält Session, Scanner und Sheet sauber. Die Premium-Badge mit Link
        // (#57) steht auf demselben Screen.
        logout();
        showLoginError(LOGIN_PREMIUM_MSG);
    });
    window.player.addListener("playback_error", ({ message }) => {
        statusEl.textContent = "Wiedergabe-Fehler: " + message;
    });
    window.player.connect();
}

function renderPlayerState(state) {
    if (!state) return;
    const track = state.track_window.current_track;
    const artistText = track.artists.map((a) => a.name).join(", ");
    const img = track.album.images[0];
    titleEl.textContent = track.name;
    artistEl.textContent = artistText;
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
    // #7: Mini-Player spiegelt denselben Zustand (Titel/Interpret bleiben
    // unscharf — Spoiler-Schutz wie im Player-Sheet, siehe style.css).
    // Sichtbar ab dem ersten Track; ausgeblendet, solange das Player-Sheet
    // (#37) offen ist. #16: Der künftige aria-hidden-Sync zum Blur muss
    // auch diese Texte abdecken; bis dahin gilt derselbe Stand wie im Sheet.
    miniCoverEl.hidden = !img;
    if (img) miniCoverEl.src = img.url;
    miniTitleEl.textContent = track.name;
    miniArtistEl.textContent = artistText;
    miniPlayerEl.classList.toggle("playing", !state.paused);
    miniToggleEl.hidden = false;
    miniToggleEl.classList.toggle("paused", state.paused);
    miniToggleEl.setAttribute(
        "aria-label",
        state.paused ? "Wiedergabe fortsetzen" : "Wiedergabe pausieren",
    );
    trackLoaded = true;
    // #37: Leiste ist redundant, solange das Sheet offen ist.
    // #47: und unsichtbar, solange der Scanner gestoppt ist — der runde
    // Play-Button gehört dann allein zur Scan-Ansicht.
    miniPlayerEl.hidden = sheetOpen || !scannerActive;
}

// Spoiler-Mechanik (#66): Der Blur-Zustand folgt dem Mini-Player — open
// wird nur noch programmatisch gesetzt (openSheet/closeSheet, #61). Der
// toggle-Event feuert auch dabei und synchronisiert Karte (#13) und
// Mini-Player-Leiste (#7); ein manueller Toggle existiert nicht mehr.
spoilerEl.addEventListener("toggle", () => {
    cardEl.classList.toggle("revealed", spoilerEl.open);
    // #7: Mini-Player deckt synchron mit auf/ab — sonst würde die kompakte
    // Leiste den Song nach dem Aufdecken wieder „vergessen".
    miniPlayerEl.classList.toggle("revealed", spoilerEl.open);
});

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
        // #9: Player verbindet noch → Track-ID zwischenspeichern; das ready-
        // Event spielt sie automatisch ab. Bricht erst mit klarer Meldung ab,
        // wenn auch 10 s nach dem Scan keine Verbindung zustande kam.
        queuedTrackId = trackId;
        statusEl.textContent = QUEUE_WAIT_MSG;
        clearTimeout(queueTimer);
        queueTimer = setTimeout(() => {
            if (!window.deviceId && queuedTrackId === trackId) {
                queuedTrackId = null;
                // Nur ersetzen, wenn nicht inzwischen eine spezifischere
                // SDK-Meldung (z. B. Auth-Fehler) steht — Queue ist trotzdem weg.
                if (statusEl.textContent === QUEUE_WAIT_MSG) {
                    statusEl.textContent = QUEUE_FAIL_MSG;
                }
            }
        }, 10000);
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
        // #6 Stufe 2: bewusst kein Ansichtswechsel — die Scan-Ansicht bleibt
        // aktiv, der Mini-Player (#7) zeigt den laufenden Song.
        return;
    }
    const messages = {
        401: "Session abgelaufen — bitte neu anmelden.",
        403: "Fehlende Scopes — bitte neu anmelden.",
        404: "Kein aktives Gerät — Player verbindet noch, bitte erneut versuchen.",
        412: LOGIN_PREMIUM_MSG, // #58: ausformuliert wie im Login-Fehlerbereich
    };
    statusEl.textContent =
        messages[response.status] ??
        `Wiedergabe fehlgeschlagen (HTTP ${response.status}).`;
}

function playScannedText(text) {
    const trackId = trackIdFrom(text);
    if (!trackId) {
        // #6 Stufe 2: ungültige QRs feuern im kontinuierlichen Modus jeden
        // Frame — Meldung nur einmal pro Karte/Zeitfenster zeigen.
        const now = Date.now();
        if (text === lastInvalidScan && now - lastInvalidAt < SCAN_COOLDOWN_MS) return;
        lastInvalidScan = text;
        lastInvalidAt = now;
        resultEl.textContent = "Kein Spotify-Track erkannt: " + text;
        return;
    }
    // #6 Stufe 2: Dubletten-Guard (Deklaration siehe Modul-Variablen) —
    // ignorierte Frames zählen nicht, vibrieren nicht, spielen nicht neu.
    const now = Date.now();
    if (trackId === lastScanTrackId && now - lastScanAt < SCAN_COOLDOWN_MS) return;
    lastScanTrackId = trackId;
    lastScanAt = now;
    // #53: keine Erfolgsmeldung — #result wird nur noch im
    // Fehlerfall aktualisiert; Erfolg-Feedback kommt über Vibration (#4)
    // und Mini-Player/Now-Playing.
    // #4: haptisches Feedback nach erfolgreichem Scan — bei Party-Lärm oder
    // hektischem Kartengeben sonst leicht zu übersehen. Progressive
    // Enhancement: navigator.vibrate fehlt z. B. in iOS Safari komplett —
    // optional chaining, kein Fehler. Der Dubletten-Guard verhindert, dass
    // ignorierte Frames vibrieren.
    navigator.vibrate?.(80);
    // #37: neuer Scan schiebt ein offenes Sheet zu — der Quiz-Flow bleibt
    // flüssig, der Spoiler-Reset in playTrack greift wie heute.
    closeSheet();
    playTrack(trackId);
}

// ---------- UI-Zustände (§6) ----------

function show(section) {
    loginSection.hidden = section !== loginSection;
    scanSection.hidden = section !== scanSection;
    // #38: Abmelden-Icon oben rechts gehört zur Scan-Ansicht.
    logoutBtn.hidden = section !== scanSection;
    // #8: Mit jeder Ziel-Ansicht endet der Ladezustand — egal ob nach
    // Token-Austausch, Token-Refresh oder Fehlerfall (Login + Meldung).
    loadingSection.hidden = true;
    // #7/#37: Mini-Player in Login- und Scan-Ansicht erreichbar, solange
    // ein Track geladen ist; versteckt, solange das Sheet offen ist.
    // #47: auch versteckt, solange der Scanner gestoppt ist.
    miniPlayerEl.hidden = !trackLoaded || sheetOpen || !scannerActive;
}

// ---------- #17: Service Worker + Offline-Hinweis ----------

// Andreas-Entscheidung zu #17: Offline-Hinweis über die bestehende
// Statuszeile, kein eigener Banner. offlineShown verhindert, dass der
// online-Zweig Queue-/SDK-Meldungen aus #9 wegputzt, die inzwischen auf
// der Zeile stehen könnten.
let offlineShown = false;
function updateOnlineHint() {
    if (!navigator.onLine) {
        statusEl.textContent = OFFLINE_MSG;
        offlineShown = true;
    } else if (offlineShown) {
        statusEl.textContent = "";
        offlineShown = false;
    }
}
window.addEventListener("online", updateOnlineHint);
window.addEventListener("offline", updateOnlineHint);

async function init() {
    // #17: Service Worker registrieren — App-Shell offline ladbar, Android-
    // Install-Prompt zuverlässig (#18). Spec §11: relativer Pfad wegen
    // /zeitklang/. Non-blocking: Die App läuft auch ohne SW weiter, ein
    // Fehler geht nur in die Konsole.
    if ("serviceWorker" in navigator) {
        navigator.serviceWorker
            .register("./sw.js")
            .catch((err) => console.error("SW-Registrierung fehlgeschlagen:", err));
    }
    // #17: Stand beim Start setzen, falls die App offline geöffnet wird.
    updateOnlineHint();
    try {
        await handleRedirect();
        accessToken = await getValidToken();
        if (accessToken) {
            createPlayer();
            show(scanSection);
        } else {
            show(loginSection);
        }
    } catch (err) {
        // #10/#58: Fachdetails (HTTP, err.message) nur in die Konsole, in der
        // UI steht die gezielte, handlungsanleitende Meldung.
        console.error("Login fehlgeschlagen:", err);
        show(loginSection);
        showLoginError(err.userMsg ?? LOGIN_GENERIC_MSG);
    }
}

loginBtn.addEventListener("click", login); // #58: Ref statt erneuter getElementById
document.getElementById("logout").addEventListener("click", logout);
// #58: „Erneut versuchen“ — einfacher Seiten-Reload (Andreas-Entscheidung):
// handleRedirect() hat ?code/?error per replaceState aus der URL geräumt,
// danach zeigt init() regulär den Login ohne OAuth-Altlasten.
loginRetryBtn.addEventListener("click", () => location.reload());
// #58: bfcache-Rückkehr (Zurück-Button nach dem Redirect): Der Button ist
// noch disabled mit „Weiterleitung zu Spotify…“ — pageshow mit persisted
// setzt ihn zurück, ein frischer Tap startet den Login erneut.
window.addEventListener("pageshow", (event) => {
    if (!event.persisted) return;
    redirecting = false;
    loginBtn.disabled = false;
    loginLabelEl.textContent = "Mit Spotify anmelden";
});
// #37: „Weitere Karte scannen" ist entfallen — der Scanner läuft kontinuierlich
// (#6 Stufe 2), ein neuer Scan schließt das offene Sheet automatisch. Die
// frühere Pause-Aktion des Buttons entfällt damit: Der nächste Scan ersetzt
// die Wiedergabe ohnehin sofort (#14-Kontext, Andreas 6. November 2026).
playPauseEl.addEventListener("click", () => window.player?.togglePlay());

// ---------- #37: Player als Bottom-Sheet über dem Scanner ----------

// Öffnen: hidden wegnehmen, im nächsten Frame die Fahrt anstoßen — eine
// Transition direkt nach dem hidden-Wechsel wirkt noch nicht (display:none
// bis zum Reflow). transform/opacity statt Layout-Sprung (Muster aus #13);
// prefers-reduced-motion greift über die Global-Regel in style.css.
function openSheet() {
    if (sheetOpen || !trackLoaded) return;
    sheetOpen = true;
    miniPlayerEl.hidden = true; // Leiste wäre redundant zum Sheet
    playerSheet.hidden = false;
    sheetBackdrop.hidden = false;
    // #61: Sheet öffnet immer enthüllt — die Zuweisung feuert das toggle-
    // Event (der Listener synchronisiert Karte, #13-Cover-Animation und
    // Mini-Player-Leiste, #7). Bewusst NACH dem Unhide: Auf display:none
    // läuft keine Transition, sonst erschiene das Cover schon in voller
    // Breite ohne #13-Animation — so wächst es parallel zur Sheet-Fahrt.
    spoilerEl.open = true;
    requestAnimationFrame(() => {
        playerSheet.classList.add("open");
        sheetBackdrop.classList.add("open");
    });
}

// Schließen: erst die Klasse weg (animiertes Runterfahren), hidden erst
// danach — sonst springt das Sheet. instant überspringt die Animation
// (Logout); der Timer hält hidden synchron, auch wenn die Transition
// durch prefers-reduced-motion ~0 ms dauert.
function closeSheet(instant = false) {
    if (!sheetOpen) return;
    sheetOpen = false;
    // #61: Schließen verhüllt immer — ein Reset für alle Pfade (Chevron,
    // Backdrop-Tap, Logout instant, Scan-Schließweg aus playScannedText).
    // Der toggle-Listener verhüllt Karte und Leiste synchron (#7); das
    // open=false in playTrack bei neuem Track bleibt als No-Op erhalten.
    spoilerEl.open = false;
    // #7: Leiste kommt zurück — #47: nur, wenn der Scanner läuft.
    miniPlayerEl.hidden = !trackLoaded || !scannerActive;
    playerSheet.classList.remove("open");
    sheetBackdrop.classList.remove("open");
    if (instant) {
        playerSheet.hidden = true;
        sheetBackdrop.hidden = true;
        return;
    }
    setTimeout(() => {
        if (sheetOpen) return; // inzwischen wieder geöffnet
        playerSheet.hidden = true;
        sheetBackdrop.hidden = true;
    }, 400); // ≈ Sheet-Transition (350 ms) + Puffer
}

// #7: Mini-Player — Tap auf die Infos öffnet das Player-Sheet (#37), der
// Play/Pause-Button steuert die Wiedergabe direkt.
miniOpenEl.addEventListener("click", openSheet);
sheetCloseBtn.addEventListener("click", () => closeSheet());
sheetBackdrop.addEventListener("click", () => closeSheet());
miniToggleEl.addEventListener("click", () => window.player?.togglePlay());

// ---------- #18: Installation (Android/Desktop-Chrome: beforeinstallprompt) ----------

const installLoginBtn = document.getElementById("install-login");
const installScanBtn = document.getElementById("install-scan");

// Android/Desktop-Chrome: Der Browser feuert beforeinstallprompt, sobald die
// PWA installierbar ist (Manifest + Service Worker aus #17). preventDefault()
// unterdrückt das eigene Mini-Banner des Browsers, stattdessen zeigen die
// dezenten Ghost-Buttons (#57-Konkurrenz) den Weg. Sie leben in Login- bzw.
// Guide-Sektion — die Sektions-Sichtbarkeit regelt, wo sie zu sehen sind.
let deferredInstallPrompt = null;

function showInstallButtons(shown) {
    installLoginBtn.hidden = !shown;
    installScanBtn.hidden = !shown;
}

window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    deferredInstallPrompt = event;
    showInstallButtons(true);
});

// Tap löst den nativen Install-Dialog aus. Das Event ist danach verbraucht;
// ob angenommen oder abgebrochen wurde, ist für die UI ohne Bedeutung
// (abgebrochen → Buttons bleiben weg, Andreas-Entscheidung: kein Wegklick).
async function promptInstall() {
    if (!deferredInstallPrompt) return;
    deferredInstallPrompt.prompt();
    await deferredInstallPrompt.userChoice.catch(() => {});
    deferredInstallPrompt = null;
    showInstallButtons(false);
}
installLoginBtn.addEventListener("click", () => promptInstall());
installScanBtn.addEventListener("click", () => promptInstall());

// Nach der Installation feuert der Browser kein beforeinstallprompt mehr —
// im Standalone-Modus erscheinen die Buttons nie wieder.
window.addEventListener("appinstalled", () => {
    deferredInstallPrompt = null;
    showInstallButtons(false);
});
init();

// ---------- QR-Scan (§4, aus dem Durchstich) ----------

// #3: Torch-Zustand als Modul-State, damit das Licht über mehrere Scans
// hinweg erhalten bleibt (Koordination mit #6 Stufe 2: dort läuft der
// Scanner kontinuierlich und darf den Torch-Zustand nicht verlieren).
let torchOn = false;

async function applyTorch(on) {
    await scanner.applyVideoConstraints({ advanced: [{ torch: on }] });
    torchOn = on;
    torchBtn.setAttribute("aria-pressed", String(on));
}

// Scanner-Start als eigene Funktion: „Scan starten“ und „Weitere Karte
// scannen“ laufen über denselben Code (#6 Stufe 2: Doppel-Starts werden
// verhindert, der Scanner läuft kontinuierlich weiter).
async function startScan() {
    if (scannerActive) return; // #6 Stufe 2: bereits laufend — kein Neustart
    // #17: Offline keinen Kamera-Start wagen — die Wiedergabe bräche
    // ohnehin sofort ab. Klarer Hinweis in #result (#53-Muster),
    // #start bleibt sichtbar.
    if (!navigator.onLine) {
        resultEl.textContent = OFFLINE_SCAN_MSG;
        return;
    }
    await scanner.start(
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
            // #6 Stufe 2: kein stop() — die Kamera bleibt zwischen den Karten
            // an, die nächste Karte braucht keinen Kamera-Neustart. Der
            // Dubletten-Guard in playScannedText hält Frame-Wiederholungen fern.
            playScannedText(decodedText);
        },
        () => {
            // pro Frame ohne Treffer — ignorieren
        },
    );
    scannerActive = true; // #6 Stufe 2: Kamera läuft jetzt kontinuierlich
    // #45: Während der Scanner läuft, ist „Scan starten“ ausgeblendet und
    // das Stopp-Overlay sichtbar. Erst NACH dem Start verstecken — schlägt
    // scanner.start() fehl, bleibt der Button sichtbar (kein Reset nötig).
    startBtn.hidden = true;
    stopScanBtn.hidden = false;
    // #47: Scan-Neustart gibt die Leiste zurück, wenn bereits ein Track
    // läuft (nach Stopp war sie ausgeblendet).
    miniPlayerEl.hidden = !trackLoaded || sheetOpen;
    // #3: Torch-Support erst nach erfolgreichem Start prüfen — Button nur
    // zeigen, wenn das Gerät die Kamera-LED wirklich steuern kann.
    try {
        const capabilities = scanner.getRunningTrackCapabilities();
        if (capabilities?.torch) {
            torchBtn.hidden = false;
            if (torchOn) await applyTorch(true); // Zustand nach Neustart wiederherstellen
        }
    } catch {
        // Capabilities nicht abrufbar → Button bleibt verborgen, kein Fehler
    }
}

// #45: Scanner manuell stoppen — Gegenstück zu startScan(). Ohne ihn liefe
// die Kamera die ganze Session (Akku, Privacy-LED) und jede Karte im Bild
// ersetzte sofort den laufenden Track. Torch-Zustand (torchOn) bleibt als
// Modul-State erhalten (#3), applyTorch zieht ihn beim nächsten Start nach.
function stopScan() {
    if (!scannerActive) return;
    scannerActive = false;
    // #51: Beim Scanner-Stopp auch die Wiedergabe anhalten — der Close-
    // Button beendet die Hör-Situation komplett. Der Player bleibt
    // verbunden; der nächste Scan startet den nächsten Track direkt.
    window.player?.pause();
    try {
        scanner.stop();
    } catch {
        // Kamera evtl. schon zu — kein Fehler
    }
    stopScanBtn.hidden = true;
    torchBtn.hidden = true;
    startBtn.hidden = false; // #45/#47: Play-Button kehrt auf die Kamerafläche zurück
    // #47: Leiste ausblenden — der gestoppte Scanner rückt den runden
    // Play-Button in den Fokus; sie kehrt mit dem Scan-Neustart bzw.
    // dem nächsten Track zurück.
    miniPlayerEl.hidden = true;
}

startBtn.addEventListener("click", () => {
    window.player?.activateElement(); // iOS: Wiedergabe braucht einen User-Tap (§5.5)
    startScan().catch((err) => {
        // Kamera braucht HTTPS oder localhost, docs/durchstich.md §4.
        // #45: #start bleibt sichtbar — versteckt wird erst nach erfolgreichem
        // Start (s. startScan), der Fehlerweg braucht keinen Reset.
        resultEl.textContent = "Kamera nicht verfügbar: " + err;
    });
});

// #45: Stopp per Overlay-Icon-Button über dem Kamerabild (oben rechts).
stopScanBtn.addEventListener("click", stopScan);

torchBtn.addEventListener("click", async () => {
    try {
        await applyTorch(!torchOn);
    } catch {
        // Umschalten doch nicht möglich (Support weggezogen) → still verbergen
        torchBtn.hidden = true;
    }
});
