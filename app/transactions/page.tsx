"use client"

import { useEffect, useState } from "react"
import { supabase } from "@/lib/supabase"
import Navbar from "@/app/components/Navbar"

export default function TransactionsPage() {
  const [transactions, setTransactions] = useState<any[]>([])
  const [members, setMembers] = useState<any[]>([])
  const [selectedMemberId, setSelectedMemberId] = useState("")
  const [selectedType, setSelectedType] = useState("")

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
      .order("created_at", {
        ascending: false
      })

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

  const typeLabels: Record<string, string> = {
    contribution: "Contribution",
    withdrawal: "Withdrawal",
    expense: "Expense",
    loan_disbursement: "Loan Disbursement",
    loan_repayment: "Loan Repayment",
    investment_allocation: "Investment Allocation"
  }

  const typeOptions = Object.keys(typeLabels)

  const filteredTransactions = transactions.filter((t) => {
    const memberMatch = selectedMemberId
      ? t.member_id === selectedMemberId
      : true
    const typeMatch = selectedType
      ? t.type === selectedType
      : true
    return memberMatch && typeMatch
  })

  return (
    <>
      <Navbar />
      <main className="p-6 bg-white dark:bg-gray-950 min-h-screen text-gray-900 dark:text-gray-100">
        <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100">
          Transactions
        </h1>

        <div className="mt-6 flex flex-wrap gap-4">
          <div className="max-w-xs flex-1 min-w-[200px]">
            <label className="block mb-2 text-sm font-medium text-gray-700 dark:text-gray-300">
              Filter by member
            </label>
            <select
              className="border border-gray-300 dark:border-gray-600 p-3 rounded w-full bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100"
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
          </div>

          <div className="max-w-xs flex-1 min-w-[200px]">
            <label className="block mb-2 text-sm font-medium text-gray-700 dark:text-gray-300">
              Filter by type
            </label>
            <select
              className="border border-gray-300 dark:border-gray-600 p-3 rounded w-full bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100"
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
          </div>
        </div>

        <p className="mt-4 text-sm text-gray-600 dark:text-gray-400">
          Showing {filteredTransactions.length} of {transactions.length} transactions
        </p>

        <div className="mt-4 space-y-4">
          {filteredTransactions.map((transaction) => (
            <div
              key={transaction.id}
              className="border border-gray-300 dark:border-gray-700 rounded p-4 bg-white dark:bg-gray-900"
            >
              <h2 className="font-bold text-lg text-gray-900 dark:text-gray-100">
                {typeLabels[transaction.type] || transaction.type}
              </h2>
              <p className="text-gray-800 dark:text-gray-300">
                Member:{" "}
                {transaction.members?.name || "Unknown"}
              </p>
              <p className="text-gray-800 dark:text-gray-300">
                Amount:{" "}
                ${Number(transaction.amount).toFixed(2)}
              </p>
              <p className="text-gray-800 dark:text-gray-300">
                Date:{" "}
                {new Date(transaction.created_at).toLocaleDateString()}
              </p>
              <p className="text-gray-800 dark:text-gray-300">
                Bank:{" "}
                {
                  transaction.bank_accounts?.account_name ||
                  transaction.bank_accounts?.bank_name ||
                  "None"
                }
              </p>
              <p className="text-gray-800 dark:text-gray-300">
                Status:{" "}
                {transaction.status}
              </p>
              <p className="text-gray-700 dark:text-gray-400">
                {transaction.description}
              </p>
              {transaction.receipt_url && (
                <div className="mt-4">
                  <a
                    href={transaction.receipt_url}
                    target="_blank"
                  >
                    <img
                      src={transaction.receipt_url}
                      alt="Receipt"
                      className="w-32 rounded border border-gray-300 dark:border-gray-700 cursor-pointer"
                    />
                  </a>
                </div>
              )}
            </div>
          ))}

          {filteredTransactions.length === 0 && (
            <p className="text-gray-700 dark:text-gray-400">
              No transactions found.
            </p>
          )}
        </div>
      </main>
    </>
  )
}
