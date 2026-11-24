/**
 * OAuth-Redirect-Handling (Spec §3.3/§3.6) — reine Logik in lib/ (Plan §5.1):
 * keine location/history/DOM-Globals, alle Abhängigkeiten werden injiziert
 * (RedirectDeps). Nachfolger von handleRedirect in web/app.js — Storage-Keys
 * sind Parity zu web/app.js KEYS.
 */

import { loginErrorMessage } from "./errors.ts";
import type { Storage } from "./storage.ts";

/** Storage-Keys — Parity zu web/app.js KEYS. */
export const KEYS = {
  state: "zeitklang_state",
  verifier: "zeitklang_verifier",
  forceConsent: "zeitklang_force_consent",
  // Bewusste Abweichung von web/app.js (additiv, HITL-freigegeben, Epiq
  // F401W08 + WH3A1BP, Kommentar VDCF9WY): Bei einer veralteten Login-/Token-
  // Epoche gibt es keinen Web-Playback — check_scope → 403, Play-Transfer →
  // 403 UNKNOWN. Der Player-Store setzt diesen persistenten Marker beim ersten
  // sonstigen 403 VOR dem Force-Consent-Redirect; überlebt Reload und App-
  // Logout und wird NUR bei erfolgreichem Play geräumt. Er fängt ein erneutes
  // 403 nach dem Redirect ab, statt in den Re-Consent-Loop zu führen — der
  // Token-Tausch gelingt auch mit veralteter Epoche.
  reconsentPending: "zeitklang_reconsent_pending",
} as const;

/**
 * Injizierte Abhängigkeiten (Plan §5.1). Im Produktivcode hängen
 * sessionStorage/localStorage (via webStorage), requestToken aus lib/tokens.ts
 * und history.replaceState daran; `search` ist location.pathname +
 * location.search. In Tests InMemoryStorage + gemockte Callbacks.
 */
export interface RedirectDeps {
  /** zeitklang_state + zeitklang_verifier (flüchtig) — sessionStorage. */
  session: Storage;
  /** zeitklang_force_consent (dauerhaft) — localStorage. */
  local: Storage;
  /** Token-Tausch aus lib/tokens.ts. */
  requestToken: (body: Record<string, string>) => Promise<void>;
  /** history.replaceState(null, "", path) — räumt den einmaligen Code aus der URL. */
  replaceState: (path: string) => void;
  redirectUri: string;
  clientId: string;
}

/** Fehler aus handleRedirect trägt den UI-Text in .userMsg (Parity web/app.js err.userMsg). */
export type RedirectError = Error & { userMsg: string };

/**
 * Wertet code/state/error aus dem Redirect-Query aus (Spec §3.3, Parity zu
 * web/app.js handleRedirect), egal auf welchem Pfad (`search` = Pfad + Query,
 * z. B. "/callback?code=…&state=…"):
 *
 * - weder code noch error → no-op (nichts strippen, kein Token-Tausch)
 * - sonst → Query per replaceState(pathname) strippen (Code ist einmalig)
 * - error → throw mit userMsg = loginErrorMessage('access_denied') bzw.
 *   loginErrorMessage('generic'); das forceConsent-Flag bleibt gesetzt
 *   (Spec §3.6: nächster Login erzwingt show_dialog erneut)
 * - state-Mismatch → throw mit userMsg = loginErrorMessage('state_mismatch')
 *   (CSRF, Spec §3.3), kein Token-Tausch
 * - Erfolg → state + verifier aus der Session entfernen, dann
 *   requestToken({grant_type: 'authorization_code', code, redirect_uri,
 *   client_id, code_verifier: verifier}), danach das forceConsent-Flag aus
 *   dem Local-Storage entfernen (erst nach erfolgreichem Tausch, Spec §3.6)
 */
export async function handleRedirect(search: string, deps: RedirectDeps): Promise<void> {
  const queryStart = search.indexOf("?");
  const pathname = queryStart === -1 ? search : search.slice(0, queryStart);
  const params = new URLSearchParams(
    queryStart === -1 ? "" : search.slice(queryStart + 1),
  );
  const code = params.get("code");
  const error = params.get("error");
  if (!code && !error) return;
  deps.replaceState(pathname); // Code ist einmalig
  if (error) {
    // #58: access_denied = Zustimmung bei Spotify abgebrochen — gezielte
    // Meldung statt generischem „Login fehlgeschlagen“.
    const err = new Error(`Spotify: ${error}`) as RedirectError;
    err.userMsg = loginErrorMessage(
      error === "access_denied" ? "access_denied" : "generic",
    );
    throw err;
  }
  if (params.get("state") !== deps.session.getItem(KEYS.state)) {
    const err = new Error(
      "Ungültiger state (CSRF-Schutz) — Login abgebrochen",
    ) as RedirectError;
    err.userMsg = loginErrorMessage("state_mismatch");
    throw err;
  }
  const verifier = deps.session.getItem(KEYS.verifier);
  deps.session.removeItem(KEYS.state);
  deps.session.removeItem(KEYS.verifier);
  await deps.requestToken({
    grant_type: "authorization_code",
    code: code as string, // ohne code && ohne error wurde oben bereits returnt
    redirect_uri: deps.redirectUri,
    client_id: deps.clientId,
    code_verifier: verifier ?? "",
  });
  // Erst nach erfolgreichem Token-Tausch das Logout-Flag zurücksetzen —
  // bei abgebrochenem Dialog (access_denied) bleibt es gesetzt (Spec §3.6).
  deps.local.removeItem(KEYS.forceConsent);
}
