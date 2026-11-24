import { describe, expect, it } from "vitest";
import { trackIdFrom } from "./track-id.ts";

// 22-stellige Base62-ID (klassisches Spotify-Beispiel).
const ID = "4uLU6hMCjMI75M1A2tKUQC";

describe("trackIdFrom", () => {
  it("open.spotify.com/track/<id> ohne Query", () => {
    expect(trackIdFrom(`https://open.spotify.com/track/${ID}`)).toBe(ID);
  });

  it("open.spotify.com/track/<id> mit Query-String", () => {
    expect(
      trackIdFrom(`https://open.spotify.com/track/${ID}?si=abc&utm_source=copy`),
    ).toBe(ID);
  });

  it("spotify:track:<id>", () => {
    expect(trackIdFrom(`spotify:track:${ID}`)).toBe(ID);
  });

  it("/play/<id> (künftige Route der PWA)", () => {
    expect(trackIdFrom(`https://andreaswillems.github.io/zeitklang/play/${ID}`)).toBe(ID);
    expect(trackIdFrom(`/play/${ID}`)).toBe(ID);
  });

  it("matcht auch von Leerzeichen/Neulines umgeben (Regex nicht verankert)", () => {
    expect(trackIdFrom(`  https://open.spotify.com/track/${ID}\n`)).toBe(ID);
  });

  it("ungültige Eingaben → null", () => {
    expect(trackIdFrom("")).toBeNull();
    expect(trackIdFrom("https://example.com/foo")).toBeNull();
    expect(trackIdFrom(`spotify:album:${ID}`)).toBeNull();
    expect(trackIdFrom("kein qr code, nur text")).toBeNull();
  });

  it("ID mit weniger als 22 Zeichen → null", () => {
    expect(trackIdFrom(`https://open.spotify.com/track/${ID.slice(0, 21)}`)).toBeNull();
    expect(trackIdFrom(`spotify:track:${ID.slice(0, 21)}`)).toBeNull();
  });
});
