"use client"

import { useEffect, useState } from "react"
import { useRouter, useParams } from "next/navigation"
import { supabase } from "@/lib/supabase"
import Navbar from "@/app/components/Navbar"
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

export default function BankYearDetailPage() {
  const router = useRouter()
  const params = useParams()
  const bank = decodeURIComponent((params?.bank as string) ?? "")
  const year = params?.year as string

  const { loading: authLoading, member } = useAuth()
  const [dataLoading, setDataLoading] = useState(true)
  const checkingAccess = authLoading || dataLoading
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

    if (member.role === "borrower") {
      router.push("/borrower")
      return
    }

    async function load() {
      // Per-member split for this bank's interest in this calendar year.
      // Mirrors investment_allocations' shape: one row per member per
      // distribution event, joined to members(name) for display.
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
  }, [bank, year, authLoading, member, router])

  const fmt = (n: number) =>
    Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })

  if (checkingAccess) {
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

  if (notFound || (!loadError && shares.length === 0)) {
    return (
      <>
        <Navbar />
        <main className="min-h-screen bg-paper text-ink font-sans overflow-x-hidden">
          <div className="max-w-3xl mx-auto px-4 sm:px-5 pt-8">
            <p className="text-sm text-ink-soft">No interest distribution found for {bank} in {year}.</p>
            <button
              onClick={() => router.push(`/bank/${encodeURIComponent(bank)}`)}
              className="mt-4 text-sm font-medium text-gold"
            >
              ← Back to {bank}
            </button>
          </div>
        </main>
      </>
    )
  }

  const sortedShares = [...shares].sort((a, b) => b.amount - a.amount)
  const total = sortedShares.reduce((sum, s) => sum + s.amount, 0)
  const distributionDate = sortedShares[0]?.allocation_date

  return (
    <>
      <Navbar />
      <main className="min-h-screen bg-paper text-ink font-sans overflow-x-hidden">
        <div className="max-w-3xl mx-auto px-4 sm:px-5 pt-8 pb-[calc(3rem+var(--dock-h)+env(safe-area-inset-bottom))]">
          <button
            onClick={() => router.push(`/bank/${encodeURIComponent(bank)}`)}
            className="text-[13px] text-ink-soft mb-4 hover:text-ink transition-colors"
          >
            ← {bank}
          </button>

          <div className="text-[11px] tracking-[0.18em] uppercase text-gold font-mono mb-2">{bank}</div>
          <h1 className="font-display text-3xl sm:text-4xl font-semibold text-ink mb-1">{year} Interest</h1>
          {distributionDate && (
            <p className="text-[13px] text-ink-soft mb-6">
              Distributed {new Date(distributionDate).toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" })}
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
      </main>
    </>
  )
}