import { describe, expect, it } from "vitest";
import { base64url } from "./pkce.ts";
import {
  missingScopesFromGranted,
  resolveGrantedScopes,
  scopesFromScopeField,
  tokenShape,
  tryScopesFromAccessToken,
} from "./token-scopes.ts";

// Unit-Tests für lib/token-scopes.ts (Ticket 71TAZ1B-1, Diagnose 403 UNKNOWN
// nach Scan+Play, Spec §5.6; BSF4QZM-1: Scope-Quellen-Auflösung; BSF4QZM-2:
// Aufrufer-Rewiring — die JWT-only-Altfunktionen scopesFromAccessToken /
// missingScopes wurden entfernt, ihre Tests entfielen mit).
// BSF4QZM: Spotify liefert aktuell OPAKE Access-Tokens (keine JWTs mehr) —
// die gewährten Scopes kommen primär aus dem scope-Feld der Token-Antwort
// (persistiert in tokens.ts), der JWT-Dekoder ist nur noch Fallback.

// Craft-JWTs: header.payload.signature, Segmente base64url-kodiert
// (Encoder als Stil-Referenz aus pkce.ts übernommen)
const HEADER = base64url(new TextEncoder().encode('{"alg":"RS256","typ":"JWT"}'));
const SIGNATURE = base64url(new TextEncoder().encode("test-signature"));

function b64url(text: string): string {
  return base64url(new TextEncoder().encode(text));
}

function makeJwt(payload: unknown): string {
  return `${HEADER}.${b64url(JSON.stringify(payload))}.${SIGNATURE}`;
}

// JWT mit fest vorgebbarem Payload-Segment (für kaputte base64url/JSON-Tests)
function jwtWithPayloadSegment(segment: string): string {
  return `${HEADER}.${segment}.${SIGNATURE}`;
}

// BSF4QZM-1: Scope-Quellen-Auflösung — primär das persistierte scope-Feld der
// Token-Antwort (tokens.ts), JWT-Dekoder nur Fallback. „null“ = unbekannt =
// KEINE Aussage (opake Tokens sind keine Aussage über fehlende Scopes!).
describe("tryScopesFromAccessToken (BSF4QZM-1)", () => {
  it("opaker Token (z. B. „BQB…“, 1 Segment) → null (nicht als JWT dekodierbar = keine Aussage)", () => {
    expect(tryScopesFromAccessToken("BQB1opaque-access-token-ohne-punkte")).toBeNull();
    expect(tryScopesFromAccessToken("")).toBeNull();
    expect(tryScopesFromAccessToken("nur.zwei")).toBeNull();
    expect(tryScopesFromAccessToken("a.b.c.d")).toBeNull();
  });

  it("JWT mit scp → scp-Liste (Leerzeichen-getrennt, leere Einträge gefiltert)", () => {
    expect(
      tryScopesFromAccessToken(makeJwt({ scp: "streaming  user-read-private " })),
    ).toEqual(["streaming", "user-read-private"]);
  });

  it("dekodierbarer JWT OHNE scp-Feld → [] (dekodierbar, aber keine Scopes — NICHT null)", () => {
    expect(tryScopesFromAccessToken(makeJwt({ sub: "x", exp: 1 }))).toEqual([]);
    expect(tryScopesFromAccessToken(makeJwt({ scp: "" }))).toEqual([]);
    expect(tryScopesFromAccessToken(makeJwt({ scp: 42 }))).toEqual([]);
  });

  it("malformed JWT (kaputtes base64url/JSON im Payload) → null", () => {
    expect(tryScopesFromAccessToken(jwtWithPayloadSegment("!!!kaputt!!!"))).toBeNull();
    expect(
      tryScopesFromAccessToken(jwtWithPayloadSegment(b64url("kein json{"))),
    ).toBeNull();
    expect(tryScopesFromAccessToken(jwtWithPayloadSegment(b64url("42")))).toBeNull();
  });

  it("nie werfen: Nicht-String-Runtime-Input → null", () => {
    expect(tryScopesFromAccessToken(undefined as unknown as string)).toBeNull();
    expect(tryScopesFromAccessToken(null as unknown as string)).toBeNull();
    expect(tryScopesFromAccessToken(42 as unknown as string)).toBeNull();
  });
});

