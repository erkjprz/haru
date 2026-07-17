"use client"

import { useEffect, useState } from "react"
import { useRouter, useParams } from "next/navigation"
import { supabase } from "@/lib/supabase"
import Navbar from "@/app/components/Navbar"
import { useAuth } from "@/app/auth-context"
import { SkeletonPanel } from "@/app/components/Skeleton"

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
  interest_rate: number | null
  term_months: number | null
  notes: string | null
}

type GainShare = {
  member_id: string
  member: string
  amount: number
}

export default function LoanDetailPage() {
  const router = useRouter()
  const params = useParams()
  const loanId = params?.id as string

  const { loading: authLoading, member } = useAuth()
  const [dataLoading, setDataLoading] = useState(true)
  const checkingAccess = authLoading || dataLoading
  const [loan, setLoan] = useState<Loan | null>(null)
  const [shares, setShares] = useState<GainShare[]>([])
  const myMemberId = member?.member_id ?? null
  const [notFound, setNotFound] = useState(false)
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
      const loanPromise = supabase.from("v_loan_summary").select("*").eq("loan_id", loanId).single()

      // Gain share per member, per Section 14 of the audit doc: split
      // proportional to each eligible member's current value at the
      // moment this loan closed, borrower excluded, joined here to
      // members for display names and sorted highest share first.
      const sharesPromise = supabase
        .from("loan_gain_allocations")
        .select("amount, member_id, members(name)")
        .eq("loan_id", loanId)
        .order("amount", { ascending: false })

      const [loanResult, sharesResult] = await Promise.all([loanPromise, sharesPromise])

      if (loanResult.error || !loanResult.data) {
        setNotFound(true)
      } else {
        setLoan(loanResult.data as Loan)
      }

      if (!sharesResult.error && sharesResult.data) {
        setShares(
          sharesResult.data.map((r: any) => ({
            member_id: r.member_id,
            member: r.members?.name ?? "Unknown",
            amount: Number(r.amount)
          }))
        )
      } else if (sharesResult.error) {
        setLoadError(sharesResult.error.message)
      }

      setDataLoading(false)
    }

    if (loanId) load()
  }, [loanId, authLoading, member, router])

  const fmt = (n: number) =>
    Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })

  if (checkingAccess) {
    return (
      <>
        <Navbar />
        <main className="min-h-screen bg-paper text-ink font-sans overflow-x-hidden">
          <div className="max-w-3xl mx-auto px-4 sm:px-5 pt-8 pb-[calc(3rem+env(safe-area-inset-bottom))]">
            <SkeletonPanel />
          </div>
        </main>
      </>
    )
  }

  if (notFound || !loan) {
    return (
      <>
        <Navbar />
        <main className="min-h-screen bg-paper text-ink font-sans">
          <div className="max-w-3xl mx-auto px-4 sm:px-5 pt-8">
            <p className="text-sm text-ink-soft">This loan couldn't be found.</p>
            <button
              onClick={() => router.push("/loans")}
              className="mt-4 text-sm font-medium text-gold"
            >
              ← Back to Loans
            </button>
          </div>
        </main>
      </>
    )
  }

  const statusMeta: Record<Loan["status"], { label: string; dot: string; text: string }> = {
    closed: { label: "Repaid in full", dot: "bg-sage", text: "text-sage" },
    active: { label: "Active", dot: "bg-gold", text: "text-gold" },
    requested: { label: "Requested", dot: "bg-ink-soft", text: "text-ink-soft" }
  }
  const meta = statusMeta[loan.status]

  const repaidPct = loan.principal > 0
    ? Math.min(100, ((loan.principal - loan.outstanding) / loan.principal) * 100)
    : 0

  const startLabel = new Date(loan.start_date).toLocaleDateString(undefined, {
    month: "long",
    day: "numeric",
    year: "numeric"
  })
  const closedLabel = loan.closed_date
    ? new Date(loan.closed_date).toLocaleDateString(undefined, {
        month: "long",
        day: "numeric",
        year: "numeric"
      })
    : null

  const totalShared = shares.reduce((sum, s) => sum + s.amount, 0)

  return (
    <>
      <Navbar />
      <main className="min-h-screen bg-paper text-ink font-sans overflow-x-hidden">
        <div className="max-w-3xl mx-auto px-4 sm:px-5 pt-8 pb-[calc(3rem+env(safe-area-inset-bottom))]">
          <button
            onClick={() => router.push("/loans")}
            className="text-[13px] text-ink-soft mb-4 hover:text-ink transition-colors"
          >
            ← Loans
          </button>

          <div className="flex items-center gap-2 mb-1">
            <span className={`w-1.5 h-1.5 rounded-full ${meta.dot}`} />
            <span className={`text-[11px] font-mono uppercase tracking-wide ${meta.text}`}>{meta.label}</span>
          </div>
          <h1 className="font-display text-3xl sm:text-4xl font-semibold text-ink mb-1">{loan.loan}</h1>
          <p className="text-[13px] text-ink-soft mb-6">
            Borrowed by {loan.borrower}
            {loan.borrower_member_id === myMemberId && " (you)"} · released {startLabel}
          </p>

          {/* Principal / repayment overview */}
          <div className="bg-paper-2 border border-hairline rounded-md px-5 pt-4 pb-3.5">
            <p className="text-[11px] uppercase tracking-wide text-ink-soft font-mono mb-1.5">
              {loan.status === "closed" ? "Total Repaid" : "Outstanding Balance"}
            </p>
            <p className="font-mono [font-variant-numeric:tabular-nums] text-3xl font-bold text-ink">
              ₱{fmt(loan.status === "closed" ? loan.repayment : loan.outstanding)}
            </p>
            <div className="mt-3">
              <div className="h-2 rounded-full bg-hairline overflow-hidden">
                <div
                  className={`h-full ${loan.status === "closed" ? "bg-sage" : "bg-gold"}`}
                  style={{ width: `${repaidPct}%` }}
                />
              </div>
              <p className="text-[11px] text-ink-soft mt-1.5">
                ₱{fmt(loan.principal - loan.outstanding)} repaid of ₱{fmt(loan.principal)} principal
              </p>
            </div>
          </div>

          {/* Capital / Performance boxes, matching Dashboard's InfoBox pattern */}
          <div className="bg-paper-2 border border-hairline rounded-md p-5 mt-4">
            <InfoBox label="Loan">
              <InfoRow label="Principal" value={`₱${fmt(loan.principal)}`} />
              <InfoRow label="Repaid so far" value={`₱${fmt(loan.repayment)}`} />
              <InfoRow
                label="Outstanding"
                value={`₱${fmt(loan.outstanding)}`}
                valueClass={loan.outstanding > 0 ? "text-gold" : "text-ink"}
              />
            </InfoBox>

            <InfoBox label="Gain">
              <InfoRow
                label={loan.status === "closed" ? "Interest earned" : "Interest so far"}
                value={loan.status === "closed" ? `+₱${fmt(loan.gain)}` : "—"}
                valueClass={loan.status === "closed" ? "text-sage" : "text-ink-soft"}
                bold
              />
              {closedLabel && <InfoRow label="Closed" value={closedLabel} />}
            </InfoBox>
          </div>

          {/* Gain share per member */}
          <section className="mt-8">
            <h2 className="font-display text-lg font-medium text-ink mb-1">Gain Share per Member</h2>
            <p className="text-[13px] text-ink-soft mb-3">
              {loan.status === "closed"
                ? `${loan.borrower} doesn't share in this loan's own gain. The rest is split by each member's value in the fund on the day it closed.`
                : "This loan hasn't closed yet — gain will be split among eligible members once it's fully repaid."}
            </p>

            {loadError && <p className="text-sm text-rust">{loadError}</p>}

            {loan.status === "closed" && shares.length > 0 && (
              <div className="bg-paper-2 border border-hairline rounded-md">
                <div className="px-5">
                  {shares.map((s, i) => (
                    <div
                      key={s.member_id}
                      className={`py-3 flex justify-between items-center gap-3 ${
                        i !== shares.length - 1 ? "border-b border-dashed border-hairline" : ""
                      }`}
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <p className="text-sm text-ink truncate">{s.member}</p>
                        {s.member_id === myMemberId && (
                          <span className="shrink-0 text-[9px] uppercase tracking-wide font-mono text-gold border border-gold/40 rounded px-1.5 py-0.5">
                            You
                          </span>
                        )}
                      </div>
                      <p className="font-mono [font-variant-numeric:tabular-nums] text-sm font-semibold text-sage shrink-0">
                        +₱{fmt(s.amount)}
                      </p>
                    </div>
                  ))}
                </div>
                <div className="px-5 py-3 border-t border-hairline flex justify-between items-center">
                  <p className="text-[11px] uppercase tracking-wide text-ink-soft font-mono">
                    Split among {shares.length} member{shares.length === 1 ? "" : "s"}
                  </p>
                  <p className="font-mono [font-variant-numeric:tabular-nums] text-[13px] font-semibold text-ink">
                    ₱{fmt(totalShared)}
                  </p>
                </div>
              </div>
            )}

            {loan.status === "closed" && shares.length === 0 && !loadError && (
              <p className="text-sm text-ink-soft text-center py-8 bg-paper-2 border border-hairline rounded-md">
                No gain was distributed for this loan.
              </p>
            )}
          </section>
        </div>
      </main>
    </>
  )
}

function InfoBox({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="bg-paper rounded-lg px-4 py-3.5 mb-3 last:mb-0">
      <p className="text-[10px] uppercase tracking-[0.1em] text-ink-soft font-mono mb-2">{label}</p>
      <div className="space-y-1.5">{children}</div>
    </div>
  )
}

function InfoRow({
  label,
  value,
  valueClass = "text-ink",
  bold = false
}: {
  label: string
  value: string
  valueClass?: string
  bold?: boolean
}) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className={`text-[13px] ${bold ? "text-ink font-semibold" : "text-ink-soft"}`}>{label}</span>
      <span
        className={`font-mono [font-variant-numeric:tabular-nums] whitespace-nowrap ${
          bold ? "text-[15px] font-bold" : "text-[13px] font-semibold"
        } ${valueClass}`}
      >
        {value}
      </span>
    </div>
  )
}
