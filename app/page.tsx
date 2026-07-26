"use client"

import { useEffect } from "react"
import { useRouter } from "next/navigation"
import { useAuth } from "@/app/auth-context"

export default function Home() {
  const router = useRouter()
  const { loading, user, member } = useAuth()

  useEffect(() => {
    if (loading) return
    router.push(user && member ? "/dashboard" : "/login")
  }, [loading, user, member, router])

  return <main className="min-h-screen bg-paper" />
}