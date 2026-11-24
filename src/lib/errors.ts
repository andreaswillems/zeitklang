/**
 * Play-Fehler-Mapping (Spec §5.6, Parity zu web/app.js playTrack/putPlay):
 * reine Funktion, keine DOM/fetch-Globals (Plan §5.1). Fachdetails
 * (HTTP-Status, Reason) wandern nur in die Konsole — hier zählt nur der
 * handlungsanleitende UI-Text.
 */

/** Premium-Text (Free-Account, Spec §5.6; Parity zu web/app.js LOGIN_PREMIUM_MSG, Wiederverwendung durch QKEQRY5-2). */
export const LOGIN_PREMIUM_MSG =
  "Dein Account hat kein Spotify Premium. Zeitklang braucht Premium, damit die Musik auf deinem Handy spielt.";

/** Autoplay-Hinweis (Spec §8, SDK-Event autoplay_failed; Parity zu web/app.js). */
export const AUTOPLAY_HINT_MSG =
  "Wiedergabe wurde vom Browser blockiert — tippe auf Play, um den Song zu starten.";

/** Login abgebrochen — Zustimmung bei Spotify verweigert (Parity zu web/app.js #58 LOGIN_DENIED_MSG). */
export const LOGIN_DENIED_MSG =
  "Anmeldung bei Spotify wurde abgebrochen. Tippe auf „Erneut versuchen“ und schließe die Anmeldung bei Spotify ab.";

/** State-Mismatch/CSRF — Anmeldung aus Sicherheitsgründen abgebrochen (Spec §3.3; Parity zu web/app.js #58 LOGIN_STATE_MSG). */
export const LOGIN_STATE_MSG =
  "Anmeldung aus Sicherheitsgründen abgebrochen. Bitte erneut versuchen.";

/** Generischer Login-Fehler (Parity zu web/app.js #58 LOGIN_GENERIC_MSG). */
export const LOGIN_GENERIC_MSG =
  "Anmeldung fehlgeschlagen. Bitte Internetverbindung prüfen und erneut versuchen.";

/**
 * Veraltete Login-/Token-Epoche (F401W08 + WH3A1BP): Wiederholtes 403 (z. B.
 * UNKNOWN) NACH dem einmaligen Re-Consent-Redirect — der Token-Tausch gelingt
 * auch mit veralteter Epoche, also darf kein zweiter Re-Consent laufen.
 * Bewusste, HITL-freigegebene Abweichung von web/app.js (kein Pendant dort);
 * der Hinweis lebt in der bestehenden Statuszeile (playerMessage), Fachdetails
 * (403, Reason) bleiben Konsole-only (#10).
 */
export const LOGIN_STALE_MSG =
  "Spotify-Login ist veraltet — bitte vollständig neu anmelden: bei spotify.com abmelden (oder ein privates Browser-Fenster nutzen) und dann in der App neu einloggen.";

/**
 * Fehlende Playback-Berechtigung (71TAZ1B-3): 403 trotz bereits gesetztem
 * Re-Consent-Marker, wenn dem Access-Token user-modify-playback-state oder
 * streaming fehlt — der Consent-Dialog wurde nicht mit ALLEN Berechtigungen
 * bestätigt. Wird in state/player.ts (zweites 403) und state/auth.ts
 * (proaktiver Check in initAuth) gesetzt. Bewusste Abweichung vom
 * F401W08-Text: LOGIN_STALE_MSG bleibt für „alle Scopes vorhanden, aber
 * veraltete Login-Epoche“ erhalten.
 */
export const MISSING_SCOPE_MSG =
  "Spotify hat die Berechtigung zum Steuern der Wiedergabe nicht erteilt — bitte neu anmelden und ALLE Berechtigungen erlauben.";

/**
 * Track-spezifischer 403 (R52EEYK): PUT /me/player/play lehnt einen
 * ungültigen/nicht verfügbaren Titel ab (z. B. Reason UNKNOWN), obwohl die
 * Playback-Scopes nachweislich vollständig oder unbekannt sind — kein
 * Logout, kein Consent-Dialog, nur dieser handlungsanleitende Text.
 */
export const TRACK_UNAVAILABLE_MSG =
  "Der Titel ist bei Spotify nicht verfügbar — bitte eine andere Karte scannen.";

/**
 * Logout-Hinweis (SA8H08W-1): logout() löscht nur die lokalen Anmeldedaten —
 * Spotify hat keinen Revoke-API-Endpunkt, ein (z. B. gestohlener) Refresh-Token
 * bleibt serverseitig gültig, bis die App-Verbindung unter
 * https://spotify.com/account/apps widerrufen wird (einziger Weg).
 * Bewusste Abweichung von web/app.js (kein Pendant dort, UI-Hinweis nur in rework).
 */
export const LOGOUT_HINT_MSG =
  "Abgemeldet — der Zugriff wurde nur auf diesem Gerät entfernt. Um Zeitklang bei Spotify komplett zu sperren, widerrufe die App unter spotify.com/account/apps.";

/**
 * Mappt einen fehlgeschlagenen Play-Request (HTTP-Status + optionaler
 * Spotify-Reason) auf den UI-Text. Der Reason wird nur bei 403 beachtet:
 * 403 + PREMIUM_REQUIRED ist ein Free-Account (gleiche Behandlung wie 412).
 */
export function playErrorMessage(status: number, reason?: string): string {
  if (status === 403 && reason === "PREMIUM_REQUIRED") {
    return LOGIN_PREMIUM_MSG;
  }
  switch (status) {
    case 401:
      return "Session abgelaufen — bitte neu anmelden.";
    case 403:
      return TRACK_UNAVAILABLE_MSG;
    case 404:
      return "Kein aktives Gerät — Player verbindet noch, bitte erneut versuchen.";
    case 412:
      return LOGIN_PREMIUM_MSG;
    default:
      return `Wiedergabe fehlgeschlagen (HTTP ${status}).`;
  }
}

/** Bekannte Login-Fehler-Kinds aus dem OAuth-Redirect (Spec §3.3, Parity zu web/app.js #58 handleRedirect). */
export type LoginErrorKind = "access_denied" | "state_mismatch" | "generic";

/**
 * Login-Fehler-Mapping (Spec §3.3, Parity zu web/app.js #58 handleRedirect):
 * reine Funktion, keine DOM/fetch-Globals (Plan §5.1). kind deckt
 * 'access_denied' | 'state_mismatch' | 'generic' ab; unbekannte kinds
 * fallen auf den generischen Text zurück.
 */
export function loginErrorMessage(kind: LoginErrorKind | (string & {})): string {
  switch (kind) {
    case "access_denied":
      return LOGIN_DENIED_MSG;
    case "state_mismatch":
      return LOGIN_STATE_MSG;
    default:
      return LOGIN_GENERIC_MSG;
  }
}