describe("scopesFromScopeField (BSF4QZM-1)", () => {
  it("null/unset → null (unbekannt)", () => {
    expect(scopesFromScopeField(null)).toBeNull();
  });

  it("String → an Leerzeichen gesplittet (leere Einträge gefiltert)", () => {
    expect(scopesFromScopeField("streaming  user-read-private ")).toEqual([
      "streaming",
      "user-read-private",
    ]);
    expect(scopesFromScopeField("streaming")).toEqual(["streaming"]);
  });

  // QE-Runde 1: Leer/Whitespace-only ist UNKNOWN (null) — ein leeres granted
  // ([] statt null) würde den JWT-Fallback in resolveGrantedScopes blockieren
  // und missingScopesFromGranted([]) melden ALLE required als fehlend
  // (False-Positive-Modus, den BSF4QZM beseitigt).
  it("Leer/Whitespace-only → null (unbekannt, kein leeres granted)", () => {
    expect(scopesFromScopeField("")).toBeNull();
    expect(scopesFromScopeField("   ")).toBeNull();
  });
});

describe("resolveGrantedScopes (BSF4QZM-1)", () => {
  const jwt = makeJwt({ scp: "jwt-a jwt-b" });

  it("persistiertes scope-Feld gewinnt vor dem JWT-Dekoder", () => {
    expect(resolveGrantedScopes("field-a field-b", jwt)).toEqual(["field-a", "field-b"]);
  });

  it("scope-Feld gesetzt + opaker Token → scope-Feld (JWT-Fallback greift nicht)", () => {
    expect(resolveGrantedScopes("field-only", "BQB1opak")).toEqual(["field-only"]);
  });

  it("scope-Feld null → Fallback JWT-Dekoder", () => {
    expect(resolveGrantedScopes(null, jwt)).toEqual(["jwt-a", "jwt-b"]);
  });

  it("beides fehlt (scope null + opaker Token) → null (unbekannt)", () => {
    expect(resolveGrantedScopes(null, "BQB1opak")).toBeNull();
  });

  // QE-Runde 1: leeres scope-Feld verhält sich wie ein fehlendes Feld —
  // Fallthrough zum JWT-Fallback (bzw. null bei opakem Token).
  it("scope-Feld leer (Leer/Whitespace) → wie null: JWT-Fallback greift", () => {
    expect(resolveGrantedScopes("", jwt)).toEqual(["jwt-a", "jwt-b"]);
    expect(resolveGrantedScopes("  ", jwt)).toEqual(["jwt-a", "jwt-b"]);
  });

  it("scope-Feld leer + opaker Token → null (unbekannt, kein false-positive [])", () => {
    expect(resolveGrantedScopes("", "BQB1opak")).toBeNull();
    expect(
      missingScopesFromGranted(resolveGrantedScopes("", "BQB1opak"), ["a", "b"]),
    ).toEqual([]);
  });
});

describe("missingScopesFromGranted (BSF4QZM-1)", () => {
  it("granted null (unbekannt) → [] — unbekannt ist NICHT fehlend", () => {
    expect(missingScopesFromGranted(null, ["a", "b"])).toEqual([]);
  });

  it("Teilmenge → Differenz aus required abzüglich granted (Reihenfolge aus required)", () => {
    expect(missingScopesFromGranted(["a", "c"], ["a", "b", "c", "d"])).toEqual([
      "b",
      "d",
    ]);
  });

  it("alle required granted → []", () => {
    expect(missingScopesFromGranted(["a", "b"], ["a", "b"])).toEqual([]);
  });
});

// tokenShape — sichere Konsole-Diagnose (#10 + check:secrets): NIEMALS
// Token-String oder Payload-Werte, nur Segment-Anzahl + Payload-Key-Namen.
describe("tokenShape (BSF4QZM-1)", () => {
  it("opaker Token → 1 Segment, leere payloadKeys — der Token-String taucht nirgends auf", () => {
    const shape = tokenShape("BQB1opaque-access-token");
    expect(shape).toEqual({ segments: 1, payloadKeys: [] });
    expect(JSON.stringify(shape)).not.toContain("BQB1opaque-access-token");
  });

  it("JWT → 3 Segmente + sortierte Payload-Key-Namen (nur Namen, nie Werte)", () => {
    const token = makeJwt({ scp: "geheimer-scope-wert", sub: "geheimer-user", exp: 1 });
    const shape = tokenShape(token);
    expect(shape).toEqual({ segments: 3, payloadKeys: ["exp", "scp", "sub"] });
    const out = JSON.stringify(shape);
    expect(out).not.toContain("geheimer-scope-wert");
    expect(out).not.toContain("geheimer-user");
  });

  it("malformed JWT (kaputtes Payload) → 3 Segmente, leere payloadKeys", () => {
    expect(tokenShape(`${HEADER}.!!!kaputt!!!.${SIGNATURE}`)).toEqual({
      segments: 3,
      payloadKeys: [],
    });
  });

  it("Nicht-String-Runtime-Input → null (nie werfen)", () => {
    expect(tokenShape(undefined as unknown as string)).toBeNull();
    expect(tokenShape(null as unknown as string)).toBeNull();
  });
});
