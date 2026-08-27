// So revisiting a screen (e.g. via bottom nav or the back button) can
// render the last-known data immediately while a fresh fetch runs quietly
// in the background, instead of blocking on a network round trip every
// time. Backed by localStorage, not sessionStorage -- on an installed
// iOS PWA, quitting and reopening from the home-screen icon can spin up
// a fresh WebKit session with sessionStorage already cleared, even
// though nothing was actually cleared from the user's perspective. That
// defeated the entire point here (painting instantly from last time)
// for exactly the real-world case this cache exists for: reopening the
// app, not just navigating within an already-open one. Every key is
// scoped to a specific member_id (or absent entirely, for auth-context's
// own signed-out case), so a different person signing in on the same
// device just misses the cache rather than seeing someone else's data --
// nothing here holds an auth token or credential, only each member's own
// already-on-screen display data, no more exposed by living in
// localStorage a while longer than it already is by living on the page.
const PREFIX = "haru:cache:"

export function readCache<T>(key: string): T | undefined {
  if (typeof window === "undefined") return undefined
  try {
    const raw = window.localStorage.getItem(PREFIX + key)
    return raw ? (JSON.parse(raw) as T) : undefined
  } catch {
    return undefined
  }
}

export function writeCache<T>(key: string, value: T): void {
  if (typeof window === "undefined") return
  try {
    window.localStorage.setItem(PREFIX + key, JSON.stringify(value))
  } catch {
    // Storage full or unavailable (e.g. private browsing) -- fall back to
    // always fetching fresh, which is the pre-cache behavior anyway.
  }
}
