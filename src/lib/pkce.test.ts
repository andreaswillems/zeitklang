import { describe, expect, it } from "vitest";
import { base64url, pkceChallenge, randomString } from "./pkce.ts";

describe("randomString", () => {
  // deterministischer RNG-Stub: byte i = i % 256
  const sequential: (length: number) => Uint8Array = (length) =>
    Uint8Array.from({ length }, (_, i) => i % 256);

  it("liefert exakt length Zeichen", () => {
    expect(randomString(64, sequential)).toHaveLength(64);
    expect(randomString(16, sequential)).toHaveLength(16);
    expect(randomString(0, sequential)).toHaveLength(0);
  });

  it("nur unreserved chars (RFC 7636 §4.1: A-Z a-z 0-9 - . _ ~)", () => {
    const s = randomString(1000, sequential);
    expect(s).toMatch(/^[A-Za-z0-9\-._~]+$/);
  });

  it("nutzt das injizierte RNG (byte % 66 → Zeichen)", () => {
    // Alphabet hat 66 Zeichen: byte 0 → 'A', 1 → 'B', 65 → '~'
    const rng = () => Uint8Array.from([0, 1, 65]);
    expect(randomString(3, rng)).toBe("AB~");
  });
});

describe("base64url", () => {
  it("kodiert ohne Padding (RFC 4648 §5)", () => {
    // "Man" → "TWFu"; 1 Byte → 2 Zeichen; 2 Bytes → 3 Zeichen
    expect(base64url(new TextEncoder().encode("Man"))).toBe("TWFu");
    expect(base64url(Uint8Array.from([0x66]))).toBe("Zg");
    expect(base64url(Uint8Array.from([0x66, 0x6f]))).toBe("Zm8");
  });

  it("nutzt - und _ statt + und /", () => {
    // 0xfb 0xff → "+/8=" in base64, "-_8" in base64url
    expect(base64url(Uint8Array.from([0xfb, 0xff]))).toBe("-_8");
  });

  it("leerer Input → leerer Output", () => {
    expect(base64url(new Uint8Array(0))).toBe("");
  });
});

describe("pkceChallenge (S256)", () => {
  it("RFC-7636-Testvektor (Appendix B)", async () => {
    const verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
    expect(await pkceChallenge(verifier)).toBe(
      "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
    );
  });

  it("liefert 43 Zeichen (32 Bytes SHA-256, unpadded) im base64url-Alphabet", async () => {
    const challenge = await pkceChallenge("irgendein-verifier");
    expect(challenge).toHaveLength(43);
    expect(challenge).toMatch(/^[A-Za-z0-9\-_]+$/);
  });
});
