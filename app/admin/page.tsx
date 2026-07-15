"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { supabase } from "@/lib/supabase"
import Navbar from "@/app/components/Navbar"
import ReceiptModal from "@/app/components/ReceiptModal"
import { autoCloseLoanIfFullyRepaid } from "@/lib/closeLoan"

const typeLabels: Record<string, string> = {
  contribution: "Contribution",
  withdrawal: "Withdrawal",
  expense: "Expense",
  loan_disbursement: "Loan Disbursement",
  loan_repayment: "Loan Repayment",
  investment_allocation: "Investment Allocation",
  bank_interest: "Bank Interest",
  bank_transfer: "Bank Transfer"
}

export default function AdminPage() {
  const router = useRouter()

  const [totalMembers, setTotalMembers] = useState(0)
  const [pendingMembers, setPendingMembers] = useState<any[]>([])
  const [pendingTransactions, setPendingTransactions] = useState<any[]>([])
  const [checkingAccess, setCheckingAccess] = useState(true)
  const [loadError, setLoadError] = useState("")
  const [openReceiptUrl, setOpenReceiptUrl] = useState<string | null>(null)

  const [memberSearch, setMemberSearch] = useState("")
  const [transactionSearch, setTransactionSearch] = useState("")
  const [transactionTypeFilter, setTransactionTypeFilter] = useState("")

  const [selectedMemberIds, setSelectedMemberIds] = useState<Set<string>>(new Set())
  const [selectedTransactionIds, setSelectedTransactionIds] = useState<Set<string>>(new Set())

  async function loadData() {
    const { count: memberCount } = await supabase
      .from("members")
      .select("*", { count: "exact", head: true })

    setTotalMembers(memberCount ?? 0)

    const { data: members } = await supabase
      .from("members")
      .select("*")
      .eq("status", "pending")

    setPendingMembers(members ?? [])

    // Both members and bank_accounts need explicit FK hints:
    // - transactions has two FKs into members (member_id, submitted_by)
    // - transactions has two FKs into bank_accounts (bank_account_id, to_bank_account_id)
    // A bare `members(...)` or `bank_accounts(...)` embed is ambiguous and
    // PostgREST errors on it.
    const { data: transactions, error: txError } = await supabase
      .from("transactions")
      .select(`
        *,
        members!transactions_member_id_fkey (
          name,
          email
        ),
        submitted_by_member:members!transactions_submitted_by_fkey (
          name
        ),
        bank_accounts!transactions_bank_account_id_fkey (
          bank_name,
          account_name
        )
      `)
      .eq("status", "pending")
      .order("created_at", { ascending: false })

    if (txError) {
      setLoadError(txError.message)
      setPendingTransactions([])
    } else {
      setLoadError("")
      setPendingTransactions(transactions ?? [])
    }

    setSelectedMemberIds(new Set())
    setSelectedTransactionIds(new Set())
  }

  async function approveMember(id: string) {
    await supabase
      .from("members")
      .update({ status: "approved" })
      .eq("id", id)

    loadData()
  }

  async function approveTransaction(id: string) {
    const transaction = pendingTransactions.find((t) => t.id === id)

    await supabase
      .from("transactions")
      .update({ status: "approved" })
      .eq("id", id)

    // If this was a loan repayment and it just fully covers the loan,
    // this closes it and distributes gain automatically.
    if (transaction?.type === "loan_repayment" && transaction.loan_id) {
      await autoCloseLoanIfFullyRepaid(transaction.loan_id)
    }

    loadData()
  }

  async function rejectTransaction(id: string) {
    await supabase
      .from("transactions")
      .update({ status: "rejected" })
      .eq("id", id)

    loadData()
  }

  async function bulkApproveMembers() {
    if (selectedMemberIds.size === 0) return

    await supabase
      .from("members")
      .update({ status: "approved" })
      .in("id", Array.from(selectedMemberIds))

    loadData()
  }

  async function bulkApproveTransactions() {
    if (selectedTransactionIds.size === 0) return

    const ids = Array.from(selectedTransactionIds)

    const affectedLoanIds = new Set(
      pendingTransactions
        .filter((t) => ids.includes(t.id) && t.type === "loan_repayment" && t.loan_id)
        .map((t) => t.loan_id)
    )

    await supabase
      .from("transactions")
      .update({ status: "approved" })
      .in("id", ids)

    for (const loanId of affectedLoanIds) {
      await autoCloseLoanIfFullyRepaid(loanId)
    }

    loadData()
  }

  async function bulkRejectTransactions() {
    if (selectedTransactionIds.size === 0) return

    await supabase
      .from("transactions")
      .update({ status: "rejected" })
      .in("id", Array.from(selectedTransactionIds))

    loadData()
  }

  function toggleMemberSelection(id: string) {
    setSelectedMemberIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }

  function toggleTransactionSelection(id: string) {
    setSelectedTransactionIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }

  async function checkAdmin() {
    const {
      data: { user }
    } = await supabase.auth.getUser()

    if (!user) {
      router.push("/login")
      return
    }

    const { data: member } = await supabase
      .from("members")
      .select("role")
      .eq("email", user.email)
      .single()

    if (!member || member.role !== "admin") {
      router.push("/dashboard")
      return
    }

    await loadData()
    setCheckingAccess(false)
  }

  useEffect(() => {
    checkAdmin()
  }, [])

  const fmt = (n: number) =>
    Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })

  const filteredMembers = pendingMembers.filter((m) => {
    const q = memberSearch.toLowerCase()
    return (
      m.name?.toLowerCase().includes(q) ||
      m.email?.toLowerCase().includes(q)
    )
  })

  const filteredTransactions = pendingTransactions.filter((t) => {
    const q = transactionSearch.toLowerCase()
    const matchesSearch =
      t.members?.name?.toLowerCase().includes(q) ||
      t.description?.toLowerCase().includes(q) ||
      String(t.amount).includes(q)
    const matchesType = transactionTypeFilter
      ? t.type === transactionTypeFilter
      : true
    return matchesSearch && matchesType
  })

  const totalPendingAmount = pendingTransactions.reduce(
    (sum, t) => sum + Number(t.amount),
    0
  )

  const allMembersSelected =
    filteredMembers.length > 0 &&
    filteredMembers.every((m) => selectedMemberIds.has(m.id))

  const allTransactionsSelected =
    filteredTransactions.length > 0 &&
    filteredTransactions.every((t) => selectedTransactionIds.has(t.id))

  function toggleSelectAllMembers() {
    if (allMembersSelected) {
      setSelectedMemberIds(new Set())
    } else {
      setSelectedMemberIds(new Set(filteredMembers.map((m) => m.id)))
    }
  }

  function toggleSelectAllTransactions() {
    if (allTransactionsSelected) {
      setSelectedTransactionIds(new Set())
    } else {
      setSelectedTransactionIds(new Set(filteredTransactions.map((t) => t.id)))
    }
  }

  if (checkingAccess) {
    return (
      <>
        <Navbar />
        <main className="min-h-screen bg-paper text-ink p-6 font-sans">
          Checking admin access...
        </main>
      </>
    )
  }

  const menu = [
    { title: "Members", description: "Manage contributors and roles", path: "/admin/members" },
    { title: "Banks", description: "Manage bank accounts and balances", path: "/admin/banks" },
    { title: "Assets", description: "Manage investments and write-offs", path: "/admin/assets" },
    { title: "Loans", description: "Approve requests, track repayment", path: "/admin/loans" }
  ]

  return (
    <>
      <Navbar />
      <main className="min-h-screen bg-paper text-ink font-sans">
        <div className="max-w-3xl mx-auto px-5 pt-10 pb-24">
          <div className="text-[11px] tracking-[0.18em] uppercase text-gold font-mono mb-2">
            Administration
          </div>
          <h1 className="font-display text-4xl font-semibold">
            Admin Panel
          </h1>

          {loadError && (
            <p className="mt-4 text-sm text-rust">
              Couldn't load pending transactions: {loadError}
            </p>
          )}

          <div className="mt-6 grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="bg-paper-2 border border-hairline rounded-md p-4">
              <div className="text-xs text-ink-soft font-mono">Members</div>
              <div className="font-display text-2xl font-semibold mt-1">
                {totalMembers}
              </div>
            </div>
            <div className="bg-paper-2 border border-hairline rounded-md p-4">
              <div className="text-xs text-ink-soft font-mono">Pending Members</div>
              <div className="font-display text-2xl font-semibold mt-1 text-gold">
                {pendingMembers.length}
              </div>
            </div>
            <div className="bg-paper-2 border border-hairline rounded-md p-4">
              <div className="text-xs text-ink-soft font-mono">Pending Txns</div>
              <div className="font-display text-2xl font-semibold mt-1 text-gold">
                {pendingTransactions.length}
              </div>
            </div>
            <div className="bg-paper-2 border border-hairline rounded-md p-4">
              <div className="text-xs text-ink-soft font-mono">Pending Amount</div>
              <div className="font-display text-lg font-semibold mt-1 font-mono">
                ₱{fmt(totalPendingAmount)}
              </div>
            </div>
          </div>

          <div className="mt-6 grid grid-cols-2 gap-3">
            {menu.map((item) => (
              <button
                key={item.title}
                onClick={() => router.push(item.path)}
                className="
                  text-left
                  bg-paper-2
                  border
                  border-hairline
                  rounded-md
                  p-4
                  hover:border-gold
                  transition
                "
              >
                <div className="font-display text-lg font-medium">
                  {item.title}
                </div>
                <div className="text-xs text-ink-soft mt-1">
                  {item.description}
                </div>
              </button>
            ))}
          </div>

          <section className="mt-10">
            <div className="flex items-baseline justify-between">
              <h2 className="font-display text-2xl font-semibold">
                Pending Members
              </h2>
              <span className="text-xs text-ink-soft font-mono">
                {filteredMembers.length} of {pendingMembers.length}
              </span>
            </div>

            {pendingMembers.length > 0 && (
              <>
                <input
                  className="mt-4 border border-hairline bg-paper-2 text-ink text-sm rounded-sm px-3 py-2 w-full"
                  placeholder="Search by name or email"
                  value={memberSearch}
                  onChange={(e) => setMemberSearch(e.target.value)}
                />

                <div className="mt-3 flex items-center justify-between">
                  <label className="flex items-center gap-2 text-sm text-ink-soft">
                    <input
                      type="checkbox"
                      checked={allMembersSelected}
                      onChange={toggleSelectAllMembers}
                    />
                    Select all
                  </label>

                  {selectedMemberIds.size > 0 && (
                    <button
                      className="bg-ink text-paper px-3 py-1.5 rounded-sm text-sm"
                      onClick={bulkApproveMembers}
                    >
                      Approve {selectedMemberIds.size} selected
                    </button>
                  )}
                </div>
              </>
            )}

            <div className="mt-3 space-y-3">
              {filteredMembers.map((member) => (
                <div
                  key={member.id}
                  className="bg-paper-2 border border-hairline rounded-md p-4 flex items-start gap-3"
                >
                  <input
                    type="checkbox"
                    className="mt-1"
                    checked={selectedMemberIds.has(member.id)}
                    onChange={() => toggleMemberSelection(member.id)}
                  />
                  <div className="flex-1">
                    <p className="font-display font-medium">
                      {member.name}
                    </p>
                    <p className="text-sm text-ink-soft">
                      {member.email}
                    </p>
                    <button
                      className="mt-3 bg-ink text-paper px-4 py-2 rounded-sm text-sm"
                      onClick={() => approveMember(member.id)}
                    >
                      Approve
                    </button>
                  </div>
                </div>
              ))}

              {pendingMembers.length === 0 && (
                <p className="text-sm text-ink-soft">
                  No pending members
                </p>
              )}

              {pendingMembers.length > 0 && filteredMembers.length === 0 && (
                <p className="text-sm text-ink-soft">
                  No matches for "{memberSearch}"
                </p>
              )}
            </div>
          </section>

          <section className="mt-10">
            <div className="flex items-baseline justify-between">
              <h2 className="font-display text-2xl font-semibold">
                Pending Transactions
              </h2>
              <span className="text-xs text-ink-soft font-mono">
                {filteredTransactions.length} of {pendingTransactions.length}
              </span>
            </div>

            {pendingTransactions.length > 0 && (
              <>
                <div className="mt-4 flex flex-col sm:flex-row gap-3">
                  <input
                    className="border border-hairline bg-paper-2 text-ink text-sm rounded-sm px-3 py-2 flex-1"
                    placeholder="Search by member, description, or amount"
                    value={transactionSearch}
                    onChange={(e) => setTransactionSearch(e.target.value)}
                  />
                  <select
                    className="border border-hairline bg-paper-2 text-ink text-sm rounded-sm px-3 py-2"
                    value={transactionTypeFilter}
                    onChange={(e) => setTransactionTypeFilter(e.target.value)}
                  >
                    <option value="">All types</option>
                    {Object.keys(typeLabels).map((type) => (
                      <option key={type} value={type}>
                        {typeLabels[type]}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="mt-3 flex items-center justify-between flex-wrap gap-2">
                  <label className="flex items-center gap-2 text-sm text-ink-soft">
                    <input
                      type="checkbox"
                      checked={allTransactionsSelected}
                      onChange={toggleSelectAllTransactions}
                    />
                    Select all
                  </label>

                  {selectedTransactionIds.size > 0 && (
                    <div className="flex gap-2">
                      <button
                        className="bg-ink text-paper px-3 py-1.5 rounded-sm text-sm"
                        onClick={bulkApproveTransactions}
                      >
                        Approve {selectedTransactionIds.size}
                      </button>
                      <button
                        className="border border-hairline px-3 py-1.5 rounded-sm text-sm"
                        onClick={bulkRejectTransactions}
                      >
                        Reject {selectedTransactionIds.size}
                      </button>
                    </div>
                  )}
                </div>
              </>
            )}

            <div className="mt-3 space-y-3">
              {filteredTransactions.map((transaction) => (
                <div
                  key={transaction.id}
                  className="bg-paper-2 border border-hairline rounded-md p-4 flex items-start gap-3"
                >
                  <input
                    type="checkbox"
                    className="mt-1"
                    checked={selectedTransactionIds.has(transaction.id)}
                    onChange={() => toggleTransactionSelection(transaction.id)}
                  />
                  <div className="flex-1">
                    <p className="font-display font-medium">
                      {transaction.members?.name || "Fund"}
                    </p>
                    {transaction.submitted_by_member && (
                      <p className="text-[11px] text-gold font-mono">
                        Recorded by {transaction.submitted_by_member.name}
                      </p>
                    )}
                    <p className="text-sm font-mono">
                      ₱{fmt(transaction.amount)}
                    </p>
                    <p className="text-sm text-ink-soft">
                      Type: {typeLabels[transaction.type] || transaction.type}
                    </p>
                    <p className="text-sm text-ink-soft">
                      Bank:{" "}
                      {
                        transaction.bank_accounts?.account_name ||
                        transaction.bank_accounts?.bank_name ||
                        "None"
                      }
                    </p>
                    {transaction.description && (
                      <p className="text-sm text-ink-soft mt-1">
                        {transaction.description}
                      </p>
                    )}

                    {transaction.receipt_url && (
                      <button
                        type="button"
                        onClick={() => setOpenReceiptUrl(transaction.receipt_url)}
                        className="mt-3 inline-flex items-center gap-1.5 text-xs font-mono text-gold border border-gold rounded-full px-3 py-1.5 hover:bg-gold/10 transition-colors"
                      >
                        🧾 View Receipt
                      </button>
                    )}

                    <div className="mt-4 flex gap-2">
                      <button
                        className="bg-ink text-paper px-4 py-2 rounded-sm text-sm"
                        onClick={() => approveTransaction(transaction.id)}
                      >
                        Approve
                      </button>
                      <button
                        className="border border-hairline px-4 py-2 rounded-sm text-sm"
                        onClick={() => rejectTransaction(transaction.id)}
                      >
                        Reject
                      </button>
                    </div>
                  </div>
                </div>
              ))}

              {pendingTransactions.length === 0 && !loadError && (
                <p className="text-sm text-ink-soft">
                  No pending transactions
                </p>
              )}

              {pendingTransactions.length > 0 && filteredTransactions.length === 0 && (
                <p className="text-sm text-ink-soft">
                  No matches for current search/filter
                </p>
              )}
            </div>
          </section>
        </div>
      </main>

      {openReceiptUrl && (
        <ReceiptModal
          url={openReceiptUrl}
          onClose={() => setOpenReceiptUrl(null)}
        />
      )}
    </>
  )
}
