/**
 * Storage-Abstraktion (Plan §5.1, lib/ — pure Logik, keine DOM-Globals).
 *
 * lib/-Code bekommt ein Storage-Interface als Parameter übergeben. Im
 * Produktivcode ist das ein DOM-Storage (localStorage/sessionStorage) —
 * strukturell kompatibel, siehe webStorage(). In Tests eine InMemoryStorage.
 */

/**
 * Die Teilmenge der Web-Storage-API, die lib/ braucht. Das DOM-Storage
 * (localStorage/sessionStorage) erfüllt dieses Interface strukturell.
 */
export interface Storage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/**
 * Adapter für ein DOM-Storage (localStorage oder sessionStorage).
 * Aufruf im Produktivcode: `webStorage(localStorage)` bzw.
 * `webStorage(sessionStorage)` — der Aufrufer reicht das Global, lib/ selbst
 * referenziert keins (§5.1). Der Wrapper ist die explizite Naht, an der Tests
 * stattdessen eine InMemoryStorage hängen können.
 */
export function webStorage(backend: Storage): Storage {
  return {
    getItem: (key) => backend.getItem(key),
    setItem: (key, value) => backend.setItem(key, value),
    removeItem: (key) => backend.removeItem(key),
  };
}

/**
 * In-Memory-Storage für Tests — gleiches Verhalten wie ein DOM-Storage:
 * fehlende Keys liefern null, removeItem auf fehlendem Key wirft nicht.
 */
export class InMemoryStorage implements Storage {
  private readonly data = new Map<string, string>();

  getItem(key: string): string | null {
    return this.data.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.data.set(key, value);
  }

  removeItem(key: string): void {
    this.data.delete(key);
  }

  /** Wie DOM-Storage.clear() — praktisch für Test-Isolation. */
  clear(): void {
    this.data.clear();
  }
}
