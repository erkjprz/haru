"use client"

import { useEffect, useState } from "react"
import { supabase } from "@/lib/supabase"
import Navbar from "@/app/components/Navbar"

export default function FundBreakdownPage() {
  const [members, setMembers] = useState<any[]>([])
  const [loading, setLoading] = useState(true)

  async function load() {
    // The transactions table has more rows than Supabase's default per-request
    // row cap, so a single unpaginated select silently truncates. Page through
    // it in order so every row is accounted for.
    const pageSize = 1000
    const transactions: any[] = []
    for (let from = 0; ; from += pageSize) {
      const { data } = await supabase
        .from("transactions")
        .select("member_id, classification, amount, status")
        .neq("status", "rejected")
        .order("transaction_id", { ascending: true })
        .range(from, from + pageSize - 1)

      if (!data || data.length === 0) break
      transactions.push(...data)
      if (data.length < pageSize) break
    }

    // Ledger amounts are signed (contributions +, withdrawals −), so the
    // net total is a straight sum over both classifications.
    const netContributionTotal = transactions.reduce((sum, t) => {
      if (
        t.classification === "Member Contribution" ||
        t.classification === "Member Withdrawal"
      ) {
        return sum + Number(t.amount)
      }
      return sum
    }, 0)

    const { data: allocations } = await supabase
      .from("investment_allocations")
      .select("member_id, allocation_type, amount")

    const { data: memberList } = await supabase
      .from("members")
      .select("member_id, name")

    const breakdown =
      (memberList ?? []).map((member) => {
        const memberContributed = transactions
          .filter((t) => t.member_id === member.member_id && t.classification === "Member Contribution")
          .reduce((sum, t) => sum + Number(t.amount), 0)

        const memberWithdrawn = Math.abs(
          transactions
            .filter((t) => t.member_id === member.member_id && t.classification === "Member Withdrawal")
            .reduce((sum, t) => sum + Number(t.amount), 0)
        )

        const netContributed = memberContributed - memberWithdrawn

        const memberInvestmentResult =
          allocations
            ?.filter((a) => a.member_id === member.member_id)
            .reduce(
              (sum, a) =>
                sum + (a.allocation_type === "Investment Loss" ? -Number(a.amount) : Number(a.amount)),
              0
            ) ?? 0

        const ownershipPercent =
          netContributionTotal > 0
            ? (netContributed / netContributionTotal) * 100
            : 0

        const ownershipValue = netContributed + memberInvestmentResult

        return {
          name: member.name,
          contributed: memberContributed,
          withdrawn: memberWithdrawn,
          investmentResult: memberInvestmentResult,
          ownershipPercent,
          ownershipValue
        }
      })
      .sort((a, b) => b.ownershipValue - a.ownershipValue)

    setMembers(breakdown)
    setLoading(false)
  }

  useEffect(() => {
    load()
  }, [])

  const fmt = (n: number) =>
    n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })

  if (loading) {
    return (
      <>
        <Navbar />
        <main className="p-6 bg-paper min-h-screen text-ink font-sans">
          Loading...
        </main>
      </>
    )
  }

  return (
    <>
      <Navbar />
      <main className="min-h-screen bg-paper text-ink font-sans">
        <div className="max-w-3xl mx-auto px-5 pt-10 pb-24">
          <div className="text-[11px] tracking-[0.18em] uppercase text-gold font-mono mb-2">
            Ledger Summary
          </div>
          <h1 className="font-display text-4xl font-semibold text-ink">
            Fund Breakdown
          </h1>
          <p className="text-sm text-ink-soft mt-2 max-w-md">
            A snapshot of each member's activity in the fund — what they've put in, taken out, and gained or lost.
          </p>

          <div className="mt-8 space-y-4">
            {members.map((member) => (
              <div
                key={member.name}
                className="bg-paper-2 border border-hairline rounded-md p-5"
              >
                <div className="flex justify-between items-baseline">
                  <span className="font-display text-xl font-semibold text-ink">
                    {member.name}
                  </span>
                  <span className="text-xs text-ink-soft font-mono">
                    {member.ownershipPercent.toFixed(1)}% of fund
                  </span>
                </div>

                <div className="mt-3 space-y-1.5 text-sm font-mono">
                  <div className="flex justify-between">
                    <span className="text-ink-soft">Contributed</span>
                    <span>₱{fmt(member.contributed)}</span>
                  </div>

                  {member.withdrawn > 0 && (
                    <div className="flex justify-between">
                      <span className="text-ink-soft">Withdrawn</span>
                      <span className="text-rust">-₱{fmt(member.withdrawn)}</span>
                    </div>
                  )}

                  <div className="flex justify-between">
                    <span className="text-ink-soft">Investment gain/loss</span>
                    <span className={member.investmentResult >= 0 ? "text-sage" : "text-rust"}>
                      {member.investmentResult >= 0 ? "+" : "-"}₱{fmt(Math.abs(member.investmentResult))}
                    </span>
                  </div>
                </div>

                <div className="mt-4 pt-4 border-t border-hairline flex justify-between items-baseline">
                  <span className="text-sm font-semibold text-ink">
                    Current Value
                  </span>
                  <span className="font-display text-2xl font-semibold text-ink">
                    ₱{fmt(member.ownershipValue)}
                  </span>
                </div>
              </div>
            ))}

            {members.length === 0 && (
              <p className="text-sm text-ink-soft text-center py-8">
                No members yet.
              </p>
            )}
          </div>
        </div>
      </main>
    </>
  )
}
