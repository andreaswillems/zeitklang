import { describe, expect, it } from "vitest";
import { createScanGuard } from "./scan-guard.ts";

const ID_A = "4uLU6hMCjMI75M1A2tKUQC";
const ID_B = "6rqhFgbbKwnb9MLmUQAbmH";
const TRACK_A = `https://open.spotify.com/track/${ID_A}`;
const TRACK_A_QUERY = `https://open.spotify.com/track/${ID_A}?si=xyz`;
const TRACK_B = `spotify:track:${ID_B}`;
const INVALID = "https://example.com/kein-track";

// fakes Clock: manuell weiterdrehen
function fakeClock(start: number) {
  let t = start;
  return {
    now: () => t,
    advance: (ms: number) => {
      t += ms;
    },
  };
}

describe("createScanGuard", () => {
  it("akzeptiert einen Track beim ersten Scan", () => {
    const clock = fakeClock(1_000);
    const guard = createScanGuard(5000, clock.now);
    expect(guard(TRACK_A)).toEqual({ kind: "track", trackId: ID_A });
  });

  it("ignoriert dieselbe Track-ID innerhalb des Cooldowns (auch über andere URL mit Query)", () => {
    const clock = fakeClock(1_000);
    const guard = createScanGuard(5000, clock.now);
    expect(guard(TRACK_A)).toEqual({ kind: "track", trackId: ID_A });
    clock.advance(1000);
    expect(guard(TRACK_A)).toEqual({ kind: "ignored" });
    clock.advance(1000);
    // dieselbe ID, anderer Rohtext (Query) → trotzdem Dublette
    expect(guard(TRACK_A_QUERY)).toEqual({ kind: "ignored" });
  });

  it("akzeptiert dieselbe Track-ID nach Ablauf des Cooldowns", () => {
    const clock = fakeClock(1_000);
    const guard = createScanGuard(5000, clock.now);
    guard(TRACK_A);
    clock.advance(4999);
    expect(guard(TRACK_A)).toEqual({ kind: "ignored" });
    clock.advance(1); // exakt 5000 ms seit letztem Scan
    expect(guard(TRACK_A)).toEqual({ kind: "track", trackId: ID_A });
  });

  it("akzeptiert eine andere Track-ID innerhalb des Cooldowns", () => {
    const clock = fakeClock(1_000);
    const guard = createScanGuard(5000, clock.now);
    guard(TRACK_A);
    clock.advance(100);
    expect(guard(TRACK_B)).toEqual({ kind: "track", trackId: ID_B });
  });

  it("ungültiger Text: erstmalig gemeldet, im Cooldown ignoriert, danach wieder gemeldet", () => {
    const clock = fakeClock(1_000);
    const guard = createScanGuard(5000, clock.now);
    expect(guard(INVALID)).toEqual({ kind: "invalid", text: INVALID });
    clock.advance(2000);
    expect(guard(INVALID)).toEqual({ kind: "ignored" });
    clock.advance(3000);
    expect(guard(INVALID)).toEqual({ kind: "invalid", text: INVALID });
  });

  it("anderer ungültiger Text innerhalb des Cooldowns wird gemeldet", () => {
    const clock = fakeClock(1_000);
    const guard = createScanGuard(5000, clock.now);
    expect(guard(INVALID)).toEqual({ kind: "invalid", text: INVALID });
    clock.advance(100);
    const other = "noch ein falscher qr";
    expect(guard(other)).toEqual({ kind: "invalid", text: other });
  });

  it("Track- und Invalid-Cooldown sind unabhängig", () => {
    const clock = fakeClock(1_000);
    const guard = createScanGuard(5000, clock.now);
    guard(TRACK_A);
    clock.advance(100);
    expect(guard(INVALID)).toEqual({ kind: "invalid", text: INVALID });
    clock.advance(100);
    // derselbe Track trotz zwischenzeitlichem Invalid-Scan weiterhin Dublette
    expect(guard(TRACK_A)).toEqual({ kind: "ignored" });
    // derselbe Invalid-Text trotz zwischenzeitlichem Track weiterhin Dublette
    expect(guard(INVALID)).toEqual({ kind: "ignored" });
  });

  it("Default-Clock (Date.now) funktioniert ohne injiziertes now", () => {
    const guard = createScanGuard(5000);
    expect(guard(TRACK_A)).toEqual({ kind: "track", trackId: ID_A });
    expect(guard(TRACK_A)).toEqual({ kind: "ignored" });
  });
});
