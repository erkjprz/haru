"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { supabase } from "@/lib/supabase"
import Navbar from "@/app/components/Navbar"
import { useAuth } from "@/app/auth-context"
import { SkeletonCardList } from "@/app/components/Skeleton"
import type { InterestType } from "@/lib/loanMath"

type Loan = {
  loan_id: string
  loan: string
  status: "requested" | "active" | "closed"
  start_date: string
  closed_date: string | null
  borrower: string
  borrower_member_id: string | null
  principal: number
  repayment: number
  gain: number
  outstanding: number
  term_months: number | null
  interest_type: InterestType | null
  interest_rate: number | null
  interest_amount: number | null
}

function termsLabel(loan: Loan, fmt: (n: number) => string): string | null {
  if (loan.term_months == null) return null

  const interest =
    loan.interest_type === "amount"
      ? loan.interest_amount != null
        ? `₱${fmt(loan.interest_amount)} flat`
        : null
      : loan.interest_rate != null
      ? `${loan.interest_rate}%`
      : null

  return interest ? `${loan.term_months} mo · ${interest}` : `${loan.term_months} mo`
}

export default function LoansPage() {
  const router = useRouter()
  const { loading: authLoading, member } = useAuth()
  const [dataLoading, setDataLoading] = useState(true)
  const checkingAccess = authLoading || dataLoading
  const [loans, setLoans] = useState<Loan[]>([])
  const myMemberId = member?.member_id ?? null
  const [loadError, setLoadError] = useState("")

  useEffect(() => {
    if (authLoading) return

    if (!member) {
      router.push("/login")
      return
    }

    if (member.status !== "approved") {
      router.push("/waiting")
      return
    }

    async function load() {
      // v_loan_summary carries the same principal/repayment/gain/outstanding
      // math as the audit's loan ledger (Section 5), plus loan_id, status,
      // and closed_date (read from loan_gain_allocations, Section 14) so
      // this page and the detail page share one definition of "closed."
      const { data, error } = await supabase
        .from("v_loan_summary")
        .select("*")
        .order("start_date", { ascending: false })

      if (error) {
        setLoadError(error.message)
      } else {
        setLoans((data as Loan[]) ?? [])
      }

      setDataLoading(false)
    }

    load()
  }, [authLoading, member, router])

  const fmt = (n: number) =>
    Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })

  const statusMeta: Record<Loan["status"], { label: string; dot: string; text: string }> = {
    closed: { label: "Repaid", dot: "bg-sage", text: "text-sage" },
    active: { label: "Active", dot: "bg-gold", text: "text-gold" },
    requested: { label: "Requested", dot: "bg-ink-soft", text: "text-ink-soft" }
  }

  if (checkingAccess) {
    return (
      <>
        <Navbar />
        <main className="min-h-screen bg-paper text-ink font-sans overflow-x-hidden">
          <div className="max-w-3xl mx-auto px-4 sm:px-5 pt-8 pb-[calc(3rem+env(safe-area-inset-bottom))]">
            <SkeletonCardList rows={4} />
          </div>
        </main>
      </>
    )
  }

  const openLoans = loans.filter((l) => l.status !== "closed")
  const closedLoans = loans.filter((l) => l.status === "closed")

  return (
    <>
      <Navbar />
      <main className="min-h-screen bg-paper text-ink font-sans overflow-x-hidden">
        <div className="max-w-3xl mx-auto px-4 sm:px-5 pt-8 pb-[calc(3rem+env(safe-area-inset-bottom))]">
          <div className="text-[11px] tracking-[0.18em] uppercase text-gold font-mono mb-2">
            Fund lending
          </div>
          <h1 className="font-display text-3xl sm:text-4xl font-semibold text-ink mb-1">Loans</h1>
          <p className="text-[13px] text-ink-soft mb-6">
            Every loan the fund has released, and what came back.
          </p>

          {loadError && <p className="mb-4 text-sm text-rust">Couldn't load loans: {loadError}</p>}

          {!loadError && loans.length === 0 && (
            <p className="text-sm text-ink-soft text-center py-12">No loans on record yet.</p>
          )}

          {openLoans.length > 0 && (
            <section className="mb-7">
              <h2 className="text-[11px] uppercase tracking-[0.1em] text-ink-soft font-mono mb-3">
                Outstanding
              </h2>
              <div className="flex flex-col gap-3">
                {openLoans.map((loan) => (
                  <LoanCard
                    key={loan.loan_id}
                    loan={loan}
                    meta={statusMeta[loan.status]}
                    fmt={fmt}
                    isMine={loan.borrower_member_id === myMemberId}
                    onClick={() => router.push(`/loans/${loan.loan_id}`)}
                  />
                ))}
              </div>
            </section>
          )}

          {closedLoans.length > 0 && (
            <section>
              <h2 className="text-[11px] uppercase tracking-[0.1em] text-ink-soft font-mono mb-3">
                Repaid
              </h2>
              <div className="flex flex-col gap-3">
                {closedLoans.map((loan) => (
                  <LoanCard
                    key={loan.loan_id}
                    loan={loan}
                    meta={statusMeta[loan.status]}
                    fmt={fmt}
                    isMine={loan.borrower_member_id === myMemberId}
                    onClick={() => router.push(`/loans/${loan.loan_id}`)}
                  />
                ))}
              </div>
            </section>
          )}
        </div>
      </main>
    </>
  )
}

