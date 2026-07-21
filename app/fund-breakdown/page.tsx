"use client"

import { Suspense, useEffect, useRef, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { supabase } from "@/lib/supabase"
import Navbar from "@/app/components/Navbar"
import { SkeletonCardList, SkeletonPanel } from "@/app/components/Skeleton"
import { useAuth } from "@/app/auth-context"
import type { InterestType } from "@/lib/loanMath"
import { formatInterestLabel } from "@/lib/loanFormat"

type Tab = "fund" | "loans" | "banks" | "investments"
type FundView = "you" | "group"

const TABS: { id: Tab; label: string }[] = [
  { id: "fund", label: "Fund" },
  { id: "loans", label: "Loans" },
  { id: "banks", label: "Banks" },
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
              <div className="flex bg-paper-2 border border-hairline rounded-md p-[3px] mb-5 max-w-[240px]">
                {(["group", "you"] as FundView[]).map((v) => (
                  <button
                    key={v}
                    onClick={() => selectView(v)}
                    className={`flex-1 py-2 rounded-[6px] text-[13px] font-semibold transition-colors ${
                      activeView === v ? "bg-paper text-ink shadow-sm" : "text-ink-soft"
                    }`}
                  >
                    {v === "group" ? "Group" : "You"}
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
}

function YouPanel({ memberId }: { memberId: string }) {
  const [dataLoading, setDataLoading] = useState(true)
  const [performance, setPerformance] = useState<MemberPerformance | null>(null)
  const [years, setYears] = useState<YearRow[]>([])
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

      const [performanceResult, txResult, bankInterestResult, loanGainResult, investmentAllocResult, investmentDatesResult] =
        await Promise.all([
          performancePromise,
          txPromise,
          bankInterestPromise,
          loanGainPromise,
          investmentAllocPromise,
          investmentDatesPromise
        ])

      if (cancelled) return

      const firstError =
        performanceResult.error ||
        txResult.error ||
        bankInterestResult.error ||
        loanGainResult.error ||
        investmentAllocResult.error ||
        investmentDatesResult.error
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
            bankWriteoff: 0,
            investmentGainLoss: 0
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

      setYears(Object.values(byYear).sort((a, b) => b.year.localeCompare(a.year)))
      setDataLoading(false)
    }

    load()
    return () => {
      cancelled = true
    }
  }, [memberId])

  const fmt = (n: number) =>
    Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  const signed = (n: number) => `${n < 0 ? "-" : "+"}₱${fmt(Math.abs(n))}`
  const tone = (n: number) => (n > 0 ? "text-sage" : n < 0 ? "text-rust" : "text-ink-soft")

  if (dataLoading) {
    return <SkeletonPanel />
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
          Contributions, withdrawals, bank interest, loan gain share, and investment gain/loss, by calendar year.
          Investment allocations aren't dated individually, so each is counted in the year of that investment's most
          recent transaction.
        </p>

        {years.length === 0 && !loadError && (
          <p className="text-sm text-ink-soft text-center py-8 bg-paper-2 border border-hairline rounded-md">
            No dated activity yet.
          </p>
        )}

        <div className="space-y-4">
          {years.map((y) => {
            const yearTotal = y.netContribution + y.bankInterest + y.loanGain + y.bankWriteoff + y.investmentGainLoss
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
                    <InfoRow label="Withdrawal" value={`-₱${fmt(Math.abs(y.withdrawal))}`} valueClass="text-rust" />
                  )}
                  <InfoRow label="Net Contribution" value={`₱${fmt(y.netContribution)}`} bold />
                </InfoBox>

                {(y.bankInterest !== 0 || y.loanGain !== 0 || y.bankWriteoff !== 0 || y.investmentGainLoss !== 0) && (
                  <InfoBox label="Performance">
                    {y.bankInterest !== 0 && (
                      <InfoRow label="Bank Interest" value={signed(y.bankInterest)} valueClass={tone(y.bankInterest)} />
                    )}
                    {y.investmentGainLoss !== 0 && (
                      <InfoRow
                        label="Investment Gain/Loss"
                        value={signed(y.investmentGainLoss)}
                        valueClass={tone(y.investmentGainLoss)}
                      />
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

function GroupPanel() {
  const router = useRouter()
  const [members, setMembers] = useState<MemberRow[]>([])
  const [totalCash, setTotalCash] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState("")
  const [activeIndex, setActiveIndex] = useState(0)
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

      const fundPromise = supabase.from("v_fund_summary").select("total_cash").single()

      const [memberResult, performanceResult, fundResult] = await Promise.all([
        memberPromise,
        performancePromise,
        fundPromise
      ])

      if (cancelled) return

      if (memberResult.error || performanceResult.error || fundResult.error) {
        setLoadError(
          (memberResult.error || performanceResult.error || fundResult.error)?.message ?? "Failed to load"
        )
        setLoading(false)
        return
      }

      setTotalCash(Number(fundResult.data?.total_cash ?? 0))

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

  function handleCardClick(memberId: string, e: React.MouseEvent) {
    if (suppressClickRef.current) {
      suppressClickRef.current = false
      e.preventDefault()
      return
    }
    router.push(`/member-breakdown/${memberId}`)
  }

  if (loading) {
    return <SkeletonCardList rows={4} />
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
          <p className="font-mono [font-variant-numeric:tabular-nums] text-2xl sm:text-3xl font-bold text-ink mb-3.5">
            ₱{totalCash != null ? fmt(totalCash) : "—"}
          </p>

          <p className="text-[10px] uppercase tracking-wide text-ink-soft font-mono mb-1.5">Ownership Share</p>
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

      <div className="overflow-hidden" onTouchStart={handleCarouselTouchStart} onTouchEnd={handleCarouselTouchEnd}>
        <div
          className="flex transition-transform duration-300 ease-out will-change-transform motion-reduce:transition-none"
          style={{ transform: `translateX(-${clampedIndex * 100}%)` }}
        >
          {members.map((member) => (
            <button
              key={member.member_id}
              onClick={(e) => handleCardClick(member.member_id, e)}
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
                <InfoRow label="Net Contribution" value={`₱${fmt(member.net_contribution)}`} bold />
              </InfoBox>

              <InfoBox label="Performance">
                <InfoRow
                  label="Total Gain/Loss"
                  value={signed(member.totalGainLoss)}
                  valueClass={tone(member.totalGainLoss)}
                  bold
                />
                <div className="pt-1 space-y-1.5">
                  <InfoSubRow label="Bank Interest" value={signed(member.bank_interest)} valueClass={tone(member.bank_interest)} />
                  <InfoSubRow
                    label="Investment Gain/Loss"
                    value={signed(member.investment_gain_loss)}
                    valueClass={tone(member.investment_gain_loss)}
                  />
                  <InfoSubRow label="Loan Gain Share" value={signed(member.loan_gain)} valueClass={tone(member.loan_gain)} />
                  {member.bank_writeoff !== 0 && (
                    <InfoSubRow
                      label="Bank Write-off Share"
                      value={signed(member.bank_writeoff)}
                      valueClass={tone(member.bank_writeoff)}
                    />
                  )}
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
}

function termLabel(loan: Loan): string | null {
  return loan.term_months != null ? `${loan.term_months} mo` : null
}

function LoansPanel({ myMemberId }: { myMemberId: string | null }) {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [loans, setLoans] = useState<Loan[]>([])
  const [loadError, setLoadError] = useState("")

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

  const statusMeta: Record<Loan["status"], { label: string; dot: string; text: string }> = {
    closed: { label: "Repaid", dot: "bg-sage", text: "text-sage" },
    active: { label: "Active", dot: "bg-gold", text: "text-gold" },
    requested: { label: "Requested", dot: "bg-ink-soft", text: "text-ink-soft" }
  }

  if (loading) {
    return <SkeletonCardList rows={4} />
  }

  const openLoans = loans.filter((l) => l.status !== "closed")
  const closedLoans = loans.filter((l) => l.status === "closed")

  return (
    <div>
      <p className="text-[13px] text-ink-soft mb-6">Every loan the fund has released, and what came back.</p>

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
          <h2 className="text-[11px] uppercase tracking-[0.1em] text-ink-soft font-mono mb-3">Repaid</h2>
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
  const repaidPct =
    loan.total_repayable > 0
      ? Math.min(100, ((loan.total_repayable - loan.outstanding) / loan.total_repayable) * 100)
      : 0

  const dateLabel = new Date(loan.start_date).toLocaleDateString(undefined, { month: "short", year: "numeric" })

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
          </p>
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
        <div className={`h-full ${loan.status === "closed" ? "bg-sage" : "bg-gold"}`} style={{ width: `${repaidPct}%` }} />
      </div>
    </button>
  )
}

/* ============================== Banks ============================== */

const CUTOVER_DATE = "2026-07-16"

type Bank = {
  bank: string
  balance: number
  interest_earned: number
  tax: number
  distributed: number
}

type BankAccount = {
  id: string
  bank_name: string
  account_name: string | null
  opening_balance: number
  interest_rate: number
}

function BanksPanel({ isAdmin }: { isAdmin: boolean }) {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [banks, setBanks] = useState<Bank[]>([])
  const [bankAccounts, setBankAccounts] = useState<BankAccount[]>([])
  const [loadError, setLoadError] = useState("")

  const [manageMode, setManageMode] = useState(false)
  const [showAddForm, setShowAddForm] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [bankName, setBankName] = useState("")
  const [accountName, setAccountName] = useState("")
  const [openingBalance, setOpeningBalance] = useState("")
  const [interestRate, setInterestRate] = useState("")
  const [saving, setSaving] = useState(false)
  const [formMessage, setFormMessage] = useState("")

  async function load() {
    const bankAccountsPromise = supabase.from("bank_accounts").select("*").order("bank_name")
    const balancesPromise = supabase.from("v_bank_balances").select("*")
    const interestPromise = supabase
      .from("transactions")
      .select("bank, classification, amount")
      .eq("status", "approved")
      .in("classification", ["Bank Interest", "Tax"])
    const distributedPromise = supabase.from("bank_interest_allocations").select("bank, amount")

    const [bankAccountsResult, balancesResult, interestResult, distributedResult] = await Promise.all([
      bankAccountsPromise,
      balancesPromise,
      interestPromise,
      distributedPromise
    ])

    if (bankAccountsResult.error) {
      setLoadError(bankAccountsResult.error.message)
      setLoading(false)
      return
    }

    setBankAccounts((bankAccountsResult.data as BankAccount[]) ?? [])

    const byBank: Record<string, Bank> = {}
    for (const acct of bankAccountsResult.data ?? []) {
      byBank[acct.bank_name] = { bank: acct.bank_name, balance: 0, interest_earned: 0, tax: 0, distributed: 0 }
    }

    if (!balancesResult.error) {
      for (const row of balancesResult.data ?? []) {
        if (!byBank[row.bank]) byBank[row.bank] = { bank: row.bank, balance: 0, interest_earned: 0, tax: 0, distributed: 0 }
        byBank[row.bank].balance = Number(row.balance)
      }
    } else {
      setLoadError(balancesResult.error.message)
    }

    if (!interestResult.error) {
      for (const row of interestResult.data ?? []) {
        if (!byBank[row.bank]) byBank[row.bank] = { bank: row.bank, balance: 0, interest_earned: 0, tax: 0, distributed: 0 }
        if (row.classification === "Bank Interest") byBank[row.bank].interest_earned += Number(row.amount)
        if (row.classification === "Tax") byBank[row.bank].tax += Number(row.amount)
      }
    }

    if (!distributedResult.error) {
      for (const row of distributedResult.data ?? []) {
        if (!byBank[row.bank]) byBank[row.bank] = { bank: row.bank, balance: 0, interest_earned: 0, tax: 0, distributed: 0 }
        byBank[row.bank].distributed += Number(row.amount)
      }
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
    setOpeningBalance("")
    setInterestRate("")
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
    setOpeningBalance(String(acct.opening_balance ?? ""))
    setInterestRate(String(acct.interest_rate ?? ""))
  }

  async function saveBank() {
    if (!bankName.trim()) {
      setFormMessage("Enter a bank name.")
      return
    }

    setSaving(true)

    if (editingId) {
      const { error } = await supabase
        .from("bank_accounts")
        .update({
          bank_name: bankName,
          account_name: accountName,
          opening_balance: Number(openingBalance) || 0,
          interest_rate: Number(interestRate) || 0
        })
        .eq("id", editingId)

      setSaving(false)
      if (error) {
        setFormMessage(error.message)
        return
      }
    } else {
      const { error } = await supabase.from("bank_accounts").insert({
        bank_name: bankName,
        account_name: accountName,
        opening_balance: Number(openingBalance) || 0,
        interest_rate: Number(interestRate) || 0
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

  const totalBalance = banks.reduce((sum, b) => sum + b.balance, 0)

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
          interestRate={interestRate}
          setInterestRate={setInterestRate}
          openingBalance={openingBalance}
          setOpeningBalance={setOpeningBalance}
          isEditing={false}
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
            <div key={b.bank}>
              <BankCard
                bank={b}
                fmt={fmt}
                onClick={() => router.push(`/bank/${encodeURIComponent(b.bank)}`)}
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
                  interestRate={interestRate}
                  setInterestRate={setInterestRate}
                  openingBalance={openingBalance}
                  setOpeningBalance={setOpeningBalance}
                  isEditing={true}
                  saving={saving}
                  message={formMessage}
                  onSave={saveBank}
                  onCancel={() => setEditingId(null)}
                  saveLabel="Save Changes"
                  fused
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
  const netInterest = bank.interest_earned - bank.tax
  const undistributed = netInterest - bank.distributed
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
          <p className="text-[12px] text-ink-soft">₱{fmt(bank.balance)} current balance</p>
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
  interestRate,
  setInterestRate,
  openingBalance,
  setOpeningBalance,
  isEditing,
  saving,
  message,
  onSave,
  onCancel,
  saveLabel,
  fused = false,
  className = ""
}: {
  title: string
  bankName: string
  setBankName: (v: string) => void
  accountName: string
  setAccountName: (v: string) => void
  interestRate: string
  setInterestRate: (v: string) => void
  openingBalance: string
  setOpeningBalance: (v: string) => void
  isEditing: boolean
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

        <div>
          <label className="block mb-2 text-xs uppercase tracking-wide text-ink-soft font-mono">Opening balance</label>
          <input
            className="border border-hairline bg-paper text-ink text-sm rounded-sm px-3 py-3 w-full font-mono"
            type="number"
            placeholder="0.00"
            value={openingBalance}
            onChange={(e) => setOpeningBalance(e.target.value)}
          />
          <p className="text-xs text-ink-soft mt-1">
            {isEditing
              ? `The reconciled balance as of the cutover date (${CUTOVER_DATE}). Changing it affects every balance calculated from this account, so only fix it if it was wrong or never set.`
              : "The true balance as of the cutover date."}
          </p>
        </div>

        <div>
          <label className="block mb-2 text-xs uppercase tracking-wide text-ink-soft font-mono">Interest rate (%)</label>
          <input
            className="border border-hairline bg-paper text-ink text-sm rounded-sm px-3 py-3 w-full font-mono"
            type="number"
            placeholder="e.g. 0.25"
            value={interestRate}
            onChange={(e) => setInterestRate(e.target.value)}
          />
        </div>

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

/* ============================== Investments ============================== */

type Investment = {
  investment_id: string
  investment: string
  affects_cash: number
  invested: number
  returned: number
  gain_loss: number
}

function InvestmentsPanel({ isAdmin }: { isAdmin: boolean }) {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [investments, setInvestments] = useState<Investment[]>([])
  const [loadError, setLoadError] = useState("")

  const [manageMode, setManageMode] = useState(false)
  const [showAddForm, setShowAddForm] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [name, setName] = useState("")
  const [affectsCash, setAffectsCash] = useState(true)
  const [saving, setSaving] = useState(false)
  const [formMessage, setFormMessage] = useState("")

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

      setSaving(false)
      if (error) {
        setFormMessage(error.message)
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

  const gains = investments.filter((i) => i.gain_loss > 0).sort((a, b) => b.gain_loss - a.gain_loss)
  const losses = investments.filter((i) => i.gain_loss <= 0).sort((a, b) => a.gain_loss - b.gain_loss)
  const netTotal = investments.reduce((sum, i) => sum + i.gain_loss, 0)

  function renderInvestmentGroup(inv: Investment) {
    const isEditingThis = isAdmin && manageMode && editingId === inv.investment_id

    return (
      <div key={inv.investment_id}>
        <InvestmentCard
          inv={inv}
          fmt={fmt}
          onClick={() => router.push(`/investment/${inv.investment_id}`)}
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

      {gains.length > 0 && (
        <section className="mb-7">
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

/* ============================== Shared info-box helpers ============================== */

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
