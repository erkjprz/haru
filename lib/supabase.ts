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

export const supabase = createClient(
  supabaseUrl,
  supabaseAnonKey,
  {
    auth: {
      lock: inMemoryAuthLock
    }
  }
)