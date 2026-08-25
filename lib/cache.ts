// Per-tab cache so revisiting a screen (e.g. via bottom nav or the back
// button) can render the last-known data immediately while a fresh fetch
// runs quietly in the background, instead of blocking on a network round
// trip every time. Backed by sessionStorage rather than plain in-memory
// state so it survives a hard refresh -- otherwise the very next
// navigation after a reload would still have nothing to serve.
const PREFIX = "haru:cache:"

export function readCache<T>(key: string): T | undefined {
  if (typeof window === "undefined") return undefined
  try {
    const raw = window.sessionStorage.getItem(PREFIX + key)
    return raw ? (JSON.parse(raw) as T) : undefined
  } catch {
    return undefined
  }
}

export function writeCache<T>(key: string, value: T): void {
  if (typeof window === "undefined") return
  try {
    window.sessionStorage.setItem(PREFIX + key, JSON.stringify(value))
  } catch {
    // Storage full or unavailable (e.g. private browsing) -- fall back to
    // always fetching fresh, which is the pre-cache behavior anyway.
  }
}
