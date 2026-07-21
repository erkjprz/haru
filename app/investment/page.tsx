"use client"

import { useEffect } from "react"
import { useRouter } from "next/navigation"

// Investments now lives as a tab on the Breakdown hub -- this route stays as
// a redirect so old links/bookmarks keep working.
export default function InvestmentsRedirectPage() {
  const router = useRouter()

  useEffect(() => {
    router.replace("/fund-breakdown?tab=investments")
  }, [router])

  return null
}
