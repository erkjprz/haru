import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

export const supabase = createClient(
  supabaseUrl,
  supabaseAnonKey,
  {
    auth: {
      // By default this client serializes token refreshes through the
      // browser's navigator.locks API. On iOS (including installed PWAs),
      // returning from the background after the token's gone stale means
      // that refresh has to make a network round trip while holding the
      // lock -- and every other Supabase call on the page, including the
      // one for whatever you're navigating to, queues behind it until it
      // resolves. Running refreshes unlocked trades a rare, harmless
      // duplicate refresh call for never blocking navigation on this.
      lock: async (_name, _acquireTimeout, fn) => fn()
    }
  }
)