"use client"

import { useEffect, useRef } from "react"
import { useRouter } from "next/navigation"
import { useAuth } from "@/app/auth-context"
import { SplashScreen } from "@/app/components/SplashScreen"
import { warmDashboardCache } from "@/lib/dashboardSnapshot"
import { warmLoansCache } from "@/lib/useLoansSummary"

// A slow connection shouldn't strand anyone on the splash indefinitely --
// give the destination's data this long to warm, then move on regardless.
// The destination page's own stale-while-revalidate cache/fetch takes it
// from there either way, warm or not.
const WARM_UP_TIMEOUT_MS = 4000

export default function Home() {
  const router = useRouter()
  const { loading, user, member } = useAuth()
  const started = useRef(false)

  useEffect(() => {
    if (loading || started.current) return
    started.current = true

    if (!user || !member) {
      router.replace("/login")
      return
    }

    if (member.status !== "approved") {
      router.replace("/waiting")
      return
    }

    if (member.role === "borrower") {
      const warm = warmLoansCache(member.member_id).catch(() => {})
      const timeout = new Promise((resolve) => setTimeout(resolve, WARM_UP_TIMEOUT_MS))
      Promise.race([warm, timeout]).then(() => router.replace("/borrower"))
      return
    }

    const warm = warmDashboardCache(member).catch(() => {})
    const timeout = new Promise((resolve) => setTimeout(resolve, WARM_UP_TIMEOUT_MS))
    Promise.race([warm, timeout]).then(() => router.replace("/dashboard"))
  }, [loading, user, member, router])

  return <SplashScreen />
}
