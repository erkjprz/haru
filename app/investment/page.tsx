"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { supabase } from "@/lib/supabase"
import Navbar from "@/app/components/Navbar"

type Investment = {
  investment_id: string
  investment: string
  affects_cash: number
  invested: number
  returned: number
  gain_loss: number
}

export default function InvestmentsPage() {
  const router = useRouter()
  const [checkingAccess, setCheckingAccess] = useState(true)
  const [investments, setInvestments] = useState<Investment[]>([])
  const [loadError, setLoadError] = useState("")

  useEffect(() => {
    async function load() {
      const {
        data: { user }
      } = await supabase.auth.getUser()

      if (!user) {
        router.push("/login")
        return
      }

      const { data: member } = await supabase
        .from("members")
        .select("member_id, status")
        .eq("email", user.email)
        .single()

      if (!member || member.status !== "approved") {
        router.push("/waiting")
        return
      }

      // v_investment_summary: invested/returned per Section 8's sign
      // convention, gain_loss = returned - invested. Works the same for
      // Perfume Biz's real cash round-trip and Farmon's realized-loss
      // lines (which always return 0) without special-casing either.
      const { data, error } = await supabase
        .from("v_investment_summary")
        .select("*")
        .order("investment")

      if (error) {
        setLoadError(error.message)
      } else {
        setInvestments((data as Investment[]) ?? [])
      }

      setCheckingAccess(false)
    }

    load()
  }, [])

  const fmt = (n: number) =>
    Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })

  if (checkingAccess) {
    return (
      <>
        <Navbar />
        <main className="p-6 bg-paper min-h-screen text-ink font-sans">Loading...</main>
      </>
    )
  }

  const gains = investments.filter((i) => i.gain_loss > 0).sort((a, b) => b.gain_loss - a.gain_loss)
  const losses = investments.filter((i) => i.gain_loss <= 0).sort((a, b) => a.gain_loss - b.gain_loss)
  const netTotal = investments.reduce((sum, i) => sum + i.gain_loss, 0)

  return (
    <>
      <Navbar />
      <main className="min-h-screen bg-paper text-ink font-sans overflow-x-hidden">
        <div className="max-w-3xl mx-auto px-4 sm:px-5 pt-8 pb-[calc(3rem+env(safe-area-inset-bottom))]">
          <div className="text-[11px] tracking-[0.18em] uppercase text-gold font-mono mb-2">
            Fund investments
          </div>
          <h1 className="font-display text-3xl sm:text-4xl font-semibold text-ink mb-1">Investments</h1>
          <p className="text-[13px] text-ink-soft mb-5">
            Every venture the fund has put money into, and how it turned out.
          </p>

          {!loadError && investments.length > 0 && (
            <div className="bg-paper-2 border border-hairline rounded-md px-5 pt-4 pb-3.5 mb-6">
              <p className="text-[11px] uppercase tracking-wide text-ink-soft font-mono mb-1.5">
                Net Position
              </p>
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
              <h2 className="text-[11px] uppercase tracking-[0.1em] text-ink-soft font-mono mb-3">
                Gains
              </h2>
              <div className="flex flex-col gap-3">
                {gains.map((inv) => (
                  <InvestmentCard
                    key={inv.investment_id}
                    inv={inv}
                    fmt={fmt}
                    onClick={() => router.push(`/investment/${inv.investment_id}`)}
                  />
                ))}
              </div>
            </section>
          )}

          {losses.length > 0 && (
            <section>
              <h2 className="text-[11px] uppercase tracking-[0.1em] text-ink-soft font-mono mb-3">
                Losses
              </h2>
              <div className="flex flex-col gap-3">
                {losses.map((inv) => (
                  <InvestmentCard
                    key={inv.investment_id}
                    inv={inv}
                    fmt={fmt}
                    onClick={() => router.push(`/investment/${inv.investment_id}`)}
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

function InvestmentCard({
  inv,
  fmt,
  onClick
}: {
  inv: Investment
  fmt: (n: number) => string
  onClick: () => void
}) {
  const isGain = inv.gain_loss > 0
  const isFlat = inv.gain_loss === 0
  const magnitudePct = inv.invested > 0 ? Math.min(100, (Math.abs(inv.gain_loss) / inv.invested) * 100) : 0

  return (
    <button
      onClick={onClick}
      className="w-full text-left bg-paper-2 border border-hairline rounded-md px-5 py-4 hover:bg-paper transition-colors"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-display text-[17px] font-semibold text-ink truncate">{inv.investment}</p>
          <p className="text-[12px] text-ink-soft">₱{fmt(inv.invested)} invested</p>
        </div>
        <div className="shrink-0 flex items-center gap-1.5">
          <span className={`w-1.5 h-1.5 rounded-full ${isGain ? "bg-sage" : isFlat ? "bg-ink-soft" : "bg-rust"}`} />
          <span
            className={`text-[11px] font-mono uppercase tracking-wide ${
              isGain ? "text-sage" : isFlat ? "text-ink-soft" : "text-rust"
            }`}
          >
            {isGain ? "Gain" : isFlat ? "Flat" : "Loss"}
          </span>
        </div>
      </div>

      <div className="flex items-baseline justify-between mt-3.5">
        <div>
          <p className="text-[10px] uppercase tracking-wide text-ink-soft font-mono">Returned</p>
          <p className="font-mono [font-variant-numeric:tabular-nums] text-sm font-semibold text-ink">
            ₱{fmt(inv.returned)}
          </p>
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
    </button>
  )
}
