"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { useAuth } from "@/app/auth-context"
import { SproutMark } from "@/app/components/SproutMark"

// Supabase resolves the cached session almost immediately, which would
// otherwise cut the sprout animation off after a frame or two -- hold the
// splash for one run of the animation (see sprout-bud in globals.css,
// which finishes at 0.78s + 0.3s) before redirecting.
const MIN_SPLASH_MS = 1100

export default function Home() {
  const router = useRouter()
  const { loading, user, member } = useAuth()
  const [minTimeElapsed, setMinTimeElapsed] = useState(false)

  useEffect(() => {
    const timer = setTimeout(() => setMinTimeElapsed(true), MIN_SPLASH_MS)
    return () => clearTimeout(timer)
  }, [])

  useEffect(() => {
    if (loading || !minTimeElapsed) return
    router.push(user && member ? "/dashboard" : "/login")
  }, [loading, minTimeElapsed, user, member, router])

  return (
    <main className="min-h-screen bg-paper flex items-center justify-center">
      <SproutMark className="w-14 h-14" />
    </main>
  )
}