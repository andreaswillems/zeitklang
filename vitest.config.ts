import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // happy-dom statt jsdom — schneller.
    environment: "happy-dom",
    // happy-dom wird pro Worker wiederverwendet statt pro Testdatei neu erstellt
    // (Vitest-Hinweis „happy-dom was created N times“ weg; per-file Isolation bleibt).
    pool: "vmThreads",
    setupFiles: ["src/test/setup.ts"],
    // explizite Imports (describe/it/expect) statt globals — bessere TS-Typen (§6).
    globals: false,
  },
});
