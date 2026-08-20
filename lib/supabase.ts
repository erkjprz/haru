import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

// By default this client serializes auth work (token refresh, sign-in,
// sign-out) through the browser's navigator.locks API. On iOS (including
// installed PWAs), returning from the background after the token's gone
// stale means that lock is held across a real network round trip -- and on
// resume this app fires several concurrent Supabase queries at once (e.g.
// BanksPanel's Promise.all), each independently checking the session, so
// they all queue behind it until it resolves.
//
// The lock isn't just incidental, though: it also serializes those
// concurrent checks against each other, which matters because Supabase
// rotates refresh tokens -- each one is single-use. Drop the lock entirely
// and two of those queries can race to refresh at once; one consumes the
// refresh token and succeeds, the other retries with the now-already-used
// token and fails, breaking the session until a hard reload.
//
// This in-memory mutex keeps that serialization (so no refresh-token race)
// without going through navigator.locks (so nothing can get stuck waiting
// on a cross-tab lock after the app resumes from the background).
let authLockChain: Promise<void> = Promise.resolve()

async function inMemoryAuthLock<R>(_name: string, _acquireTimeout: number, fn: () => Promise<R>): Promise<R> {
  const previous = authLockChain
  let release: () => void
  authLockChain = new Promise<void>((resolve) => {
    release = () => resolve()
  })
  try {
    await previous
    return await fn()
  } finally {
    release!()
  }
}

// After the installed PWA sits backgrounded for a while (10+ minutes), iOS
// tears down its network connections but doesn't tell an in-flight or
// freshly-issued fetch() about it -- the promise just never settles,
// neither resolving nor rejecting, which is why this showed up as content
// stuck on its loading skeleton forever with no error, only fixed by a
// full page reload (which forces fresh connections). Wrapping fetch with a
// timeout-and-retry gives every Supabase call the same recovery a reload
// provides, without needing one.
const FETCH_TIMEOUT_MS = 15000

async function fetchWithTimeout(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  // This app never passes its own AbortSignal into a Supabase call today --
  // stay out of the way if that ever changes rather than fight over it.
  if (init?.signal) return fetch(input, init)

  async function attempt(): Promise<Response> {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
    try {
      return await fetch(input, { ...init, signal: controller.signal })
    } finally {
      clearTimeout(timeoutId)
    }
  }

  try {
    return await attempt()
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      // One retry opens a fresh connection instead of leaving the caller
      // waiting on a dead one indefinitely.
      return attempt()
    }
    throw err
  }
}

export const supabase = createClient(
  supabaseUrl,
  supabaseAnonKey,
  {
    auth: {
      lock: inMemoryAuthLock
    },
    global: {
      fetch: fetchWithTimeout
    }
  }
)
