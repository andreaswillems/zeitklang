import { describe, expect, it } from "vitest";
import { LOGIN_DENIED_MSG, LOGIN_GENERIC_MSG, LOGIN_STATE_MSG } from "./errors.ts";
import { handleRedirect } from "./redirect.ts";
import { InMemoryStorage } from "./storage.ts";

// Unit-Tests für lib/redirect.ts (Spec §3.3, Parity zu web/app.js
// handleRedirect). Reines Modul (Plan §5.1): keine location/history/DOM-
// Globals — alle Deps werden injiziert. Erwarteter Kontrakt für redirect.ts:
//
//   interface RedirectDeps {
//     session: Storage;   // zeitklang_state + zeitklang_verifier (flüchtig)
//     local: Storage;     // zeitklang_force_consent (dauerhaft)
//     requestToken: (body: Record<string, string>) => Promise<void>; // aus lib/tokens.ts
//     replaceState: (path: string) => void; // history.replaceState(null, "", path)
//     redirectUri: string;
//     clientId: string;
//   }
//   handleRedirect(search: string, deps: RedirectDeps): Promise<void>
//
// `search` ist Pfad + Query der aktuellen URL (z. B. "/callback?code=…&state=…",
// im Produktivcode location.pathname + location.search); die Query wird per
// replaceState(pathname) gestrippt. Storage-Keys Parity zu web/app.js KEYS.

const REDIRECT_URI = "https://127.0.0.1:8080/callback";
const CLIENT_ID = "test-client-id";

// Storage-Keys — Parity zu web/app.js KEYS
const STATE = "zeitklang_state";
const VERIFIER = "zeitklang_verifier";
const FORCE_CONSENT = "zeitklang_force_consent";

// Deps-Fabrik: InMemory-Storage + gemocktes requestToken/replaceState (zeichnen Calls auf)
function makeDeps() {
  const session = new InMemoryStorage();
  const local = new InMemoryStorage();
  const replaceStateCalls: string[] = [];
  const tokenBodies: Record<string, string>[] = [];
  const deps = {
    session,
    local,
    requestToken: async (body: Record<string, string>) => {
      tokenBodies.push(body);
    },
    replaceState: (path: string) => {
      replaceStateCalls.push(path);
    },
    redirectUri: REDIRECT_URI,
    clientId: CLIENT_ID,
  };
  return { deps, session, local, replaceStateCalls, tokenBodies };
}

// Login-Zustand in der Session (state + verifier gesetzt, wie nach login())
function seedLogin(session: InMemoryStorage): void {
  session.setItem(STATE, "state-1");
  session.setItem(VERIFIER, "verifier-abc");
}

async function catchErr(p: Promise<unknown>): Promise<unknown> {
  return p.catch((e: unknown) => e);
}

describe("handleRedirect", () => {
  it("ohne code und error → no-op: kein replaceState, kein requestToken", async () => {
    const { deps, replaceStateCalls, tokenBodies } = makeDeps();
    await expect(handleRedirect("/callback?foo=bar", deps)).resolves.toBeUndefined();
    await expect(handleRedirect("", deps)).resolves.toBeUndefined();
    expect(replaceStateCalls).toEqual([]);
    expect(tokenBodies).toEqual([]);
  });

  it("code in der URL → Query wird per replaceState(pathname) gestrippt", async () => {
    const { deps, session, replaceStateCalls } = makeDeps();
    seedLogin(session);
    await handleRedirect("/callback?code=auth-code-123&state=state-1", deps);
    expect(replaceStateCalls).toEqual(["/callback"]);
  });

  it("error in der URL → Query wird per replaceState(pathname) gestrippt", async () => {
    const { deps, replaceStateCalls } = makeDeps();
    const err = await catchErr(handleRedirect("/callback?error=access_denied", deps));
    expect(err).toBeInstanceOf(Error);
    expect(replaceStateCalls).toEqual(["/callback"]);
  });

  it("error=access_denied → throw mit userMsg = LOGIN_DENIED_MSG; forceConsent-Flag bleibt im Local-Storage (Spec §3.6)", async () => {
    const { deps, local, tokenBodies } = makeDeps();
    local.setItem(FORCE_CONSENT, "1");
    const err = await catchErr(handleRedirect("/callback?error=access_denied", deps));
    expect(err).toBeInstanceOf(Error);
    expect((err as Error & { userMsg: string }).userMsg).toBe(LOGIN_DENIED_MSG);
    // bei access_denied bleibt das Flag gesetzt ( nächster Login erzwingt show_dialog)
    expect(local.getItem(FORCE_CONSENT)).toBe("1");
    expect(tokenBodies).toEqual([]); // kein Token-Tausch
  });

  it("anderer error → throw mit userMsg = LOGIN_GENERIC_MSG", async () => {
    const { deps } = makeDeps();
    const err = await catchErr(handleRedirect("/callback?error=server_error", deps));
    expect(err).toBeInstanceOf(Error);
    expect((err as Error & { userMsg: string }).userMsg).toBe(LOGIN_GENERIC_MSG);
  });

  it("state-Mismatch (state param !== session state) → throw mit userMsg = LOGIN_STATE_MSG (CSRF, Spec §3.3)", async () => {
    const { deps, session, tokenBodies } = makeDeps();
    seedLogin(session);
    const err = await catchErr(
      handleRedirect("/callback?code=auth-code-123&state=gehackt", deps),
    );
    expect(err).toBeInstanceOf(Error);
    expect((err as Error & { userMsg: string }).userMsg).toBe(LOGIN_STATE_MSG);
    expect(tokenBodies).toEqual([]); // kein Token-Tausch bei CSRF-Verdacht
  });

  it("Erfolg → requestToken({grant_type: 'authorization_code', code, redirect_uri, client_id, code_verifier}); state + verifier aus Session entfernt, forceConsent aus Local entfernt", async () => {
    const { deps, session, local, replaceStateCalls, tokenBodies } = makeDeps();
    seedLogin(session);
    local.setItem(FORCE_CONSENT, "1");
    await handleRedirect("/callback?code=auth-code-123&state=state-1", deps);
    expect(replaceStateCalls).toEqual(["/callback"]);
    expect(tokenBodies).toHaveLength(1);
    expect(tokenBodies[0]).toEqual({
      grant_type: "authorization_code",
      code: "auth-code-123",
      redirect_uri: REDIRECT_URI,
      client_id: CLIENT_ID,
      code_verifier: "verifier-abc",
    });
    expect(session.getItem(STATE)).toBeNull();
    expect(session.getItem(VERIFIER)).toBeNull();
    expect(local.getItem(FORCE_CONSENT)).toBeNull();
  });
});
