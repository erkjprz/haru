"use client"

import { useEffect, useState } from "react"
import { useRouter, useParams } from "next/navigation"
import { supabase } from "@/lib/supabase"
import Navbar from "@/app/components/Navbar"
import { useAuth } from "@/app/auth-context"
import { SkeletonPanel } from "@/app/components/Skeleton"
import {
  getPendingBankInterestGroups,
  distributeBankInterestGroup,
  type PendingBankInterestGroup
} from "@/lib/bankInterest"

type YearRow = { year: string; amount: number; memberCount: number }

export default function BankDetailPage() {
  const router = useRouter()
  const params = useParams()
  const bank = decodeURIComponent((params?.bank as string) ?? "")

  const { loading: authLoading, member } = useAuth()
  const isAdmin = member?.role === "admin"
  const [dataLoading, setDataLoading] = useState(true)
  const checkingAccess = authLoading || dataLoading
  const [balance, setBalance] = useState(0)
  const [interestEarned, setInterestEarned] = useState(0)
  const [tax, setTax] = useState(0)
  const [years, setYears] = useState<YearRow[]>([])
  const [notFound, setNotFound] = useState(false)
  const [loadError, setLoadError] = useState("")
  const [pendingGroups, setPendingGroups] = useState<PendingBankInterestGroup[]>([])
  const [distributingYear, setDistributingYear] = useState<number | null>(null)

  async function loadPending() {
    const groups = await getPendingBankInterestGroups()
    setPendingGroups(groups.filter((g) => g.bank === bank))
  }

  async function handleDistribute(group: PendingBankInterestGroup) {
    setDistributingYear(group.year)
    await distributeBankInterestGroup(group)
    await Promise.all([loadPending(), load()])
    setDistributingYear(null)
  }

  async function load() {
    const balancePromise = supabase.from("v_bank_balances").select("*").eq("bank", bank).maybeSingle()

    const interestPromise = supabase
      .from("transactions")
      .select("classification, amount")
      .eq("status", "approved")
      .eq("bank", bank)
      .in("classification", ["Bank Interest", "Tax"])

    // Every allocation row for this bank, across all years -- grouped
    // client-side by the year of allocation_date to build the year list.
    // One allocation_date per member per distribution event, same shape
    // as investment_allocations but keyed by bank + date instead of
    // investment_id.
    const allocationsPromise = supabase
      .from("bank_interest_allocations")
      .select("allocation_date, amount, member_id")
      .eq("bank", bank)

    const [balanceResult, interestResult, allocationsResult] = await Promise.all([
      balancePromise,
      interestPromise,
      allocationsPromise
    ])

    if (balanceResult.error || !balanceResult.data) {
      setNotFound(true)
      setDataLoading(false)
      return
    }

    setBalance(Number(balanceResult.data.balance))

    if (!interestResult.error) {
      let earned = 0
      let taxTotal = 0
      for (const row of interestResult.data ?? []) {
        if (row.classification === "Bank Interest") earned += Number(row.amount)
        if (row.classification === "Tax") taxTotal += Number(row.amount)
      }
      setInterestEarned(earned)
      setTax(taxTotal)
    } else {
      setLoadError(interestResult.error.message)
    }

    if (!allocationsResult.error) {
      const byYear: Record<string, { amount: number; members: Set<string> }> = {}
      for (const row of allocationsResult.data ?? []) {
        const year = (row.allocation_date || "").slice(0, 4)
        if (!year) continue
        if (!byYear[year]) byYear[year] = { amount: 0, members: new Set() }
        byYear[year].amount += Number(row.amount)
        byYear[year].members.add(row.member_id)
      }
      const rows = Object.entries(byYear)
        .map(([year, v]) => ({ year, amount: v.amount, memberCount: v.members.size }))
        .sort((a, b) => b.year.localeCompare(a.year))
      setYears(rows)
    } else if (!loadError) {
      setLoadError(allocationsResult.error.message)
    }

    setDataLoading(false)
  }

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

    if (bank) {
      load()
      loadPending()
    }
  }, [bank, authLoading, member, router])

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

  if (notFound) {
    return (
      <>
        <Navbar />
        <main className="min-h-screen bg-paper text-ink font-sans overflow-x-hidden">
          <div className="max-w-3xl mx-auto px-4 sm:px-5 pt-8">
            <p className="text-sm text-ink-soft">This bank couldn't be found.</p>
            <button onClick={() => router.push("/bank")} className="mt-4 text-sm font-medium text-gold">
              ← Back to Banks
            </button>
          </div>
        </main>
      </>
    )
  }

  const netInterest = interestEarned - tax
  const totalDistributed = years.reduce((sum, y) => sum + y.amount, 0)
  const undistributed = netInterest - totalDistributed

  return (
    <>
      <Navbar />
      <main className="min-h-screen bg-paper text-ink font-sans overflow-x-hidden">
        <div className="max-w-3xl mx-auto px-4 sm:px-5 pt-8 pb-[calc(3rem+env(safe-area-inset-bottom))]">
          <button onClick={() => router.push("/bank")} className="text-[13px] text-ink-soft mb-4 hover:text-ink transition-colors">
            ← Bank
          </button>

          <h1 className="font-display text-3xl sm:text-4xl font-semibold text-ink mb-1">{bank}</h1>
          <p className="text-[13px] text-ink-soft mb-6">Current balance and interest history for this account.</p>

          <div className="bg-paper-2 border border-hairline rounded-md px-5 pt-4 pb-3.5">
            <p className="text-[11px] uppercase tracking-wide text-ink-soft font-mono mb-1.5">Current Balance</p>
            <p className="font-mono [font-variant-numeric:tabular-nums] text-3xl font-bold text-ink">₱{fmt(balance)}</p>
          </div>

          <div className="bg-paper-2 border border-hairline rounded-md p-5 mt-4">
            <InfoBox label="Interest">
              <InfoRow label="Interest Earned" value={`+₱${fmt(interestEarned)}`} valueClass="text-sage" />
              {tax !== 0 && <InfoRow label="Tax Withheld" value={`-₱${fmt(Math.abs(tax))}`} valueClass="text-rust" />}
              <InfoRow label="Net Interest" value={`₱${fmt(netInterest)}`} bold />
              <div className="pt-1 space-y-1.5">
                <InfoSubRow label="Distributed to Members" value={`₱${fmt(totalDistributed)}`} />
                {undistributed > 0.01 && (
                  <InfoSubRow label="Not Yet Distributed" value={`₱${fmt(undistributed)}`} valueClass="text-gold" />
                )}
              </div>
            </InfoBox>
          </div>

          {loadError && <p className="mt-4 text-sm text-rust">{loadError}</p>}

          {isAdmin && pendingGroups.length > 0 && (
            <section className="mt-8">
              <h2 className="font-display text-lg font-medium text-ink mb-1">Pending Distribution</h2>
              <p className="text-[13px] text-ink-soft mb-3">
                Approved interest that hasn't been split across members yet.
              </p>
              <div className="flex flex-col gap-3">
                {pendingGroups.map((group) => (
                  <div key={group.year} className="bg-paper-2 border border-hairline rounded-md px-5 pt-4 pb-4">
                    <p className="text-[11px] uppercase tracking-wide text-ink-soft font-mono mb-1.5">
                      {group.year}
                    </p>
                    <p className="font-mono [font-variant-numeric:tabular-nums] text-2xl font-bold text-ink">
                      ₱{fmt(Math.abs(group.totalAmount))}
                    </p>
                    <p className="text-[12px] text-ink-soft mt-1.5">
                      {group.transactionCount} transaction{group.transactionCount === 1 ? "" : "s"} combined into
                      one lump sum
                    </p>
                    <button
                      className="w-full mt-4 bg-ink text-paper px-4 py-3 rounded-sm text-sm font-medium disabled:opacity-50"
                      onClick={() => handleDistribute(group)}
                      disabled={distributingYear === group.year}
                    >
                      {distributingYear === group.year ? "Distributing..." : "Distribute"}
                    </button>
                  </div>
                ))}
              </div>
            </section>
          )}

          <section className="mt-8">
            <h2 className="font-display text-lg font-medium text-ink mb-1">Interest by Year</h2>
            <p className="text-[13px] text-ink-soft mb-3">Tap a year to see how it was split across members.</p>

            {years.length > 0 && (
              <div className="bg-paper-2 border border-hairline rounded-md">
                <div className="px-5">
                  {years.map((y, i) => (
                    <button
                      key={y.year}
                      onClick={() => router.push(`/bank/${encodeURIComponent(bank)}/${y.year}`)}
                      className={`w-full py-3 flex justify-between items-center gap-3 text-left ${
                        i !== years.length - 1 ? "border-b border-dashed border-hairline" : ""
                      }`}
                    >
                      <div className="min-w-0">
                        <p className="text-sm text-ink font-medium">{y.year}</p>
                        <p className="text-[11px] text-ink-soft">
                          split across {y.memberCount} member{y.memberCount === 1 ? "" : "s"}
                        </p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <p className="font-mono [font-variant-numeric:tabular-nums] text-sm font-semibold text-sage">
                          +₱{fmt(y.amount)}
                        </p>
                        <span className="text-ink-soft">→</span>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {years.length === 0 && !loadError && (
              <p className="text-sm text-ink-soft text-center py-8 bg-paper-2 border border-hairline rounded-md">
                No interest has been distributed for this bank yet.
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
