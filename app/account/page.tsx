"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import Navbar from "@/app/components/Navbar"
import { supabase } from "@/lib/supabase"
import { useAuth } from "@/app/auth-context"

export default function AccountPage() {
  const router = useRouter()
  const { loading: authLoading, user, member } = useAuth()

  const [newEmail, setNewEmail] = useState("")
  const [emailMessage, setEmailMessage] = useState("")
  const [emailLoading, setEmailLoading] = useState(false)

  const [newPassword, setNewPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")
  const [passwordMessage, setPasswordMessage] = useState("")
  const [passwordLoading, setPasswordLoading] = useState(false)
  const [showPassword, setShowPassword] = useState(false)

  useEffect(() => {
    if (authLoading) return
    if (!member) router.push("/login")
  }, [authLoading, member, router])

  async function changeEmail() {
    if (emailLoading) return

    setEmailLoading(true)
    setEmailMessage("")

    const { error } = await supabase.auth.updateUser({ email: newEmail })

    setEmailLoading(false)

    if (error) {
      setEmailMessage(error.message)
      return
    }

    setEmailMessage("Check your new email inbox to confirm the change.")
    setNewEmail("")
  }

  async function changePassword() {
    if (passwordLoading) return

    if (newPassword !== confirmPassword) {
      setPasswordMessage("Passwords don't match.")
      return
    }

    setPasswordLoading(true)
    setPasswordMessage("")

    const { error } = await supabase.auth.updateUser({ password: newPassword })

    setPasswordLoading(false)

    if (error) {
      setPasswordMessage(error.message)
      return
    }

    setPasswordMessage("Password updated.")
    setNewPassword("")
    setConfirmPassword("")
  }

  if (authLoading || !member) {
    return <main className="min-h-screen bg-paper" />
  }

  return (
    <>
      <Navbar />
      <main className="min-h-screen bg-paper text-ink font-sans">
        <div className="max-w-3xl mx-auto px-5 pt-10 pb-24">

          <div className="text-[11px] tracking-[0.18em] uppercase text-gold font-mono mb-2">
            Account
          </div>
          <h1 className="font-display text-4xl font-semibold">
            Settings
          </h1>

          {/* Change Email */}

          <div className="mt-8 bg-paper-2 border border-hairline rounded-md p-5">

            <h2 className="font-display text-xl">
              Email
            </h2>

            <p className="text-sm text-ink-soft mt-1">
              Currently signed in as {user?.email}
            </p>

            <div className="mt-4 space-y-3">
              <input
                type="email"
                placeholder="new@email.com"
                value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)}
                className="border border-hairline bg-paper px-3 py-2 rounded-md w-full text-sm"
              />

              {emailMessage && (
                <p className="text-sm text-ink-soft">
                  {emailMessage}
                </p>
              )}

              <button
                onClick={changeEmail}
                disabled={emailLoading || !newEmail}
                className="bg-ink text-paper px-4 py-2 rounded-md text-sm disabled:opacity-60"
              >
                {emailLoading ? "Sending..." : "Change Email"}
              </button>
            </div>

          </div>

          {/* Change Password */}

          <div className="mt-6 bg-paper-2 border border-hairline rounded-md p-5">

            <h2 className="font-display text-xl">
              Password
            </h2>

            <div className="mt-4 space-y-3">
              <div className="relative">
                <input
                  type={showPassword ? "text" : "password"}
                  placeholder="New password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  className="border border-hairline bg-paper px-3 py-2 pr-14 rounded-md w-full text-sm"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-medium text-gold hover:text-ink"
                >
                  {showPassword ? "Hide" : "Show"}
                </button>
              </div>

              <input
                type={showPassword ? "text" : "password"}
                placeholder="Confirm new password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") changePassword()
                }}
                className="border border-hairline bg-paper px-3 py-2 rounded-md w-full text-sm"
              />

              {passwordMessage && (
                <p className="text-sm text-ink-soft">
                  {passwordMessage}
                </p>
              )}

              <button
                onClick={changePassword}
                disabled={passwordLoading || !newPassword}
                className="bg-ink text-paper px-4 py-2 rounded-md text-sm disabled:opacity-60"
              >
                {passwordLoading ? "Updating..." : "Change Password"}
              </button>
            </div>

          </div>

        </div>
      </main>
    </>
  )
}
