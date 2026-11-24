import { trackIdFrom } from "./track-id.ts";

/** Ergebnis eines geprüften Scans. */
export type ScanVerdict =
  | { kind: "track"; trackId: string }
  | { kind: "invalid"; text: string }
  | { kind: "ignored" };

/**
 * Dubletten-Guard für den kontinuierlichen Scanner (Issue #6, Spec §4): im
 * kontinuierlichen Modus feuert der Decoder für dieselbe Karte jeden Frame.
 *
 * - derselbe Track innerhalb von cooldownMs → { kind: "ignored" }
 *   (kein Vibrieren, kein Re-Play; Parity zu lastScanTrackId/lastScanAt in
 *   web/app.js — Schlüsseln über die Track-ID, nicht den Rohtext, damit auch
 *   dieselbe ID über eine andere URL (z. B. mit Query) ignoriert wird)
 * - derselbe ungültige Text innerhalb von cooldownMs → { kind: "ignored" }
 *   (Meldung nur einmal pro Karte/Zeitfenster; Parity zu
 *   lastInvalidScan/lastInvalidAt in web/app.js)
 *
 * `now` ist für Tests injizierbar (Default: Date.now).
 */
export function createScanGuard(
  cooldownMs: number,
  now: () => number = () => Date.now(),
): (text: string) => ScanVerdict {
  let lastTrackId: string | null = null;
  let lastTrackAt = 0;
  let lastInvalidText: string | null = null;
  let lastInvalidAt = 0;

  return (text: string): ScanVerdict => {
    const trackId = trackIdFrom(text);
    const t = now();
    if (trackId !== null) {
      if (trackId === lastTrackId && t - lastTrackAt < cooldownMs) {
        return { kind: "ignored" };
      }
      lastTrackId = trackId;
      lastTrackAt = t;
      return { kind: "track", trackId };
    }
    if (text === lastInvalidText && t - lastInvalidAt < cooldownMs) {
      return { kind: "ignored" };
    }
    lastInvalidText = text;
    lastInvalidAt = t;
    return { kind: "invalid", text };
  };
}
