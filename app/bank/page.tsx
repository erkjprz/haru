"use client"

import { useEffect } from "react"
import { useRouter } from "next/navigation"

// Banks now lives as a tab on the Breakdown hub -- this route stays as a
// redirect so old links/bookmarks keep working.
export default function BanksRedirectPage() {
  const router = useRouter()

  useEffect(() => {
    router.replace("/fund-breakdown?tab=banks")
  }, [router])

  return null
}
