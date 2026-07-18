"use client"

import { useState } from "react"
import Link from "next/link"
import { supabase } from "@/lib/supabase"

export default function ForgotPasswordPage() {

  const [email, setEmail] = useState("")
  const [message, setMessage] = useState("")
  const [sent, setSent] = useState(false)
  const [loading, setLoading] = useState(false)

  async function sendReset() {

    if (loading) return

    setLoading(true)
    setMessage("")

    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password`,
    })

    setLoading(false)

    if (error) {
      setMessage(error.message)
      return
    }

    setSent(true)
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
            Reset your password.
          </p>

        </div>


        {/* Card */}

        <div className="bg-paper-2 border border-hairline rounded-xl shadow-sm p-6">

          {sent ? (

            <div className="text-center">

              <div className="mx-auto mb-5 w-12 h-12 rounded-full bg-gold/10 flex items-center justify-center">
                <span className="text-2xl">✉️</span>
              </div>

              <h2 className="font-display text-xl font-semibold text-ink">
                Check your inbox
              </h2>

              <p className="text-sm text-ink-soft mt-3 leading-relaxed">
                If an account exists for {email}, a password reset link is on its way.
              </p>

            </div>

          ) : (

            <div className="space-y-5">

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
                    if (e.key === "Enter") sendReset()
                  }}
                  className="
                    w-full
                    rounded-md
                    border
                    border-hairline
                    bg-paper
                    px-4
                    py-3
                    text-sm
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
                onClick={sendReset}
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
                {loading ? "Sending..." : "Send Reset Link"}
              </button>

            </div>

          )}

          <div className="mt-6 border-t border-hairline pt-5 text-center">
            <Link href="/login" className="text-sm font-medium text-gold hover:underline">
              ← Back to sign in
            </Link>
          </div>

        </div>

      </div>

    </main>
  )
}
