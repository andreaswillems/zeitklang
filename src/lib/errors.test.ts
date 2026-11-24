import { describe, expect, it } from "vitest";
import {
  AUTOPLAY_HINT_MSG,
  LOGIN_DENIED_MSG,
  LOGIN_GENERIC_MSG,
  LOGIN_PREMIUM_MSG,
  LOGIN_STALE_MSG,
  LOGIN_STATE_MSG,
  LOGOUT_HINT_MSG,
  loginErrorMessage,
  MISSING_SCOPE_MSG,
  playErrorMessage,
} from "./errors.ts";

// Play-Fehler-Mapping (Spec §5.6, Parity zu web/app.js playTrack/putPlay):
// reine Funktion, keine DOM/fetch-Globals (Plan §5.1). #10/#58: Fachdetails
// (HTTP-Status, Reason) wandern nur in die Konsole — hier zählt nur der
// handlungsanleitende UI-Text.

describe("playErrorMessage", () => {
  it("403 + reason PREMIUM_REQUIRED → Premium-Text (Free-Account, Spec §5.6)", () => {
    expect(playErrorMessage(403, "PREMIUM_REQUIRED")).toBe(LOGIN_PREMIUM_MSG);
  });

  it("412 → Premium-Text", () => {
    expect(playErrorMessage(412)).toBe(LOGIN_PREMIUM_MSG);
  });

  it("401 → Session abgelaufen", () => {
    expect(playErrorMessage(401)).toBe("Session abgelaufen — bitte neu anmelden.");
  });

  it("403 mit anderem/keinem Reason → Fehlende Scopes", () => {
    expect(playErrorMessage(403, "OTHER_REASON")).toBe(
      "Fehlende Scopes — bitte neu anmelden.",
    );
    expect(playErrorMessage(403)).toBe("Fehlende Scopes — bitte neu anmelden.");
  });

  it("404 → kein aktives Gerät", () => {
    expect(playErrorMessage(404)).toBe(
      "Kein aktives Gerät — Player verbindet noch, bitte erneut versuchen.",
    );
  });

  it("Fallback enthält den HTTP-Status (Reason wird nur bei 403 beachtet)", () => {
    expect(playErrorMessage(500)).toBe("Wiedergabe fehlgeschlagen (HTTP 500).");
    expect(playErrorMessage(500, "PREMIUM_REQUIRED")).toBe(
      "Wiedergabe fehlgeschlagen (HTTP 500).",
    );
    expect(playErrorMessage(400)).toBe("Wiedergabe fehlgeschlagen (HTTP 400).");
  });
});

describe("exportierte Konstanten", () => {
  it("LOGIN_PREMIUM_MSG (Parity web/app.js, Wiederverwendung durch QKEQRY5-2)", () => {
    expect(LOGIN_PREMIUM_MSG).toBe(
      "Dein Account hat kein Spotify Premium. Zeitklang braucht Premium, damit die Musik auf deinem Handy spielt.",
    );
  });

  it("AUTOPLAY_HINT_MSG (Spec §8, SDK-Event autoplay_failed)", () => {
    expect(AUTOPLAY_HINT_MSG).toBe(
      "Wiedergabe wurde vom Browser blockiert — tippe auf Play, um den Song zu starten.",
    );
  });

  it("LOGIN_DENIED_MSG (Parity web/app.js #58)", () => {
    expect(LOGIN_DENIED_MSG).toBe(
      "Anmeldung bei Spotify wurde abgebrochen. Tippe auf „Erneut versuchen“ und schließe die Anmeldung bei Spotify ab.",
    );
  });

  it("LOGIN_STATE_MSG (state-Mismatch/CSRF, Spec §3.3, Parity web/app.js #58)", () => {
    expect(LOGIN_STATE_MSG).toBe(
      "Anmeldung aus Sicherheitsgründen abgebrochen. Bitte erneut versuchen.",
    );
  });

  it("LOGIN_GENERIC_MSG (Parity web/app.js #58)", () => {
    expect(LOGIN_GENERIC_MSG).toBe(
      "Anmeldung fehlgeschlagen. Bitte Internetverbindung prüfen und erneut versuchen.",
    );
  });

  it("LOGIN_STALE_MSG (F401W08 + WH3A1BP: veraltete Login/Token-Epoche, wiederholtes 403 nach Re-Consent)", () => {
    expect(LOGIN_STALE_MSG).toBe(
      "Spotify-Login ist veraltet — bitte vollständig neu anmelden: bei spotify.com abmelden (oder ein privates Browser-Fenster nutzen) und dann in der App neu einloggen.",
    );
  });

  it("LOGOUT_HINT_MSG (SA8H08W-1: logout() löscht nur lokale Daten, Widerruf der App unter spotify.com/account/apps — Spotify hat keinen Revoke-API-Endpunkt)", () => {
    expect(LOGOUT_HINT_MSG).toBe(
      "Abgemeldet — der Zugriff wurde nur auf diesem Gerät entfernt. Um Zeitklang bei Spotify komplett zu sperren, widerrufe die App unter spotify.com/account/apps.",
    );
  });

  it("MISSING_SCOPE_MSG (71TAZ1B-3: 403 trotz Re-Consent-Marker, wenn dem Access-Token user-modify-playback-state oder streaming fehlt — handlungsanleitend: neu anmelden und ALLE Berechtigungen erlauben)", () => {
    expect(MISSING_SCOPE_MSG).toBe(
      "Spotify hat die Berechtigung zum Steuern der Wiedergabe nicht erteilt — bitte neu anmelden und ALLE Berechtigungen erlauben.",
    );
  });
});

// Login-Fehler-Mapping (Spec §3.3, Parity zu web/app.js #58 handleRedirect):
// reine Funktion, keine DOM/fetch-Globals (Plan §5.1). kind deckt
// 'access_denied' | 'state_mismatch' | 'generic' ab; unbekannte kinds → generic.

describe("loginErrorMessage", () => {
  it("'access_denied' → LOGIN_DENIED_MSG (Zustimmung bei Spotify abgebrochen, #58)", () => {
    expect(loginErrorMessage("access_denied")).toBe(LOGIN_DENIED_MSG);
  });

  it("'state_mismatch' → LOGIN_STATE_MSG (CSRF-Schutz, Spec §3.3)", () => {
    expect(loginErrorMessage("state_mismatch")).toBe(LOGIN_STATE_MSG);
  });

  it("'generic' → LOGIN_GENERIC_MSG", () => {
    expect(loginErrorMessage("generic")).toBe(LOGIN_GENERIC_MSG);
  });

  it("unbekannter kind → Fallback LOGIN_GENERIC_MSG", () => {
    expect(loginErrorMessage("invalid_scope")).toBe(LOGIN_GENERIC_MSG);
  });
});
