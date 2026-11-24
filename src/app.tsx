import { LogoutIcon } from "./components/icons.tsx";
import { LoadingView } from "./components/LoadingView.tsx";
import { LoginView } from "./components/LoginView.tsx";
import { MiniPlayer } from "./components/MiniPlayer.tsx";
import toggleStyles from "./components/PersistLoginToggle.module.css";
import { PersistLoginToggle } from "./components/PersistLoginToggle.tsx";
import { PlayerSheet } from "./components/PlayerSheet.tsx";
import scanStyles from "./components/ScanView.module.css";
import { ScanView } from "./components/ScanView.tsx";
import { ShareDialog } from "./components/ShareDialog.tsx";
import { logout } from "./state/auth.ts";
import { playerMessage } from "./state/player.ts";
import { online, view } from "./state/ui.ts";

// #17: Offline-Hinweis über die globale Statuszeile, byte-genau aus
// web/app.js L281–282 (Parity updateOnlineHint L583–598).
const OFFLINE_MSG =
  "Keine Internetverbindung. Scannen und Wiedergabe brauchen Internet — bitte WLAN oder Mobilfunk prüfen.";

/**
 * App-Shell (Plan §5.3): Header + View-Switch auf view() + Statuszeile.
 * Parity zu web/index.html und web/app.js show L573–585. LoginView,
 * LoadingView (3b) und ScanView (3c) sind montiert; die Sektions-Hüllen
 * (id bleibt für die :has()-Regeln in global.css) bleiben hier — die
 * Sektions-Regeln #scan/#status (web/style.css L558–568) liegen im
 * ScanView.module.css und werden hier per Klasse appliziert.
 */
export function App() {
  const current = view.value;
  return (
    <>
      <header>
        <h1>Zeitklang</h1>
        {/* YWEC4VR-3: „Angemeldet bleiben“-Toggle im Scan-Header neben dem
            #logout-Icon — hidden analog current !== scan, damit auch
            eingeloggte Nutzer die Speicher-Einstellung wechseln können. */}
        <div class={toggleStyles.header} hidden={current !== "scan"}>
          <PersistLoginToggle />
        </div>
        {/* #38: Abmelden-Icon oben rechts gehört zur Scan-Ansicht (show L576). */}
        <button
          type="button"
          id="logout"
          hidden={current !== "scan"}
          aria-label="Abmelden"
          onClick={logout}
        >
          <LogoutIcon />
        </button>
      </header>
      <main>
        {/* #8: Ladezustand endet erst mit der Ziel-Ansicht; der Inhalt
            (Spinner + Text) kommt aus LoadingView (3b). */}
        <section id="loading" role="status" hidden={current !== "loading"}>
          <LoadingView />
        </section>
        <section id="login" hidden={current !== "login"}>
          <LoginView />
        </section>
        <section id="scan" class={scanStyles.scan} hidden={current !== "scan"}>
          <ScanView />
        </section>
        {/* #37: Sheet-Backdrop + Player-Sheet als Geschwister der Sektionen
            in <main> (web/index.html L191 ff., vor der Statuszeile L248). */}
        <PlayerSheet />
        {/* #7: Persistenter Mini-Player als Geschwister des Player-Sheets in
            <main> (web/index.html L219–231, vor der Statuszeile). */}
        <MiniPlayer />
        {/* #94: Share-QR-Dialog als Geschwister nach dem Mini-Player in
            <main> (web/index.html L238–247, vor der Statuszeile L248). */}
        <ShareDialog />
        {/* #17: Statuszeilen-Merging (3d) — abgeleitet statt imperativ:
            offline → OFFLINE_MSG überschreibt alles, sonst playerMessage.
            Bewusste Anpassung des imperativen offlineShown-Musters
            (web/app.js updateOnlineHint L583–598): Dort verhindert ein
            offlineShown-Flag, dass der online-Zweig Queue-/SDK-Meldungen
            (#9) wegputzt. Als Derived State leistet das der offline-Vorrang
            direkt: !online gewinnt über playerMessage, und sobald online
            wieder true ist, erscheint playerMessage von allein wieder —
            kein Flag, das synchron gehalten werden müsste. */}
        <p id="status" role="alert" class={scanStyles.status}>
          {online.value ? (playerMessage.value ?? "") : OFFLINE_MSG}
        </p>
      </main>
    </>
  );
}
