"use client"

import { useEffect } from "react"
import { useRouter } from "next/navigation"
import { supabase } from "@/lib/supabase"
import { useAuth } from "@/app/auth-context"

export default function WaitingPage() {
  const router = useRouter()
  const { loading: authLoading, user, member } = useAuth()

  // This page is the catch-all every gated page sends non-approved members
  // to, for two different reasons (a genuinely new pending signup, or an
  // admin-deactivated member) -- and, via a stale bookmark/tab, sometimes
  // for no reason at all if they've since been approved. Route those away
  // instead of always showing "waiting for approval" copy.
  useEffect(() => {
    if (authLoading) return

    if (!user || !member) {
      router.replace("/login")
      return
    }

    if (member.status === "approved") {
      router.replace(member.role === "borrower" ? "/borrower" : "/dashboard")
    }
  }, [authLoading, user, member, router])

  const checkingSession = authLoading || !user || !member || member.status === "approved"
  const isInactive = member?.status === "inactive"

  async function signOut() {
    await supabase.auth.signOut()
    router.push("/login")
  }

  if (checkingSession) {
    return <main className="min-h-screen bg-paper" />
  }

  return (
    <main className="min-h-screen bg-paper flex items-center justify-center px-5 py-8">

      <div className="w-full max-w-md animate-in fade-in duration-500">

        {/* Header */}

        <div className="text-center mb-8">

          <h1 className="font-display text-4xl font-semibold text-ink">
            Est. 2017
          </h1>

          <p className="text-sm text-ink-soft mt-2">
            Shared fund membership
          </p>

        </div>


        {/* Card */}

        <div className="
          bg-paper-2
          border
          border-hairline
          rounded-xl
          shadow-sm
          p-6
          text-center
        ">

          <div className="
            mx-auto
            mb-5
            w-12
            h-12
            rounded-full
            bg-gold/10
            flex
            items-center
            justify-center
          ">
            <span className="text-2xl">
              ⏳
            </span>
          </div>


          {isInactive ? (
            <>
              <h2 className="font-display text-xl font-semibold text-ink">
                Account deactivated
              </h2>

              <p className="text-sm text-ink-soft mt-3 leading-relaxed">
                An admin has deactivated your account. Contact an admin if you
                believe this is a mistake.
              </p>
            </>
          ) : (
            <>
              <h2 className="font-display text-xl font-semibold text-ink">
                Waiting for approval
              </h2>


              <p className="text-sm text-ink-soft mt-3 leading-relaxed">
                Your account has been created. Two things need to happen before you
                can sign in.
              </p>


              <div className="mt-6 space-y-3 text-left">

                <div className="
                  bg-paper
                  border
                  border-hairline
                  rounded-md
                  px-4
                  py-3
                ">
                  <p className="text-xs font-semibold text-ink">
                    1. Confirm your email
                  </p>
                  <p className="text-xs text-ink-soft mt-1">
                    We sent a confirmation link to your inbox. Click it to verify
                    your email address — you won&apos;t be able to sign in until you do.
                  </p>
                </div>

                <div className="
                  bg-paper
                  border
                  border-hairline
                  rounded-md
                  px-4
                  py-3
                ">
                  <p className="text-xs font-semibold text-ink">
                    2. Wait for admin approval
                  </p>
                  <p className="text-xs text-ink-soft mt-1">
                    An admin will review your request. Once approved, you can sign
                    in and view your contributions, investments and fund performance.
                  </p>
                </div>

              </div>
            </>
          )}


        </div>

        {/* Only way out of this page otherwise -- no other navigation lives
            here, so without this, fixing a typo'd signup email or
            abandoning the account entirely had no path in the UI at all. */}
        <div className="mt-6 flex items-center justify-center gap-4">
          <button
            onClick={() => router.push("/account")}
            className="text-xs font-mono text-ink-soft hover:text-ink transition-colors"
          >
            Account Settings
          </button>
          <span className="text-hairline">·</span>
          <button
            onClick={signOut}
            className="text-xs font-mono text-ink-soft hover:text-ink transition-colors"
          >
            Sign Out
          </button>
        </div>

        <p className="mt-6 text-center text-xs text-ink-soft">
          {isInactive ? "Est. 2017 shared fund." : "Thank you for joining Est. 2017."}
        </p>


      </div>

    </main>
  )
}