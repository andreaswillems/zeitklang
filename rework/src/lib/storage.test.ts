import { describe, expect, it } from "vitest";
import { InMemoryStorage, type Storage, webStorage } from "./storage.ts";

describe("InMemoryStorage", () => {
  it("getItem auf leerem Storage liefert null", () => {
    const storage = new InMemoryStorage();
    expect(storage.getItem("zeitklang_access")).toBeNull();
  });

  it("setItem/getItem-Roundtrip", () => {
    const storage = new InMemoryStorage();
    storage.setItem("zeitklang_access", "token-123");
    expect(storage.getItem("zeitklang_access")).toBe("token-123");
  });

  it("überschreibt vorhandene Werte", () => {
    const storage = new InMemoryStorage();
    storage.setItem("key", "a");
    storage.setItem("key", "b");
    expect(storage.getItem("key")).toBe("b");
  });

  it("removeItem löscht einen vorhandenen Key", () => {
    const storage = new InMemoryStorage();
    storage.setItem("key", "v");
    storage.removeItem("key");
    expect(storage.getItem("key")).toBeNull();
  });

  it("removeItem auf fehlendem Key wirft nicht (wie DOM-Storage)", () => {
    const storage = new InMemoryStorage();
    expect(() => storage.removeItem("fehlt")).not.toThrow();
    expect(storage.getItem("fehlt")).toBeNull();
  });

  it("Keys sind case-sensitive (wie DOM-Storage)", () => {
    const storage = new InMemoryStorage();
    storage.setItem("Key", "1");
    expect(storage.getItem("key")).toBeNull();
    expect(storage.getItem("Key")).toBe("1");
  });

  it("clear() räumt alle Keys ab", () => {
    const storage = new InMemoryStorage();
    storage.setItem("a", "1");
    storage.setItem("b", "2");
    storage.clear();
    expect(storage.getItem("a")).toBeNull();
    expect(storage.getItem("b")).toBeNull();
  });
});

describe("webStorage", () => {
  function fakeDomStorage(): Storage & { data: Map<string, string> } {
    const data = new Map<string, string>();
    return {
      data,
      getItem: (key) => data.get(key) ?? null,
      setItem: (key, value) => {
        data.set(key, value);
      },
      removeItem: (key) => {
        data.delete(key);
      },
    };
  }

  it("delegiert getItem/setItem/removeItem an das Backend", () => {
    const backend = fakeDomStorage();
    const storage = webStorage(backend);

    expect(storage.getItem("key")).toBeNull();
    storage.setItem("key", "v");
    expect(backend.data.get("key")).toBe("v");
    expect(storage.getItem("key")).toBe("v");
    storage.removeItem("key");
    expect(backend.data.has("key")).toBe(false);
    expect(storage.getItem("key")).toBeNull();
  });

  it("akzeptiert das echte localStorage aus happy-dom (DOM-Kompatibilität)", () => {
    const storage = webStorage(localStorage);
    storage.setItem("zeitklang_test", "ok");
    expect(localStorage.getItem("zeitklang_test")).toBe("ok");
    storage.removeItem("zeitklang_test");
    expect(localStorage.getItem("zeitklang_test")).toBeNull();
  });
});
