"use client"

import { useEffect, useState } from "react"
import { useParams, useRouter } from "next/navigation"
import Navbar from "@/app/components/Navbar"
import { supabase } from "@/lib/supabase"
import { useAuth } from "@/app/auth-context"
import { SkeletonCardList } from "@/app/components/Skeleton"
import { LoanCards } from "@/app/components/LoanCards"
import { useLoansSummary } from "@/lib/useLoansSummary"

type TargetMember = { member_id: string; name: string; role: string }

// Read-only preview of what a borrower sees on /borrower, for admins
// troubleshooting a member's account without needing their login. Reuses
// the same query as /borrower (useLoansSummary) -- RLS already lets any
// non-borrower read every member's loans/transactions, so no elevated
// access is needed here.
export default function ViewAsPage() {
  const params = useParams()
  const memberId = params?.memberId as string
  const router = useRouter()
  const { loading: authLoading, member: authMember } = useAuth()

  const [target, setTarget] = useState<TargetMember | null>(null)
  const [targetLoading, setTargetLoading] = useState(true)
  const [targetError, setTargetError] = useState("")

  const isAdmin = authMember?.role === "admin"

  useEffect(() => {
    if (authLoading) return

    if (!authMember) {
      router.push("/login")
      return
    }

    if (!isAdmin) {
      router.push("/dashboard")
      return
    }

    async function loadTarget() {
      const { data, error } = await supabase
        .from("members")
        .select("member_id, name, role")
        .eq("member_id", memberId)
        .maybeSingle()

      if (error) {
        setTargetError(error.message)
      } else if (!data) {
        setTargetError("Member not found.")
      } else {
        setTarget(data)
      }

      setTargetLoading(false)
    }

    loadTarget()
  }, [authLoading, authMember, isAdmin, memberId, router])

  const { loading: dataLoading, loans, loadError } = useLoansSummary(
    target?.role === "borrower" ? target.member_id : undefined
  )

  if (authLoading || !isAdmin || targetLoading) {
    return (
      <>
        <Navbar />
        <main className="min-h-screen bg-paper text-ink font-sans overflow-x-hidden">
          <div className="max-w-lg mx-auto px-4 sm:px-5 pt-8 pb-24">
            <SkeletonCardList rows={2} />
          </div>
        </main>
      </>
    )
  }

  return (
    <>
      <Navbar />
      <main className="min-h-screen bg-paper text-ink font-sans overflow-x-hidden">
        <div className="max-w-lg mx-auto px-4 sm:px-5 pt-8 pb-24">
          <button
            onClick={() => router.push("/admin/members")}
            className="text-[13px] text-ink-soft mb-4 hover:text-ink transition-colors"
          >
            ← Members
          </button>

          <div className="text-[11px] tracking-[0.18em] uppercase text-gold font-mono mb-2">
            Viewing as (read-only)
          </div>

          {targetError && <p className="text-sm text-rust">{targetError}</p>}

          {target && (
            <>
              <h1 className="font-display text-3xl sm:text-4xl font-semibold text-ink mb-1">
                {target.name}
              </h1>

              {target.role !== "borrower" ? (
                <p className="text-sm text-ink-soft mt-4">
                  {target.name} isn&apos;t a borrower, so there&apos;s no loan view to preview. This
                  page currently only mirrors /borrower.
                </p>
              ) : (
                <>
                  <p className="text-[13px] text-ink-soft mb-6">
                    This is what {target.name} sees on their loan page. Actions are disabled here.
                  </p>

                  {dataLoading && <SkeletonCardList rows={2} />}

                  {!dataLoading && loadError && (
                    <p className="mb-4 text-sm text-rust">Couldn&apos;t load loans: {loadError}</p>
                  )}

                  {!dataLoading && !loadError && <LoanCards loans={loans} editable={false} />}
                </>
              )}
            </>
          )}
        </div>
      </main>
    </>
  )
}
