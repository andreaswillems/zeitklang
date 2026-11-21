import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import preact from "@preact/preset-vite";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

// Repo-Root (eine Ebene über rework/) — mkcert-Zertifikate liegen in .cache/ (gitignored).
const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const certPath = `${repoRoot}.cache/serve-127.0.0.1.pem`;
const keyPath = `${repoRoot}.cache/serve-127.0.0.1-key.pem`;

// TLS für `vite preview` via mkcert (analog serve.py ensure_cert, docs/pwa-rebuild.md §4):
// nur aktiv, wenn die Zertifikate lokal existieren — sonst plain HTTP (undefined).
const https =
  existsSync(certPath) && existsSync(keyPath)
    ? { cert: readFileSync(certPath), key: readFileSync(keyPath) }
    : undefined;

export default defineConfig({
  // base './' — alle Asset-URLs relativ (Pages-Base-Pfad /zeitklang/, Spec §11).
  base: "./",
  build: {
    outDir: "dist",
    // CSP: keine Inline-/data-URL-Assets (§7).
    assetsInlineLimit: 0,
  },
  plugins: [
    preact(),
    VitePWA({
      strategies: "injectManifest",
      srcDir: "src",
      filename: "sw.ts",
      registerType: "autoUpdate",
      // Manifest + Icons liegen unverändert in public/ (Phase 4).
      manifest: false,
      includeAssets: ["manifest.webmanifest", "icon.png", "icons/**/*"],
      injectManifest: {
        globPatterns: ["**/*.{js,css,html,png,webmanifest}"],
      },
    }),
  ],
  preview: {
    https,
  },
});
