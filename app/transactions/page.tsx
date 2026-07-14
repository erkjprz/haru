"use client"

import { useEffect, useState } from "react"
import { supabase } from "@/lib/supabase"
import Navbar from "@/app/components/Navbar"

const typeLabels: Record<string, string> = {
  contribution: "Contribution",
  withdrawal: "Withdrawal",
  expense: "Expense",
  loan_disbursement: "Loan Disbursement",
  loan_repayment: "Loan Repayment",
  investment_allocation: "Investment Allocation"
}

const typeColor: Record<string, string> = {
  contribution: "text-sage border-sage",
  withdrawal: "text-rust border-rust",
  expense: "text-rust border-rust",
  loan_disbursement: "text-gold border-gold",
  loan_repayment: "text-gold border-gold",
  investment_allocation: "text-ink-soft border-ink-soft"
}

export default function TransactionsPage() {
  const [transactions, setTransactions] = useState<any[]>([])
  const [members, setMembers] = useState<any[]>([])
  const [selectedMemberId, setSelectedMemberId] = useState("")
  const [selectedType, setSelectedType] = useState("")
  const [selectedYear, setSelectedYear] = useState("")

  async function loadTransactions() {
    const { data } = await supabase
      .from("transactions")
      .select(`
        *,
        members (
          name,
          email
        ),
        bank_accounts (
          bank_name,
          account_name
        )
      `)
      .order("created_at", { ascending: false })

    setTransactions(data ?? [])
  }

  async function loadMembers() {
    const { data } = await supabase
      .from("members")
      .select("id, name")
      .order("name")

    setMembers(data ?? [])
  }

  useEffect(() => {
    loadTransactions()
    loadMembers()
  }, [])

  const typeOptions = Object.keys(typeLabels)

  const yearOptions = Array.from(
    new Set(
      transactions.map((t) =>
        new Date(t.created_at).getFullYear().toString()
      )
    )
  ).sort((a, b) => Number(b) - Number(a))

  const filteredTransactions = transactions.filter((t) => {
    const memberMatch = selectedMemberId
      ? t.member_id === selectedMemberId
      : true

    const typeMatch = selectedType
      ? t.type === selectedType
      : true

    const yearMatch = selectedYear
      ? new Date(t.created_at).getFullYear().toString() === selectedYear
      : true

    return memberMatch && typeMatch && yearMatch
  })

  const fmt = (n: number) =>
    Number(n).toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    })

  return (
    <>
      <Navbar />

      <main className="min-h-screen bg-paper text-ink font-sans">
        <div className="max-w-3xl mx-auto px-5 pt-10 pb-24">

          <div className="text-[11px] tracking-[0.18em] uppercase text-gold font-mono mb-2">
            Full History
          </div>

          <h1 className="font-display text-4xl font-semibold text-ink">
            Transactions
          </h1>

          <div className="mt-6 flex flex-wrap gap-3">

            <select
              className="border border-hairline bg-paper-2 text-ink text-sm rounded-sm px-3 py-2"
              value={selectedYear}
              onChange={(e) => setSelectedYear(e.target.value)}
            >
              <option value="">All years</option>
              {yearOptions.map((year) => (
                <option key={year} value={year}>
                  {year}
                </option>
              ))}
            </select>

            <select
              className="border border-hairline bg-paper-2 text-ink text-sm rounded-sm px-3 py-2"
              value={selectedMemberId}
              onChange={(e) => setSelectedMemberId(e.target.value)}
            >
              <option value="">All members</option>

              {members.map((member) => (
                <option key={member.id} value={member.id}>
                  {member.name}
                </option>
              ))}
            </select>

            <select
              className="border border-hairline bg-paper-2 text-ink text-sm rounded-sm px-3 py-2"
              value={selectedType}
              onChange={(e) => setSelectedType(e.target.value)}
            >
              <option value="">All types</option>

              {typeOptions.map((type) => (
                <option key={type} value={type}>
                  {typeLabels[type]}
                </option>
              ))}
            </select>

            <span className="text-xs text-ink-soft font-mono self-center ml-auto">
              {filteredTransactions.length} of {transactions.length}
            </span>

          </div>


          <div className="mt-6 space-y-3">

            {filteredTransactions.map((transaction) => (

              <div
                key={transaction.id}
                className="bg-paper-2 border border-hairline rounded-md p-4"
              >

                <div className="flex justify-between items-start gap-3">

                  <div className="min-w-0">

                    <div className="flex items-center gap-2 flex-wrap">

                      <span
                        className={`text-[9px] uppercase tracking-widest font-mono border rounded-full px-2 py-0.5 ${
                          typeColor[transaction.type] ??
                          "text-ink-soft border-hairline"
                        }`}
                      >
                        {typeLabels[transaction.type] || transaction.type}
                      </span>

                      <span className="text-xs text-ink-soft font-mono">
                        {new Date(transaction.created_at).toLocaleDateString()}
                      </span>

                    </div>


                    <div className="font-display text-lg font-medium text-ink mt-2">
                      {transaction.members?.name || "Unknown"}
                    </div>


                    {transaction.description && (
                      <p className="text-xs text-ink-soft mt-1 max-w-md leading-relaxed">
                        {transaction.description}
                      </p>
                    )}


                    {transaction.bank_accounts && (
                      <p className="text-xs text-ink-soft mt-1 font-mono">
                        {transaction.bank_accounts.account_name ||
                          transaction.bank_accounts.bank_name}
                      </p>
                    )}

                  </div>


                  <div className="text-right shrink-0">

                    <div className="font-mono text-xl font-semibold text-ink">
                      ₱{fmt(transaction.amount)}
                    </div>

                    <div className="text-[10px] uppercase text-ink-soft font-mono mt-1">
                      {transaction.status}
                    </div>

                  </div>

                </div>


                {transaction.receipt_url && (
                  <a
                    href={transaction.receipt_url}
                    target="_blank"
                    className="inline-block mt-3"
                  >
                    <img
                      src={transaction.receipt_url}
                      alt="Receipt"
                      className="w-24 rounded-sm border border-hairline"
                    />
                  </a>
                )}

              </div>

            ))}


            {filteredTransactions.length === 0 && (
              <p className="py-8 text-sm text-ink-soft text-center">
                No transactions found.
              </p>
            )}

          </div>

        </div>
      </main>
    </>
  )
}