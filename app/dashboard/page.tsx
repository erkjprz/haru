"use client"

import { useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { supabase } from "@/lib/supabase"
import Navbar from "@/app/components/Navbar"
import { useAuth } from "@/app/auth-context"
import { SkeletonPanel } from "@/app/components/Skeleton"

type FundSummary = {
  total_cash: number
  bdo_balance: number
  maya_balance: number
  total_bank_interest: number
  undistributed_bank_interest: number
  net_investment_gain_loss: number
  total_loan_gain_distributed: number
  open_loans_count: number
  open_loans_principal: number
  open_loans_outstanding: number
  open_loans_total_repayable: number
  total_contribution: number
  total_withdrawal: number
  net_contribution: number
}

type TrendPoint = { value: number; date: string }

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

export default function DashboardPage() {
  const router = useRouter()
  const { loading: authLoading, member } = useAuth()
  const [dataLoading, setDataLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<"you" | "fund">("you")
  const [asOf, setAsOf] = useState<Date | null>(null)

  const [fund, setFund] = useState<FundSummary | null>(null)
  const [mine, setMine] = useState<MemberPerformance | null>(null)
  const [myTrend, setMyTrend] = useState<TrendPoint[]>([])
  const [fundTrend, setFundTrend] = useState<TrendPoint[]>([])
  const [pendingCount, setPendingCount] = useState(0)
  const [loadError, setLoadError] = useState("")

  const memberName = member?.name ?? ""
  const isAdmin = member?.role === "admin"
  const checkingAccess = authLoading || dataLoading

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

    async function loadDashboard() {
      if (!member) return

      // Fund-wide performance: v_fund_summary applies the correct sign to
      // investment gain/loss (Farmon losses vs. Perfume Biz gains),
      // separates total interest income from what's been distributed to
      // members so far, and includes fund-wide capital totals (same
      // definition v_member_ledger uses per member: status = 'approved',
      // Member Contribution / Member Withdrawal only) -- see the view's
      // own comments. Never derive these by summing investment_allocations
      // or bank_interest_allocations directly.
      const fundPromise = supabase.from("v_fund_summary").select("*").single()

      // Personal performance: v_member_performance mirrors that same
      // sign-corrected logic at the member level, plus bank interest,
      // loan gain, and bank write-off shares.
      const minePromise = supabase
        .from("v_member_performance")
        .select("total_contribution, total_withdrawal, net_contribution, bank_interest, investment_gain_loss, loan_gain, bank_writeoff, total_value, money_on_hold, withdrawable_now")
        .eq("member_id", member.member_id)
        .single()

      const myTrendPromise = supabase
        .from("v_member_value_timeline")
        .select("event_date, running_total")
        .eq("member_id", member.member_id)
        .order("event_date", { ascending: true })

      const fundTrendPromise = supabase
        .from("v_fund_cash_timeline")
        .select("month, running_balance")
        .order("month", { ascending: true })

      const pendingPromise = member.role === "admin"
        ? supabase
            .from("transactions")
            .select("transaction_id", { count: "exact", head: true })
            .eq("status", "pending")
        : Promise.resolve({ count: 0 } as any)

      const [fundResult, mineResult, myTrendResult, fundTrendResult, pendingResult] =
        await Promise.all([fundPromise, minePromise, myTrendPromise, fundTrendPromise, pendingPromise])

      if (fundResult.error) {
        setLoadError(fundResult.error.message)
      } else if (fundResult.data) {
        setFund({
          total_cash: Number(fundResult.data.total_cash),
          bdo_balance: Number(fundResult.data.bdo_balance),
          maya_balance: Number(fundResult.data.maya_balance),
          total_bank_interest: Number(fundResult.data.total_bank_interest),
          undistributed_bank_interest: Number(fundResult.data.undistributed_bank_interest),
          net_investment_gain_loss: Number(fundResult.data.net_investment_gain_loss),
          total_loan_gain_distributed: Number(fundResult.data.total_loan_gain_distributed),
          open_loans_count: Number(fundResult.data.open_loans_count),
          open_loans_principal: Number(fundResult.data.open_loans_principal),
          open_loans_outstanding: Number(fundResult.data.open_loans_outstanding),
          open_loans_total_repayable: Number(fundResult.data.open_loans_total_repayable),
          total_contribution: Number(fundResult.data.total_contribution),
          total_withdrawal: Number(fundResult.data.total_withdrawal),
          net_contribution: Number(fundResult.data.net_contribution)
        })
      }

      if (!mineResult.error && mineResult.data) {
        setMine({
          total_contribution: Number(mineResult.data.total_contribution),
          total_withdrawal: Number(mineResult.data.total_withdrawal),
          net_contribution: Number(mineResult.data.net_contribution),
          bank_interest: Number(mineResult.data.bank_interest),
          investment_gain_loss: Number(mineResult.data.investment_gain_loss),
          loan_gain: Number(mineResult.data.loan_gain),
          bank_writeoff: Number(mineResult.data.bank_writeoff),
          total_value: Number(mineResult.data.total_value),
          money_on_hold: Number(mineResult.data.money_on_hold),
          withdrawable_now: Number(mineResult.data.withdrawable_now)
        })
      }

      if (!myTrendResult.error && myTrendResult.data) {
        setMyTrend(myTrendResult.data.map((r: any) => ({ value: Number(r.running_total), date: r.event_date })))
      }

      if (!fundTrendResult.error && fundTrendResult.data) {
        setFundTrend(fundTrendResult.data.map((r: any) => ({ value: Number(r.running_balance), date: r.month })))
      }

      setPendingCount(pendingResult.count ?? 0)
      setAsOf(new Date())
      setDataLoading(false)
    }

    loadDashboard()
  }, [authLoading, member, router])

  const fmt = (n: number) =>
    Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })

  const signed = (n: number) => `${n < 0 ? "-" : "+"}₱${fmt(Math.abs(n))}`
  const tone = (n: number) => (n > 0 ? "text-sage" : n < 0 ? "text-rust" : "text-ink-soft")

  const asOfLabel = asOf
    ? asOf.toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        year: "numeric",
        hour: "numeric",
        minute: "2-digit"
      })
    : ""

  if (checkingAccess) {
    return (
      <>
        <Navbar />
        <main className="min-h-screen bg-paper text-ink font-sans">
          <div className="max-w-3xl mx-auto px-4 sm:px-5 pt-8 pb-10">
            <SkeletonPanel />
          </div>
        </main>
      </>
    )
  }

  const bdoPct = fund && fund.bdo_balance + fund.maya_balance > 0
    ? (fund.bdo_balance / (fund.bdo_balance + fund.maya_balance)) * 100
    : 50
  const loanRepaidPct = fund && fund.open_loans_total_repayable > 0
    ? ((fund.open_loans_total_repayable - fund.open_loans_outstanding) / fund.open_loans_total_repayable) * 100
    : 0

  return (
    <>
      <Navbar />

      <main className="min-h-screen bg-paper text-ink font-sans overflow-x-hidden">
        <div className="max-w-3xl mx-auto px-4 sm:px-5 pt-8 pb-10">
          <div className="text-[11px] tracking-[0.18em] uppercase text-gold font-mono mb-2">
            Welcome back
          </div>
          <h1 className="font-display text-3xl sm:text-4xl font-semibold text-ink">
            {memberName}
          </h1>
          {asOfLabel && (
            <p className="text-[11px] text-ink-soft mt-1 mb-5">As of {asOfLabel}</p>
          )}

          {loadError && (
            <p className="mt-2 mb-4 text-sm text-rust">
              Couldn't load some dashboard data: {loadError}
            </p>
          )}

          {isAdmin && pendingCount > 0 && (
            <button
              onClick={() => router.push("/admin")}
              className="mb-6 w-full text-left bg-paper-2 border border-hairline rounded-md px-5 py-4 flex items-center justify-between"
            >
              <div>
                <p className="text-sm text-ink font-medium">
                  {pendingCount} {pendingCount === 1 ? "entry" : "entries"} awaiting approval
                </p>
                <p className="text-xs text-rust mt-0.5">Tap to review in Admin</p>
              </div>
              <span className="text-ink-soft">→</span>
            </button>
          )}

          {/* Segmented control */}
          <div className="flex bg-paper-2 border border-hairline rounded-md p-[3px] mb-4">
            <button
              onClick={() => setActiveTab("you")}
              className={`flex-1 py-2.5 rounded-[6px] text-sm font-semibold transition-colors ${
                activeTab === "you" ? "bg-paper text-ink shadow-sm" : "text-ink-soft"
              }`}
            >
              You
            </button>
            <button
              onClick={() => setActiveTab("fund")}
              className={`flex-1 py-2.5 rounded-[6px] text-sm font-semibold transition-colors ${
                activeTab === "fund" ? "bg-paper text-ink shadow-sm" : "text-ink-soft"
              }`}
            >
              Fund
            </button>
          </div>

          {activeTab === "you" && (
            <section>
              <div className="bg-paper-2 border border-hairline rounded-md px-5 pt-4 pb-3.5">
                <p className="text-[11px] uppercase tracking-wide text-ink-soft font-mono mb-1.5">
                  Available Balance
                </p>
                <p className="font-mono [font-variant-numeric:tabular-nums] text-3xl font-bold text-ink">
                  ₱{mine != null ? fmt(mine.withdrawable_now) : "—"}
                </p>
                {mine != null && mine.money_on_hold > 0 && (
                  <p className="text-xs text-ink-soft mt-1">
                    of ₱{fmt(mine.total_value)} total — ₱{fmt(mine.money_on_hold)} currently out on loan
                  </p>
                )}
                <Sparkline points={myTrend} color="#5F7A5A" />
              </div>

              {mine != null && (
                <button
                  onClick={() => router.push("/fund-breakdown")}
                  className="w-full text-left bg-paper-2 border border-hairline rounded-md p-5 mt-4 hover:bg-paper transition-colors"
                >
                  <InfoBox label="Capital">
                    <InfoRow label="Total Contribution" value={`₱${fmt(mine.total_contribution)}`} />
                    {mine.total_withdrawal !== 0 && (
                      <InfoRow
                        label="Total Withdrawal"
                        value={`-₱${fmt(Math.abs(mine.total_withdrawal))}`}
                        valueClass="text-rust"
                      />
                    )}
                    <InfoRow label="Net Contribution" value={`₱${fmt(mine.net_contribution)}`} bold />
                  </InfoBox>

                  <InfoBox label="Performance">
                    <InfoRow
                      label="Total Gain/Loss"
                      value={signed(mine.bank_interest + mine.investment_gain_loss + mine.loan_gain + mine.bank_writeoff)}
                      valueClass={tone(mine.bank_interest + mine.investment_gain_loss + mine.loan_gain + mine.bank_writeoff)}
                      bold
                    />
                    <div className="pt-1 space-y-1.5">
                      <InfoSubRow label="Bank Interest" value={signed(mine.bank_interest)} valueClass={tone(mine.bank_interest)} />
                      <InfoSubRow
                        label="Investment Gain/Loss"
                        value={signed(mine.investment_gain_loss)}
                        valueClass={tone(mine.investment_gain_loss)}
                      />
                      <InfoSubRow label="Loan Gain Share" value={signed(mine.loan_gain)} valueClass={tone(mine.loan_gain)} />
                      {mine.bank_writeoff !== 0 && (
                        <InfoSubRow
                          label="Bank Write-off Share"
                          value={signed(mine.bank_writeoff)}
                          valueClass={tone(mine.bank_writeoff)}
                        />
                      )}
                    </div>
                  </InfoBox>

                  <p className="text-[11px] text-ink-soft text-right mt-1">View Full Fund Breakdown →</p>
                </button>
              )}
            </section>
          )}

          {activeTab === "fund" && (
            <section>
              <button
                onClick={() => router.push("/bank")}
                className="w-full text-left bg-paper-2 border border-hairline rounded-md px-5 pt-4 pb-3.5 hover:bg-paper transition-colors"
              >
                <p className="text-[11px] uppercase tracking-wide text-ink-soft font-mono mb-1.5">
                  Fund Total Cash
                </p>
                <p className="font-mono [font-variant-numeric:tabular-nums] text-3xl font-bold text-ink">
                  ₱{fund != null ? fmt(fund.total_cash) : "—"}
                </p>
                <Sparkline points={fundTrend} color="#B8912F" />

                {fund != null && (
                  <div className="mt-3">
                    <div className="flex h-2 rounded-full overflow-hidden bg-hairline">
                      <div className="bg-[#28405C]" style={{ width: `${bdoPct}%` }} />
                      <div className="bg-[#3B5443]" style={{ width: `${100 - bdoPct}%` }} />
                    </div>
                    <div className="flex justify-between text-[11px] text-ink-soft mt-1.5">
                      <span className="inline-flex items-center gap-1.5">
                        <span className="inline-block w-2 h-2 rounded-full bg-[#28405C]" />
                        BDO ₱{fmt(fund.bdo_balance)}
                      </span>
                      <span className="inline-flex items-center gap-1.5">
                        <span className="inline-block w-2 h-2 rounded-full bg-[#3B5443]" />
                        Maya ₱{fmt(fund.maya_balance)}
                      </span>
                    </div>
                  </div>
                )}

                {fund != null && fund.undistributed_bank_interest > 0 && (
                  <p className="text-xs text-gold mt-2.5">
                    ₱{fmt(fund.undistributed_bank_interest)} of interest earned is still pending —
                    it'll be split among members by year-end, same as in past years.
                  </p>
                )}

                <p className="text-[11px] text-ink-soft text-right mt-2.5">View Bank Details →</p>
              </button>

              {fund != null && (
                <button
                  onClick={() => router.push("/fund-breakdown")}
                  className="w-full text-left bg-paper-2 border border-hairline rounded-md p-5 mt-4 hover:bg-paper transition-colors"
                >
                  <InfoBox label="Capital">
                    <InfoRow label="Total Contribution" value={`₱${fmt(fund.total_contribution)}`} />
                    {fund.total_withdrawal !== 0 && (
                      <InfoRow
                        label="Total Withdrawal"
                        value={`-₱${fmt(Math.abs(fund.total_withdrawal))}`}
                        valueClass="text-rust"
                      />
                    )}
                    <InfoRow label="Net Contribution" value={`₱${fmt(fund.net_contribution)}`} bold />
                  </InfoBox>

                  <InfoBox label="Performance">
                    <InfoRow
                      label="Total Fund Gain/Loss"
                      value={signed(fund.total_bank_interest + fund.net_investment_gain_loss + fund.total_loan_gain_distributed)}
                      valueClass={tone(fund.total_bank_interest + fund.net_investment_gain_loss + fund.total_loan_gain_distributed)}
                      bold
                    />
                    <div className="pt-1 space-y-1.5">
                      <InfoSubRow
                        label="Bank Interest (all-time)"
                        value={signed(fund.total_bank_interest)}
                        valueClass="text-sage"
                      />
                      <InfoSubRow
                        label="Investment Position"
                        value={signed(fund.net_investment_gain_loss)}
                        valueClass={tone(fund.net_investment_gain_loss)}
                      />
                      <InfoSubRow
                        label="Loan Gains Distributed"
                        value={`₱${fmt(fund.total_loan_gain_distributed)}`}
                      />
                    </div>
                  </InfoBox>

                  <p className="text-[11px] text-ink-soft text-right mt-1">View Full Fund Breakdown →</p>
                </button>
              )}

              {fund != null && fund.open_loans_count > 0 && (
                <button
                  onClick={() => router.push("/loans")}
                  className="w-full text-left bg-paper-2 border border-hairline rounded-md px-5 py-4 mt-4 hover:bg-paper transition-colors"
                >
                  <p className="text-[11px] uppercase tracking-wide text-ink-soft font-mono mb-1.5">
                    {fund.open_loans_count} Loan{fund.open_loans_count === 1 ? "" : "s"} Outstanding
                  </p>
                  <p className="font-mono [font-variant-numeric:tabular-nums] text-2xl font-bold text-ink">
                    ₱{fmt(fund.open_loans_outstanding)}
                  </p>

                  <div className="mt-3">
                    <div className="flex justify-between text-[11px] text-ink-soft mb-1.5">
                      <span className="font-semibold text-sage">{loanRepaidPct.toFixed(0)}% repaid</span>
                      <span>
                        ₱{fmt(fund.open_loans_total_repayable - fund.open_loans_outstanding)} of ₱
                        {fmt(fund.open_loans_total_repayable)}
                      </span>
                    </div>
                    <div className="h-2 rounded-full bg-hairline overflow-hidden">
                      <div className="h-full bg-sage" style={{ width: `${loanRepaidPct}%` }} />
                    </div>
                  </div>

                  <p className="text-[11px] text-ink-soft text-right mt-2.5">View All Loans →</p>
                </button>
              )}
            </section>
          )}
        </div>
      </main>
    </>
  )
}

// A single calm block for a group of related figures -- flat background,
// one soft border, no internal rule lines. Reads at a glance rather than
// as a row-by-row ledger. Matches the Fund Breakdown page's InfoBox.
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
    // space if a member had a burst of activity recently (e.g. 2025/2026),
    // so enforce a minimum pixel gap and let the later year win a collision
    // rather than overlapping the text.
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
