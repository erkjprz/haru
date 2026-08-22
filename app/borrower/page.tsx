"use client"

import { useEffect } from "react"
import { useRouter } from "next/navigation"
import BorrowerHeader from "@/app/components/BorrowerHeader"
import ScanToPayCard from "@/app/components/ScanToPayCard"
import { LoanCards } from "@/app/components/LoanCards"
import { useAuth } from "@/app/auth-context"
import { SkeletonCardList } from "@/app/components/Skeleton"
import { useLoansSummary } from "@/lib/useLoansSummary"

export default function BorrowerPage() {
  const router = useRouter()
  const { loading: authLoading, member } = useAuth()

  useEffect(() => {
    if (authLoading) return

    if (!member) {
      router.push("/login")
      return
    }

    if (member.role !== "borrower") {
      router.push("/dashboard")
      return
    }

    if (member.status !== "approved") {
      router.push("/waiting")
      return
    }
  }, [authLoading, member, router])

  const hasAccess = !!member && member.role === "borrower" && member.status === "approved"
  const { loading: dataLoading, loans, loadError } = useLoansSummary(hasAccess ? member!.member_id : undefined)
  const checkingAccess = authLoading || !hasAccess || dataLoading

  if (checkingAccess) {
    return (
      <>
        <BorrowerHeader />
        <main className="min-h-screen bg-paper text-ink font-sans overflow-x-hidden">
          <div className="max-w-lg mx-auto px-4 sm:px-5 pt-8 pb-24">
            <SkeletonCardList rows={2} />
          </div>
        </main>
      </>
    )
  }

  const hasActiveLoan = loans.some((l) => l.status === "active")

  return (
    <>
      <BorrowerHeader />
      <main className="min-h-screen bg-paper text-ink font-sans overflow-x-hidden">
        <div className="max-w-lg mx-auto px-4 sm:px-5 pt-8 pb-24">
          <div className="text-[11px] tracking-[0.18em] uppercase text-gold font-mono mb-2">
            Your loan
          </div>
          <h1 className="font-display text-3xl sm:text-4xl font-semibold text-ink mb-1">
            {member!.name}
          </h1>
          <p className="text-[13px] text-ink-soft mb-6">Request a loan, or repay one you already have.</p>

          <div className="flex gap-2 mb-7">
            <button
              onClick={() => router.push("/borrower/request")}
              className="flex-1 bg-ink text-paper px-4 py-3 rounded-md text-sm font-semibold"
            >
              Request a Loan
            </button>
            {hasActiveLoan && (
              <button
                onClick={() => router.push("/borrower/repay")}
                className="flex-1 bg-gold-soft text-ink px-4 py-3 rounded-md text-sm font-semibold"
              >
                Make a Repayment
              </button>
            )}
          </div>

          <ScanToPayCard />

          {loadError && <p className="mb-4 text-sm text-rust">Couldn't load your loans: {loadError}</p>}

          {!loadError && <LoanCards loans={loans} editable />}
        </div>
      </main>
    </>
  )
}
