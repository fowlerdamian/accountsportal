// Storage access that never throws. Safari private mode, embedded webviews and
// "block all cookies" settings make localStorage / sessionStorage throw on
// access; on the customer-facing guide page that would blank the whole screen.
// Every call returns null / false on failure so callers can carry on.

type Area = "local" | "session";

function area(kind: Area): Storage | null {
  try {
    const s = kind === "local" ? window.localStorage : window.sessionStorage;
    // Some browsers expose the object but throw on use — probe it.
    const probe = "__guide_probe__";
    s.setItem(probe, "1");
    s.removeItem(probe);
    return s;
  } catch {
    return null;
  }
}

function make(kind: Area) {
  return {
    get(key: string): string | null {
      try {
        return area(kind)?.getItem(key) ?? null;
      } catch {
        return null;
      }
    },
    set(key: string, value: string): boolean {
      try {
        const s = area(kind);
        if (!s) return false;
        s.setItem(key, value);
        return true;
      } catch {
        return false;
      }
    },
    remove(key: string): boolean {
      try {
        const s = area(kind);
        if (!s) return false;
        s.removeItem(key);
        return true;
      } catch {
        return false;
      }
    },
    /** Parse a stored JSON value; null when missing or malformed. */
    getJSON<T = unknown>(key: string): T | null {
      const raw = this.get(key);
      if (raw === null) return null;
      try {
        return JSON.parse(raw) as T;
      } catch {
        return null;
      }
    },
  };
}

export const safeLocal = make("local");
export const safeSession = make("session");
