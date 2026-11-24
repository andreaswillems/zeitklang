/**
 * UI-Store (Plan §5.2 ui.ts, Spec §6/§8; Parity zu web/app.js show L573–585,
 * init L617–622, logout L259–261, openSheet L660, closeSheet L682).
 * Teil 1 (Subtask QMZ02D0-1): view/sheetOpen-Signale, spoilerOpen/
 * miniPlayerVisible-Computeds, Sheet-Guards + authStatus-Reaktion.
 * Teil 2 (Subtask QMZ02D0-2): Share-Dialog, Install-Prompt, online.
 *
 * DOM/Animation (hidden-Wechsel, Sheet-Fahrt, instant-Parameter) ist bewusst
 * nicht hier — das gehört in die Komponenten (Phase 3d).
 */

import { computed, effect, signal } from "@preact/signals";
import { authStatus } from "./auth.ts";
import { trackLoaded } from "./player.ts";
import { scannerActive } from "./scanner.ts";

export const view = signal<"loading" | "login" | "scan">("loading");
export const sheetOpen = signal(false);
/** #61/#66: Öffnen enthüllt, Schließen verhüllt — kein eigener Spoiler-State. */
export const spoilerOpen = computed(() => sheetOpen.value);
/** #7/#47 (Parity L580/L690): Leiste nur mit Track, closed Sheet und laufendem Scanner. */
export const miniPlayerVisible = computed(
  () => trackLoaded.value && !sheetOpen.value && scannerActive.value,
);

/** Öffnet das Player-Sheet (Parity L660): nur mit geladenem Track, kein Doppel-Open. */
export function openSheet(): void {
  if (sheetOpen.value || !trackLoaded.value) return;
  sheetOpen.value = true;
}

/** Schließt das Player-Sheet (Parity L682): idempotent; kein instant-Parameter (Phase 3d). */
export function closeSheet(): void {
  if (!sheetOpen.value) return;
  sheetOpen.value = false;
}

/**
 * View folgt authStatus (Muster: authStatus-Effekt in state/player.ts):
 * ready → Scan-Ansicht (init L617–622), logged-out → Sheet zu + Login
 * (logout L259–261) — auch beim initialen logged-out (Start ohne Token).
 * loading lässt die View unverändert (#8: Ladezustand endet erst mit der
 * Ziel-Ansicht).
 */
effect(() => {
  switch (authStatus.value) {
    case "ready":
      view.value = "scan";
      return;
    case "logged-out":
      closeSheet();
      view.value = "login";
      return;
    case "loading":
      return;
  }
});

/**
 * #18: beforeinstallprompt-Event (Chromium, nicht in lib.dom) — nur die
 * Mitglieder, die der Store benutzt (Parity L729–743).
 */
export interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  readonly userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
}

/** #94 (Parity L808–819): keine Guards — QR-Rendering/appUrl() ist Phase 3e. */
export const shareDialogOpen = signal(false);

export function openShareDialog(): void {
  shareDialogOpen.value = true;
}

export function closeShareDialog(): void {
  shareDialogOpen.value = false;
}

/** #18 (Parity L729–733): Capture preventDefault()t und merkt sich das Event. */
export const installPrompt = signal<BeforeInstallPromptEvent | null>(null);

/** Exportiert, damit Tests ein Fake-Event direkt injizieren können (happy-dom
 * trägt kein Fake durch ein dispatchtes beforeinstallprompt-Event). */
export function captureInstallPrompt(event: BeforeInstallPromptEvent): void {
  event.preventDefault();
  installPrompt.value = event;
}

/** #18 (Parity L739–743): Event ist nach dem Prompt verbraucht — ob angenommen
 * oder abgebrochen, ist für die UI ohne Bedeutung (kein Wegklick). */
export async function promptInstall(): Promise<void> {
  const event = installPrompt.value;
  if (event === null) return;
  event.prompt();
  await event.userChoice.catch(() => {});
  installPrompt.value = null;
}

/** #17 (Parity L599–600): nur das Signal — Statuszeilen-Text ist Phase 3a. */
export const online = signal(navigator.onLine);

// Window-Listener auf Modul-Ebene (Muster: authStatus-Effekt in state/player.ts);
// die main.tsx-Verdrahtung folgt in Phase 3a.
window.addEventListener("beforeinstallprompt", captureInstallPrompt as EventListener);
window.addEventListener("appinstalled", () => {
  installPrompt.value = null; // Parity L750–753
});
window.addEventListener("online", () => {
  online.value = true;
});
window.addEventListener("offline", () => {
  online.value = false;
});

/** Stellt die Signale für Test-Isolation wieder her. */
export function resetForTests(): void {
  view.value = "loading";
  sheetOpen.value = false;
  shareDialogOpen.value = false;
  installPrompt.value = null;
  online.value = navigator.onLine;
}
