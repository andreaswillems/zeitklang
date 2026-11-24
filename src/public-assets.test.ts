import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// Phase 4: public/-Assets (Manifest + Icons) liegen in rework/public und werden
// 1:1 nach dist/ kopiert (keine Recompression). Die
// Byte-Parity zu web/ wurde während der Migration geprüft; seit dem Cutover
// (Phase 7, 2026-11-23) ist web/ entfernt — public/ ist damit die Referenz.
// Vitest läuft mit cwd = rework/ (Hausstil wie index.html.test.ts).
const FILES = [
  "manifest.webmanifest",
  "icon.png",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "icons/icon-maskable-512.png",
];

describe("public/ (PWA-Assets)", () => {
  it("Manifest + Icons liegen in public/ und sind nicht leer", () => {
    for (const file of FILES) {
      const content = readFileSync(resolve(process.cwd(), "public", file));
      expect(content.length > 0, file).toBe(true);
    }
  });

  it("manifest.webmanifest ist valides JSON mit relativen Pages-Pfaden", () => {
    const manifest = JSON.parse(
      readFileSync(resolve(process.cwd(), "public", "manifest.webmanifest"), "utf8"),
    );
    expect(manifest.start_url).toBe("./");
    expect(manifest.scope).toBe("./");
    expect(manifest.display).toBe("standalone");
    expect(manifest.icons.map((icon: { src: string }) => icon.src)).toEqual([
      "icons/icon-192.png",
      "icons/icon-512.png",
      "icons/icon-maskable-512.png",
    ]);
  });
});
