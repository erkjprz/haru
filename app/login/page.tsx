"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { supabase } from "@/lib/supabase"
import { useAuth } from "@/app/auth-context"

export default function LoginPage() {
  const router = useRouter()
  const { loading: authLoading, user } = useAuth()

  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [message, setMessage] = useState("")
  const [loading, setLoading] = useState(false)
  const [showPassword, setShowPassword] = useState(false)

  useEffect(() => {
    if (authLoading) return

    if (user) {
      router.replace("/dashboard")
    }
  }, [authLoading, user, router])

  const checkingSession = authLoading || !!user

  async function login() {
    if (loading) return

    setLoading(true)
    setMessage("")

    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    })

    setLoading(false)

    if (error) {
      setMessage(error.message)
    } else {
      router.replace("/dashboard")
    }
  }

  if (checkingSession) {
    return <main className="min-h-screen bg-paper" />
  }

  return (
    <main className="min-h-screen bg-paper flex items-center justify-center px-5 py-8">
      <div className="w-full max-w-md animate-in fade-in duration-500">

        {/* Header */}
        <div className="text-center mb-8">

          <p className="text-[11px] uppercase tracking-[0.2em] text-gold font-mono">
            Est. 2017
          </p>

          <h1 className="font-display text-4xl font-semibold text-ink mt-2">
            Haru
          </h1>

          <p className="text-sm text-ink-soft mt-2">
            Sign in to access your shared fund.
          </p>

        </div>


        {/* Login Card */}
        <div className="bg-paper-2 border border-hairline rounded-xl shadow-sm p-6">

          <div className="space-y-5">

            {/* Email */}

            <div>
              <label className="block text-[11px] uppercase tracking-[0.1em] text-ink-soft font-mono mb-2">
                Email
              </label>

              <input
                type="email"
                placeholder="name@email.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") login()
                }}
                className="
                  w-full
                  rounded-md
                  border
                  border-hairline
                  bg-paper
                  px-4
                  py-3
                  text-base
                  text-ink
                  placeholder:text-ink-soft
                  outline-none
                  transition-all
                  focus:border-gold
                  focus:ring-2
                  focus:ring-gold/20
                "
              />

            </div>


            {/* Password */}

            <div>

              <div className="flex items-baseline justify-between mb-2">
                <label className="block text-[11px] uppercase tracking-[0.1em] text-ink-soft font-mono">
                  Password
                </label>

                <Link
                  href="/forgot-password"
                  className="text-[11px] text-gold hover:underline"
                >
                  Forgot password?
                </Link>
              </div>


              <div className="relative">

                <input
                  type={showPassword ? "text" : "password"}
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") login()
                  }}
                  className="
                    w-full
                    rounded-md
                    border
                    border-hairline
                    bg-paper
                    px-4
                    py-3
                    pr-16
                    text-base
                    text-ink
                    placeholder:text-ink-soft
                    outline-none
                    transition-all
                    focus:border-gold
                    focus:ring-2
                    focus:ring-gold/20
                  "
                />


                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="
                    absolute
                    right-3
                    top-1/2
                    -translate-y-1/2
                    text-xs
                    font-medium
                    text-gold
                    hover:text-ink
                    transition-colors
                  "
                >
                  {showPassword ? "Hide" : "Show"}
                </button>

              </div>

            </div>


            {/* Error */}

            {message && (
              <div className="
                rounded-md
                border
                border-rust/20
                bg-rust/10
                px-4
                py-3
              ">
                <p className="text-sm text-rust">
                  {message}
                </p>
              </div>
            )}


            {/* Login Button */}

            <button
              onClick={login}
              disabled={loading}
              className="
                w-full
                rounded-md
                bg-gold
                py-3
                font-semibold
                text-ink
                shadow-sm
                transition-all
                hover:opacity-90
                active:scale-[0.99]
                disabled:cursor-not-allowed
                disabled:opacity-60
              "
            >
              {loading ? "Signing in..." : "Sign In"}
            </button>


          </div>


          {/* Signup */}

          <div className="mt-6 border-t border-hairline pt-5 text-center">

            <p className="text-sm text-ink-soft">
              Don't have an account?
            </p>

            <Link
              href="/signup"
              className="
                mt-2
                inline-block
                font-medium
                text-gold
                hover:underline
              "
            >
              Create an account →
            </Link>

          </div>

        </div>


        <p className="mt-6 text-center text-xs text-ink-soft">
          Your contributions, investments, loans and fund performance in one place.
        </p>


      </div>
    </main>
  )
}