"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { supabase } from "@/lib/supabase"
import Navbar from "@/app/components/Navbar"
import { useAuth } from "@/app/auth-context"

type Bank = {
  bank: string
  balance: number
  interest_earned: number
  tax: number
  distributed: number
}

export default function BanksPage() {
  const router = useRouter()
  const { loading: authLoading, member } = useAuth()
  const [dataLoading, setDataLoading] = useState(true)
  const checkingAccess = authLoading || dataLoading
  const [banks, setBanks] = useState<Bank[]>([])
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
      // v_bank_balances: running cash balance per bank from the ledger.
      const balancesPromise = supabase.from("v_bank_balances").select("*")

      // Interest earned and tax withheld per bank, all-time, approved only.
      // Mirrors v_bank_summary's own filter (Bank Interest / Tax, approved)
      // but pulled per-row here so we can pivot classification into columns.
      const interestPromise = supabase
        .from("transactions")
        .select("bank, classification, amount")
        .eq("status", "approved")
        .in("classification", ["Bank Interest", "Tax"])

      // What's actually been paid out to members so far, per bank.
      const distributedPromise = supabase.from("bank_interest_allocations").select("bank, amount")

      const [balancesResult, interestResult, distributedResult] = await Promise.all([
        balancesPromise,
        interestPromise,
        distributedPromise
      ])

      if (balancesResult.error) {
        setLoadError(balancesResult.error.message)
        setDataLoading(false)
        return
      }

      const byBank: Record<string, Bank> = {}
      for (const row of balancesResult.data ?? []) {
        byBank[row.bank] = { bank: row.bank, balance: Number(row.balance), interest_earned: 0, tax: 0, distributed: 0 }
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
      setDataLoading(false)
    }

    load()
  }, [authLoading, member, router])

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

  const totalBalance = banks.reduce((sum, b) => sum + b.balance, 0)

  return (
    <>
      <Navbar />
      <main className="min-h-screen bg-paper text-ink font-sans overflow-x-hidden">
        <div className="max-w-3xl mx-auto px-4 sm:px-5 pt-8 pb-[calc(3rem+env(safe-area-inset-bottom))]">
          <div className="text-[11px] tracking-[0.18em] uppercase text-gold font-mono mb-2">
            Fund accounts
          </div>
          <h1 className="font-display text-3xl sm:text-4xl font-semibold text-ink mb-1">Banks</h1>
          <p className="text-[13px] text-ink-soft mb-5">
            Where the fund's cash sits, and the interest each account has earned.
          </p>

          {!loadError && banks.length > 0 && (
            <div className="bg-paper-2 border border-hairline rounded-md px-5 pt-4 pb-3.5 mb-6">
              <p className="text-[11px] uppercase tracking-wide text-ink-soft font-mono mb-1.5">
                Total Bank Balance
              </p>
              <p className="font-mono [font-variant-numeric:tabular-nums] text-3xl font-bold text-ink">
                ₱{fmt(totalBalance)}
              </p>
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
            {banks.map((b) => (
              <BankCard key={b.bank} bank={b} fmt={fmt} onClick={() => router.push(`/bank/${encodeURIComponent(b.bank)}`)} />
            ))}
          </div>
        </div>
      </main>
    </>
  )
}

function BankCard({ bank, fmt, onClick }: { bank: Bank; fmt: (n: number) => string; onClick: () => void }) {
  const netInterest = bank.interest_earned - bank.tax
  const undistributed = netInterest - bank.distributed
  const distributedPct = netInterest > 0 ? Math.min(100, (bank.distributed / netInterest) * 100) : 0

  return (
    <button
      onClick={onClick}
      className="w-full text-left bg-paper-2 border border-hairline rounded-md px-5 py-4 hover:bg-paper transition-colors"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-display text-[17px] font-semibold text-ink truncate">{bank.bank}</p>
          <p className="text-[12px] text-ink-soft">₱{fmt(bank.balance)} current balance</p>
        </div>
        <span className="text-ink-soft shrink-0">→</span>
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
          <p className="font-mono [font-variant-numeric:tabular-nums] text-sm font-semibold text-ink">
            ₱{fmt(bank.distributed)}
          </p>
        </div>
      </div>

      <div className="h-1.5 rounded-full bg-hairline overflow-hidden mt-2.5">
        <div className="h-full bg-sage" style={{ width: `${distributedPct}%` }} />
      </div>

      {undistributed > 0.01 && (
        <p className="text-[11px] text-gold mt-2">₱{fmt(undistributed)} not yet distributed to members</p>
      )}
    </button>
  )
}
