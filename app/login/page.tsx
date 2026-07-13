"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { supabase } from "@/lib/supabase"

export default function LoginPage() {
  const router = useRouter()
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [message, setMessage] = useState("")

  async function login() {
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    })

    if (error) {
    setMessage(error.message)
    } else {
    router.push("/dashboard")
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center">
      <div className="w-full max-w-sm space-y-4">
        <h1 className="text-3xl font-bold">
          Shared Fund Tracker
        </h1>

        <input
          className="w-full border p-3 rounded"
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />

        <input
          className="w-full border p-3 rounded"
          placeholder="Password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />

        <button
          className="w-full bg-black text-white p-3 rounded"
          onClick={login}
        >
          Login
        </button>

        <p>{message}</p>
        <a
            href="/signup"
            className="text-blue-600"
        >
            Create an account
        </a>
      </div>
    </main>
  )
}