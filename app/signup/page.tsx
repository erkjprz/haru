"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { supabase } from "@/lib/supabase"

type UnclaimedMember = {
  member_id: string
  name: string
}

const NEW_MEMBER = "__new__"

export default function SignupPage() {

  const router = useRouter()

  const [unclaimedMembers, setUnclaimedMembers] = useState<UnclaimedMember[]>([])
  const [selectedMemberId, setSelectedMemberId] = useState(NEW_MEMBER)
  const [name, setName] = useState("")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [message, setMessage] = useState("")
  const [loading, setLoading] = useState(false)
  const [showPassword, setShowPassword] = useState(false)

  useEffect(() => {
    supabase.rpc("list_unclaimed_members").then(({ data }) => {
      setUnclaimedMembers(data ?? [])
    })
  }, [])

  const isExistingMember = selectedMemberId !== NEW_MEMBER

  async function signup() {

    if (loading) return

    setLoading(true)
    setMessage("")


    const { data, error } = await supabase.auth.signUp({
      email,
      password,
    })


    if (error) {
      setLoading(false)
      setMessage(error.message)
      return
    }


    if (data.user) {

      if (isExistingMember) {

        const { error: claimError } = await supabase
          .rpc("claim_member", { p_member_id: selectedMemberId })

        if (claimError) {
          setLoading(false)
          setMessage(claimError.message)
          return
        }

        router.push("/dashboard")
        return
      }

      const { error: memberError } = await supabase
        .from("members")
        .insert({
          name,
          email,
          role: "member",
          status: "pending"
        })


      if (memberError) {
        setLoading(false)
        setMessage(memberError.message)
        return
      }


      router.push("/waiting")
      return
    }


    setLoading(false)
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
            Create your shared fund account.
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


            {/* Name */}

            <div>

              <label className="block text-[11px] uppercase tracking-[0.1em] text-ink-soft font-mono mb-2">
                Name
              </label>

              <select
                value={selectedMemberId}
                onChange={(e) => setSelectedMemberId(e.target.value)}
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
                  outline-none
                  transition-all
                  focus:border-gold
                  focus:ring-2
                  focus:ring-gold/20
                "
              >
                <option value={NEW_MEMBER}>I&apos;m a new member</option>
                {unclaimedMembers.map((m) => (
                  <option key={m.member_id} value={m.member_id}>
                    {m.name}
                  </option>
                ))}
              </select>

              {isExistingMember ? (
                <p className="mt-2 text-xs text-ink-soft">
                  This links your account to {unclaimedMembers.find((m) => m.member_id === selectedMemberId)?.name}&apos;s existing contributions, loans and investments.
                </p>
              ) : (
                <input
                  type="text"
                  placeholder="Your name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") signup()
                  }}
                  className="
                    mt-2
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
          Your account will be reviewed before joining the fund.
        </p>


      </div>

    </main>
  )
}