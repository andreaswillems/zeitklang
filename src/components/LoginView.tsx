import { authError, login, logoutHint, redirecting } from "../state/auth.ts";
import { installPrompt, openShareDialog, promptInstall } from "../state/ui.ts";
import { InstallIcon, QrIcon, SpotifyIcon, WarningIcon } from "./icons.tsx";
import styles from "./LoginView.module.css";
import { PersistLoginToggle } from "./PersistLoginToggle.tsx";

/**
 * Login-Inhalt (Parity web/index.html L65–104, web/app.js): Wortmarke +
 * EQ-Deko (#57/#63), Spotify-Button in der Daumenzone (#56), Fehlerbereich
 * mit Retry (#58), Premium-Badge (#57), Install- (#18) und Share-Button
 * (#94). Die Sektions-Hülle (id="login", hidden-Switch auf view()) bleibt
 * in app.tsx (3a).
 */
export function LoginView() {
  // #58: disabled/Label nur aus redirecting ableiten — der pageshow-Reset
  // (resetRedirecting() in main.tsx, L641–646) wirkt so ohne extra Wiring.
  const busy = redirecting.value;
  const error = authError.value;
  // SA8H08W-1: Logout-Hinweis — sichtbar nur nach logout() (Signal gesetzt),
  // [hidden]-Mechanik wie #login-error.
  const hint = logoutHint.value;
  return (
    <>
      {/* #57: Wortmarke als zentrierter visueller Anker — das Header-h1 ist
          hier per :has()-Regel in global.css ausgeblendet. */}
      <h2 class={styles.wordmark}>Zeitklang</h2>
      {/* #57: dezente Equalizer-Deko, rein dekorativ (Muster .eq). */}
      <div class={styles["login-eq"]} aria-hidden="true">
        <span />
        <span />
        <span />
        <span />
      </div>
      <p class={styles["hero-text"]}>
        Melde dich an, scanne eine Karte und das Lied spielt auf deinem Handy.
      </p>
      {/* #56/#57: Spotify-Branding-Button fixiert in der Daumenzone.
          Wrapper wie app.js L632: das Click-Event darf nicht als
          forceConsent durchgereicht werden. */}
      <button
        type="button"
        id="login-button"
        class={styles["login-button"]}
        disabled={busy}
        onClick={() => login()}
      >
        <SpotifyIcon />
        <span id="login-label">
          {busy ? "Weiterleitung zu Spotify…" : "Mit Spotify anmelden"}
        </span>
      </button>
      {/* YWEC4VR-3: „Angemeldet bleiben“-Toggle direkt unter dem Login-Button
          (im zentrierten Grid der #login-Sektion); checked/onChange hängen am
          persistLogin-Signal — inkl. Key + Token-Migration in state/auth.ts. */}
      <PersistLoginToggle />
      {/* #58: Fehlerbereich mit „Erneut versuchen“ (showLoginError
          L110–114); während der Weiterleitung ausgeblendet (L125).
          Mikro-Abweichung (akzeptiert): Der Bereich folgt dem authError-
          Signal — nach bfcache-Rückkehr erscheint ein zuvor gesetzter
          Fehler wieder, web/app.js hielt das DOM dagegen versteckt. */}
      <div
        id="login-error"
        class={styles["login-error"]}
        role="alert"
        hidden={busy || error === null}
      >
        <WarningIcon />
        <p id="login-error-text">{error}</p>
        {/* Retry = einfacher Seiten-Reload (L637, Andreas-Entscheidung). */}
        <button
          type="button"
          id="login-retry"
          class="ghost"
          onClick={() => location.reload()}
        >
          Erneut versuchen
        </button>
      </div>
      {/* SA8H08W-1: Logout-Hinweis (LOGOUT_HINT_MSG) — logout() löscht nur
          die lokalen Tokens; Spotify hat keinen Revoke-API-Endpunkt, der
          Widerruf der App-Verbindung geht nur manuell unter
          spotify.com/account/apps. [hidden] greift global (!important). */}
      <p id="logout-hint" class={styles["logout-hint"]} hidden={hint === null}>
        {hint}
      </p>
      {/* #57: Premium-Hinweis als Badge mit Link. */}
      <p class={styles.badge}>
        Benötigt{" "}
        <a href="https://www.spotify.com/premium/" target="_blank" rel="noopener">
          Spotify Premium
        </a>
        .
      </p>
      {/* #18: Install-Button erscheint nur mit beforeinstallprompt-Event;
          der Store nullt das Signal nach prompt()/appinstalled (L724–746). */}
      <button
        type="button"
        id="install-login"
        class={`ghost ${styles["install-login"]}`}
        hidden={installPrompt.value === null}
        onClick={() => void promptInstall()}
      >
        <InstallIcon />
        <span>App installieren</span>
      </button>
      {/* #94: „App teilen“ ist immer sichtbar — Klick flippt nur das
          Signal, der QR-Dialog selbst folgt in Phase 3e (L821). */}
      <button
        type="button"
        id="share-login"
        class={`ghost ${styles["share-login"]}`}
        onClick={openShareDialog}
      >
        <QrIcon />
        <span>App teilen</span>
      </button>
    </>
  );
}
