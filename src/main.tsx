import { render } from "preact";
import { App } from "./app.tsx";
import { initAuth, initPersistLogin, resetRedirecting } from "./state/auth.ts";
import "./styles/global.css";

const root = document.getElementById("app");
if (root) {
  // XQSXXEX: Preacts render() entfernt unbeanspruchte statische Kinder nicht —
  // den Pre-JS-Ladezustand aus index.html vor dem Mount explizit ersetzen.
  root.replaceChildren();
  render(<App />, root);
}

// YWEC4VR-2: persistLogin VOR initAuth einlesen — initAuth hängt sein
// refresh-Dep an refreshStorage() = persistLogin ? local : session.
initPersistLogin();

// WH3A1BP-1 (Smoke-Test-Fund): Auth-Restore anstoßen — ohne diesen Aufruf bliebe
// authStatus für immer auf "loading" und die App zeigte endlos den Spinner
// „Anmeldung läuft…". Fire-and-forget: initAuth fängt selbst ab und setzt am
// Ende authStatus (ready|logged-out); der View-Effekt in state/ui.ts wechselt
// dann von #loading auf die Ziel-Ansicht (Parity web/app.js init L610–622).
initAuth();

// #17: Service Worker registrieren — App-Shell offline ladbar, Android-
// Install-Prompt zuverlässig (#18). Spec §11: relativer Pfad wegen
// /zeitklang/. Non-blocking: Die App läuft auch ohne SW weiter, ein Fehler
// geht nur in die Konsole (Parity web/app.js init L604–609).
if ("serviceWorker" in navigator) {
  navigator.serviceWorker
    .register(`${import.meta.env.BASE_URL}sw.js`)
    .catch((err) => console.error("SW-Registrierung fehlgeschlagen:", err));
}

// #58: bfcache-Rückkehr (Zurück-Button nach dem Redirect): pageshow mit
// persisted setzt das Redirecting-Flag zurück, ein frischer Tap startet den
// Login erneut (Parity web/app.js L639–645; der Login-Button-Reset folgt
// mit LoginView in 3b).
window.addEventListener("pageshow", (event) => {
  if (!event.persisted) return;
  resetRedirecting();
});
