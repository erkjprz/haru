"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { supabase } from "@/lib/supabase"
import { useAuth } from "@/app/auth-context"

export default function SignupPage() {

  const router = useRouter()
  const { loading: authLoading, user } = useAuth()

  const [accountType, setAccountType] = useState<"member" | "borrower">("member")
  const [name, setName] = useState("")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [message, setMessage] = useState("")
  const [loading, setLoading] = useState(false)
  const [showPassword, setShowPassword] = useState(false)

  const isBorrower = accountType === "borrower"

  // An already-signed-in user filling this out would silently create a
  // second, unrelated account while staying logged into the first one --
  // /login already knows how to route a signed-in user (dashboard, or the
  // orphaned-account message), so hand off to it instead of duplicating
  // that logic here.
  useEffect(() => {
    if (authLoading) return
    if (user) {
      router.replace("/login")
    }
  }, [authLoading, user, router])

  const checkingSession = authLoading || !!user

  async function signup() {

    if (loading) return

    setLoading(true)
    setMessage("")


    // The matching members row (name/role/gain_sharing_eligible, status
    // "pending") is created atomically by the on_auth_user_created trigger
    // from this signup metadata -- see handle_new_member_signup().
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          name,
          role: isBorrower ? "borrower" : "member",
        },
      },
    })

    setLoading(false)

    if (error) {
      setMessage(error.message)
      return
    }

    router.push("/waiting")
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
            {isBorrower ? "Create an account to manage your loan." : "Create your shared fund account."}
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
        ">


          <div className="space-y-5">

            {/* Account type */}

            <div className="flex border border-hairline rounded-md overflow-hidden">
              <button
                type="button"
                onClick={() => setAccountType("member")}
                className={`flex-1 text-sm font-semibold py-2.5 transition-colors ${
                  accountType === "member" ? "bg-gold-soft text-ink" : "bg-paper text-ink-soft"
                }`}
              >
                Join the fund
              </button>
              <button
                type="button"
                onClick={() => setAccountType("borrower")}
                className={`flex-1 text-sm font-semibold py-2.5 transition-colors ${
                  accountType === "borrower" ? "bg-gold-soft text-ink" : "bg-paper text-ink-soft"
                }`}
              >
                Repaying a loan
              </button>
            </div>

            {/* Name */}

            <div>

              <label className="block text-[11px] uppercase tracking-[0.1em] text-ink-soft font-mono mb-2">
                Name
              </label>

              <input
                type="text"
                placeholder="Your name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") signup()
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

              {isBorrower && (
                <p className="mt-2 text-xs text-ink-soft">
                  An admin will approve your account and link it to your loan.
                </p>
              )}

            </div>



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
                  if (e.key === "Enter") signup()
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

              <label className="block text-[11px] uppercase tracking-[0.1em] text-ink-soft font-mono mb-2">
                Password
              </label>


              <div className="relative">

                <input
                  type={showPassword ? "text" : "password"}
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") signup()
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
                  "
                >
                  {showPassword ? "Hide" : "Show"}
                </button>

              </div>

            </div>



            {/* Message */}

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



            {/* Button */}

            <button
              onClick={signup}
              disabled={loading}
              className="
                w-full
                rounded-md
                bg-gold-soft
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
              {loading ? "Creating account..." : "Create Account"}
            </button>


          </div>



          {/* Login */}

          <div className="mt-6 border-t border-hairline pt-5 text-center">

            <p className="text-sm text-ink-soft">
              Already have an account?
            </p>

            <Link
              href="/login"
              className="
                mt-2
                inline-block
                font-medium
                text-gold
                hover:underline
              "
            >
              Sign in →
            </Link>

          </div>


        </div>



        <p className="mt-6 text-center text-xs text-ink-soft">
          {isBorrower
            ? "Your account will be reviewed before you can manage your loan."
            : "Your account will be reviewed before joining the fund."}
        </p>


      </div>

    </main>
  )
}