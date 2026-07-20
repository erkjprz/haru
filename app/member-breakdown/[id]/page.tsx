"use client"

import { useEffect, useState } from "react"
import { useRouter, useParams } from "next/navigation"
import { supabase } from "@/lib/supabase"
import Navbar from "@/app/components/Navbar"
import { useAuth } from "@/app/auth-context"
import { SkeletonPanel } from "@/app/components/Skeleton"

type MemberPerformance = {
  total_contribution: number
  total_withdrawal: number
  net_contribution: number
  bank_interest: number
  investment_gain_loss: number
  loan_gain: number
  bank_writeoff: number
  total_value: number
  money_on_hold: number
  withdrawable_now: number
}

type YearRow = {
  year: string
  contribution: number
  withdrawal: number
  netContribution: number
  bankInterest: number
  loanGain: number
  bankWriteoff: number
}

export default function MemberBreakdownPage() {
  const router = useRouter()
  const params = useParams()
  const targetId = params?.id as string

  const { loading: authLoading, member } = useAuth()
  const [dataLoading, setDataLoading] = useState(true)
  const [targetName, setTargetName] = useState("")
  const [notFound, setNotFound] = useState(false)
  const [performance, setPerformance] = useState<MemberPerformance | null>(null)
  const [years, setYears] = useState<YearRow[]>([])
  const [loadError, setLoadError] = useState("")

  const checkingAccess = authLoading || dataLoading
  const isSelf = member?.member_id === targetId

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

    if (member.role === "borrower") {
      router.push("/borrower")
      return
    }

    async function load() {
      if (!targetId) return

      const namePromise = supabase.from("members").select("name").eq("member_id", targetId).single()

      const performancePromise = supabase
        .from("v_member_performance")
        .select(
          "total_contribution, total_withdrawal, net_contribution, bank_interest, investment_gain_loss, loan_gain, bank_writeoff, total_value, money_on_hold, withdrawable_now"
        )
        .eq("member_id", targetId)
        .single()

      // Dated, per-year building blocks. Investment gain/loss isn't
      // included here -- investment_allocations has no date column at all
      // (v_member_value_timeline dumps it all onto a placeholder date for
      // the same reason), so it can't honestly be attributed to a year.
      const txPromise = supabase
        .from("transactions")
        .select("txn_date, classification, amount")
        .eq("member_id", targetId)
        .eq("status", "approved")
        .in("classification", ["Member Contribution", "Member Withdrawal", "Bank Write-off"])

      const bankInterestPromise = supabase
        .from("bank_interest_allocations")
        .select("allocation_date, amount")
        .eq("member_id", targetId)

      const loanGainPromise = supabase
        .from("loan_gain_allocations")
        .select("allocation_date, amount")
        .eq("member_id", targetId)

      const [nameResult, performanceResult, txResult, bankInterestResult, loanGainResult] = await Promise.all([
        namePromise,
        performancePromise,
        txPromise,
        bankInterestPromise,
        loanGainPromise
      ])

      if (nameResult.error || !nameResult.data) {
        setNotFound(true)
        setDataLoading(false)
        return
      }
      setTargetName(nameResult.data.name)

      const firstError =
        performanceResult.error || txResult.error || bankInterestResult.error || loanGainResult.error
      if (firstError) setLoadError(firstError.message)

      if (!performanceResult.error && performanceResult.data) {
        setPerformance({
          total_contribution: Number(performanceResult.data.total_contribution),
          total_withdrawal: Number(performanceResult.data.total_withdrawal),
          net_contribution: Number(performanceResult.data.net_contribution),
          bank_interest: Number(performanceResult.data.bank_interest),
          investment_gain_loss: Number(performanceResult.data.investment_gain_loss),
          loan_gain: Number(performanceResult.data.loan_gain),
          bank_writeoff: Number(performanceResult.data.bank_writeoff),
          total_value: Number(performanceResult.data.total_value),
          money_on_hold: Number(performanceResult.data.money_on_hold),
          withdrawable_now: Number(performanceResult.data.withdrawable_now)
        })
      }

      const byYear: Record<string, YearRow> = {}
      const ensure = (year: string) => {
        if (!byYear[year]) {
          byYear[year] = {
            year,
            contribution: 0,
            withdrawal: 0,
            netContribution: 0,
            bankInterest: 0,
            loanGain: 0,
            bankWriteoff: 0
          }
        }
        return byYear[year]
      }

      ;(txResult.data ?? []).forEach((t: any) => {
        const year = (t.txn_date || "").slice(0, 4)
        if (!year) return
        const amount = Number(t.amount)
        const row = ensure(year)
        if (t.classification === "Member Contribution") {
          row.contribution += amount
          row.netContribution += amount
        } else if (t.classification === "Member Withdrawal") {
          row.withdrawal += amount
          row.netContribution += amount
        } else if (t.classification === "Bank Write-off") {
          row.bankWriteoff += amount
        }
      })

      ;(bankInterestResult.data ?? []).forEach((r: any) => {
        const year = (r.allocation_date || "").slice(0, 4)
        if (!year) return
        ensure(year).bankInterest += Number(r.amount)
      })

      ;(loanGainResult.data ?? []).forEach((r: any) => {
        const year = (r.allocation_date || "").slice(0, 4)
        if (!year) return
        ensure(year).loanGain += Number(r.amount)
      })

      setYears(Object.values(byYear).sort((a, b) => b.year.localeCompare(a.year)))
      setDataLoading(false)
    }

    load()
  }, [authLoading, member, router, targetId])

  const fmt = (n: number) =>
    Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })

  const signed = (n: number) => `${n < 0 ? "-" : "+"}₱${fmt(Math.abs(n))}`
  const tone = (n: number) => (n > 0 ? "text-sage" : n < 0 ? "text-rust" : "text-ink-soft")

  if (checkingAccess) {
    return (
      <>
        <Navbar />
        <main className="min-h-screen bg-paper text-ink font-sans overflow-x-hidden">
          <div className="max-w-3xl mx-auto px-4 sm:px-5 pt-8 pb-10">
            <SkeletonPanel />
          </div>
        </main>
      </>
    )
  }

  if (notFound) {
    return (
      <>
        <Navbar />
        <main className="min-h-screen bg-paper text-ink font-sans overflow-x-hidden">
          <div className="max-w-3xl mx-auto px-4 sm:px-5 pt-8">
            <p className="text-sm text-ink-soft">This member couldn't be found.</p>
            <button onClick={() => router.push("/fund-breakdown")} className="mt-4 text-sm font-medium text-gold">
              ← Fund Breakdown
            </button>
          </div>
        </main>
      </>
    )
  }

  const backLabel = isSelf ? "Dashboard" : "Fund Breakdown"
  const backHref = isSelf ? "/dashboard" : "/fund-breakdown"

  return (
    <>
      <Navbar />
      <main className="min-h-screen bg-paper text-ink font-sans overflow-x-hidden">
        <div className="max-w-3xl mx-auto px-4 sm:px-5 pt-8 pb-[calc(3rem+env(safe-area-inset-bottom))]">
          <button
            onClick={() => router.push(backHref)}
            className="text-[13px] text-ink-soft mb-4 hover:text-ink transition-colors"
          >
            ← {backLabel}
          </button>

          <div className="text-[11px] tracking-[0.18em] uppercase text-gold font-mono mb-2">
            Personal Ledger
          </div>
          <h1 className="font-display text-3xl sm:text-4xl font-semibold text-ink mb-1">
            {isSelf ? "Your Breakdown" : `${targetName}'s Breakdown`}
          </h1>
          <p className="text-[13px] text-ink-soft mb-6">
            {isSelf ? "Your" : `${targetName}'s`} capital and performance, all-time and by year.
          </p>

          {loadError && (
            <p className="mb-4 text-sm text-rust">Couldn't load some of this breakdown: {loadError}</p>
          )}

          {performance != null && (
            <div className="bg-paper-2 border border-hairline rounded-md p-5">
              <p className="text-[11px] uppercase tracking-wide text-ink-soft font-mono mb-1">
                Available Balance
              </p>
              <p className="font-mono [font-variant-numeric:tabular-nums] text-2xl font-bold text-ink mb-4">
                ₱{fmt(performance.withdrawable_now)}
              </p>
              {performance.money_on_hold > 0 && (
                <p className="text-xs text-ink-soft -mt-3 mb-4">
                  of ₱{fmt(performance.total_value)} total — ₱{fmt(performance.money_on_hold)} currently out on loan
                </p>
              )}

              <InfoBox label="Capital (All-Time)">
                <InfoRow label="Total Contribution" value={`₱${fmt(performance.total_contribution)}`} />
                {performance.total_withdrawal !== 0 && (
                  <InfoRow
                    label="Total Withdrawal"
                    value={`-₱${fmt(Math.abs(performance.total_withdrawal))}`}
                    valueClass="text-rust"
                  />
                )}
                <InfoRow label="Net Contribution" value={`₱${fmt(performance.net_contribution)}`} bold />
              </InfoBox>

              <InfoBox label="Performance (All-Time)">
                <InfoRow
                  label="Total Gain/Loss"
                  value={signed(
                    performance.bank_interest + performance.investment_gain_loss + performance.loan_gain + performance.bank_writeoff
                  )}
                  valueClass={tone(
                    performance.bank_interest + performance.investment_gain_loss + performance.loan_gain + performance.bank_writeoff
                  )}
                  bold
                />
                <div className="pt-1 space-y-1.5">
                  <InfoSubRow
                    label="Bank Interest"
                    value={signed(performance.bank_interest)}
                    valueClass={tone(performance.bank_interest)}
                  />
                  <InfoSubRow
                    label="Investment Gain/Loss"
                    value={signed(performance.investment_gain_loss)}
                    valueClass={tone(performance.investment_gain_loss)}
                  />
                  <InfoSubRow
                    label="Loan Gain Share"
                    value={signed(performance.loan_gain)}
                    valueClass={tone(performance.loan_gain)}
                  />
                  {performance.bank_writeoff !== 0 && (
                    <InfoSubRow
                      label="Bank Write-off Share"
                      value={signed(performance.bank_writeoff)}
                      valueClass={tone(performance.bank_writeoff)}
                    />
                  )}
                </div>
              </InfoBox>
            </div>
          )}

          <section className="mt-8">
            <h2 className="font-display text-lg font-medium text-ink mb-1">By Year</h2>
            <p className="text-[13px] text-ink-soft mb-3">
              Contributions, withdrawals, bank interest, and loan gain share, by calendar year. Investment
              gain/loss isn't tied to a specific year, so it only appears in the all-time total above.
            </p>

            {years.length === 0 && !loadError && (
              <p className="text-sm text-ink-soft text-center py-8 bg-paper-2 border border-hairline rounded-md">
                No dated activity yet.
              </p>
            )}

            <div className="space-y-4">
              {years.map((y) => {
                const yearTotal = y.netContribution + y.bankInterest + y.loanGain + y.bankWriteoff
                return (
                  <div key={y.year} className="bg-paper-2 border border-hairline rounded-md p-5">
                    <div className="flex justify-between items-baseline mb-3">
                      <span className="font-display text-xl font-semibold text-ink">{y.year}</span>
                      <span className={`font-mono [font-variant-numeric:tabular-nums] text-sm font-semibold ${tone(yearTotal)}`}>
                        {signed(yearTotal)}
                      </span>
                    </div>

                    <InfoBox label="Capital">
                      <InfoRow label="Contribution" value={`₱${fmt(y.contribution)}`} />
                      {y.withdrawal !== 0 && (
                        <InfoRow
                          label="Withdrawal"
                          value={`-₱${fmt(Math.abs(y.withdrawal))}`}
                          valueClass="text-rust"
                        />
                      )}
                      <InfoRow label="Net Contribution" value={`₱${fmt(y.netContribution)}`} bold />
                    </InfoBox>

                    {(y.bankInterest !== 0 || y.loanGain !== 0 || y.bankWriteoff !== 0) && (
                      <InfoBox label="Performance">
                        {y.bankInterest !== 0 && (
                          <InfoRow label="Bank Interest" value={signed(y.bankInterest)} valueClass={tone(y.bankInterest)} />
                        )}
                        {y.loanGain !== 0 && (
                          <InfoRow label="Loan Gain Share" value={signed(y.loanGain)} valueClass={tone(y.loanGain)} />
                        )}
                        {y.bankWriteoff !== 0 && (
                          <InfoRow
                            label="Bank Write-off Share"
                            value={signed(y.bankWriteoff)}
                            valueClass={tone(y.bankWriteoff)}
                          />
                        )}
                      </InfoBox>
                    )}
                  </div>
                )
              })}
            </div>
          </section>
        </div>
      </main>
    </>
  )
}

// A single calm block for a group of related figures -- flat background,
// one soft border, no internal rule lines. Matches the dashboard and Fund
// Breakdown page's InfoBox.
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

// Smaller detail line underneath a subtotal (e.g. what makes up Total
// Gain/Loss) -- distinguished from InfoRow by size and indentation alone,
// no border or leader line.
function InfoSubRow({
  label,
  value,
  valueClass = "text-ink"
}: {
  label: string
  value: string
  valueClass?: string
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 pl-2">
      <span className="text-[12px] text-ink-soft">{label}</span>
      <span className={`font-mono [font-variant-numeric:tabular-nums] text-[12px] font-medium whitespace-nowrap ${valueClass}`}>
        {value}
      </span>
    </div>
  )
}