function LoanCard({
  loan,
  meta,
  fmt,
  isMine,
  onClick
}: {
  loan: Loan
  meta: { label: string; dot: string; text: string }
  fmt: (n: number) => string
  isMine: boolean
  onClick: () => void
}) {
  const repaidPct = loan.principal > 0
    ? Math.min(100, ((loan.principal - loan.outstanding) / loan.principal) * 100)
    : 0

  const dateLabel = new Date(loan.start_date).toLocaleDateString(undefined, {
    month: "short",
    year: "numeric"
  })

  return (
    <button
      onClick={onClick}
      className="w-full text-left bg-paper-2 border border-hairline rounded-md px-5 py-4 hover:bg-paper transition-colors"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            <p className="font-display text-[17px] font-semibold text-ink truncate">{loan.loan}</p>
            {isMine && (
              <span className="shrink-0 text-[9px] uppercase tracking-wide font-mono text-gold border border-gold/40 rounded px-1.5 py-0.5">
                You
              </span>
            )}
          </div>
          <p className="text-[12px] text-ink-soft">
            {loan.borrower} · {dateLabel}
          </p>
          {termsLabel(loan, fmt) && (
            <p className="text-[11px] text-ink-soft font-mono mt-0.5">{termsLabel(loan, fmt)}</p>
          )}
        </div>
        <div className="shrink-0 flex items-center gap-2">
          <div className="flex items-center gap-1.5">
            <span className={`w-1.5 h-1.5 rounded-full ${meta.dot}`} />
            <span className={`text-[11px] font-mono uppercase tracking-wide ${meta.text}`}>{meta.label}</span>
          </div>
          <span className="text-ink-soft">→</span>
        </div>
      </div>

      <div className="flex items-baseline justify-between mt-3.5">
        <div>
          <p className="text-[10px] uppercase tracking-wide text-ink-soft font-mono">Principal</p>
          <p className="font-mono [font-variant-numeric:tabular-nums] text-sm font-semibold text-ink">
            ₱{fmt(loan.principal)}
          </p>
        </div>
        {loan.status === "closed" ? (
          <div className="text-right">
            <p className="text-[10px] uppercase tracking-wide text-ink-soft font-mono">Gain</p>
            <p className="font-mono [font-variant-numeric:tabular-nums] text-sm font-semibold text-sage">
              +₱{fmt(loan.gain)}
            </p>
          </div>
        ) : (
          <div className="text-right">
            <p className="text-[10px] uppercase tracking-wide text-ink-soft font-mono">Outstanding</p>
            <p className="font-mono [font-variant-numeric:tabular-nums] text-sm font-semibold text-ink">
              ₱{fmt(loan.outstanding)}
            </p>
          </div>
        )}
      </div>

      <div className="h-1.5 rounded-full bg-hairline overflow-hidden mt-2.5">
        <div
          className={`h-full ${loan.status === "closed" ? "bg-sage" : "bg-gold"}`}
          style={{ width: `${repaidPct}%` }}
        />
      </div>
    </button>
  )
}
