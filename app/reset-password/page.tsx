"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { supabase } from "@/lib/supabase"

export default function ResetPasswordPage() {

  const router = useRouter()

  const [ready, setReady] = useState(false)
  const [password, setPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")
  const [message, setMessage] = useState("")
  const [loading, setLoading] = useState(false)
  const [done, setDone] = useState(false)
  const [showPassword, setShowPassword] = useState(false)

  // The recovery link Supabase emails redirects here with a token in the
  // URL; supabase-js parses it and fires PASSWORD_RECOVERY once the
  // one-time recovery session is established.
  useEffect(() => {
    const { data: listener } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") {
        setReady(true)
      }
    })

    supabase.auth.getSession().then(({ data }) => {
      if (data.session) setReady(true)
    })

    return () => {
      listener.subscription.unsubscribe()
    }
  }, [])

  async function updatePassword() {

    if (loading) return

    if (password !== confirmPassword) {
      setMessage("Passwords don't match.")
      return
    }

    setLoading(true)
    setMessage("")

    const { error } = await supabase.auth.updateUser({ password })

    setLoading(false)

    if (error) {
      setMessage(error.message)
      return
    }

    setDone(true)
    setTimeout(() => router.push("/dashboard"), 1500)
  }

  return (
    <main className="min-h-screen bg-paper flex items-center justify-center px-5 py-8">

      <div className="w-full max-w-md animate-in fade-in duration-500">

        <div className="text-center mb-8">

          <p className="text-[11px] uppercase tracking-[0.2em] text-gold font-mono">
            Est. 2017
          </p>

          <h1 className="font-display text-4xl font-semibold text-ink mt-2">
            Haru
          </h1>

          <p className="text-sm text-ink-soft mt-2">
            Choose a new password.
          </p>

        </div>

        <div className="bg-paper-2 border border-hairline rounded-xl shadow-sm p-6">

          {!ready ? (

            <p className="text-sm text-ink-soft text-center">
              Open this page using the reset link from your email.
            </p>

          ) : done ? (

            <div className="text-center">
              <div className="mx-auto mb-5 w-12 h-12 rounded-full bg-gold/10 flex items-center justify-center">
                <span className="text-2xl">✓</span>
              </div>
              <h2 className="font-display text-xl font-semibold text-ink">
                Password updated
              </h2>
              <p className="text-sm text-ink-soft mt-3">
                Taking you to your dashboard...
              </p>
            </div>

          ) : (

            <div className="space-y-5">

              <div>
                <label className="block text-[11px] uppercase tracking-[0.1em] text-ink-soft font-mono mb-2">
                  New Password
                </label>
                <div className="relative">
                  <input
                    type={showPassword ? "text" : "password"}
                    placeholder="••••••••"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
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
                    "
                  >
                    {showPassword ? "Hide" : "Show"}
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-[11px] uppercase tracking-[0.1em] text-ink-soft font-mono mb-2">
                  Confirm Password
                </label>
                <input
                  type={showPassword ? "text" : "password"}
                  placeholder="••••••••"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") updatePassword()
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

              {message && (
                <div className="rounded-md border border-rust/20 bg-rust/10 px-4 py-3">
                  <p className="text-sm text-rust">
                    {message}
                  </p>
                </div>
              )}

              <button
                onClick={updatePassword}
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
                  disabled:opacity-60
                "
              >
                {loading ? "Updating..." : "Update Password"}
              </button>

            </div>

          )}

        </div>

      </div>

    </main>
  )
}
