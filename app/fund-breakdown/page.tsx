"use client"

import { useEffect, useState } from "react"
import { supabase } from "@/lib/supabase"
import Navbar from "@/app/components/Navbar"

export default function FundBreakdownPage() {
  const [totalContributions, setTotalContributions] = useState(0)
  const [cashInBanks, setCashInBanks] = useState(0)
  const [netAssets, setNetAssets] = useState(0)
  const [loanInterestTotal, setLoanInterestTotal] = useState(0)
  const [perfumeBizTotal, setPerfumeBizTotal] = useState(0)
  const [farmOnTotal, setFarmOnTotal] = useState(0)
  const [members, setMembers] = useState<any[]>([])
  const [loading, setLoading] = useState(true)

  async function load() {
    const { data: transactions } = await supabase
      .from("transactions")
      .select("member_id, type, amount, status")
      .neq("status", "rejected")

    const cashTotal =
      transactions?.reduce((sum, t) => {
        if (t.type === "contribution") {
          return sum + Number(t.amount)
        }
        if (t.type === "expense") {
          return sum - Number(t.amount)
        }
        if (t.type === "withdrawal") {
          return sum - Number(t.amount)
        }
        return sum
      }, 0) ?? 0

    setCashInBanks(cashTotal)

    const contributionTotal =
      transactions
        ?.filter((t) => t.type === "contribution")
        .reduce((sum, t) => sum + Number(t.amount), 0) ?? 0

    setTotalContributions(contributionTotal)

    const netContributionTotal =
      transactions?.reduce((sum, t) => {
        if (t.type === "contribution") {
          return sum + Number(t.amount)
        }
        if (t.type === "withdrawal") {
          return sum - Number(t.amount)
        }
        return sum
      }, 0) ?? 0

    const { data: allocations } = await supabase
      .from("investment_allocations")
      .select("member_id, category, amount")

    const allocationsTotal =
      allocations?.reduce((sum, a) => sum + Number(a.amount), 0) ?? 0

    setNetAssets(allocationsTotal)

    setLoanInterestTotal(
      allocations
        ?.filter((a) => a.category === "loan_interest")
        .reduce((sum, a) => sum + Number(a.amount), 0) ?? 0
    )
    setPerfumeBizTotal(
      allocations
        ?.filter((a) => a.category === "perfume_biz")
        .reduce((sum, a) => sum + Number(a.amount), 0) ?? 0
    )
    setFarmOnTotal(
      allocations
        ?.filter((a) => a.category === "farmon_writeoff")
        .reduce((sum, a) => sum + Number(a.amount), 0) ?? 0
    )

    const { data: memberList } = await supabase
      .from("members")
      .select("id, name")

    const breakdown =
      (memberList ?? []).map((member) => {
        const memberContributed =
          transactions
            ?.filter(
              (t) =>
                t.member_id === member.id &&
                t.type === "contribution"
            )
            .reduce((sum, t) => sum + Number(t.amount), 0) ?? 0

        const memberWithdrawn =
          transactions
            ?.filter(
              (t) =>
                t.member_id === member.id &&
                t.type === "withdrawal"
            )
            .reduce((sum, t) => sum + Number(t.amount), 0) ?? 0

        const netContributed = memberContributed - memberWithdrawn

        const memberInvestmentResult =
          allocations
            ?.filter((a) => a.member_id === member.id)
            .reduce((sum, a) => sum + Number(a.amount), 0) ?? 0

        const ownershipPercent =
          netContributionTotal > 0
            ? (netContributed / netContributionTotal) * 100
            : 0

        const ownershipValue = netContributed + memberInvestmentResult

        return {
          name: member.name,
          contributed: memberContributed,
          netContributed,
          investmentResult: memberInvestmentResult,
          ownershipPercent,
          ownershipValue
        }
      })

    setMembers(breakdown)
    setLoading(false)
  }

  useEffect(() => {
    load()
  }, [])

  const totalAccountedFunds = cashInBanks + netAssets

  if (loading) {
    return (
      <>
        <Navbar />
        <main className="p-6 bg-white dark:bg-gray-950 min-h-screen text-gray-900 dark:text-gray-100">
          Loading...
        </main>
      </>
    )
  }

  return (
    <>
      <Navbar />
      <main className="min-h-screen p-6 bg-white dark:bg-gray-950 text-gray-900 dark:text-gray-100">
        <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100">
          Fund Breakdown
        </h1>
        <p className="text-sm text-gray-700 dark:text-gray-400 mt-1">
          Total Accounted Funds = Cash in Banks + Net Assets — everything the fund currently owns.
        </p>

        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="border border-gray-300 dark:border-gray-700 rounded p-4 bg-white dark:bg-gray-900">
            <h2 className="font-bold text-sm text-gray-700 dark:text-gray-300">
              Total Contributions
            </h2>
            <p className="text-xl font-bold text-gray-900 dark:text-gray-100">
              ${totalContributions.toFixed(2)}
            </p>
          </div>

          <div className="border border-gray-300 dark:border-gray-700 rounded p-4 bg-white dark:bg-gray-900">
            <h2 className="font-bold text-sm text-gray-700 dark:text-gray-300">
              Cash in Banks
            </h2>
            <p className="text-xl font-bold text-gray-900 dark:text-gray-100">
              ${cashInBanks.toFixed(2)}
            </p>
          </div>

          <div className="border border-gray-300 dark:border-gray-700 rounded p-4 bg-white dark:bg-gray-900">
            <h2 className="font-bold text-sm text-gray-700 dark:text-gray-300">
              Net Assets
            </h2>
            <p className="text-xl font-bold text-gray-900 dark:text-gray-100">
              ${netAssets.toFixed(2)}
            </p>
            <p className="text-xs text-gray-700 dark:text-gray-400 mt-2 leading-relaxed">
              Loan interest:{" "}
              <span className="font-medium text-gray-900 dark:text-gray-200">
                ${loanInterestTotal.toFixed(2)}
              </span>
              {" · "}
              Perfume Biz:{" "}
              <span className="font-medium text-gray-900 dark:text-gray-200">
                ${perfumeBizTotal.toFixed(2)}
              </span>
              {" · "}
              FarmOn write-off:{" "}
              <span className="font-medium text-gray-900 dark:text-gray-200">
                ${farmOnTotal.toFixed(2)}
              </span>
            </p>
          </div>

          <div className="border border-gray-300 dark:border-gray-700 rounded p-4 bg-blue-50 dark:bg-blue-950">
            <h2 className="font-bold text-sm text-gray-700 dark:text-gray-300">
              Total Accounted Funds
            </h2>
            <p className="text-xl font-bold text-gray-900 dark:text-gray-100">
              ${totalAccountedFunds.toFixed(2)}
            </p>
          </div>
        </div>

        <h2 className="text-xl font-bold mt-10 text-gray-900 dark:text-gray-100">
          Member Ownership
        </h2>

        <div className="mt-4 space-y-3">
          {members.map((member) => (
            <div
              key={member.name}
              className="border border-gray-300 dark:border-gray-700 rounded p-4 bg-white dark:bg-gray-900"
            >
              <div className="flex justify-between items-baseline">
                <h3 className="font-bold text-lg text-gray-900 dark:text-gray-100">
                  {member.name}
                </h3>
                <span className="text-sm text-gray-700 dark:text-gray-400">
                  {member.ownershipPercent.toFixed(1)}% of contributions
                </span>
              </div>
              <p className="text-gray-800 dark:text-gray-300">
                Contributed: ${member.contributed.toFixed(2)}
              </p>
              <p className="text-gray-800 dark:text-gray-300">
                Investment gain/loss: ${member.investmentResult.toFixed(2)}
              </p>
              <p className="font-bold mt-1 text-gray-900 dark:text-gray-100">
                Ownership Value: ${member.ownershipValue.toFixed(2)}
              </p>
            </div>
          ))}
        </div>
      </main>
    </>
  )
}
