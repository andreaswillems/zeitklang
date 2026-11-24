/**
 * fetch mit Timeout (Security-Audit A10:2025, Finding F6) — zentrale
 * Hilfsfunktion in lib/ (Plan §5.1): das fetch selbst wird injiziert,
 * AbortController/setTimeout sind Web-APIs (Browser + Node ≥ 20, Plan §12).
 *
 * Implementierung bewusst mit AbortController + setTimeout statt
 * AbortSignal.timeout, damit vi.useFakeTimers in Tests die Zeit kontrolliert.
 */

/** Typ von AbortSignal.any (neuere DOM-Implementierungen — per Feature-Detection genutzt). */
type AbortSignalAny = (signals: AbortSignal[]) => AbortSignal;

/**
 * Timeout-Fehler — unterscheidbar via err.name === "TimeoutError" (und
 * instanceof TimeoutError). Trägt bewusst KEINEN .status, damit Aufrufer
 * (z. B. getValidToken in lib/tokens.ts) die HTTP-Fehlerbehandlung nicht
 * versehentlich auslösen (nur HTTP 400 verwirft dort den Refresh-Token).
 */
export class TimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`fetch wurde nicht innerhalb von ${timeoutMs} ms beantwortet (Timeout)`);
    this.name = "TimeoutError";
  }
}

/**
 * Führt `f(input, init)` mit einem Timeout von `timeoutMs` aus.
 *
 * - Timeout → reject mit TimeoutError; das an fetch übergebene init.signal
 *   ist danach aborted (AbortController feuert mit dem TimeoutError als reason).
 * - Ein vom Caller gesetztes init.signal wird respektiert und gemerged
 *   (AbortSignal.any, wenn verfügbar; sonst Weiterleitung des abort-Events
 *   auf den eigenen Controller). Das gemergte Signal landet in init.signal.
 * - Der Timer wird nach settle (resolve UND reject) gecleared — keine
 *   dangling timers.
 */
export async function fetchWithTimeout(
  f: typeof fetch,
  input: RequestInfo | URL,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const callerSignal = init.signal ?? null;
  let signal = controller.signal;
  if (callerSignal) {
    const abortSignalCtor = AbortSignal as unknown as { any?: AbortSignalAny };
    if (typeof abortSignalCtor.any === "function") {
      // Gebunden als Methode aufrufen: happy-dom implementiert any() mit
      // `new this()` — eine extrahierte Referenz würde dort scheitern.
      signal = abortSignalCtor.any.call(AbortSignal, [controller.signal, callerSignal]);
    } else if (callerSignal.aborted) {
      controller.abort(callerSignal.reason);
    } else {
      // Fallback ohne AbortSignal.any: abort des Caller-Signals weiterleiten
      callerSignal.addEventListener(
        "abort",
        () => controller.abort(callerSignal.reason),
        {
          once: true,
        },
      );
    }
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      f(input, { ...init, signal }),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          const err = new TimeoutError(timeoutMs);
          controller.abort(err); // fetch sieht danach init.signal.aborted === true
          reject(err);
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
