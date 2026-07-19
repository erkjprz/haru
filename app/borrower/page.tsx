"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { supabase } from "@/lib/supabase"
import BorrowerHeader from "@/app/components/BorrowerHeader"
import { useAuth } from "@/app/auth-context"
import { SkeletonCardList } from "@/app/components/Skeleton"
import { totalRepayable, type InterestType } from "@/lib/loanMath"
import { formatInterestLabel } from "@/lib/loanFormat"

type Repayment = {
  transaction_id: string
  amount: number
  status: "pending" | "approved" | "rejected" | "cancelled"
  date: string
}

type Loan = {
  loan_id: string
  name: string | null
  status: "requested" | "active" | "closed"
  start_date: string
  principal: number
  interest_type: InterestType
  interest_rate: number
  interest_amount: number
  term_months: number | null
  repaid: number
  totalRepayable: number
  outstanding: number
  repayments: Repayment[]
}

export default function BorrowerPage() {
  const router = useRouter()
  const { loading: authLoading, member } = useAuth()
  const [dataLoading, setDataLoading] = useState(true)
  const checkingAccess = authLoading || dataLoading
  const [loans, setLoans] = useState<Loan[]>([])
  const [loadError, setLoadError] = useState("")

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

    async function load() {
      const { data: borrowerRow } = await supabase
        .from("borrowers")
        .select("borrower_id")
        .eq("member_id", member!.member_id)
        .maybeSingle()

      const filter = borrowerRow?.borrower_id
        ? `member_id.eq.${member!.member_id},borrower_id.eq.${borrowerRow.borrower_id}`
        : `member_id.eq.${member!.member_id}`

      const { data: myLoans, error } = await supabase
        .from("loans")
        .select("*")
        .or(filter)
        .order("start_date", { ascending: false })

      if (error) {
        setLoadError(error.message)
        setDataLoading(false)
        return
      }

      const loanIds = (myLoans ?? []).map((l) => l.loan_id)
      const { data: allTxns } = loanIds.length
        ? await supabase
            .from("transactions")
            .select("transaction_id, loan_id, classification, amount, status, txn_date, created_at")
            .in("loan_id", loanIds)
            .neq("status", "cancelled")
            .order("txn_date", { ascending: false })
        : { data: [] }

      const withProgress: Loan[] = (myLoans ?? []).map((loan) => {
        const related = (allTxns ?? []).filter((t) => t.loan_id === loan.loan_id)
        const repayments = related.filter((t) => t.classification === "Loan Repayment")

        const repaid = repayments
          .filter((t) => t.status === "approved")
          .reduce((sum, t) => sum + Number(t.amount), 0)

        const interestType: InterestType = loan.interest_type === "amount" ? "amount" : "rate"
        const totalRepayableVal = totalRepayable(
          Number(loan.principal),
          interestType,
          Number(loan.interest_rate ?? 0),
          Number(loan.interest_amount ?? 0)
        )

        return {
          loan_id: loan.loan_id,
          name: loan.name,
          status: loan.status,
          start_date: loan.start_date,
          principal: Number(loan.principal),
          interest_type: interestType,
          interest_rate: Number(loan.interest_rate ?? 0),
          interest_amount: Number(loan.interest_amount ?? 0),
          term_months: loan.term_months,
          repaid,
          totalRepayable: totalRepayableVal,
          outstanding: loan.status === "closed" ? 0 : Math.max(0, totalRepayableVal - repaid),
          repayments: repayments.map((t) => ({
            transaction_id: t.transaction_id,
            amount: Number(t.amount),
            status: t.status,
            date: t.txn_date ?? t.created_at
          }))
        }
      })

      setLoans(withProgress)
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
            {member?.name}
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
                className="flex-1 bg-gold text-ink px-4 py-3 rounded-md text-sm font-semibold"
              >
                Make a Repayment
              </button>
            )}
          </div>

          {loadError && <p className="mb-4 text-sm text-rust">Couldn't load your loans: {loadError}</p>}

          {!loadError && loans.length === 0 && (
            <p className="text-sm text-ink-soft text-center py-12 bg-paper-2 border border-hairline rounded-md">
              You don't have any loans on record yet.
            </p>
          )}

          <div className="flex flex-col gap-3">
            {loans.map((loan) => {
              const meta = statusMeta[loan.status]
              const repaidPct = loan.totalRepayable > 0
                ? Math.min(100, ((loan.totalRepayable - loan.outstanding) / loan.totalRepayable) * 100)
                : 0

              return (
                <div key={loan.loan_id} className="bg-paper-2 border border-hairline rounded-md px-5 py-4">
                  <div className="flex items-start justify-between gap-3">
                    <p className="font-display text-[17px] font-semibold text-ink truncate">
                      {loan.name || "Loan"}
                    </p>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <span className={`w-1.5 h-1.5 rounded-full ${meta.dot}`} />
                      <span className={`text-[11px] font-mono uppercase tracking-wide ${meta.text}`}>
                        {meta.label}
                      </span>
                    </div>
                  </div>

                  <div className="grid grid-cols-3 gap-2 items-baseline mt-3.5">
                    <div>
                      <p className="text-[10px] uppercase tracking-wide text-ink-soft font-mono">Principal</p>
                      <p className="font-mono [font-variant-numeric:tabular-nums] text-sm font-semibold text-ink">
                        ₱{fmt(loan.principal)}
                      </p>
                    </div>
                    <div>
                      <p className="text-[10px] uppercase tracking-wide text-gold font-mono font-bold">Interest</p>
                      <p className="font-mono [font-variant-numeric:tabular-nums] text-sm font-semibold text-gold">
                        {formatInterestLabel(loan.interest_type, loan.interest_rate, loan.interest_amount, fmt)}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-[10px] uppercase tracking-wide text-ink-soft font-mono">
                        {loan.status === "closed" ? "Repaid" : "Outstanding"}
                      </p>
                      <p className="font-mono [font-variant-numeric:tabular-nums] text-sm font-semibold text-ink">
                        ₱{fmt(loan.status === "closed" ? loan.repaid : loan.outstanding)}
                      </p>
                    </div>
                  </div>

                  <div className="h-1.5 rounded-full bg-hairline overflow-hidden mt-2.5">
                    <div
                      className={`h-full ${loan.status === "closed" ? "bg-sage" : "bg-gold"}`}
                      style={{ width: `${repaidPct}%` }}
                    />
                  </div>

                  {loan.repayments.length > 0 && (
                    <div className="mt-4 pt-3 border-t border-hairline">
                      <p className="text-[10px] uppercase tracking-wide text-ink-soft font-mono mb-2">
                        Repayments
                      </p>
                      <div className="space-y-2">
                        {loan.repayments.map((r) => (
                          <div key={r.transaction_id} className="flex items-center justify-between gap-2">
                            <span className="text-[12px] text-ink-soft">
                              {new Date(r.date).toLocaleDateString(undefined, {
                                month: "short",
                                day: "numeric",
                                year: "numeric"
                              })}
                            </span>
                            <div className="flex items-center gap-2 shrink-0">
                              <span
                                className={`text-[10px] font-mono uppercase tracking-wide px-1.5 py-0.5 rounded-full border ${
                                  r.status === "approved"
                                    ? "text-sage border-sage/40"
                                    : r.status === "rejected"
                                    ? "text-rust border-rust/40"
                                    : "text-gold border-gold/40"
                                }`}
                              >
                                {r.status}
                              </span>
                              <span className="font-mono [font-variant-numeric:tabular-nums] text-[13px] font-semibold text-ink">
                                ₱{fmt(r.amount)}
                              </span>
                              {r.status === "pending" && (
                                <button
                                  type="button"
                                  onClick={() => router.push(`/transactions/${r.transaction_id}/edit`)}
                                  className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide text-gold font-mono"
                                >
                                  ✎ Edit
                                </button>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      </main>
    </>
  )
}
