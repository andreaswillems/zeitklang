import { defineConfig } from "vitest/config";

export default defineConfig({
    test: {
        // happy-dom statt jsdom — schneller (docs/pwa-rebuild.md §2).
        environment: "happy-dom",
        setupFiles: ["src/test/setup.ts"],
        // explizite Imports (describe/it/expect) statt globals — bessere TS-Typen (§6).
        globals: false,
    },
});
