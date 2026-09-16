/**
 * The only browser-persistence adapter in the web runtime. It exposes a
 * deliberately tiny, namespaced surface; feature code cannot choose an
 * arbitrary key or persist a credential-bearing value by accident.
 */
export type GovernedBrowserStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

const KEY_PREFIX = "cvg.sign-out.";

function allowedKey(key: string): boolean {
  return key.startsWith(KEY_PREFIX) && key.length <= 96;
}

export function governedBrowserStorage(): GovernedBrowserStorage | null {
  try {
    if (typeof window === "undefined") return null;
    const candidate = window.localStorage;
    return {
      getItem: (key) => allowedKey(key) ? candidate.getItem(key) : null,
      setItem: (key, value) => { if (allowedKey(key) && value.length <= 2_048) candidate.setItem(key, value); },
      removeItem: (key) => { if (allowedKey(key)) candidate.removeItem(key); }
    };
  } catch {
    return null;
  }
}
