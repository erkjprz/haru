"use client"

import { useEffect, useState } from "react"
import { useRouter, useParams } from "next/navigation"
import { supabase } from "@/lib/supabase"
import Navbar from "@/app/components/Navbar"
import { useAuth } from "@/app/auth-context"

type Investment = {
  investment_id: string
  investment: string
  affects_cash: number
  invested: number
  returned: number
  gain_loss: number
}

type Share = {
  member_id: string
  member: string
  amount: number
  allocation_type: string
}

export default function InvestmentDetailPage() {
  const router = useRouter()
  const params = useParams()
  const investmentId = params?.id as string

  const { loading: authLoading, member } = useAuth()
  const [dataLoading, setDataLoading] = useState(true)
  const checkingAccess = authLoading || dataLoading
  const [investment, setInvestment] = useState<Investment | null>(null)
  const [shares, setShares] = useState<Share[]>([])
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
      const investmentPromise = supabase
        .from("v_investment_summary")
        .select("*")
        .eq("investment_id", investmentId)
        .single()

      // Per-member split, per Section 8: Perfume Biz is a flat equal
      // split across all 10 members; Farmon's realized loss is spread
      // across 9 (Yabie isn't allocated a share, a pre-existing artifact
      // of this table's history, not something decided in this pass).
      // allocation_type tells us whether the row is a gain or a loss so
      // the sign can be applied for display.
      const sharesPromise = supabase
        .from("investment_allocations")
        .select("amount, allocation_type, member_id, members(name)")
        .eq("investment_id", investmentId)

      const [investmentResult, sharesResult] = await Promise.all([investmentPromise, sharesPromise])

      if (investmentResult.error || !investmentResult.data) {
        setNotFound(true)
      } else {
        setInvestment(investmentResult.data as Investment)
      }

      if (!sharesResult.error && sharesResult.data) {
        setShares(
          sharesResult.data.map((r: any) => ({
            member_id: r.member_id,
            member: r.members?.name ?? "Unknown",
            amount: Number(r.amount),
            allocation_type: r.allocation_type
          }))
        )
      } else if (sharesResult.error) {
        setLoadError(sharesResult.error.message)
      }

      setDataLoading(false)
    }

    if (investmentId) load()
  }, [investmentId, authLoading, member, router])

  const fmt = (n: number) =>
    Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })

  if (checkingAccess) {
    return (
      <>
        <Navbar />
        <main className="p-6 bg-paper min-h-screen text-ink font-sans" />
      </>
    )
  }

  if (notFound || !investment) {
    return (
      <>
        <Navbar />
        <main className="min-h-screen bg-paper text-ink font-sans">
          <div className="max-w-3xl mx-auto px-4 sm:px-5 pt-8">
            <p className="text-sm text-ink-soft">This investment couldn't be found.</p>
            <button
              onClick={() => router.push("/investment")}
              className="mt-4 text-sm font-medium text-gold"
            >
              ← Back to Investment
            </button>
          </div>
        </main>
      </>
    )
  }

  const isGain = investment.gain_loss > 0
  const isFlat = investment.gain_loss === 0

  const signedShares = shares
    .map((s) => ({ ...s, signed: s.allocation_type === "Investment Loss" ? -s.amount : s.amount }))
    .sort((a, b) => (isGain ? b.signed - a.signed : a.signed - b.signed))

  const totalShared = signedShares.reduce((sum, s) => sum + s.signed, 0)

  return (
    <>
      <Navbar />
      <main className="min-h-screen bg-paper text-ink font-sans overflow-x-hidden">
        <div className="max-w-3xl mx-auto px-4 sm:px-5 pt-8 pb-[calc(3rem+env(safe-area-inset-bottom))]">
          <button
            onClick={() => router.push("/investment")}
            className="text-[13px] text-ink-soft mb-4 hover:text-ink transition-colors"
          >
            ← Investment
          </button>

          <div className="flex items-center gap-2 mb-1">
            <span className={`w-1.5 h-1.5 rounded-full ${isGain ? "bg-sage" : isFlat ? "bg-ink-soft" : "bg-rust"}`} />
            <span
              className={`text-[11px] font-mono uppercase tracking-wide ${
                isGain ? "text-sage" : isFlat ? "text-ink-soft" : "text-rust"
              }`}
            >
              {isGain ? "Gain" : isFlat ? "Flat" : "Loss"}
            </span>
          </div>
          <h1 className="font-display text-3xl sm:text-4xl font-semibold text-ink mb-1">
            {investment.investment}
          </h1>
          <p className="text-[13px] text-ink-soft mb-6">
            {investment.affects_cash ? "Funded through the tracked bank accounts" : "Funded outside the tracked bank trail"}
          </p>

          {/* Gain/loss overview */}
          <div className="bg-paper-2 border border-hairline rounded-md px-5 pt-4 pb-3.5">
            <p className="text-[11px] uppercase tracking-wide text-ink-soft font-mono mb-1.5">
              Net Gain / Loss
            </p>
            <p
              className={`font-mono [font-variant-numeric:tabular-nums] text-3xl font-bold ${
                isGain ? "text-sage" : isFlat ? "text-ink" : "text-rust"
              }`}
            >
              {investment.gain_loss < 0 ? "-" : "+"}₱{fmt(Math.abs(investment.gain_loss))}
            </p>
          </div>

          {/* Invested / Returned */}
          <div className="bg-paper-2 border border-hairline rounded-md p-5 mt-4">
            <InfoBox label="Cash Flow">
              <InfoRow label="Invested" value={`₱${fmt(investment.invested)}`} />
              <InfoRow label="Returned" value={`₱${fmt(investment.returned)}`} />
              <InfoRow
                label="Net"
                value={`${investment.gain_loss < 0 ? "-" : "+"}₱${fmt(Math.abs(investment.gain_loss))}`}
                valueClass={isGain ? "text-sage" : isFlat ? "text-ink" : "text-rust"}
                bold
              />
            </InfoBox>
          </div>

          {/* Gain/loss share per member */}
          <section className="mt-8">
            <h2 className="font-display text-lg font-medium text-ink mb-1">
              {isGain ? "Gain" : "Loss"} Share per Member
            </h2>
            <p className="text-[13px] text-ink-soft mb-3">
              How this investment's {isGain ? "gain" : "loss"} is split across members.
            </p>

            {loadError && <p className="text-sm text-rust">{loadError}</p>}

            {signedShares.length > 0 && (
              <div className="bg-paper-2 border border-hairline rounded-md">
                <div className="px-5">
                  {signedShares.map((s, i) => (
                    <div
                      key={s.member_id}
                      className={`py-3 flex justify-between items-center gap-3 ${
                        i !== signedShares.length - 1 ? "border-b border-dashed border-hairline" : ""
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
                      <p
                        className={`font-mono [font-variant-numeric:tabular-nums] text-sm font-semibold shrink-0 ${
                          s.signed < 0 ? "text-rust" : "text-sage"
                        }`}
                      >
                        {s.signed < 0 ? "-" : "+"}₱{fmt(Math.abs(s.signed))}
                      </p>
                    </div>
                  ))}
                </div>
                <div className="px-5 py-3 border-t border-hairline flex justify-between items-center">
                  <p className="text-[11px] uppercase tracking-wide text-ink-soft font-mono">
                    Split among {signedShares.length} member{signedShares.length === 1 ? "" : "s"}
                  </p>
                  <p
                    className={`font-mono [font-variant-numeric:tabular-nums] text-[13px] font-semibold ${
                      totalShared < 0 ? "text-rust" : "text-sage"
                    }`}
                  >
                    {totalShared < 0 ? "-" : "+"}₱{fmt(Math.abs(totalShared))}
                  </p>
                </div>
              </div>
            )}

            {signedShares.length === 0 && !loadError && (
              <p className="text-sm text-ink-soft text-center py-8 bg-paper-2 border border-hairline rounded-md">
                No allocation on record for this investment.
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
