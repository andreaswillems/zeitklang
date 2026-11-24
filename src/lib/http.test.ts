import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchWithTimeout, TimeoutError } from "./http.ts";

// Unit-Tests für lib/http.ts (Security-Audit A10:2025, Finding F6): fetch mit
// Timeout. Implementierung: AbortController + setTimeout — bewusst KEIN
// AbortSignal.timeout, damit vi.useFakeTimers die Zeit kontrolliert.

const TEST_URL = "https://accounts.spotify.com/api/token";

describe("fetchWithTimeout", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('nie auflösender fetch: erst nach timeoutMs reject mit TimeoutError (name === "TimeoutError")', async () => {
    const fetchMock = vi.fn<typeof fetch>(() => new Promise<Response>(() => {}));
    const promise = fetchWithTimeout(fetchMock, TEST_URL, {}, 1_000);
    let settled: unknown = null;
    void promise.then(
      () => {
        settled = "resolved";
      },
      (e: unknown) => {
        settled = e;
      },
    );
    await vi.advanceTimersByTimeAsync(999);
    expect(settled).toBeNull(); // vor Ablauf noch nicht settled
    await vi.advanceTimersByTimeAsync(1);
    const err = await promise.catch((e: unknown) => e);
    expect(err).toBeInstanceOf(TimeoutError);
    expect((err as Error).name).toBe("TimeoutError");
    expect(settled).toBe(err);
  });

  it("reicht eine normale Response 1:1 durch (ok/status/body unverändert)", async () => {
    const body = { access_token: "at-1", expires_in: 3600 };
    const fetchMock = vi.fn<typeof fetch>(
      async () => ({ ok: true, status: 200, json: async () => body }) as Response,
    );
    const res = await fetchWithTimeout(fetchMock, TEST_URL, {}, 10_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(res.ok).toBe(true);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(body);
  });

  it("reicht input und init (method/headers/body) an fetch weiter, init trägt zusätzlich signal", async () => {
    const fetchMock = vi.fn<typeof fetch>(
      async () => ({ ok: true, status: 200 }) as Response,
    );
    await fetchWithTimeout(
      fetchMock,
      TEST_URL,
      { method: "POST", headers: { "Content-Type": "x" }, body: "a=b" },
      1_000,
    );
    const [input, init] = fetchMock.mock.calls[0];
    expect(input).toBe(TEST_URL);
    expect(init?.method).toBe("POST");
    expect(init?.headers).toEqual({ "Content-Type": "x" });
    expect(init?.body).toBe("a=b");
    expect(init?.signal).toBeDefined();
  });

  it("cleared den Timer nach resolve — keine dangling timers (vi.getTimerCount() === 0)", async () => {
    const fetchMock = vi.fn<typeof fetch>(
      async () => ({ ok: true, status: 200 }) as Response,
    );
    await fetchWithTimeout(fetchMock, TEST_URL, {}, 10_000);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("cleared den Timer auch nach reject (Timeout) — vi.getTimerCount() === 0", async () => {
    const fetchMock = vi.fn<typeof fetch>(() => new Promise<Response>(() => {}));
    const caught = fetchWithTimeout(fetchMock, TEST_URL, {}, 500).catch(
      (e: unknown) => e,
    );
    await vi.advanceTimersByTimeAsync(500);
    await caught;
    expect(vi.getTimerCount()).toBe(0);
  });

  it("reicht einen fetch-Fehler 1:1 durch und cleared den Timer", async () => {
    const boom = new Error("network down");
    const fetchMock = vi.fn<typeof fetch>(async () => {
      throw boom;
    });
    const err = await fetchWithTimeout(fetchMock, TEST_URL, {}, 10_000).catch(
      (e: unknown) => e,
    );
    expect(err).toBe(boom);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("setzt nach dem Timeout das an fetch übergebene init.signal auf aborted", async () => {
    const fetchMock = vi.fn<typeof fetch>(() => new Promise<Response>(() => {}));
    const caught = fetchWithTimeout(fetchMock, TEST_URL, {}, 500).catch(
      (e: unknown) => e,
    );
    await vi.advanceTimersByTimeAsync(500);
    await caught;
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(init.signal).toBeDefined();
    expect(init.signal?.aborted).toBe(true);
  });

  it("respektiert ein vorhandenes init.signal: caller-abort schlägt bis zum fetch-Signal durch", async () => {
    const caller = new AbortController();
    // Mock wie ein echter fetch: reject mit dem abort-reason, sobald das Signal feuert
    const fetchMock = vi.fn<typeof fetch>(
      (_input, init) =>
        new Promise<Response>((_, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(init.signal?.reason ?? new DOMException("Aborted", "AbortError")),
          );
        }),
    );
    const caught = fetchWithTimeout(
      fetchMock,
      TEST_URL,
      { signal: caller.signal },
      10_000,
    ).catch((e: unknown) => e);
    caller.abort(new DOMException("Aborted", "AbortError"));
    const err = await caught;
    expect(err).not.toBeInstanceOf(TimeoutError);
    expect((err as Error).name).toBe("AbortError");
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(init.signal?.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("bereits abortiertes init.signal wird respektiert (fetch sieht aborted signal, kein Timeout-Fehler)", async () => {
    const caller = new AbortController();
    caller.abort();
    const fetchMock = vi.fn<typeof fetch>((_input, init) => {
      if (init?.signal?.aborted) return Promise.reject(init.signal.reason);
      return new Promise<Response>(() => {});
    });
    const err = await fetchWithTimeout(
      fetchMock,
      TEST_URL,
      { signal: caller.signal },
      10_000,
    ).catch((e: unknown) => e);
    expect(err).not.toBeInstanceOf(TimeoutError);
    expect((err as Error).name).toBe("AbortError");
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(init.signal?.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });
});
