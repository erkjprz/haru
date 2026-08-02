"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import Navbar from "@/app/components/Navbar"
import BorrowerHeader from "@/app/components/BorrowerHeader"
import { supabase } from "@/lib/supabase"
import { useAuth } from "@/app/auth-context"

export default function AccountPage() {
  const router = useRouter()
  const { loading: authLoading, user, member } = useAuth()
  const isBorrower = member?.role === "borrower"

  const [newName, setNewName] = useState("")
  const [nameInitialized, setNameInitialized] = useState(false)
  const [nameMessage, setNameMessage] = useState("")
  const [nameLoading, setNameLoading] = useState(false)

  const [newEmail, setNewEmail] = useState("")
  const [emailMessage, setEmailMessage] = useState("")
  const [emailLoading, setEmailLoading] = useState(false)

  const [newPassword, setNewPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")
  const [passwordMessage, setPasswordMessage] = useState("")
  const [passwordLoading, setPasswordLoading] = useState(false)
  const [showPassword, setShowPassword] = useState(false)

  // Email/password are a universal need -- unlike the rest of the app's
  // member-facing pages, this one deliberately doesn't redirect borrowers
  // away. A borrower's only other self-service option is the unauthenticated
  // "Forgot Password" flow, which can reset a password but can't fix a typo'd
  // email -- there was previously no path anywhere for that.
  useEffect(() => {
    if (authLoading) return
    if (!member) {
      router.push("/login")
      return
    }
  }, [authLoading, member, router])

  // Pre-fill once member loads. Adjusting state during render (React's
  // documented pattern for this) instead of in an Effect -- avoids an extra
  // render pass, and the guard means this only ever fires the one time
  // member goes from null to loaded, never clobbering an in-progress edit.
  if (member && !nameInitialized) {
    setNewName(member.name)
    setNameInitialized(true)
  }

  async function changeName() {
    if (nameLoading) return

    const trimmed = newName.trim()
    if (!trimmed) {
      setNameMessage("Name can't be empty.")
      return
    }

    setNameLoading(true)
    setNameMessage("")

    const { error } = await supabase.rpc("update_my_name", { p_name: trimmed })

    setNameLoading(false)

    if (error) {
      setNameMessage(error.message)
      return
    }

    // AuthProvider only refetches the member row on sign-in/out or token
    // refresh, not on every navigation -- reload so the new name shows up
    // everywhere it's used (Dashboard's greeting, Fund Breakdown, etc.)
    // right away instead of looking stale until the next session refresh.
    // Same pattern PullToRefresh already uses for this reason.
    window.location.reload()
  }

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

    setEmailMessage("Check your new email inbox to confirm the change. Some accounts also need to confirm from the old email address — check there too if the change doesn't take effect.")
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
      {isBorrower ? <BorrowerHeader /> : <Navbar />}
      <main className="min-h-screen bg-paper text-ink font-sans overflow-x-hidden">
        <div className="max-w-3xl mx-auto px-4 sm:px-5 pt-8 pb-[calc(6rem+var(--dock-h)+env(safe-area-inset-bottom))]">

          <button
            onClick={() => router.push(isBorrower ? "/borrower" : "/menu")}
            className="text-[13px] text-ink-soft mb-4 hover:text-ink transition-colors"
          >
            {isBorrower ? "← Your Loan" : "← Menu"}
          </button>

          <div className="text-[11px] tracking-[0.18em] uppercase text-gold font-mono mb-2">
            Account
          </div>
          <h1 className="font-display text-3xl sm:text-4xl font-semibold text-ink mb-1">
            Settings
          </h1>
          <p className="text-[13px] text-ink-soft mb-6">Manage your name, sign-in email, and password.</p>

          {/* Change Name */}

          <div className="bg-paper-2 border border-hairline rounded-md p-5">

            <h2 className="font-display text-lg font-medium text-ink mb-1">
              Name
            </h2>

            <p className="text-[13px] text-ink-soft">
              Shown to other members throughout the app.
            </p>

            <div className="mt-4 space-y-3">
              <input
                type="text"
                placeholder="Your name"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") changeName()
                }}
                className="border border-hairline bg-paper px-3 py-2 rounded-md w-full text-base"
              />

              {nameMessage && (
                <p className="text-sm text-ink-soft">
                  {nameMessage}
                </p>
              )}

              <button
                onClick={changeName}
                disabled={nameLoading || !newName.trim() || newName.trim() === member.name}
                className="bg-ink text-paper px-4 py-2 rounded-md text-sm disabled:opacity-60"
              >
                {nameLoading ? "Saving..." : "Save Name"}
              </button>
            </div>

          </div>

          {/* Change Email */}

          <div className="mt-6 bg-paper-2 border border-hairline rounded-md p-5">

            <h2 className="font-display text-lg font-medium text-ink mb-1">
              Email
            </h2>

            <p className="text-[13px] text-ink-soft">
              Currently signed in as {user?.email}
            </p>

            <div className="mt-4 space-y-3">
              <input
                type="email"
                placeholder="new@email.com"
                value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)}
                className="border border-hairline bg-paper px-3 py-2 rounded-md w-full text-base"
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

            <h2 className="font-display text-lg font-medium text-ink mb-1">
              Password
            </h2>

            <div className="mt-4 space-y-3">
              <div className="relative">
                <input
                  type={showPassword ? "text" : "password"}
                  placeholder="New password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  className="border border-hairline bg-paper px-3 py-2 pr-14 rounded-md w-full text-base"
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
                className="border border-hairline bg-paper px-3 py-2 rounded-md w-full text-base"
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
