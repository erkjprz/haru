"use client"

import { Suspense, useEffect, useMemo, useRef, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { supabase } from "@/lib/supabase"
import Navbar from "@/app/components/Navbar"
import { SkeletonCardList, SkeletonPanel } from "@/app/components/Skeleton"
import { useAuth } from "@/app/auth-context"
import type { InterestType } from "@/lib/loanMath"
import { formatInterestLabel, durationLabel, paymentOverdueLabel } from "@/lib/loanFormat"
import { getBankQrPublicUrl } from "@/lib/bankQrUrl"
import { getPendingBankInterestGroups } from "@/lib/bankInterest"
import { LoanDetailPanel } from "@/app/components/breakdown/LoanDetailPanel"
import { BankDetailPanel } from "@/app/components/breakdown/BankDetailPanel"
import { BankYearDetailPanel } from "@/app/components/breakdown/BankYearDetailPanel"
import { InvestmentDetailPanel } from "@/app/components/breakdown/InvestmentDetailPanel"
import { InfoBox, InfoRow, InfoSubRow } from "@/app/components/breakdown/InfoBox"

type Tab = "fund" | "loans" | "banks" | "investments"
type FundView = "you" | "group"
type TrendPoint = { value: number; date: string }

const TABS: { id: Tab; label: string }[] = [
  { id: "fund", label: "Fund" },
  { id: "banks", label: "Banks" },
  { id: "loans", label: "Loans" },
  { id: "investments", label: "Investments" }
]

function isTab(v: string | null): v is Tab {
  return v === "fund" || v === "loans" || v === "banks" || v === "investments"
}

export default function FundBreakdownPage() {
  return (
    <Suspense fallback={null}>
      <FundBreakdownHub />
    </Suspense>
  )
}

function FundBreakdownHub() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { loading: authLoading, member } = useAuth()

  const activeTab: Tab = isTab(searchParams.get("tab")) ? (searchParams.get("tab") as Tab) : "fund"
  const activeView: FundView = searchParams.get("view") === "you" ? "you" : "group"

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
  }, [authLoading, member, router])

  function selectTab(tab: Tab) {
    if (tab === activeTab) return
    router.replace(tab === "fund" ? "/fund-breakdown" : `/fund-breakdown?tab=${tab}`, { scroll: false })
  }

  function selectView(view: FundView) {
    if (view === activeView) return
    router.replace(view === "group" ? "/fund-breakdown" : "/fund-breakdown?view=you", { scroll: false })
  }

  if (authLoading || !member) {
    return (
      <>
        <Navbar />
        <main className="min-h-screen bg-paper text-ink font-sans overflow-x-hidden">
          <div className="max-w-3xl mx-auto px-4 sm:px-5 pt-8 pb-[calc(3rem+var(--dock-h)+env(safe-area-inset-bottom))]">
            <SkeletonPanel />
          </div>
        </main>
      </>
    )
  }

  return (
    <>
      <Navbar />
      <main className="min-h-screen bg-paper text-ink font-sans overflow-x-hidden">
        <div className="max-w-3xl mx-auto px-4 sm:px-5 pt-8 pb-[calc(3rem+var(--dock-h)+env(safe-area-inset-bottom))]">
          <div className="text-[11px] tracking-[0.18em] uppercase text-gold font-mono mb-1">
            Fund Ledger
          </div>
          <h1 className="font-display text-3xl sm:text-4xl font-semibold text-ink mb-3">Breakdown</h1>

          {/* Top-level section nav -- plain underline tabs (not a boxed
              control) so it reads as page-level navigation, distinct from
              the pill toggle below it. */}
          <div className="flex border-b border-hairline mb-5">
            {TABS.map((t) => (
              <button
                key={t.id}
                onClick={() => selectTab(t.id)}
                className={`flex-1 text-[14px] font-semibold pt-1 pb-2.5 border-b-2 -mb-px transition-colors ${
                  activeTab === t.id ? "text-ink border-gold" : "text-ink-soft border-transparent"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>

          {activeTab === "fund" && (
            <>
              {/* Secondary view toggle -- raised-pill segmented control,
                  matching the Dashboard's You/Fund switcher, so it clearly
                  reads as a sub-choice under the Fund tab rather than a
                  second row of top-level tabs. */}
              <div className="flex bg-paper-2 border border-hairline rounded-full p-[3px] mb-5">
                {(["group", "you"] as FundView[]).map((v) => (
                  <button
                    key={v}
                    onClick={() => selectView(v)}
                    className={`flex-1 py-2 rounded-full text-[13px] font-semibold transition-colors ${
                      activeView === v ? "bg-paper text-ink shadow-sm" : "text-ink-soft"
                    }`}
                  >
                    {v === "group" ? "Haru" : "You"}
                  </button>
                ))}
              </div>

              {activeView === "you" ? (
                <YouPanel memberId={member.member_id} />
              ) : (
                <GroupPanel />
              )}
            </>
          )}

          {activeTab === "loans" && <LoansPanel myMemberId={member.member_id} />}
          {activeTab === "banks" && <BanksPanel isAdmin={member.role === "admin"} />}
          {activeTab === "investments" && <InvestmentsPanel isAdmin={member.role === "admin"} />}
        </div>
      </main>
    </>
  )
}

/* ============================== Fund / You ============================== */

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
  investmentGainLoss: number
  beginningBalance: number
  endingBalance: number
}

// Shared by YouPanel and MemberBreakdownSheet -- both need the exact same
// all-time performance snapshot plus by-year breakdown for a member,
// differing only in whether the value-over-time trend is needed too (only
// YouPanel renders a sparkline for it). Keeping this in one place means a
// fix to one no longer has to be remembered for the other.
function useMemberBreakdown(memberId: string, includeTrend: boolean) {
  const [dataLoading, setDataLoading] = useState(true)
  const [performance, setPerformance] = useState<MemberPerformance | null>(null)
  const [years, setYears] = useState<YearRow[]>([])
  const [trend, setTrend] = useState<TrendPoint[]>([])
  const [loadError, setLoadError] = useState("")

  useEffect(() => {
    let cancelled = false

    async function load() {
      const performancePromise = supabase
        .from("v_member_performance")
        .select(
          "total_contribution, total_withdrawal, net_contribution, bank_interest, investment_gain_loss, loan_gain, bank_writeoff, total_value, money_on_hold, withdrawable_now"
        )
        .eq("member_id", memberId)
        .single()

      const trendPromise = includeTrend
        ? supabase
            .from("v_member_value_timeline")
            .select("event_date, running_total")
            .eq("member_id", memberId)
            .order("event_date", { ascending: true })
        : Promise.resolve({ data: null as any, error: null as any })

      const txPromise = supabase
        .from("transactions")
        .select("txn_date, classification, amount")
        .eq("member_id", memberId)
        .eq("status", "approved")
        .in("classification", ["Member Contribution", "Member Withdrawal", "Bank Write-off"])

      const bankInterestPromise = supabase
        .from("bank_interest_allocations")
        .select("allocation_date, amount")
        .eq("member_id", memberId)

      const loanGainPromise = supabase
        .from("loan_gain_allocations")
        .select("allocation_date, amount")
        .eq("member_id", memberId)

      const investmentAllocPromise = supabase
        .from("investment_allocations")
        .select("investment_id, allocation_type, amount, allocation_date")
        .eq("member_id", memberId)

      const investmentDatesPromise = supabase.from("v_investment_dates").select("investment_id, last_txn_date")

      const [performanceResult, trendResult, txResult, bankInterestResult, loanGainResult, investmentAllocResult, investmentDatesResult] =
        await Promise.all([
          performancePromise,
          trendPromise,
          txPromise,
          bankInterestPromise,
          loanGainPromise,
          investmentAllocPromise,
          investmentDatesPromise
        ])

      if (cancelled) return

      const firstError =
        performanceResult.error ||
        trendResult.error ||
        txResult.error ||
        bankInterestResult.error ||
        loanGainResult.error ||
        investmentAllocResult.error ||
        investmentDatesResult.error
      if (firstError) setLoadError(firstError.message)

      if (includeTrend && !trendResult.error && trendResult.data) {
        setTrend((trendResult.data as any[]).map((r: any) => ({ value: Number(r.running_total), date: r.event_date })))
      }

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
            bankWriteoff: 0,
            investmentGainLoss: 0,
            beginningBalance: 0,
            endingBalance: 0
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

      const investmentDateByInvestmentId: Record<string, string> = {}
      ;(investmentDatesResult.data ?? []).forEach((r: any) => {
        investmentDateByInvestmentId[r.investment_id] = r.last_txn_date
      })

      ;(investmentAllocResult.data ?? []).forEach((r: any) => {
        const year = (r.allocation_date || investmentDateByInvestmentId[r.investment_id] || "").slice(0, 4)
        if (!year) return
        const amount = r.allocation_type === "Investment Loss" ? -Number(r.amount) : Number(r.amount)
        ensure(year).investmentGainLoss += amount
      })

      // Walk years oldest-first to build each year's Beginning/Ending Balance --
      // byYear only ever gets an entry for a year with real activity, so the
      // earliest year truly starts from zero.
      let runningBalance = 0
      const ascendingYears = Object.values(byYear).sort((a, b) => a.year.localeCompare(b.year))
      ascendingYears.forEach((row) => {
        row.beginningBalance = runningBalance
        runningBalance += row.netContribution + row.bankInterest + row.loanGain + row.bankWriteoff + row.investmentGainLoss
        row.endingBalance = runningBalance
      })

      setYears(ascendingYears.slice().sort((a, b) => b.year.localeCompare(a.year)))
      setDataLoading(false)
    }

    load()
    return () => {
      cancelled = true
    }
  }, [memberId, includeTrend])

  return { dataLoading, performance, years, trend, loadError }
}

function YouPanel({ memberId }: { memberId: string }) {
  const { dataLoading, performance, years, trend: myTrend, loadError } = useMemberBreakdown(memberId, true)
  const [yearIndex, setYearIndex] = useState(0)
  const yearTouchStartX = useRef<number | null>(null)

  const [loansLoading, setLoansLoading] = useState(true)
  const [myLoans, setMyLoans] = useState<Loan[]>([])
  const [loansLoadError, setLoansLoadError] = useState("")
  const [selectedLoanId, setSelectedLoanId] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    async function loadLoans() {
      setLoansLoading(true)
      const { data, error } = await supabase
        .from("v_loan_summary")
        .select("*")
        .eq("borrower_member_id", memberId)
        .order("start_date", { ascending: false })

      if (cancelled) return

      if (error) {
        setLoansLoadError(error.message)
      } else {
        setMyLoans((data as Loan[]) ?? [])
      }
      setLoansLoading(false)
    }

    loadLoans()
    return () => {
      cancelled = true
    }
  }, [memberId])

  const fmt = (n: number) =>
    Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  const signed = (n: number) => `${n < 0 ? "-" : "+"}₱${fmt(Math.abs(n))}`
  const tone = (n: number) => (n > 0 ? "text-sage" : n < 0 ? "text-rust" : "text-ink-soft")

  // Same touchend-only swipe detection as the Group carousel -- no
  // touchmove listener needed. The container's touch-action: pan-y (set
  // where this is rendered below) is what actually stops a mostly-
  // horizontal swipe from also dragging the page up/down: the browser
  // decides pan vs. no-op per gesture at the OS/compositor level based on
  // that hint, so a genuinely vertical touch still scrolls the page
  // natively, but a horizontal one never does, even if the finger drifts
  // slightly off-axis mid-swipe.
  function handleYearTouchStart(e: React.TouchEvent) {
    yearTouchStartX.current = e.touches[0].clientX
  }

  function handleYearTouchEnd(e: React.TouchEvent) {
    if (yearTouchStartX.current === null) return
    const dx = e.changedTouches[0].clientX - yearTouchStartX.current
    yearTouchStartX.current = null

    if (Math.abs(dx) < 32) return
    setYearIndex((i) => Math.max(0, Math.min(years.length - 1, dx < 0 ? i + 1 : i - 1)))
  }

  if (dataLoading) {
    return <SkeletonPanel />
  }

  const clampedYearIndex = Math.min(yearIndex, Math.max(0, years.length - 1))

  if (selectedLoanId) {
    return <LoanDetailPanel loanId={selectedLoanId} onBack={() => setSelectedLoanId(null)} />
  }

  return (
    <div>
      {loadError && <p className="mb-4 text-sm text-rust">Couldn't load some of this breakdown: {loadError}</p>}

      {performance != null && (
        <div className="bg-paper-2 border border-hairline rounded-md p-5">
          <p className="text-[11px] uppercase tracking-wide text-ink-soft font-mono mb-1">Available Balance</p>
          <p className="font-mono [font-variant-numeric:tabular-nums] text-2xl font-bold text-ink mb-4">
            ₱{fmt(performance.withdrawable_now)}
          </p>
          {performance.money_on_hold > 0 && (
            <p className="text-xs text-ink-soft -mt-3 mb-4">
              of ₱{fmt(performance.total_value)} total — ₱{fmt(performance.money_on_hold)} currently tied up in loans/investments
            </p>
          )}
          <div className="mb-4">
            <Sparkline points={myTrend} color="#5F7A5A" />
          </div>

          <InfoBox label="Capital (All-Time)">
            <InfoRow label="Total Contribution" value={`₱${fmt(performance.total_contribution)}`} />
            {performance.total_withdrawal !== 0 && (
              <InfoRow
                label="Total Withdrawal"
                value={`-₱${fmt(Math.abs(performance.total_withdrawal))}`}
                valueClass="text-rust"
              />
            )}
            <InfoRow
              label="Net Contribution"
              value={`${performance.net_contribution < 0 ? "-" : ""}₱${fmt(Math.abs(performance.net_contribution))}`}
              bold
            />
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
              {performance.bank_writeoff !== 0 && (
                <InfoSubRow
                  label="Bank Write-off Share"
                  value={signed(performance.bank_writeoff)}
                  valueClass={tone(performance.bank_writeoff)}
                />
              )}
              <InfoSubRow
                label="Investment Gain/Loss"
                value={signed(performance.investment_gain_loss)}
                valueClass={tone(performance.investment_gain_loss)}
              />
              <InfoSubRow
                label="Bank Interest"
                value={signed(performance.bank_interest)}
                valueClass={tone(performance.bank_interest)}
              />
              <InfoSubRow
                label="Loan Gain Share"
                value={signed(performance.loan_gain)}
                valueClass={tone(performance.loan_gain)}
              />
            </div>
          </InfoBox>
        </div>
      )}

      <section className="mt-8">
        <h2 className="font-display text-lg font-medium text-ink mb-1">By Year</h2>
        <p className="text-[13px] text-ink-soft mb-3">
          Contributions, withdrawals, bank interest, loan gain share, and investment gain/loss, by calendar year.
          Investment allocations aren't dated individually, so each is counted in the year of that investment's most
          recent transaction.
        </p>

        {years.length === 0 && !loadError && (
          <p className="text-sm text-ink-soft text-center py-8 bg-paper-2 border border-hairline rounded-md">
            No dated activity yet.
          </p>
        )}

        {years.length > 0 && (
          <>
            <div
              className="overflow-hidden"
              style={{ touchAction: "pan-y" }}
              onTouchStart={handleYearTouchStart}
              onTouchEnd={handleYearTouchEnd}
            >
              <div
                className="flex transition-transform duration-300 ease-out will-change-transform motion-reduce:transition-none"
                style={{ transform: `translateX(-${clampedYearIndex * 100}%)` }}
              >
                {years.map((y) => {
                  const yearGainLoss = y.bankInterest + y.loanGain + y.bankWriteoff + y.investmentGainLoss
                  return (
                    <div key={y.year} className="w-full shrink-0 bg-paper-2 border border-hairline rounded-md p-5">
                      <div className="mb-3">
                        <span className="font-display text-xl font-semibold text-ink">{y.year}</span>
                      </div>

                      <InfoBox label="Year Summary">
                        <InfoRow label="Beginning Balance" value={`₱${fmt(y.beginningBalance)}`} />
                        <InfoRow label="Contribution" value={`₱${fmt(y.contribution)}`} />
                        {y.withdrawal !== 0 && (
                          <InfoRow label="Withdrawal" value={`-₱${fmt(Math.abs(y.withdrawal))}`} valueClass="text-rust" />
                        )}
                        <InfoRow label="Gain/Loss" value={signed(yearGainLoss)} valueClass={tone(yearGainLoss)} />
                        <InfoRow label="Ending Balance" value={`₱${fmt(y.endingBalance)}`} bold />
                      </InfoBox>

                      {(y.bankWriteoff !== 0 || y.investmentGainLoss !== 0 || y.bankInterest !== 0 || y.loanGain !== 0) && (
                        <InfoBox label="Gain/Loss Breakdown">
                          {y.bankWriteoff !== 0 && (
                            <InfoSubRow
                              label="Bank Write-off Share"
                              value={signed(y.bankWriteoff)}
                              valueClass={tone(y.bankWriteoff)}
                            />
                          )}
                          {y.investmentGainLoss !== 0 && (
                            <InfoSubRow
                              label="Investment Gain/Loss"
                              value={signed(y.investmentGainLoss)}
                              valueClass={tone(y.investmentGainLoss)}
                            />
                          )}
                          {y.bankInterest !== 0 && (
                            <InfoSubRow label="Bank Interest" value={signed(y.bankInterest)} valueClass={tone(y.bankInterest)} />
                          )}
                          {y.loanGain !== 0 && (
                            <InfoSubRow label="Loan Gain Share" value={signed(y.loanGain)} valueClass={tone(y.loanGain)} />
                          )}
                        </InfoBox>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>

            {years.length > 1 && (
              <div className="flex items-center justify-center gap-1.5 mt-4">
                {years.map((y, i) => (
                  <button
                    key={y.year}
                    onClick={() => setYearIndex(i)}
                    aria-label={`Go to ${y.year}`}
                    className="w-6 h-6 flex items-center justify-center"
                  >
                    <span
                      className={`block rounded-full transition-all ${
                        i === clampedYearIndex ? "w-4 h-1.5 rounded-[3px] bg-gold" : "w-1.5 h-1.5 bg-hairline"
                      }`}
                    />
                  </button>
                ))}
              </div>
            )}
          </>
        )}
      </section>

      {!loansLoading && myLoans.length > 0 && (
        <section className="mt-8">
          <h2 className="font-display text-lg font-medium text-ink mb-1">
            Your Loan{myLoans.length > 1 ? "s" : ""}
          </h2>
          <p className="text-[13px] text-ink-soft mb-3">Loans you&apos;re the borrower on, past and present.</p>
          {loansLoadError && <p className="mb-3 text-sm text-rust">Couldn&apos;t load loans: {loansLoadError}</p>}
          <div className="flex flex-col gap-3">
            {myLoans.map((loan) => (
              <LoanCard
                key={loan.loan_id}
                loan={loan}
                meta={loanStatusMeta(loan)}
                fmt={fmt}
                isMine
                onClick={() => setSelectedLoanId(loan.loan_id)}
              />
            ))}
          </div>
        </section>
      )}
    </div>
  )
}

/* ============================== Fund / Group ============================== */

type MemberRow = {
  member_id: string
  name: string
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
  totalGainLoss: number
  roi: number | null
  shareOfFund: number
}

const SHARE_COLORS = ["#B8912F", "#5F7A5A", "#8FA88A", "#D4B65C", "#A99B84", "#C97B63", "#7A8FA6", "#9C8AA5"]

type FundTotals = {
  total_cash: number
  total_contribution: number
  total_withdrawal: number
  net_contribution: number
  total_bank_interest: number
  net_investment_gain_loss: number
  total_loan_gain_distributed: number
  total_bank_writeoff: number
  open_loans_count: number
  open_loans_outstanding: number
}

function GroupPanel() {
  const { member: authMember } = useAuth()
  const [members, setMembers] = useState<MemberRow[]>([])
  const [fund, setFund] = useState<FundTotals | null>(null)
  const [fundTrend, setFundTrend] = useState<TrendPoint[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState("")
  const [activeIndex, setActiveIndex] = useState(0)
  const [openMember, setOpenMember] = useState<{ id: string; name: string } | null>(null)
  const touchStartX = useRef<number | null>(null)
  const suppressClickRef = useRef(false)

  useEffect(() => {
    let cancelled = false

    async function load() {
      const memberPromise = supabase
        .from("members")
        .select("member_id, name")
        .eq("status", "approved")
        .neq("role", "borrower")

      const performancePromise = supabase
        .from("v_member_performance")
        .select(
          "member_id, total_contribution, total_withdrawal, net_contribution, bank_interest, investment_gain_loss, loan_gain, bank_writeoff, total_value, money_on_hold, withdrawable_now"
        )

      const fundPromise = supabase
        .from("v_fund_summary")
        .select(
          "total_cash, total_contribution, total_withdrawal, net_contribution, total_bank_interest, net_investment_gain_loss, total_loan_gain_distributed, open_loans_count, open_loans_outstanding"
        )
        .single()

      const fundTrendPromise = supabase
        .from("v_fund_cash_timeline")
        .select("month, running_balance")
        .order("month", { ascending: true })

      // v_fund_summary's total_bank_interest is gross, before withholding tax --
      // netted here against Tax so this matches the Banks tab's Interest Earned
      // (same fix, same reasoning: tax is stored as a negative amount).
      const taxPromise = supabase.from("transactions").select("amount").eq("classification", "Tax").eq("status", "approved")

      // v_fund_summary's open_loans_outstanding is total_repayable minus
      // repaid, i.e. principal plus interest still owed -- fetched
      // separately here to show just the principal still out instead.
      const activeLoansPromise = supabase.from("loans").select("loan_id, principal").eq("status", "active")

      const loanRepaymentsPromise = supabase
        .from("transactions")
        .select("loan_id, amount")
        .eq("classification", "Loan Repayment")
        .eq("status", "approved")

      const [memberResult, performanceResult, fundResult, fundTrendResult, taxResult, activeLoansResult, loanRepaymentsResult] =
        await Promise.all([
          memberPromise,
          performancePromise,
          fundPromise,
          fundTrendPromise,
          taxPromise,
          activeLoansPromise,
          loanRepaymentsPromise
        ])

      if (cancelled) return

      if (memberResult.error || performanceResult.error || fundResult.error) {
        setLoadError(
          (memberResult.error || performanceResult.error || fundResult.error)?.message ?? "Failed to load"
        )
        setLoading(false)
        return
      }

      if (fundResult.data) {
        const totalTax = (taxResult.data ?? []).reduce((sum: number, row: any) => sum + Number(row.amount), 0)

        const repaidByLoan: Record<string, number> = {}
        for (const row of loanRepaymentsResult.data ?? []) {
          repaidByLoan[row.loan_id] = (repaidByLoan[row.loan_id] ?? 0) + Number(row.amount)
        }
        const open_loans_principal_outstanding = (activeLoansResult.data ?? []).reduce(
          (sum: number, loan: any) => sum + Math.max(0, Number(loan.principal) - (repaidByLoan[loan.loan_id] ?? 0)),
          0
        )

        // v_fund_summary has no write-off total of its own -- sum each
        // approved member's Bank Write-off Share instead, same population
        // the member breakdown below is built from.
        const approvedMemberIds = new Set((memberResult.data ?? []).map((m: any) => m.member_id))
        const total_bank_writeoff = (performanceResult.data ?? []).reduce(
          (sum: number, row: any) => (approvedMemberIds.has(row.member_id) ? sum + Number(row.bank_writeoff ?? 0) : sum),
          0
        )

        setFund({
          total_cash: Number(fundResult.data.total_cash),
          total_contribution: Number(fundResult.data.total_contribution),
          total_withdrawal: Number(fundResult.data.total_withdrawal),
          net_contribution: Number(fundResult.data.net_contribution),
          total_bank_interest: Number(fundResult.data.total_bank_interest) + totalTax,
          net_investment_gain_loss: Number(fundResult.data.net_investment_gain_loss),
          total_loan_gain_distributed: Number(fundResult.data.total_loan_gain_distributed),
          total_bank_writeoff,
          open_loans_count: Number(fundResult.data.open_loans_count),
          open_loans_outstanding: open_loans_principal_outstanding
        })
      }

      if (!fundTrendResult.error && fundTrendResult.data) {
        setFundTrend(fundTrendResult.data.map((r: any) => ({ value: Number(r.running_balance), date: r.month })))
      }

      const performanceByMember: Record<string, any> = {}
      performanceResult.data?.forEach((row: any) => {
        performanceByMember[row.member_id] = row
      })

      const breakdown = (memberResult.data ?? []).map((member: any) => {
        const p = performanceByMember[member.member_id]
        const total_contribution = Number(p?.total_contribution ?? 0)
        const total_withdrawal = Number(p?.total_withdrawal ?? 0)
        const net_contribution = Number(p?.net_contribution ?? 0)
        const bank_interest = Number(p?.bank_interest ?? 0)
        const investment_gain_loss = Number(p?.investment_gain_loss ?? 0)
        const loan_gain = Number(p?.loan_gain ?? 0)
        const bank_writeoff = Number(p?.bank_writeoff ?? 0)
        const total_value = Number(p?.total_value ?? 0)
        const money_on_hold = Number(p?.money_on_hold ?? 0)
        const withdrawable_now = Number(p?.withdrawable_now ?? 0)
        const totalGainLoss = bank_interest + investment_gain_loss + loan_gain + bank_writeoff
        const roi = net_contribution > 0 ? (totalGainLoss / net_contribution) * 100 : null

        return {
          member_id: member.member_id,
          name: member.name,
          total_contribution,
          total_withdrawal,
          net_contribution,
          bank_interest,
          investment_gain_loss,
          loan_gain,
          bank_writeoff,
          total_value,
          money_on_hold,
          withdrawable_now,
          totalGainLoss,
          roi,
          shareOfFund: 0
        } as MemberRow
      })

      const totalEquity = breakdown.reduce((sum, m) => sum + m.total_value, 0)

      const final = breakdown
        .map((m) => ({
          ...m,
          shareOfFund: totalEquity > 0 ? (m.total_value / totalEquity) * 100 : 0
        }))
        .sort((a, b) => b.total_value - a.total_value)

      setMembers(final)
      setLoading(false)
    }

    load()
    return () => {
      cancelled = true
    }
  }, [])

  const fmt = (n: number) =>
    Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  const signed = (n: number) => `${n < 0 ? "-" : "+"}₱${fmt(Math.abs(n))}`
  const tone = (n: number) => (n > 0 ? "text-sage" : n < 0 ? "text-rust" : "text-ink-soft")

  function handleCarouselTouchStart(e: React.TouchEvent) {
    touchStartX.current = e.touches[0].clientX
  }

  function handleCarouselTouchEnd(e: React.TouchEvent) {
    if (touchStartX.current === null) return
    const dx = e.changedTouches[0].clientX - touchStartX.current
    touchStartX.current = null

    if (Math.abs(dx) < 10) return

    suppressClickRef.current = true
    if (Math.abs(dx) >= 32) {
      setActiveIndex((i) => Math.max(0, Math.min(members.length - 1, dx < 0 ? i + 1 : i - 1)))
    }
  }

  function handleCardClick(memberId: string, memberName: string, e: React.MouseEvent) {
    if (suppressClickRef.current) {
      suppressClickRef.current = false
      e.preventDefault()
      return
    }
    setOpenMember({ id: memberId, name: memberName })
  }

  if (loading) {
    return <SkeletonCardList rows={4} />
  }

  if (openMember) {
    return (
      <MemberBreakdownSheet
        memberId={openMember.id}
        memberName={openMember.name}
        isSelf={authMember?.member_id === openMember.id}
        onClose={() => setOpenMember(null)}
      />
    )
  }

  const clampedIndex = Math.min(activeIndex, Math.max(0, members.length - 1))

  return (
    <div>
      <p className="text-sm text-ink-soft mt-0 mb-6">
        Ownership based on net contribution, investment performance, bank interest, and loan gain share.
      </p>

      {loadError && <p className="mb-4 text-sm text-rust">Couldn't load the fund breakdown: {loadError}</p>}

      {members.length > 0 && (
        <div className="bg-paper-2 border border-hairline rounded-md px-5 py-4 mb-6">
          <div className="flex justify-between items-baseline mb-1">
            <span className="text-[11px] uppercase tracking-wide text-ink-soft font-mono">Fund Total Cash</span>
            <span className="text-[13px] text-ink-soft font-mono">{members.length} members</span>
          </div>
          <p className="font-mono [font-variant-numeric:tabular-nums] text-2xl sm:text-3xl font-bold text-ink">
            ₱{fund != null ? fmt(fund.total_cash) : "—"}
          </p>
          <Sparkline points={fundTrend} color="#B8912F" />

          <p className="text-[10px] uppercase tracking-wide text-ink-soft font-mono mb-1.5 mt-3.5">Ownership Share</p>
          <div className="flex h-2 rounded-full overflow-hidden bg-hairline">
            {members.map((m, i) => (
              <div
                key={m.member_id}
                title={`${m.name}: ${m.shareOfFund.toFixed(1)}%`}
                style={{
                  width: `${Math.max(0, m.shareOfFund)}%`,
                  backgroundColor: SHARE_COLORS[i % SHARE_COLORS.length]
                }}
              />
            ))}
          </div>
          <div className="flex flex-wrap gap-x-3.5 gap-y-1.5 mt-2.5">
            {members.map((m, i) => (
              <div key={m.member_id} className="flex items-center gap-1.5">
                <span
                  className="w-[7px] h-[7px] rounded-full"
                  style={{ backgroundColor: SHARE_COLORS[i % SHARE_COLORS.length] }}
                />
                <span className="text-[10.5px] text-ink-soft font-mono">
                  {m.name} {m.shareOfFund.toFixed(1)}%
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {fund != null && (
        <div className="bg-paper-2 border border-hairline rounded-md p-5 mb-6">
          <p className="text-[11px] uppercase tracking-wide text-ink-soft font-mono mb-3">Fund Breakdown</p>

          <InfoBox label="Capital">
            <InfoRow label="Total Contribution" value={`₱${fmt(fund.total_contribution)}`} />
            {fund.total_withdrawal !== 0 && (
              <InfoRow
                label="Total Withdrawal"
                value={`-₱${fmt(Math.abs(fund.total_withdrawal))}`}
                valueClass="text-rust"
              />
            )}
            <InfoRow
              label="Net Contribution"
              value={`${fund.net_contribution < 0 ? "-" : ""}₱${fmt(Math.abs(fund.net_contribution))}`}
              bold
            />
          </InfoBox>

          {fund.open_loans_count > 0 && (
            <InfoBox label="Loans">
              <InfoRow
                label={`Principal Outstanding (${fund.open_loans_count} active)`}
                value={`₱${fmt(fund.open_loans_outstanding)}`}
                bold
              />
              <p className="text-[11px] text-ink-soft pt-1">Doesn't include interest owed.</p>
            </InfoBox>
          )}

          <InfoBox label="Performance">
            <InfoRow
              label="Total Fund Gain/Loss"
              value={signed(
                fund.total_bank_writeoff + fund.total_bank_interest + fund.net_investment_gain_loss + fund.total_loan_gain_distributed
              )}
              valueClass={tone(
                fund.total_bank_writeoff + fund.total_bank_interest + fund.net_investment_gain_loss + fund.total_loan_gain_distributed
              )}
              bold
            />
            <div className="pt-1 space-y-1.5">
              <InfoSubRow
                label="Investment Gain/Loss"
                value={signed(fund.net_investment_gain_loss)}
                valueClass={tone(fund.net_investment_gain_loss)}
              />
              {fund.total_bank_writeoff !== 0 && (
                <InfoSubRow
                  label="Bank Write-off"
                  value={signed(fund.total_bank_writeoff)}
                  valueClass={tone(fund.total_bank_writeoff)}
                />
              )}
              <InfoSubRow label="Bank Interest" value={signed(fund.total_bank_interest)} valueClass="text-sage" />
              <InfoSubRow
                label="Loan Gains Distributed"
                value={signed(fund.total_loan_gain_distributed)}
                valueClass={tone(fund.total_loan_gain_distributed)}
              />
            </div>
          </InfoBox>
        </div>
      )}

      <div
        className="overflow-hidden"
        style={{ touchAction: "pan-y" }}
        onTouchStart={handleCarouselTouchStart}
        onTouchEnd={handleCarouselTouchEnd}
      >
        <div
          className="flex transition-transform duration-300 ease-out will-change-transform motion-reduce:transition-none"
          style={{ transform: `translateX(-${clampedIndex * 100}%)` }}
        >
          {members.map((member) => (
            <button
              key={member.member_id}
              onClick={(e) => handleCardClick(member.member_id, member.name, e)}
              className="w-full shrink-0 text-left bg-paper-2 border border-hairline rounded-md p-5 hover:bg-paper transition-colors"
            >
              <div className="flex justify-between items-baseline flex-wrap gap-1.5 mb-4">
                <span className="font-display text-xl font-semibold text-ink">{member.name}</span>
                <div className="flex items-baseline gap-2.5">
                  {member.roi !== null && (
                    <span
                      className={`text-[11.5px] font-mono font-semibold px-[7px] py-[2px] rounded-full ${tone(
                        member.roi
                      )} ${member.roi > 0 ? "bg-sage/10" : member.roi < 0 ? "bg-rust/10" : "bg-ink-soft/10"}`}
                    >
                      {member.roi >= 0 ? "+" : ""}
                      {member.roi.toFixed(1)}% return
                    </span>
                  )}
                  <span className="text-[11px] text-ink-soft font-mono">{member.shareOfFund.toFixed(2)}% of fund</span>
                </div>
              </div>

              <InfoBox label="Capital">
                <InfoRow label="Total Contribution" value={`₱${fmt(member.total_contribution)}`} />
                {member.total_withdrawal !== 0 && (
                  <InfoRow
                    label="Total Withdrawal"
                    value={`-₱${fmt(Math.abs(member.total_withdrawal))}`}
                    valueClass="text-rust"
                  />
                )}
                <InfoRow
                  label="Net Contribution"
                  value={`${member.net_contribution < 0 ? "-" : ""}₱${fmt(Math.abs(member.net_contribution))}`}
                  bold
                />
              </InfoBox>

              <InfoBox label="Performance">
                <InfoRow
                  label="Total Gain/Loss"
                  value={signed(member.totalGainLoss)}
                  valueClass={tone(member.totalGainLoss)}
                  bold
                />
                <div className="pt-1 space-y-1.5">
                  {member.bank_writeoff !== 0 && (
                    <InfoSubRow
                      label="Bank Write-off Share"
                      value={signed(member.bank_writeoff)}
                      valueClass={tone(member.bank_writeoff)}
                    />
                  )}
                  <InfoSubRow
                    label="Investment Gain/Loss"
                    value={signed(member.investment_gain_loss)}
                    valueClass={tone(member.investment_gain_loss)}
                  />
                  <InfoSubRow label="Bank Interest" value={signed(member.bank_interest)} valueClass={tone(member.bank_interest)} />
                  <InfoSubRow label="Loan Gain Share" value={signed(member.loan_gain)} valueClass={tone(member.loan_gain)} />
                </div>
              </InfoBox>

              <div className="mt-4">
                <p className="text-[11px] uppercase tracking-wide text-ink-soft font-mono mb-1">Available Balance</p>
                <p className="font-mono [font-variant-numeric:tabular-nums] text-2xl font-bold text-ink">
                  ₱{fmt(member.withdrawable_now)}
                </p>
                {member.money_on_hold > 0 && (
                  <p className="text-xs text-ink-soft mt-1">
                    of ₱{fmt(member.total_value)} total — ₱{fmt(member.money_on_hold)} currently tied up in loans/investments
                  </p>
                )}
              </div>

              <p className="text-[11px] text-ink-soft text-right mt-3">View Breakdown →</p>
            </button>
          ))}
        </div>
      </div>

      {members.length > 1 && (
        <div className="flex items-center justify-center gap-1.5 mt-4">
          {members.map((m, i) => (
            <button
              key={m.member_id}
              onClick={() => setActiveIndex(i)}
              aria-label={`Go to ${m.name}`}
              className="w-6 h-6 flex items-center justify-center"
            >
              <span
                className={`block rounded-full transition-all ${
                  i === clampedIndex ? "w-4 h-1.5 rounded-[3px] bg-gold" : "w-1.5 h-1.5 bg-hairline"
                }`}
              />
            </button>
          ))}
        </div>
      )}

    </div>
  )
}

/* A member's full capital/performance breakdown, opened in place over the
   Group tab instead of navigating to its own route -- same data and layout
   the old /member-breakdown/[id] page rendered, just as an overlay so
   closing it returns to exactly where the carousel was left. */
function MemberBreakdownSheet({
  memberId,
  memberName,
  isSelf,
  onClose
}: {
  memberId: string
  memberName: string
  isSelf: boolean
  onClose: () => void
}) {
  const { dataLoading, performance, years, loadError } = useMemberBreakdown(memberId, false)
  const [yearIndex, setYearIndex] = useState(0)
  const yearTouchStartX = useRef<number | null>(null)

  const [loansLoading, setLoansLoading] = useState(true)
  const [memberLoans, setMemberLoans] = useState<Loan[]>([])
  const [loansLoadError, setLoansLoadError] = useState("")
  const [selectedLoanId, setSelectedLoanId] = useState<string | null>(null)

  // Opening this while the Group carousel is scrolled down would otherwise
  // leave the Breakdown header out of view -- jump back to top so it's
  // visible the instant the sheet mounts.
  useEffect(() => {
    window.scrollTo(0, 0)
  }, [])

  useEffect(() => {
    let cancelled = false

    async function loadLoans() {
      setLoansLoading(true)
      const { data, error } = await supabase
        .from("v_loan_summary")
        .select("*")
        .eq("borrower_member_id", memberId)
        .order("start_date", { ascending: false })

      if (cancelled) return

      if (error) {
        setLoansLoadError(error.message)
      } else {
        setMemberLoans((data as Loan[]) ?? [])
      }
      setLoansLoading(false)
    }

    loadLoans()
    return () => {
      cancelled = true
    }
  }, [memberId])

  const fmt = (n: number) =>
    Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  const signed = (n: number) => `${n < 0 ? "-" : "+"}₱${fmt(Math.abs(n))}`
  const tone = (n: number) => (n > 0 ? "text-sage" : n < 0 ? "text-rust" : "text-ink-soft")

  // Same touchend-only swipe detection as YouPanel's/the Group carousel --
  // see YouPanel's handleYearTouchStart/End for why touch-action: pan-y on
  // the wrapping div (set below) is what lets a vertical touch keep
  // scrolling the page natively while a horizontal swipe never does.
  function handleYearTouchStart(e: React.TouchEvent) {
    yearTouchStartX.current = e.touches[0].clientX
  }

  function handleYearTouchEnd(e: React.TouchEvent) {
    if (yearTouchStartX.current === null) return
    const dx = e.changedTouches[0].clientX - yearTouchStartX.current
    yearTouchStartX.current = null

    if (Math.abs(dx) < 32) return
    setYearIndex((i) => Math.max(0, Math.min(years.length - 1, dx < 0 ? i + 1 : i - 1)))
  }

  const clampedYearIndex = Math.min(yearIndex, Math.max(0, years.length - 1))

  if (selectedLoanId) {
    return <LoanDetailPanel loanId={selectedLoanId} onBack={() => setSelectedLoanId(null)} />
  }

  return (
    <div>
      <button onClick={onClose} className="text-[13px] text-ink-soft mb-4 hover:text-ink transition-colors">
        ← Group
      </button>

      <div className="text-[11px] tracking-[0.18em] uppercase text-gold font-mono mb-2">Personal Ledger</div>
      <h1 className="font-display text-3xl sm:text-4xl font-semibold text-ink mb-1">
        {isSelf ? "Your Breakdown" : `${memberName}'s Breakdown`}
      </h1>
      <p className="text-[13px] text-ink-soft mb-6">
        {isSelf ? "Your" : `${memberName}'s`} capital and performance, all-time and by year.
      </p>

        {dataLoading ? (
          <SkeletonPanel />
        ) : (
          <>
            {loadError && <p className="mb-4 text-sm text-rust">Couldn&apos;t load some of this breakdown: {loadError}</p>}

            {performance != null && (
              <div className="bg-paper-2 border border-hairline rounded-md p-5">
                <p className="text-[11px] uppercase tracking-wide text-ink-soft font-mono mb-1">Available Balance</p>
                <p className="font-mono [font-variant-numeric:tabular-nums] text-2xl font-bold text-ink mb-4">
                  ₱{fmt(performance.withdrawable_now)}
                </p>
                {performance.money_on_hold > 0 && (
                  <p className="text-xs text-ink-soft -mt-3 mb-4">
                    of ₱{fmt(performance.total_value)} total — ₱{fmt(performance.money_on_hold)} currently tied up in
                    loans/investments
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
                  <InfoRow
                    label="Net Contribution"
                    value={`${performance.net_contribution < 0 ? "-" : ""}₱${fmt(Math.abs(performance.net_contribution))}`}
                    bold
                  />
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
                    {performance.bank_writeoff !== 0 && (
                      <InfoSubRow
                        label="Bank Write-off Share"
                        value={signed(performance.bank_writeoff)}
                        valueClass={tone(performance.bank_writeoff)}
                      />
                    )}
                    <InfoSubRow
                      label="Investment Gain/Loss"
                      value={signed(performance.investment_gain_loss)}
                      valueClass={tone(performance.investment_gain_loss)}
                    />
                    <InfoSubRow
                      label="Bank Interest"
                      value={signed(performance.bank_interest)}
                      valueClass={tone(performance.bank_interest)}
                    />
                    <InfoSubRow
                      label="Loan Gain Share"
                      value={signed(performance.loan_gain)}
                      valueClass={tone(performance.loan_gain)}
                    />
                  </div>
                </InfoBox>
              </div>
            )}

            <section className="mt-8">
              <h2 className="font-display text-lg font-medium text-ink mb-1">By Year</h2>
              <p className="text-[13px] text-ink-soft mb-3">
                Contributions, withdrawals, bank interest, loan gain share, and investment gain/loss, by calendar
                year. Investment allocations aren&apos;t dated individually, so each is counted in the year of that
                investment&apos;s most recent transaction.
              </p>

              {years.length === 0 && !loadError && (
                <p className="text-sm text-ink-soft text-center py-8 bg-paper-2 border border-hairline rounded-md">
                  No dated activity yet.
                </p>
              )}

              {years.length > 0 && (
              <div
                className="overflow-hidden"
                style={{ touchAction: "pan-y" }}
                onTouchStart={handleYearTouchStart}
                onTouchEnd={handleYearTouchEnd}
              >
              <div
                className="flex transition-transform duration-300 ease-out will-change-transform motion-reduce:transition-none"
                style={{ transform: `translateX(-${clampedYearIndex * 100}%)` }}
              >
                {years.map((y) => {
                  const yearGainLoss = y.bankInterest + y.loanGain + y.bankWriteoff + y.investmentGainLoss
                  return (
                    <div key={y.year} className="w-full shrink-0 bg-paper-2 border border-hairline rounded-md p-5">
                      <div className="mb-3">
                        <span className="font-display text-xl font-semibold text-ink">{y.year}</span>
                      </div>

                      <InfoBox label="Year Summary">
                        <InfoRow label="Beginning Balance" value={`₱${fmt(y.beginningBalance)}`} />
                        <InfoRow label="Contribution" value={`₱${fmt(y.contribution)}`} />
                        {y.withdrawal !== 0 && (
                          <InfoRow label="Withdrawal" value={`-₱${fmt(Math.abs(y.withdrawal))}`} valueClass="text-rust" />
                        )}
                        <InfoRow label="Gain/Loss" value={signed(yearGainLoss)} valueClass={tone(yearGainLoss)} />
                        <InfoRow label="Ending Balance" value={`₱${fmt(y.endingBalance)}`} bold />
                      </InfoBox>

                      {(y.bankWriteoff !== 0 || y.investmentGainLoss !== 0 || y.bankInterest !== 0 || y.loanGain !== 0) && (
                        <InfoBox label="Gain/Loss Breakdown">
                          {y.bankWriteoff !== 0 && (
                            <InfoSubRow
                              label="Bank Write-off Share"
                              value={signed(y.bankWriteoff)}
                              valueClass={tone(y.bankWriteoff)}
                            />
                          )}
                          {y.investmentGainLoss !== 0 && (
                            <InfoSubRow
                              label="Investment Gain/Loss"
                              value={signed(y.investmentGainLoss)}
                              valueClass={tone(y.investmentGainLoss)}
                            />
                          )}
                          {y.bankInterest !== 0 && (
                            <InfoSubRow label="Bank Interest" value={signed(y.bankInterest)} valueClass={tone(y.bankInterest)} />
                          )}
                          {y.loanGain !== 0 && (
                            <InfoSubRow label="Loan Gain Share" value={signed(y.loanGain)} valueClass={tone(y.loanGain)} />
                          )}
                        </InfoBox>
                      )}
                    </div>
                  )
                })}
              </div>
              </div>
              )}

              {years.length > 1 && (
                <div className="flex items-center justify-center gap-1.5 mt-4">
                  {years.map((y, i) => (
                    <button
                      key={y.year}
                      onClick={() => setYearIndex(i)}
                      aria-label={`Go to ${y.year}`}
                      className="w-6 h-6 flex items-center justify-center"
                    >
                      <span
                        className={`block rounded-full transition-all ${
                          i === clampedYearIndex ? "w-4 h-1.5 rounded-[3px] bg-gold" : "w-1.5 h-1.5 bg-hairline"
                        }`}
                      />
                    </button>
                  ))}
                </div>
              )}
            </section>

            {!loansLoading && memberLoans.length > 0 && (
              <section className="mt-8">
                <h2 className="font-display text-lg font-medium text-ink mb-1">
                  {isSelf ? "Your Loan" : `${memberName}'s Loan`}
                  {memberLoans.length > 1 ? "s" : ""}
                </h2>
                <p className="text-[13px] text-ink-soft mb-3">
                  {isSelf ? "Loans you're the borrower on" : `Loans ${memberName} is the borrower on`}, past and
                  present.
                </p>
                {loansLoadError && <p className="mb-3 text-sm text-rust">Couldn&apos;t load loans: {loansLoadError}</p>}
                <div className="flex flex-col gap-3">
                  {memberLoans.map((loan) => (
                    <LoanCard
                      key={loan.loan_id}
                      loan={loan}
                      meta={loanStatusMeta(loan)}
                      fmt={fmt}
                      isMine={isSelf}
                      onClick={() => setSelectedLoanId(loan.loan_id)}
                    />
                  ))}
                </div>
              </section>
            )}
          </>
        )}
    </div>
  )
}

/* ============================== Loans ============================== */

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
  total_repayable: number
  term_months: number | null
  interest_type: InterestType | null
  interest_rate: number | null
  interest_amount: number | null
  repayment_frequency: string | null
  last_repayment_date: string | null
}

function termLabel(loan: Loan): string | null {
  return loan.term_months != null ? `${loan.term_months} mo` : null
}

// A closed loan isn't always a full repayment -- "Close Early (Write Off)"
// closes it with whatever was actually repaid, which can be less than
// total_repayable. Label off the real repayment total instead of assuming
// every closed loan was paid off in full (same rule as LoanDetailPanel).
function loanStatusMeta(loan: Loan): { label: string; dot: string; text: string } {
  if (loan.status === "active") return { label: "Active", dot: "bg-gold", text: "text-gold" }
  if (loan.status === "requested") return { label: "Requested", dot: "bg-ink-soft", text: "text-ink-soft" }
  return loan.repayment >= loan.total_repayable
    ? { label: "Repaid in full", dot: "bg-sage", text: "text-sage" }
    : { label: "Closed early", dot: "bg-rust", text: "text-rust" }
}

function LoansPanel({ myMemberId }: { myMemberId: string | null }) {
  const [loading, setLoading] = useState(true)
  const [loans, setLoans] = useState<Loan[]>([])
  const [loadError, setLoadError] = useState("")
  const [selectedLoanId, setSelectedLoanId] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    async function load() {
      const { data, error } = await supabase
        .from("v_loan_summary")
        .select("*")
        .order("start_date", { ascending: false })

      if (cancelled) return

      if (error) {
        setLoadError(error.message)
      } else {
        setLoans((data as Loan[]) ?? [])
      }

      setLoading(false)
    }

    load()
    return () => {
      cancelled = true
    }
  }, [])

  const fmt = (n: number) =>
    Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })

  if (loading) {
    return <SkeletonCardList rows={4} />
  }

  if (selectedLoanId) {
    return <LoanDetailPanel loanId={selectedLoanId} onBack={() => setSelectedLoanId(null)} />
  }

  const openLoans = loans.filter((l) => l.status !== "closed")
  const closedLoans = loans.filter((l) => l.status === "closed")
  const totalInterestEarned = closedLoans.reduce((sum, l) => sum + l.gain, 0)
  const totalOutstanding = openLoans.reduce((sum, l) => sum + l.outstanding, 0)

  return (
    <div>
      <p className="text-[13px] text-ink-soft mb-6">Every loan the fund has released, and what came back.</p>

      {!loadError && loans.length > 0 && (
        <div className="bg-paper-2 border border-hairline rounded-md px-5 pt-4 pb-3.5 mb-6">
          <p className="text-[11px] uppercase tracking-wide text-ink-soft font-mono mb-1.5">Total Outstanding</p>
          <p className="font-mono [font-variant-numeric:tabular-nums] text-3xl font-bold text-ink">
            ₱{fmt(totalOutstanding)}
          </p>
          <p className="text-[11px] text-ink-soft mt-1">
            across {openLoans.length} outstanding loan{openLoans.length === 1 ? "" : "s"}
          </p>

          {closedLoans.length > 0 && (
            <div className="flex items-baseline justify-between mt-3.5 pt-3 border-t border-hairline">
              <div>
                <p className="text-[10px] uppercase tracking-wide text-ink-soft font-mono">Interest Earned</p>
                <p className="text-[10px] text-ink-soft mt-0.5">
                  across {closedLoans.length} closed loan{closedLoans.length === 1 ? "" : "s"}
                </p>
              </div>
              <p
                className={`font-mono [font-variant-numeric:tabular-nums] text-[15px] font-semibold ${
                  totalInterestEarned > 0 ? "text-sage" : totalInterestEarned < 0 ? "text-rust" : "text-ink"
                }`}
              >
                {totalInterestEarned < 0 ? "-" : "+"}₱{fmt(Math.abs(totalInterestEarned))}
              </p>
            </div>
          )}
        </div>
      )}

      {loadError && <p className="mb-4 text-sm text-rust">Couldn't load loans: {loadError}</p>}

      {!loadError && loans.length === 0 && (
        <p className="text-sm text-ink-soft text-center py-12">No loans on record yet.</p>
      )}

      {openLoans.length > 0 && (
        <section className="mb-7">
          <h2 className="text-[11px] uppercase tracking-[0.1em] text-ink-soft font-mono mb-3">Outstanding</h2>
          <div className="flex flex-col gap-3">
            {openLoans.map((loan) => (
              <LoanCard
                key={loan.loan_id}
                loan={loan}
                meta={loanStatusMeta(loan)}
                fmt={fmt}
                isMine={loan.borrower_member_id === myMemberId}
                onClick={() => setSelectedLoanId(loan.loan_id)}
              />
            ))}
          </div>
        </section>
      )}

      {closedLoans.length > 0 && (
        <section>
          <h2 className="text-[11px] uppercase tracking-[0.1em] text-ink-soft font-mono mb-3">Closed</h2>
          <div className="flex flex-col gap-3">
            {closedLoans.map((loan) => (
              <LoanCard
                key={loan.loan_id}
                loan={loan}
                meta={loanStatusMeta(loan)}
                fmt={fmt}
                isMine={loan.borrower_member_id === myMemberId}
                onClick={() => setSelectedLoanId(loan.loan_id)}
              />
            ))}
          </div>
        </section>
      )}
    </div>
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
  // Driven by the real repaid amount, not total_repayable - outstanding --
  // outstanding is forced to 0 for any closed loan (see v_loan_summary),
  // which would otherwise show a full bar even for a write-off that was
  // never actually repaid.
  const repaidPct = loan.total_repayable > 0 ? Math.min(100, (loan.repayment / loan.total_repayable) * 100) : 0
  const fullyRepaid = loan.repayment >= loan.total_repayable

  const dateLabel = new Date(loan.start_date).toLocaleDateString(undefined, { month: "short", year: "numeric" })
  const overdueLabel = paymentOverdueLabel(loan.status, loan.repayment_frequency, loan.start_date, loan.last_repayment_date)

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
            {termLabel(loan) && ` · ${termLabel(loan)}`}
            {loan.status === "closed" &&
              durationLabel(loan.start_date, loan.closed_date) &&
              ` · paid off in ${durationLabel(loan.start_date, loan.closed_date)}`}
          </p>
          {overdueLabel && (
            <p className="text-[11px] font-mono uppercase tracking-wide text-rust mt-1">⚠ {overdueLabel}</p>
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
        {loan.status === "closed" ? (
          <div className="text-right">
            <p className="text-[10px] uppercase tracking-wide text-ink-soft font-mono">
              {loan.gain >= 0 ? "Gain" : "Loss"}
            </p>
            <p
              className={`font-mono [font-variant-numeric:tabular-nums] text-sm font-semibold ${
                loan.gain >= 0 ? "text-sage" : "text-rust"
              }`}
            >
              {loan.gain >= 0 ? "+" : "-"}₱{fmt(Math.abs(loan.gain))}
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

      {!(loan.status === "closed" && fullyRepaid) && (
        <div className="h-1.5 rounded-full bg-hairline overflow-hidden mt-2.5">
          <div
            className={`h-full ${loan.status === "closed" ? "bg-rust" : "bg-gold"}`}
            style={{ width: `${repaidPct}%` }}
          />
        </div>
      )}
    </button>
  )
}

/* ============================== Banks ============================== */

type Bank = {
  bank: string
  balance: number
  interest_earned: number
  tax: number
  distributed: number
  pending_interest: number
}

type BankAccount = {
  id: string
  bank_name: string
  account_name: string | null
  qr_code_url: string | null
}

function BanksPanel({ isAdmin }: { isAdmin: boolean }) {
  const [loading, setLoading] = useState(true)
  const [banks, setBanks] = useState<Bank[]>([])
  const [bankAccounts, setBankAccounts] = useState<BankAccount[]>([])
  const [loadError, setLoadError] = useState("")
  const [selectedBank, setSelectedBank] = useState<string | null>(null)
  const [selectedYear, setSelectedYear] = useState<string | null>(null)

  const [manageMode, setManageMode] = useState(false)
  const [showAddForm, setShowAddForm] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [bankName, setBankName] = useState("")
  const [accountName, setAccountName] = useState("")
  const [saving, setSaving] = useState(false)
  const [formMessage, setFormMessage] = useState("")
  const editFormRef = useRef<HTMLDivElement | null>(null)

  // Tapping Edit on a bank further down the list reveals its form inline,
  // below the fold -- with nothing to indicate the tap even registered.
  // Scrolls the opened form into view the moment it mounts (once per
  // editingId change, not on every keystroke -- editFormRef is a stable
  // object ref, only reassigned when the underlying DOM node itself
  // mounts/unmounts).
  useEffect(() => {
    if (editingId) editFormRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" })
  }, [editingId])

  async function load() {
    const bankAccountsPromise = supabase.from("bank_accounts").select("*").order("bank_name")
    const balancesPromise = supabase.from("v_bank_balances").select("*")
    // bank falls back to the linked bank_accounts.bank_name -- transactions
    // recorded through the current form only set bank_account_id, leaving
    // the legacy bank text column null. v_cash_ledger already resolves the
    // same way (COALESCE(t.bank, ba.account_name, ba.bank_name)); this
    // mirrors it so a bank's balance and its interest/tax never disagree
    // about which bank a transaction belongs to.
    const interestPromise = supabase
      .from("transactions")
      .select("bank, classification, amount, bank_accounts!transactions_bank_account_id_fkey ( bank_name )")
      .eq("status", "approved")
      .in("classification", ["Bank Interest", "Tax"])
    const distributedPromise = supabase.from("bank_interest_allocations").select("bank, amount")
    // Same source the admin Distrib. tab is built from -- reusing it here
    // instead of tracking pending status from the raw transactions means
    // this "not yet distributed" figure can never drift from what
    // Distribute actually credits (tax netted out, orphaned already-
    // distributed years excluded). Caught locally, unlike the other
    // promises here -- getPendingBankInterestGroups throws instead of
    // resolving to {error}, which would otherwise abort the whole
    // Promise.all and leave every other result here unprocessed too.
    const pendingGroupsPromise = getPendingBankInterestGroups().catch((err) => {
      setLoadError(err instanceof Error ? err.message : "Couldn't load pending interest.")
      return []
    })

    const [bankAccountsResult, balancesResult, interestResult, distributedResult, pendingGroups] = await Promise.all([
      bankAccountsPromise,
      balancesPromise,
      interestPromise,
      distributedPromise,
      pendingGroupsPromise
    ])

    if (bankAccountsResult.error) {
      setLoadError(bankAccountsResult.error.message)
      setLoading(false)
      return
    }

    setBankAccounts((bankAccountsResult.data as BankAccount[]) ?? [])

    const byBank: Record<string, Bank> = {}
    for (const acct of bankAccountsResult.data ?? []) {
      byBank[acct.bank_name] = { bank: acct.bank_name, balance: 0, interest_earned: 0, tax: 0, distributed: 0, pending_interest: 0 }
    }

    if (!balancesResult.error) {
      for (const row of balancesResult.data ?? []) {
        if (!byBank[row.bank]) byBank[row.bank] = { bank: row.bank, balance: 0, interest_earned: 0, tax: 0, distributed: 0, pending_interest: 0 }
        byBank[row.bank].balance = Number(row.balance)
      }
    } else {
      setLoadError(balancesResult.error.message)
    }

    if (!interestResult.error) {
      for (const row of interestResult.data ?? []) {
        const bankName = row.bank || (row as any).bank_accounts?.bank_name
        // Shouldn't happen -- every transaction here should resolve to a
        // real bank one way or the other -- but skip rather than pool
        // unattributed interest/tax into a bogus "unknown bank" card.
        if (!bankName) continue
        if (!byBank[bankName]) byBank[bankName] = { bank: bankName, balance: 0, interest_earned: 0, tax: 0, distributed: 0, pending_interest: 0 }
        if (row.classification === "Bank Interest") byBank[bankName].interest_earned += Number(row.amount)
        if (row.classification === "Tax") byBank[bankName].tax += Number(row.amount)
      }
    } else {
      setLoadError(interestResult.error.message)
    }

    if (!distributedResult.error) {
      for (const row of distributedResult.data ?? []) {
        if (!byBank[row.bank]) byBank[row.bank] = { bank: row.bank, balance: 0, interest_earned: 0, tax: 0, distributed: 0, pending_interest: 0 }
        byBank[row.bank].distributed += Number(row.amount)
      }
    } else {
      setLoadError(distributedResult.error.message)
    }

    for (const group of pendingGroups) {
      if (!byBank[group.bank]) {
        byBank[group.bank] = { bank: group.bank, balance: 0, interest_earned: 0, tax: 0, distributed: 0, pending_interest: 0 }
      }
      byBank[group.bank].pending_interest += group.totalAmount
    }

    setBanks(Object.values(byBank).sort((a, b) => b.balance - a.balance))
    setLoading(false)
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function clearForm() {
    setShowAddForm(false)
    setEditingId(null)
    setBankName("")
    setAccountName("")
    setFormMessage("")
  }

  function startAdd() {
    clearForm()
    setShowAddForm(true)
  }

  function startEdit(acct: BankAccount) {
    clearForm()
    setEditingId(acct.id)
    setBankName(acct.bank_name ?? "")
    setAccountName(acct.account_name ?? "")
  }

  async function saveBank() {
    if (!bankName.trim()) {
      setFormMessage("Enter a bank name.")
      return
    }

    // v_cash_ledger/v_bank_balances group by this resolved (bank_name,
    // account_name) pair, not by id -- two accounts that resolve to the
    // same pair would silently merge their balances together with no
    // error. Checked here for a friendly message; the DB's own unique
    // index is the real backstop.
    const trimmedBankName = bankName.trim()
    const trimmedAccountName = accountName.trim() || null
    const isDuplicate = bankAccounts.some(
      (acct) =>
        acct.id !== editingId &&
        acct.bank_name === trimmedBankName &&
        (acct.account_name?.trim() || null) === trimmedAccountName
    )
    if (isDuplicate) {
      setFormMessage("An account with this bank name and account name already exists.")
      return
    }

    setSaving(true)

    if (editingId) {
      const { error } = await supabase
        .from("bank_accounts")
        .update({
          bank_name: trimmedBankName,
          account_name: trimmedAccountName
        })
        .eq("id", editingId)

      setSaving(false)
      if (error) {
        setFormMessage(error.message)
        return
      }
    } else {
      const { error } = await supabase.from("bank_accounts").insert({
        bank_name: trimmedBankName,
        account_name: trimmedAccountName
      })

      setSaving(false)
      if (error) {
        setFormMessage(error.message)
        return
      }
    }

    clearForm()
    load()
  }

  const fmt = (n: number) =>
    Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })

  if (loading) {
    return <SkeletonCardList rows={3} />
  }

  if (selectedBank && selectedYear) {
    return (
      <BankYearDetailPanel bank={selectedBank} year={selectedYear} onBack={() => setSelectedYear(null)} />
    )
  }

  if (selectedBank) {
    return (
      <BankDetailPanel
        bank={selectedBank}
        onBack={() => setSelectedBank(null)}
        onSelectYear={(y) => setSelectedYear(y)}
      />
    )
  }

  const totalBalance = banks.reduce((sum, b) => sum + b.balance, 0)
  // tax is stored as a negative amount, so adding it nets it out -- subtracting
  // it would add the withheld amount back instead.
  const totalNetInterest = banks.reduce((sum, b) => sum + (b.interest_earned + b.tax), 0)

  return (
    <div>
      <p className="text-[13px] text-ink-soft mb-4">Where the fund's cash sits, and the interest each account has earned.</p>

      {isAdmin && (
        <div className="flex items-center gap-2 flex-wrap mb-5">
          {manageMode ? (
            <button
              className="bg-ink text-paper px-4 py-2.5 rounded-sm text-sm font-medium shrink-0"
              onClick={() => {
                setManageMode(false)
                clearForm()
              }}
            >
              Done
            </button>
          ) : (
            <button
              className="border border-hairline text-ink-soft px-4 py-2.5 rounded-sm text-sm font-medium shrink-0"
              onClick={() => {
                setManageMode(true)
                clearForm()
              }}
            >
              Manage
            </button>
          )}
          <button
            className="shrink-0 bg-gold text-ink px-4 py-2.5 rounded-sm text-sm font-semibold shadow-sm hover:opacity-90 transition-opacity flex items-center gap-1.5"
            onClick={startAdd}
          >
            <span className="text-lg leading-none">+</span>
            Add Bank
          </button>
        </div>
      )}

      {showAddForm && (
        <BankForm
          title="Add Bank Account"
          bankName={bankName}
          setBankName={setBankName}
          accountName={accountName}
          setAccountName={setAccountName}
          saving={saving}
          message={formMessage}
          onSave={saveBank}
          onCancel={clearForm}
          saveLabel="Add Bank"
          className="mb-6"
        />
      )}

      {!loadError && banks.length > 0 && (
        <div className="bg-paper-2 border border-hairline rounded-md px-5 pt-4 pb-3.5 mb-6">
          <p className="text-[11px] uppercase tracking-wide text-ink-soft font-mono mb-1.5">Total Bank Balance</p>
          <p className="font-mono [font-variant-numeric:tabular-nums] text-3xl font-bold text-ink">₱{fmt(totalBalance)}</p>
          <p className="text-[11px] text-ink-soft mt-1">
            across {banks.length} account{banks.length === 1 ? "" : "s"}
          </p>

          <div className="flex items-baseline justify-between mt-3.5 pt-3 border-t border-hairline">
            <div>
              <p className="text-[10px] uppercase tracking-wide text-ink-soft font-mono">Interest Earned</p>
              <p className="text-[10px] text-ink-soft mt-0.5">
                across {banks.length} account{banks.length === 1 ? "" : "s"}
              </p>
            </div>
            <p
              className={`font-mono [font-variant-numeric:tabular-nums] text-[15px] font-semibold ${
                totalNetInterest > 0 ? "text-sage" : totalNetInterest < 0 ? "text-rust" : "text-ink"
              }`}
            >
              {totalNetInterest < 0 ? "-" : "+"}₱{fmt(Math.abs(totalNetInterest))}
            </p>
          </div>
        </div>
      )}

      {loadError && <p className="mb-4 text-sm text-rust">Couldn't load banks: {loadError}</p>}

      {!loadError && banks.length === 0 && (
        <p className="text-sm text-ink-soft text-center py-12">No bank accounts on record yet.</p>
      )}

      <div className="flex flex-col gap-3">
        {banks.map((b) => {
          const acct = bankAccounts.find((a) => a.bank_name === b.bank)
          const isEditingThis = isAdmin && manageMode && !!acct && editingId === acct.id

          return (
            <div key={b.bank} ref={isEditingThis ? editFormRef : undefined}>
              <BankCard
                bank={b}
                fmt={fmt}
                onClick={() => setSelectedBank(b.bank)}
                showEdit={isAdmin && manageMode}
                fused={isEditingThis}
                onEdit={acct ? () => startEdit(acct) : undefined}
              />
              {isEditingThis && acct && (
                <BankForm
                  title="Edit Bank Account"
                  bankName={bankName}
                  setBankName={setBankName}
                  accountName={accountName}
                  setAccountName={setAccountName}
                  saving={saving}
                  message={formMessage}
                  onSave={saveBank}
                  onCancel={() => setEditingId(null)}
                  saveLabel="Save Changes"
                  fused
                  bankAccountId={acct.id}
                  qrCodeUrl={acct.qr_code_url}
                  onQrUpdated={(path) =>
                    setBankAccounts((prev) => prev.map((a) => (a.id === acct.id ? { ...a, qr_code_url: path } : a)))
                  }
                />
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function BankCard({
  bank,
  fmt,
  onClick,
  showEdit,
  fused,
  onEdit
}: {
  bank: Bank
  fmt: (n: number) => string
  onClick: () => void
  showEdit: boolean
  fused: boolean
  onEdit?: () => void
}) {
  // tax is stored as a negative amount, so adding it nets it out --
  // subtracting it would add the withheld amount back instead.
  const netInterest = bank.interest_earned + bank.tax
  // Not derived as interest_earned - distributed -- pending_interest comes
  // straight from getPendingBankInterestGroups (the same source the admin
  // Distrib. tab uses), so it can never drift from what Distribute
  // actually credits: tax netted out, and years whose interest was
  // already fully distributed correctly excluded.
  const undistributed = bank.pending_interest
  const distributedPct = netInterest > 0 ? Math.min(100, (bank.distributed / netInterest) * 100) : 0

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault()
          onClick()
        }
      }}
      className={`w-full text-left bg-paper-2 border border-hairline px-5 py-4 hover:bg-paper transition-colors cursor-pointer ${
        fused ? "rounded-t-md rounded-b-none border-b-0" : "rounded-md"
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-display text-[17px] font-semibold text-ink truncate">{bank.bank}</p>
          <p className="font-mono [font-variant-numeric:tabular-nums] text-2xl font-bold text-ink mt-0.5">
            ₱{fmt(bank.balance)}
          </p>
          <p className="text-[11px] text-ink-soft">current balance</p>
        </div>
        {showEdit ? (
          <button
            onClick={(e) => {
              e.stopPropagation()
              onEdit?.()
            }}
            className="shrink-0 text-[11px] text-ink-soft border border-hairline rounded-sm px-2.5 py-1.5"
          >
            Edit
          </button>
        ) : (
          <span className="text-ink-soft shrink-0">→</span>
        )}
      </div>

      <div className="flex items-baseline justify-between mt-3.5">
        <div>
          <p className="text-[10px] uppercase tracking-wide text-ink-soft font-mono">Interest Earned</p>
          <p className="font-mono [font-variant-numeric:tabular-nums] text-sm font-semibold text-sage">
            +₱{fmt(netInterest)}
          </p>
        </div>
        <div className="text-right">
          <p className="text-[10px] uppercase tracking-wide text-ink-soft font-mono">Distributed</p>
          <p className="font-mono [font-variant-numeric:tabular-nums] text-sm font-semibold text-ink">₱{fmt(bank.distributed)}</p>
        </div>
      </div>

      <div className="h-1.5 rounded-full bg-hairline overflow-hidden mt-2.5">
        <div className="h-full bg-sage" style={{ width: `${distributedPct}%` }} />
      </div>

      {undistributed > 0.01 && (
        <p className="text-[11px] text-gold mt-2">₱{fmt(undistributed)} not yet distributed to members</p>
      )}
    </div>
  )
}

function BankForm({
  title,
  bankName,
  setBankName,
  accountName,
  setAccountName,
  saving,
  message,
  onSave,
  onCancel,
  saveLabel,
  fused = false,
  className = "",
  bankAccountId,
  qrCodeUrl,
  onQrUpdated
}: {
  title: string
  bankName: string
  setBankName: (v: string) => void
  accountName: string
  setAccountName: (v: string) => void
  saving: boolean
  message: string
  onSave: () => void
  onCancel: () => void
  saveLabel: string
  fused?: boolean
  className?: string
  // Only known once the account already exists -- the QR upload needs a
  // real bank_accounts.id to attach to, so it's hidden on the "Add Bank
  // Account" form and only appears once editing an existing one.
  bankAccountId?: string
  qrCodeUrl?: string | null
  onQrUpdated?: (path: string) => void
}) {
  return (
    <div className={`bg-paper-2 border border-hairline relative overflow-hidden ${fused ? "rounded-b-md" : "rounded-md"} ${className}`}>
      {!fused && <div className="absolute left-0 top-0 bottom-0 w-[3px] bg-gold" />}
      <div className={fused ? "px-5 py-5 space-y-4" : "pl-6 pr-5 py-6 space-y-4"}>
        <p className="font-display text-lg font-medium">{title}</p>

        <div>
          <label className="block mb-2 text-xs uppercase tracking-wide text-ink-soft font-mono">Bank name</label>
          <input
            className="border border-hairline bg-paper text-ink text-sm rounded-sm px-3 py-3 w-full"
            placeholder="e.g. BDO"
            value={bankName}
            onChange={(e) => setBankName(e.target.value)}
          />
        </div>

        <div>
          <label className="block mb-2 text-xs uppercase tracking-wide text-ink-soft font-mono">Account name</label>
          <input
            className="border border-hairline bg-paper text-ink text-sm rounded-sm px-3 py-3 w-full"
            placeholder="e.g. Haru Fund Savings"
            value={accountName}
            onChange={(e) => setAccountName(e.target.value)}
          />
        </div>

        {bankAccountId && (
          <BankQrField bankAccountId={bankAccountId} qrCodeUrl={qrCodeUrl ?? null} onUpdated={onQrUpdated} />
        )}

        <div className="flex gap-3">
          <button
            className="bg-ink text-paper px-4 py-3 rounded-sm text-sm font-medium flex-1 disabled:opacity-50"
            onClick={onSave}
            disabled={saving}
          >
            {saving ? "Saving..." : saveLabel}
          </button>
          <button className="border border-hairline rounded-sm px-4 py-3 text-sm" onClick={onCancel}>
            Cancel
          </button>
        </div>

        {message && <p className="text-sm text-rust">{message}</p>}
      </div>
    </div>
  )
}

// Lets an admin upload/replace the "scan to pay" QR shown on Dashboard and
// the Borrower hub for this bank account. Uploads straight away on file
// select (no separate save step, independent of the bank name/account name
// save button above it).
function BankQrField({
  bankAccountId,
  qrCodeUrl,
  onUpdated
}: {
  bankAccountId: string
  qrCodeUrl: string | null
  onUpdated?: (path: string) => void
}) {
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState("")
  const fileInput = useRef<HTMLInputElement | null>(null)

  async function handleFile(file: File) {
    setError("")
    setUploading(true)

    const path = `${bankAccountId}-${Date.now()}-${file.name}`

    const { error: uploadError } = await supabase.storage.from("BankQR").upload(path, file, { contentType: file.type })

    if (uploadError) {
      setError(uploadError.message)
      setUploading(false)
      return
    }

    const { error: updateError } = await supabase
      .from("bank_accounts")
      .update({ qr_code_url: path })
      .eq("id", bankAccountId)

    if (updateError) {
      // The new file already uploaded -- if pointing the bank row at it
      // failed, clean it up rather than leaving an orphaned object behind.
      await supabase.storage.from("BankQR").remove([path])
      setError(updateError.message)
      setUploading(false)
      return
    }

    if (qrCodeUrl) await supabase.storage.from("BankQR").remove([qrCodeUrl])

    onUpdated?.(path)
    setUploading(false)
  }

  return (
    <div>
      <label className="block mb-2 text-xs uppercase tracking-wide text-ink-soft font-mono">
        Scan-to-pay QR code
      </label>
      <div className="flex items-center gap-3">
        {qrCodeUrl ? (
          <img
            src={getBankQrPublicUrl(qrCodeUrl)}
            alt="Bank QR code"
            className="w-14 h-14 object-contain rounded-sm border border-hairline bg-paper shrink-0"
          />
        ) : (
          <div className="w-14 h-14 rounded-sm border border-dashed border-hairline shrink-0 flex items-center justify-center text-ink-soft text-[10px]">
            None
          </div>
        )}

        <input
          ref={fileInput}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0]
            e.target.value = ""
            if (file) handleFile(file)
          }}
        />
        <button
          type="button"
          onClick={() => fileInput.current?.click()}
          disabled={uploading}
          className="text-xs font-medium text-ink-soft border border-hairline rounded-sm px-3 py-2 hover:bg-paper hover:text-ink transition-colors disabled:opacity-60"
        >
          {uploading ? "Uploading..." : qrCodeUrl ? "Replace" : "Upload"}
        </button>
      </div>
      {error && <p className="text-sm text-rust mt-1.5">{error}</p>}
    </div>
  )
}

/* ============================== Investments ============================== */

type Investment = {
  investment_id: string
  investment: string
  affects_cash: number
  invested: number
  returned: number
  gain_loss: number
  status: "open" | "closed"
  closed_date: string | null
}

function InvestmentsPanel({ isAdmin }: { isAdmin: boolean }) {
  const [loading, setLoading] = useState(true)
  const [investments, setInvestments] = useState<Investment[]>([])
  const [loadError, setLoadError] = useState("")
  const [selectedInvestmentId, setSelectedInvestmentId] = useState<string | null>(null)

  const [manageMode, setManageMode] = useState(false)
  const [showAddForm, setShowAddForm] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [name, setName] = useState("")
  const [affectsCash, setAffectsCash] = useState(true)
  const [saving, setSaving] = useState(false)
  const [formMessage, setFormMessage] = useState("")
  const editFormRef = useRef<HTMLDivElement | null>(null)

  // Same fix as BanksPanel: scroll the opened form into view the moment it
  // mounts, once per editingId change (editFormRef is a stable object ref,
  // only reassigned when the underlying DOM node itself mounts/unmounts).
  useEffect(() => {
    if (editingId) editFormRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" })
  }, [editingId])

  async function load() {
    const { data, error } = await supabase.from("v_investment_summary").select("*").order("investment")

    if (error) {
      setLoadError(error.message)
    } else {
      setInvestments((data as Investment[]) ?? [])
    }

    setLoading(false)
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function clearForm() {
    setShowAddForm(false)
    setEditingId(null)
    setName("")
    setAffectsCash(true)
    setFormMessage("")
  }

  function startAdd() {
    clearForm()
    setShowAddForm(true)
  }

  function startEdit(inv: Investment) {
    clearForm()
    setEditingId(inv.investment_id)
    setName(inv.investment ?? "")
    setAffectsCash(!!inv.affects_cash)
  }

  async function saveInvestment() {
    if (!name.trim()) {
      setFormMessage("Enter an investment name.")
      return
    }

    setSaving(true)

    if (editingId) {
      const { error } = await supabase
        .from("investments")
        .update({ name, affects_cash: affectsCash ? 1 : 0 })
        .eq("investment_id", editingId)

      if (error) {
        setSaving(false)
        setFormMessage(error.message)
        return
      }

      // v_cash_ledger reads each transaction's own affects_cash, not the
      // investment's -- without this, flipping the toggle here would leave
      // every transaction already recorded against this investment still
      // treated the old way, silently contradicting what the toggle now
      // says.
      const { error: syncError } = await supabase
        .from("transactions")
        .update({ affects_cash: affectsCash ? 1 : 0 })
        .eq("investment_id", editingId)
        .in("classification", ["Investment", "Investment Return"])

      setSaving(false)
      if (syncError) {
        setFormMessage(`Investment saved, but couldn't update its existing transactions: ${syncError.message}`)
        return
      }
    } else {
      const { error } = await supabase.from("investments").insert({
        name,
        affects_cash: affectsCash ? 1 : 0
      })

      setSaving(false)
      if (error) {
        setFormMessage(error.message)
        return
      }
    }

    clearForm()
    load()
  }

  const fmt = (n: number) =>
    Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })

  if (loading) {
    return <SkeletonCardList rows={4} />
  }

  if (selectedInvestmentId) {
    return (
      <InvestmentDetailPanel
        investmentId={selectedInvestmentId}
        onBack={() => setSelectedInvestmentId(null)}
      />
    )
  }

  // Active takes priority over gain/loss direction -- a still-open
  // investment's current gain/loss is just an interim snapshot, not a
  // settled outcome, so it belongs with the other ongoing investments
  // rather than being sorted by a number that can still move. Gains/Losses
  // are scoped to closed investments only, where the number is final.
  const active = investments.filter((i) => i.status === "open")
  const closedInvestments = investments.filter((i) => i.status === "closed")
  const gains = closedInvestments.filter((i) => i.gain_loss > 0).sort((a, b) => b.gain_loss - a.gain_loss)
  const losses = closedInvestments.filter((i) => i.gain_loss <= 0).sort((a, b) => a.gain_loss - b.gain_loss)
  const netTotal = investments.reduce((sum, i) => sum + i.gain_loss, 0)

  function renderInvestmentGroup(inv: Investment) {
    const isEditingThis = isAdmin && manageMode && editingId === inv.investment_id

    return (
      <div key={inv.investment_id} ref={isEditingThis ? editFormRef : undefined}>
        <InvestmentCard
          inv={inv}
          fmt={fmt}
          onClick={() => setSelectedInvestmentId(inv.investment_id)}
          showEdit={isAdmin && manageMode}
          fused={isEditingThis}
          onEdit={() => startEdit(inv)}
        />
        {isEditingThis && (
          <InvestmentForm
            title="Edit Investment"
            name={name}
            setName={setName}
            affectsCash={affectsCash}
            setAffectsCash={setAffectsCash}
            saving={saving}
            message={formMessage}
            onSave={saveInvestment}
            onCancel={() => setEditingId(null)}
            saveLabel="Save Changes"
            fused
          />
        )}
      </div>
    )
  }

  return (
    <div>
      <p className="text-[13px] text-ink-soft mb-4">Every venture the fund has put money into, and how it turned out.</p>

      {isAdmin && (
        <div className="flex items-center gap-2 flex-wrap mb-5">
          {manageMode ? (
            <button
              className="bg-ink text-paper px-4 py-2.5 rounded-sm text-sm font-medium shrink-0"
              onClick={() => {
                setManageMode(false)
                clearForm()
              }}
            >
              Done
            </button>
          ) : (
            <button
              className="border border-hairline text-ink-soft px-4 py-2.5 rounded-sm text-sm font-medium shrink-0"
              onClick={() => {
                setManageMode(true)
                clearForm()
              }}
            >
              Manage
            </button>
          )}
          <button
            className="shrink-0 bg-gold text-ink px-4 py-2.5 rounded-sm text-sm font-semibold shadow-sm hover:opacity-90 transition-opacity flex items-center gap-1.5"
            onClick={startAdd}
          >
            <span className="text-lg leading-none">+</span>
            Add Investment
          </button>
        </div>
      )}

      {showAddForm && (
        <InvestmentForm
          title="Add Investment"
          name={name}
          setName={setName}
          affectsCash={affectsCash}
          setAffectsCash={setAffectsCash}
          saving={saving}
          message={formMessage}
          onSave={saveInvestment}
          onCancel={clearForm}
          saveLabel="Add Investment"
          className="mb-6"
        />
      )}

      {!loadError && investments.length > 0 && (
        <div className="bg-paper-2 border border-hairline rounded-md px-5 pt-4 pb-3.5 mb-6">
          <p className="text-[11px] uppercase tracking-wide text-ink-soft font-mono mb-1.5">Net Position</p>
          <p
            className={`font-mono [font-variant-numeric:tabular-nums] text-3xl font-bold ${
              netTotal > 0 ? "text-sage" : netTotal < 0 ? "text-rust" : "text-ink"
            }`}
          >
            {netTotal < 0 ? "-" : "+"}₱{fmt(Math.abs(netTotal))}
          </p>
          <p className="text-[11px] text-ink-soft mt-1">
            across {investments.length} investment{investments.length === 1 ? "" : "s"}
          </p>
        </div>
      )}

      {loadError && <p className="mb-4 text-sm text-rust">Couldn't load investments: {loadError}</p>}

      {!loadError && investments.length === 0 && (
        <p className="text-sm text-ink-soft text-center py-12">No investments on record yet.</p>
      )}

      {active.length > 0 && (
        <section className={gains.length > 0 || losses.length > 0 ? "mb-7" : ""}>
          <h2 className="text-[11px] uppercase tracking-[0.1em] text-ink-soft font-mono mb-3">Active</h2>
          <div className="flex flex-col gap-3">{active.map(renderInvestmentGroup)}</div>
        </section>
      )}

      {gains.length > 0 && (
        <section className={losses.length > 0 ? "mb-7" : ""}>
          <h2 className="text-[11px] uppercase tracking-[0.1em] text-ink-soft font-mono mb-3">Gains</h2>
          <div className="flex flex-col gap-3">{gains.map(renderInvestmentGroup)}</div>
        </section>
      )}

      {losses.length > 0 && (
        <section>
          <h2 className="text-[11px] uppercase tracking-[0.1em] text-ink-soft font-mono mb-3">Losses</h2>
          <div className="flex flex-col gap-3">{losses.map(renderInvestmentGroup)}</div>
        </section>
      )}
    </div>
  )
}

function InvestmentCard({
  inv,
  fmt,
  onClick,
  showEdit,
  fused,
  onEdit
}: {
  inv: Investment
  fmt: (n: number) => string
  onClick: () => void
  showEdit: boolean
  fused: boolean
  onEdit: () => void
}) {
  const isGain = inv.gain_loss > 0
  const isFlat = inv.gain_loss === 0
  const magnitudePct = inv.invested > 0 ? Math.min(100, (Math.abs(inv.gain_loss) / inv.invested) * 100) : 0

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault()
          onClick()
        }
      }}
      className={`w-full text-left bg-paper-2 border border-hairline px-5 py-4 hover:bg-paper transition-colors cursor-pointer ${
        fused ? "rounded-t-md rounded-b-none border-b-0" : "rounded-md"
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-display text-[17px] font-semibold text-ink truncate">{inv.investment}</p>
          <p className="text-[12px] text-ink-soft">₱{fmt(inv.invested)} invested</p>
        </div>
        <div className="shrink-0 flex items-center gap-2">
          <div className="flex items-center gap-1.5">
            <span className={`w-1.5 h-1.5 rounded-full ${isGain ? "bg-sage" : isFlat ? "bg-ink-soft" : "bg-rust"}`} />
            <span
              className={`text-[11px] font-mono uppercase tracking-wide ${
                isGain ? "text-sage" : isFlat ? "text-ink-soft" : "text-rust"
              }`}
            >
              {isGain ? "Gain" : isFlat ? "Flat" : "Loss"}
            </span>
          </div>
          {inv.status === "closed" && (
            <span className="text-[10px] font-mono font-bold uppercase tracking-wide text-gold border border-gold rounded-full px-2 py-0.5">
              Closed
            </span>
          )}
          {showEdit ? (
            <button
              onClick={(e) => {
                e.stopPropagation()
                onEdit()
              }}
              className="text-[11px] text-ink-soft border border-hairline rounded-sm px-2.5 py-1.5"
            >
              Edit
            </button>
          ) : (
            <span className="text-ink-soft">→</span>
          )}
        </div>
      </div>

      <div className="flex items-baseline justify-between mt-3.5">
        <div>
          <p className="text-[10px] uppercase tracking-wide text-ink-soft font-mono">Returned</p>
          <p className="font-mono [font-variant-numeric:tabular-nums] text-sm font-semibold text-ink">₱{fmt(inv.returned)}</p>
        </div>
        <div className="text-right">
          <p className="text-[10px] uppercase tracking-wide text-ink-soft font-mono">Gain / Loss</p>
          <p
            className={`font-mono [font-variant-numeric:tabular-nums] text-sm font-semibold ${
              isGain ? "text-sage" : isFlat ? "text-ink" : "text-rust"
            }`}
          >
            {inv.gain_loss < 0 ? "-" : "+"}₱{fmt(Math.abs(inv.gain_loss))}
          </p>
        </div>
      </div>

      <div className="h-1.5 rounded-full bg-hairline overflow-hidden mt-2.5">
        <div className={`h-full ${isGain ? "bg-sage" : "bg-rust"}`} style={{ width: `${magnitudePct}%` }} />
      </div>
    </div>
  )
}

function InvestmentForm({
  title,
  name,
  setName,
  affectsCash,
  setAffectsCash,
  saving,
  message,
  onSave,
  onCancel,
  saveLabel,
  fused = false,
  className = ""
}: {
  title: string
  name: string
  setName: (v: string) => void
  affectsCash: boolean
  setAffectsCash: (v: boolean) => void
  saving: boolean
  message: string
  onSave: () => void
  onCancel: () => void
  saveLabel: string
  fused?: boolean
  className?: string
}) {
  return (
    <div className={`bg-paper-2 border border-hairline relative overflow-hidden ${fused ? "rounded-b-md" : "rounded-md"} ${className}`}>
      {!fused && <div className="absolute left-0 top-0 bottom-0 w-[3px] bg-gold" />}
      <div className={fused ? "px-5 py-5 space-y-4" : "pl-6 pr-5 py-6 space-y-4"}>
        <p className="font-display text-lg font-medium">{title}</p>

        <div>
          <label className="block mb-2 text-xs uppercase tracking-wide text-ink-soft font-mono">Investment name</label>
          <input
            className="border border-hairline bg-paper text-ink text-sm rounded-sm px-3 py-3 w-full"
            placeholder="e.g. Farmon - Rice (2026-Q3)"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>

        <button
          type="button"
          onClick={() => setAffectsCash(!affectsCash)}
          className="w-full flex items-center justify-between gap-3 border border-hairline bg-paper rounded-sm px-3.5 py-3 text-left"
        >
          <span>
            <span className="block text-sm font-medium text-ink">Affects cash</span>
            <span className="block text-xs text-ink-soft mt-0.5">
              {affectsCash ? "Funded through the tracked bank accounts" : "Funded outside the tracked cash trail"}
            </span>
          </span>
          <span
            className={`shrink-0 relative w-[38px] h-[22px] rounded-full transition-colors ${
              affectsCash ? "bg-sage" : "bg-hairline"
            }`}
          >
            <span
              className={`absolute top-[2px] w-[18px] h-[18px] rounded-full bg-paper shadow transition-transform ${
                affectsCash ? "translate-x-[18px]" : "translate-x-[2px]"
              }`}
            />
          </span>
        </button>

        <p className="text-xs text-ink-soft">
          Invested, returned, and gain/loss aren't set here — they're totalled automatically from approved
          transactions tagged to this investment.
        </p>

        <div className="flex gap-3">
          <button
            className="bg-ink text-paper px-4 py-3 rounded-sm text-sm font-medium flex-1 disabled:opacity-50"
            onClick={onSave}
            disabled={saving}
          >
            {saving ? "Saving..." : saveLabel}
          </button>
          <button className="border border-hairline rounded-sm px-4 py-3 text-sm" onClick={onCancel}>
            Cancel
          </button>
        </div>

        {message && <p className="text-sm text-rust">{message}</p>}
      </div>
    </div>
  )
}

/* ============================== Sparkline ============================== */

function Sparkline({ points, color }: { points: TrendPoint[]; color: string }) {
  const { linePoints, ticks } = useMemo(() => {
    if (!points || points.length < 2) return { linePoints: "", ticks: [] as { x: number; label: string }[] }

    const values = points.map((p) => p.value)
    const min = Math.min(...values)
    const max = Math.max(...values)
    const range = max - min || 1
    const w = 300
    const h = 34
    const step = w / (points.length - 1)

    const linePoints = points
      .map((p, i) => {
        const x = i * step
        const y = h - ((p.value - min) / range) * (h - 4) - 2
        return `${x.toFixed(1)},${y.toFixed(1)}`
      })
      .join(" ")

    // One tick per calendar year, placed at that year's first data point.
    // Consecutive real-world years can land very close together in index-
    // space if a member had a burst of activity recently, so enforce a
    // minimum pixel gap and let the later year win a collision rather than
    // overlapping the text.
    const minGap = 26
    const rawTicks: { x: number; label: string }[] = []
    let lastYear = ""
    points.forEach((p, i) => {
      const year = (p.date || "").slice(0, 4)
      if (year && year !== lastYear) {
        rawTicks.push({ x: i * step, label: year })
        lastYear = year
      }
    })

    const ticks: { x: number; label: string }[] = []
    rawTicks.forEach((t) => {
      if (ticks.length > 0 && t.x - ticks[ticks.length - 1].x < minGap) {
        ticks[ticks.length - 1] = t
      } else {
        ticks.push(t)
      }
    })

    return { linePoints, ticks }
  }, [points])

  if (!linePoints) {
    return <div className="h-[48px] mt-2.5" />
  }

  return (
    <div className="mt-2.5">
      <svg className="block" width="100%" height="34" viewBox="0 0 300 34" preserveAspectRatio="none">
        <polyline points={linePoints} fill="none" stroke={color} strokeWidth="2" />
      </svg>
      <div className="relative h-[14px] mt-1">
        {ticks.map((t, i) => (
          <span
            key={i}
            className="absolute text-[9.5px] text-ink-soft font-mono"
            style={{
              left: `${(t.x / 300) * 100}%`,
              transform: i === 0 ? "translateX(0)" : i === ticks.length - 1 ? "translateX(-100%)" : "translateX(-50%)"
            }}
          >
            {t.label}
          </span>
        ))}
      </div>
    </div>
  )
}

