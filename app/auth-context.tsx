"use client"

import { createContext, useContext, useEffect, useState } from "react"
import type { User } from "@supabase/supabase-js"
import { supabase } from "@/lib/supabase"

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

// Fetches the logged-in user's member row once per session (on sign-in,
// sign-out, or first load) instead of every page re-querying it on every
// navigation. onAuthStateChange fires immediately with the current session
// when subscribed, so no separate getUser() call is needed up front.
export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AuthState>({ loading: true, user: null, member: null })

  useEffect(() => {
    let lastEmail: string | null = null

    const { data: listener } = supabase.auth.onAuthStateChange(async (event, session) => {
      const user = session?.user ?? null

      if (!user) {
        lastEmail = null
        setState({ loading: false, user: null, member: null })
        return
      }

      if (event === "TOKEN_REFRESHED" && user.email === lastEmail) return
      lastEmail = user.email ?? null

      const { data: member } = await supabase
        .from("members")
        .select("member_id, name, status, role")
        .eq("email", user.email)
        .single()

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
