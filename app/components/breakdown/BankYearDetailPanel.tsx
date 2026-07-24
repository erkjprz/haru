"use client"

// Inline replacement for the old standalone /bank/[bank]/[year] route --
// the second level of the Banks drill-down, rendered in place so the
// Breakdown header and tab row stay visible.

import { useEffect, useState } from "react"
import { supabase } from "@/lib/supabase"
import { useAuth } from "@/app/auth-context"
import { SkeletonPanel } from "@/app/components/Skeleton"

type Share = {
  member_id: string
  member: string
  amount: number
  allocation_date: string
  current_value: number
  pct_share: number
}

export function BankYearDetailPanel({
  bank,
  year,
  onBack
}: {
  bank: string
  year: string
  onBack: () => void
}) {
  const { member } = useAuth()
  const myMemberId = member?.member_id ?? null

  const [dataLoading, setDataLoading] = useState(true)
  const [shares, setShares] = useState<Share[]>([])
  const [notFound, setNotFound] = useState(false)
  const [loadError, setLoadError] = useState("")

  // Opening a drill-down while the list is scrolled down would otherwise
  // leave the Breakdown header out of view -- jump back to top so it's
  // visible the instant the detail mounts.
  useEffect(() => {
    window.scrollTo(0, 0)
  }, [])

  useEffect(() => {
    async function load() {
      // Per-member split for this bank's interest in this calendar year.
      const { data, error } = await supabase
        .from("bank_interest_allocations")
        .select("amount, allocation_date, member_id, current_value, pct_share, members(name)")
        .eq("bank", bank)
        .gte("allocation_date", `${year}-01-01`)
        .lte("allocation_date", `${year}-12-31`)

      if (error) {
        setLoadError(error.message)
      } else if (!data || data.length === 0) {
        setNotFound(true)
      } else {
        setShares(
          data.map((r: any) => ({
            member_id: r.member_id,
            member: r.members?.name ?? "Unknown",
            amount: Number(r.amount),
            allocation_date: r.allocation_date,
            current_value: Number(r.current_value),
            pct_share: Number(r.pct_share)
          }))
        )
      }

      setDataLoading(false)
    }

    if (bank && year) load()
  }, [bank, year])

  const fmt = (n: number) =>
    Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })

  if (dataLoading) {
    return <SkeletonPanel />
  }

  if (notFound || (!loadError && shares.length === 0)) {
    return (
      <div>
        <p className="text-sm text-ink-soft">
          No interest distribution found for {bank} in {year}.
        </p>
        <button onClick={onBack} className="mt-4 text-sm font-medium text-gold">
          ← Back to {bank}
        </button>
      </div>
    )
  }

  const sortedShares = [...shares].sort((a, b) => b.amount - a.amount)
  const total = sortedShares.reduce((sum, s) => sum + s.amount, 0)
  const distributionDate = sortedShares[0]?.allocation_date

  return (
    <div>
      <button onClick={onBack} className="text-[13px] text-ink-soft mb-4 hover:text-ink transition-colors">
        ← {bank}
      </button>

      <div className="text-[11px] tracking-[0.18em] uppercase text-gold font-mono mb-2">{bank}</div>
      <h1 className="font-display text-3xl sm:text-4xl font-semibold text-ink mb-1">{year} Interest</h1>
      {distributionDate && (
        <p className="text-[13px] text-ink-soft mb-6">
          Distributed{" "}
          {new Date(distributionDate).toLocaleDateString(undefined, {
            month: "long",
            day: "numeric",
            year: "numeric"
          })}
        </p>
      )}

      <div className="bg-paper-2 border border-hairline rounded-md px-5 pt-4 pb-3.5">
        <p className="text-[11px] uppercase tracking-wide text-ink-soft font-mono mb-1.5">Total Distributed</p>
        <p className="font-mono [font-variant-numeric:tabular-nums] text-3xl font-bold text-sage">+₱{fmt(total)}</p>
      </div>

      {loadError && <p className="mt-4 text-sm text-rust">{loadError}</p>}

      <section className="mt-8">
        <h2 className="font-display text-lg font-medium text-ink mb-1">Share per Member</h2>
        <p className="text-[13px] text-ink-soft mb-3">
          How {bank}'s {year} interest was split across members.
        </p>

        {sortedShares.length > 0 && (
          <div className="bg-paper-2 border border-hairline rounded-md">
            <div className="px-5">
              {sortedShares.map((s, i) => (
                <div
                  key={s.member_id}
                  className={`py-3 flex justify-between items-center gap-3 ${
                    i !== sortedShares.length - 1 ? "border-b border-dashed border-hairline" : ""
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
                  <div className="flex flex-col items-end shrink-0">
                    <p className="font-mono [font-variant-numeric:tabular-nums] text-sm font-semibold text-sage">
                      +₱{fmt(s.amount)}
                    </p>
                    <p className="text-[11px] text-ink-soft font-mono whitespace-nowrap">
                      {s.pct_share.toFixed(2)}% of ₱{fmt(s.current_value)}
                    </p>
                  </div>
                </div>
              ))}
            </div>
            <div className="px-5 py-3 border-t border-hairline flex justify-between items-center">
              <p className="text-[11px] uppercase tracking-wide text-ink-soft font-mono">
                Split among {sortedShares.length} member{sortedShares.length === 1 ? "" : "s"}
              </p>
              <p className="font-mono [font-variant-numeric:tabular-nums] text-[13px] font-semibold text-sage">
                +₱{fmt(total)}
              </p>
            </div>
          </div>
        )}
      </section>
    </div>
  )
}
