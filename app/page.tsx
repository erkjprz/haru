"use client"

import { useEffect } from "react"
import { useRouter } from "next/navigation"
import { useAuth } from "@/app/auth-context"

export default function Home() {
  const router = useRouter()
  const { loading, user } = useAuth()

  useEffect(() => {
    if (loading) return
    router.push(user ? "/dashboard" : "/login")
  }, [loading, user, router])

  return <main className="min-h-screen bg-paper" />
}