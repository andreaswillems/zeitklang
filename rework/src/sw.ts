/// <reference lib="webworker" />

// Phase 0: Platzhalter für den injectManifest-Service-Worker, damit `vite build`
// grün läuft. Phase 4 ersetzt diese Datei durch den echten SW
// (Precache + network-first Navigationen, docs/pwa-rebuild.md §7).
declare let self: ServiceWorkerGlobalScope;

declare global {
    interface ServiceWorkerGlobalScope {
        // Injektionspunkt — vite-plugin-pwa ersetzt diesen Ausdruck beim Build.
        __WB_MANIFEST: Array<string | { url: string; revision: string | null }>;
    }
}

const precacheManifest = self.__WB_MANIFEST;

export { precacheManifest };
