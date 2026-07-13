"use client"

import { useEffect } from "react"
import { useRouter } from "next/navigation"
import { supabase } from "@/lib/supabase"

export default function Home() {
  const router = useRouter()

  useEffect(() => {
    async function checkUser() {
      const { data } = await supabase.auth.getUser()

      if (data.user) {
        router.push("/dashboard")
      } else {
        router.push("/login")
      }
    }

    checkUser()
  }, [router])

  return (
    <main className="flex min-h-screen items-center justify-center">
      <p>Loading Shared Fund Tracker...</p>
    </main>
  )
}