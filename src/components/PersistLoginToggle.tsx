import { persistLogin, setPersistLogin } from "../state/auth.ts";
import styles from "./PersistLoginToggle.module.css";

/**
 * „Angemeldet bleiben"-Toggle (YWEC4VR-3; Security-Audit A09: Refresh-Token
 * konfigurierbar — localStorage (Default) vs. sessionStorage). checked
 * folgt dem persistLogin-Signal (state/auth.ts, Subtask YWEC4VR-2); onChange
 * ruft setPersistLogin(!persistLogin.value) — damit landen localStorage-Key
 * zeitklang_persist_login UND die Token-Migration via moveRefreshToken
 * zentral in state/auth.ts.
 *
 * Eingebaut in LoginView (unter dem Login-Button) und im Scan-Header
 * (app.tsx, neben #logout) — damit auch eingeloggte Nutzer wechseln können.
 * Barrierefreiheit: das <label> umschließt die Checkbox, der Text „Angemeldet
 * bleiben" ist damit der zugängliche Name des inputs (kein extra aria-Attribut
 * nötig, Muster wie bestehende Komponenten).
 */
export function PersistLoginToggle() {
  const checked = persistLogin.value;
  return (
    <label class={styles["persist-login"]}>
      <input
        type="checkbox"
        checked={checked}
        onChange={() => setPersistLogin(!persistLogin.value)}
      />
      <span>Angemeldet bleiben</span>
    </label>
  );
}
