"use client"

import { createContext, useContext, useEffect, useState } from "react"
import type { User } from "@supabase/supabase-js"
import { supabase } from "@/lib/supabase"
import { readCache, writeCache } from "@/lib/cache"

type AuthMember = {
  member_id: string
  name: string
  status: string
  role: string
}

type AuthState = {
  loading: boolean
  user: User | null
  member: AuthMember | null
}

const AuthContext = createContext<AuthState>({ loading: true, user: null, member: null })

const MEMBER_CACHE_KEY = "auth:member"

// Fetches the logged-in user's member row once per session (on sign-in,
// sign-out, or first load) instead of every page re-querying it on every
// navigation. onAuthStateChange fires immediately with the current session
// when subscribed, so no separate getUser() call is needed up front.
export function AuthProvider({ children }: { children: React.ReactNode }) {
  // `loading` still starts true and only flips once the real check
  // resolves -- every page gating a redirect on it (root, /login,
  // /waiting, /account, etc.) keeps working exactly as before. `member`
  // alone seeds from last session's cache so consumers that don't wait on
  // `loading` (Navbar's dock/FAB prefetch, dashboard's own per-member
  // cache lookup, which needs a member id to even find its cache key) can
  // paint the right thing on the very first frame instead of flickering
  // in once the live round trip finishes. A stale role here is corrected
  // within one network round trip same as any other stale cache in this
  // app -- nothing security-sensitive reads `member` without also
  // checking `loading`.
  const [state, setState] = useState<AuthState>(() => ({
    loading: true,
    user: null,
    member: readCache<AuthMember>(MEMBER_CACHE_KEY) ?? null
  }))

  useEffect(() => {
    let lastEmail: string | null = null

    const { data: listener } = supabase.auth.onAuthStateChange(async (event, session) => {
      const user = session?.user ?? null

      if (!user) {
        lastEmail = null
        writeCache(MEMBER_CACHE_KEY, null)
        setState({ loading: false, user: null, member: null })
        return
      }

      if (event === "TOKEN_REFRESHED" && user.email === lastEmail) return
      lastEmail = user.email ?? null

      const { data: member, error } = await supabase
        .from("members")
        .select("member_id, name, status, role")
        .eq("email", user.email)
        .maybeSingle()

      if (error) {
        // A real query failure (network, RLS, etc.), not "no matching row"
        // -- maybeSingle() represents that as data: null with no error.
        // /login, /waiting, and the root redirect all treat member: null as
        // "this account is genuinely orphaned" and show a terminal message,
        // so a transient failure here shouldn't collapse into that -- keep
        // whatever member state was already known good instead.
        setState((prev) => ({ loading: false, user, member: prev.member }))
        return
      }

      writeCache(MEMBER_CACHE_KEY, member ?? null)
      setState({ loading: false, user, member: member ?? null })
    })

    return () => {
      listener.subscription.unsubscribe()
    }
  }, [])

  return <AuthContext.Provider value={state}>{children}</AuthContext.Provider>
}

export function useAuth() {
  return useContext(AuthContext)
}
