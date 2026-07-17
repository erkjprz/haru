"use client"

import { useEffect, useState } from "react"
import { supabase } from "@/lib/supabase"
import Navbar from "@/app/components/Navbar"
import { SkeletonCardList } from "@/app/components/Skeleton"

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

// Cycled per-member for the ownership bar/legend. Not tied to any semantic
// meaning (unlike gold/sage/rust elsewhere), just distinct swatches drawn
// from the same warm palette family.
const SHARE_COLORS = ["#B8912F", "#5F7A5A", "#8FA88A", "#D4B65C", "#A99B84", "#C97B63", "#7A8FA6", "#9C8AA5"]

export default function FundBreakdownPage() {
  const [members, setMembers] = useState<MemberRow[]>([])
  const [totalCash, setTotalCash] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState("")

  useEffect(() => {
    async function load() {
      const memberPromise = supabase
        .from("members")
        .select("member_id, name")
        .eq("status", "approved")

      // v_member_performance is the same source the dashboard uses for
      // "You" -- correct sign on investment gain/loss, plus bank interest,
      // loan gain share, bank write-off, and the on-hold/withdrawable
      // split. Don't recompute any of this from the raw allocation tables.
      const performancePromise = supabase
        .from("v_member_performance")
        .select(
          "member_id, total_contribution, total_withdrawal, net_contribution, bank_interest, investment_gain_loss, loan_gain, bank_writeoff, total_value, money_on_hold, withdrawable_now"
        )

      // v_fund_summary.total_cash is the SAME number the dashboard's "Fund"
      // tab shows as "Fund Total Cash". Use it here too instead of summing
      // member.total_value -- that sum is member equity (includes money
      // currently out on loan), which is a real and different number from
      // cash on hand.
      const fundPromise = supabase.from("v_fund_summary").select("total_cash").single()

      const [memberResult, performanceResult, fundResult] = await Promise.all([
        memberPromise,
        performancePromise,
        fundPromise
      ])

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

      // Ownership share is deliberately based on member equity (total_value),
      // not cash -- it answers "how much of the fund does each person own,"
      // a different question from "how much cash is in the bank right now."
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
  }, [])

  const fmt = (n: number) =>
    Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })

  const signed = (n: number) => `${n < 0 ? "-" : "+"}₱${fmt(Math.abs(n))}`
  const tone = (n: number) => (n > 0 ? "text-sage" : n < 0 ? "text-rust" : "text-ink-soft")

  if (loading) {
    return (
      <>
        <Navbar />
        <main className="min-h-screen bg-paper text-ink font-sans overflow-x-hidden">
          <div className="max-w-3xl mx-auto px-4 sm:px-5 pt-8 pb-[calc(6.5rem+env(safe-area-inset-bottom))]">
            <SkeletonCardList rows={4} />
          </div>
        </main>
      </>
    )
  }

  return (
    <>
      <Navbar />
      <main className="min-h-screen bg-paper text-ink font-sans overflow-x-hidden">
        <div className="max-w-3xl mx-auto px-4 sm:px-5 pt-8 pb-[calc(6.5rem+env(safe-area-inset-bottom))]">
          <div className="text-[11px] tracking-[0.18em] uppercase text-gold font-mono mb-2">
            Member Ledger
          </div>
          <h1 className="font-display text-3xl sm:text-4xl font-semibold text-ink">
            Fund Breakdown
          </h1>
          <p className="text-sm text-ink-soft mt-2 mb-6">
            Ownership based on net contribution, investment performance, bank interest, and loan gain share.
          </p>

          {loadError && (
            <p className="mb-4 text-sm text-rust">
              Couldn't load the fund breakdown: {loadError}
            </p>
          )}

          {/* ---- fund total (matches dashboard's "Fund Total Cash") + ownership bar ---- */}
          {members.length > 0 && (
            <div className="bg-paper-2 border border-hairline rounded-md px-5 py-4 mb-6">
              <div className="flex justify-between items-baseline mb-1">
                <span className="text-[11px] uppercase tracking-wide text-ink-soft font-mono">
                  Fund Total Cash
                </span>
                <span className="text-[13px] text-ink-soft font-mono">
                  {members.length} members
                </span>
              </div>
              <p className="font-mono [font-variant-numeric:tabular-nums] text-2xl sm:text-3xl font-bold text-ink mb-3.5">
                ₱{totalCash != null ? fmt(totalCash) : "—"}
              </p>

              <p className="text-[10px] uppercase tracking-wide text-ink-soft font-mono mb-1.5">
                Ownership Share
              </p>
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

          {/* ---- per-member cards ---- */}
          <div className="space-y-4">
            {members.map((member) => (
              <div key={member.member_id} className="bg-paper-2 border border-hairline rounded-md p-5">
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
                    <span className="text-[11px] text-ink-soft font-mono">
                      {member.shareOfFund.toFixed(2)}% of fund
                    </span>
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

                {/* Available Balance -- same pattern as the dashboard's "You" tab */}
                <div className="mt-4">
                  <p className="text-[11px] uppercase tracking-wide text-ink-soft font-mono mb-1">
                    Available Balance
                  </p>
                  <p className="font-mono [font-variant-numeric:tabular-nums] text-2xl font-bold text-ink">
                    ₱{fmt(member.withdrawable_now)}
                  </p>
                  {member.money_on_hold > 0 && (
                    <p className="text-xs text-ink-soft mt-1">
                      of ₱{fmt(member.total_value)} total — ₱{fmt(member.money_on_hold)} currently out on loan
                    </p>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </main>
    </>
  )
}

// A single calm block for a group of related figures -- flat background,
// one soft border, no internal rule lines. Meant to read at a glance rather
// than as a row-by-row ledger.
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
