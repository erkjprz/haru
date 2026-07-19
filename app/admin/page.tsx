"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { supabase } from "@/lib/supabase"
import Navbar from "@/app/components/Navbar"
import ReceiptModal from "@/app/components/ReceiptModal"
import { useAuth } from "@/app/auth-context"
import { SkeletonCardList } from "@/app/components/Skeleton"

const typeLabels: Record<string, string> = {
  "Member Contribution": "Contribution",
  "Member Withdrawal": "Withdrawal",
  "Expense": "Expense",
  "Loan Release": "Loan Disbursement",
  "Loan Repayment": "Loan Repayment",
  "Gain Allocation": "Investment Allocation",
  "Bank Interest": "Bank Interest",
  "Internal Transfer": "Bank Transfer"
}

export default function AdminPage() {
  const router = useRouter()
  const { loading: authLoading, member } = useAuth()
  const [dataLoading, setDataLoading] = useState(true)
  const checkingAccess = authLoading || dataLoading

  const [memberCount, setMemberCount] = useState(0)
  const [pendingMembers, setPendingMembers] = useState<any[]>([])
  const [pendingTransactions, setPendingTransactions] = useState<any[]>([])
  const [banks, setBanks] = useState<any[]>([])
  const [withdrawalBankSelections, setWithdrawalBankSelections] = useState<Record<string, string>>({})

  const [loadError, setLoadError] = useState("")
  const [openReceiptUrl, setOpenReceiptUrl] = useState<string | null>(null)

  const [memberSearch, setMemberSearch] = useState("")
  const [txnSearch, setTxnSearch] = useState("")
  const [txnTypeFilter, setTxnTypeFilter] = useState("")

  const [selectedMemberIds, setSelectedMemberIds] = useState<Set<string>>(new Set())
  const [selectedTxnIds, setSelectedTxnIds] = useState<Set<string>>(new Set())

  async function loadData() {
    const { count } = await supabase
      .from("members")
      .select("*", { count: "exact", head: true })
    setMemberCount(count ?? 0)

    const { data: pendingM } = await supabase
      .from("members")
      .select("*")
      .eq("status", "pending")
    setPendingMembers(pendingM ?? [])

    const { data: bankList } = await supabase
      .from("bank_accounts")
      .select("id, bank_name, account_name")
      .order("bank_name")
    setBanks(bankList ?? [])

    const { data: pendingT, error } = await supabase
      .from("transactions")
      .select(
        `
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
      `
      )
      .eq("status", "pending")
      .order("created_at", { ascending: false })

    if (error) {
      setLoadError(error.message)
      setPendingTransactions([])
    } else {
      setLoadError("")
      setPendingTransactions(pendingT ?? [])
    }

    setSelectedMemberIds(new Set())
    setSelectedTxnIds(new Set())
  }

  async function approveMember(memberId: string) {
    await supabase.from("members").update({ status: "approved" }).eq("member_id", memberId)
    loadData()
  }

  async function approveTransaction(transactionId: string) {
    const txn = pendingTransactions.find((t) => t.transaction_id === transactionId)
    const updates: Record<string, any> = { status: "approved" }

    if (txn?.classification === "Member Withdrawal") {
      const bankAccountId = withdrawalBankSelections[transactionId]
      if (!bankAccountId) return
      updates.bank_account_id = bankAccountId
    }

    await supabase.from("transactions").update(updates).eq("transaction_id", transactionId)

    loadData()
  }

  async function rejectTransaction(transactionId: string) {
    await supabase.from("transactions").update({ status: "rejected" }).eq("transaction_id", transactionId)
    loadData()
  }

  async function bulkApproveMembers() {
    if (selectedMemberIds.size === 0) return
    await supabase
      .from("members")
      .update({ status: "approved" })
      .in("member_id", Array.from(selectedMemberIds))
    loadData()
  }

  async function bulkApproveTransactions() {
    if (selectedTxnIds.size === 0) return
    const ids = Array.from(selectedTxnIds)

    await supabase.from("transactions").update({ status: "approved" }).in("transaction_id", ids)

    loadData()
  }

  async function bulkRejectTransactions() {
    if (selectedTxnIds.size === 0) return
    await supabase
      .from("transactions")
      .update({ status: "rejected" })
      .in("transaction_id", Array.from(selectedTxnIds))
    loadData()
  }

  useEffect(() => {
    if (authLoading) return

    if (!member) {
      router.push("/login")
      return
    }

    if (member.role !== "admin") {
      router.push("/dashboard")
      return
    }

    async function checkAdminAccess() {
      await loadData()
      setDataLoading(false)
    }

    checkAdminAccess()
  }, [authLoading, member, router])

  const fmt = (n: number) =>
    Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })

  const filteredMembers = pendingMembers.filter((m) => {
    const q = memberSearch.toLowerCase()
    return m.name?.toLowerCase().includes(q) || m.email?.toLowerCase().includes(q)
  })

  const filteredTransactions = pendingTransactions.filter((t) => {
    const q = txnSearch.toLowerCase()
    const matchesSearch =
      t.members?.name?.toLowerCase().includes(q) ||
      t.description?.toLowerCase().includes(q) ||
      String(t.amount).includes(q)
    const matchesType = !txnTypeFilter || t.classification === txnTypeFilter
    return matchesSearch && matchesType
  })

  const pendingAmountTotal = pendingTransactions.reduce((sum, t) => sum + Math.abs(Number(t.amount)), 0)

  const allMembersSelected = filteredMembers.length > 0 && filteredMembers.every((m) => selectedMemberIds.has(m.member_id))
  const selectableTransactions = filteredTransactions.filter((t) => t.classification !== "Member Withdrawal")
  const allTransactionsSelected =
    selectableTransactions.length > 0 && selectableTransactions.every((t) => selectedTxnIds.has(t.transaction_id))

  if (checkingAccess) {
    return (
      <>
        <Navbar />
        <main className="min-h-screen bg-paper text-ink font-sans">
          <div className="max-w-3xl mx-auto px-5 pt-10 pb-24">
            <SkeletonCardList rows={3} />
          </div>
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
            Administration
          </div>
          <h1 className="font-display text-4xl font-semibold">Admin Panel</h1>

          {loadError && (
            <p className="mt-4 text-sm text-rust">
              Couldn't load pending transactions: {loadError}
            </p>
          )}

          <div className="mt-6 grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="bg-paper-2 border border-hairline rounded-md p-4">
              <div className="text-xs text-ink-soft font-mono">Members</div>
              <div className="font-display text-2xl font-semibold mt-1">{memberCount}</div>
            </div>
            <div className="bg-paper-2 border border-hairline rounded-md p-4">
              <div className="text-xs text-ink-soft font-mono">Pending Members</div>
              <div className="font-display text-2xl font-semibold mt-1 text-gold">{pendingMembers.length}</div>
            </div>
            <div className="bg-paper-2 border border-hairline rounded-md p-4">
              <div className="text-xs text-ink-soft font-mono">Pending Txns</div>
              <div className="font-display text-2xl font-semibold mt-1 text-gold">{pendingTransactions.length}</div>
            </div>
            <div className="bg-paper-2 border border-hairline rounded-md p-4">
              <div className="text-xs text-ink-soft font-mono">Pending Amount</div>
              <div className="font-display text-lg font-semibold mt-1 font-mono">₱{fmt(pendingAmountTotal)}</div>
            </div>
          </div>

          <div className="mt-6 grid grid-cols-2 gap-3">
            {[
              { title: "Members", description: "Manage contributors and roles", path: "/admin/members" },
              { title: "Loans", description: "Approve requests, track repayment", path: "/loans" },
              { title: "Borrowers", description: "Approve and link borrower accounts", path: "/admin/borrowers" }
            ].map((item) => (
              <button
                key={item.title}
                onClick={() => router.push(item.path)}
                className="text-left bg-paper-2 border border-hairline rounded-md p-4 hover:border-gold transition"
              >
                <div className="font-display text-lg font-medium">{item.title}</div>
                <div className="text-xs text-ink-soft mt-1">{item.description}</div>
              </button>
            ))}
          </div>

          <section className="mt-10">
            <div className="flex items-baseline justify-between">
              <h2 className="font-display text-2xl font-semibold">Pending Members</h2>
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
                      onChange={() => {
                        if (allMembersSelected) {
                          setSelectedMemberIds(new Set())
                        } else {
                          setSelectedMemberIds(new Set(filteredMembers.map((m) => m.member_id)))
                        }
                      }}
                    />
                    Select all
                  </label>
                  {selectedMemberIds.size > 0 && (
                    <button className="bg-ink text-paper px-3 py-1.5 rounded-sm text-sm" onClick={bulkApproveMembers}>
                      Approve {selectedMemberIds.size} selected
                    </button>
                  )}
                </div>
              </>
            )}

            <div className="mt-3 space-y-3">
              {filteredMembers.map((m) => (
                <div key={m.member_id} className="bg-paper-2 border border-hairline rounded-md p-4 flex items-start gap-3">
                  <input
                    type="checkbox"
                    className="mt-1"
                    checked={selectedMemberIds.has(m.member_id)}
                    onChange={() => {
                      setSelectedMemberIds((prev) => {
                        const next = new Set(prev)
                        if (next.has(m.member_id)) next.delete(m.member_id)
                        else next.add(m.member_id)
                        return next
                      })
                    }}
                  />
                  <div className="flex-1">
                    <p className="font-display font-medium">{m.name}</p>
                    <p className="text-sm text-ink-soft">{m.email}</p>
                    <button
                      className="mt-3 bg-ink text-paper px-4 py-2 rounded-sm text-sm"
                      onClick={() => approveMember(m.member_id)}
                    >
                      Approve
                    </button>
                  </div>
                </div>
              ))}
              {pendingMembers.length === 0 && <p className="text-sm text-ink-soft">No pending members</p>}
              {pendingMembers.length > 0 && filteredMembers.length === 0 && (
                <p className="text-sm text-ink-soft">No matches for "{memberSearch}"</p>
              )}
            </div>
          </section>

          <section className="mt-10">
            <div className="flex items-baseline justify-between">
              <h2 className="font-display text-2xl font-semibold">Pending Transactions</h2>
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
                    value={txnSearch}
                    onChange={(e) => setTxnSearch(e.target.value)}
                  />
                  <select
                    className="border border-hairline bg-paper-2 text-ink text-sm rounded-sm px-3 py-2"
                    value={txnTypeFilter}
                    onChange={(e) => setTxnTypeFilter(e.target.value)}
                  >
                    <option value="">All types</option>
                    {Object.keys(typeLabels).map((key) => (
                      <option key={key} value={key}>
                        {typeLabels[key]}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="mt-3 flex items-center justify-between flex-wrap gap-2">
                  <label className="flex items-center gap-2 text-sm text-ink-soft">
                    <input
                      type="checkbox"
                      checked={allTransactionsSelected}
                      onChange={() => {
                        if (allTransactionsSelected) {
                          setSelectedTxnIds(new Set())
                        } else {
                          setSelectedTxnIds(new Set(selectableTransactions.map((t) => t.transaction_id)))
                        }
                      }}
                    />
                    Select all
                  </label>
                  {selectedTxnIds.size > 0 && (
                    <div className="flex gap-2">
                      <button className="bg-ink text-paper px-3 py-1.5 rounded-sm text-sm" onClick={bulkApproveTransactions}>
                        Approve {selectedTxnIds.size}
                      </button>
                      <button className="border border-hairline px-3 py-1.5 rounded-sm text-sm" onClick={bulkRejectTransactions}>
                        Reject {selectedTxnIds.size}
                      </button>
                    </div>
                  )}
                </div>
              </>
            )}

            <div className="mt-3 space-y-3">
              {filteredTransactions.map((t) => (
                <div key={t.transaction_id} className="bg-paper-2 border border-hairline rounded-md p-4 flex items-start gap-3">
                  {t.classification !== "Member Withdrawal" && (
                    <input
                      type="checkbox"
                      className="mt-1"
                      checked={selectedTxnIds.has(t.transaction_id)}
                      onChange={() => {
                        setSelectedTxnIds((prev) => {
                          const next = new Set(prev)
                          if (next.has(t.transaction_id)) next.delete(t.transaction_id)
                          else next.add(t.transaction_id)
                          return next
                        })
                      }}
                    />
                  )}
                  <div className="flex-1">
                    <p className="font-display font-medium">{t.members?.name || "Fund"}</p>
                    {t.submitted_by_member && (
                      <p className="text-[11px] text-gold font-mono">
                        Recorded by {t.submitted_by_member.name}
                      </p>
                    )}
                    <p className="text-sm font-mono">₱{fmt(Math.abs(t.amount))}</p>
                    <p className="text-sm text-ink-soft">Type: {typeLabels[t.classification] || t.classification}</p>
                    <p className="text-sm text-ink-soft">
                      Bank: {t.bank_accounts?.account_name || t.bank_accounts?.bank_name || "None"}
                    </p>
                    {t.description && <p className="text-sm text-ink-soft mt-1">{t.description}</p>}
                    {t.receipt_url && (
                      <button
                        type="button"
                        onClick={() => setOpenReceiptUrl(t.receipt_url)}
                        className="mt-3 inline-flex items-center gap-1.5 text-xs font-mono text-gold border border-gold rounded-full px-3 py-1.5 hover:bg-gold/10 transition-colors"
                      >
                        🧾 View Receipt
                      </button>
                    )}
                    {t.classification === "Member Withdrawal" && (
                      <div className="mt-3">
                        <label className="block mb-1 text-xs uppercase tracking-wide text-ink-soft font-mono">
                          Withdraw from bank
                        </label>
                        <select
                          className="border border-hairline bg-paper text-ink text-sm rounded-sm px-3 py-2 w-full"
                          value={withdrawalBankSelections[t.transaction_id] || ""}
                          onChange={(e) =>
                            setWithdrawalBankSelections((prev) => ({ ...prev, [t.transaction_id]: e.target.value }))
                          }
                        >
                          <option value="">Select a bank</option>
                          {banks.map((bank) => (
                            <option key={bank.id} value={bank.id}>
                              {bank.account_name || bank.bank_name}
                            </option>
                          ))}
                        </select>
                      </div>
                    )}
                    <div className="mt-4 flex gap-2">
                      <button
                        className="bg-ink text-paper px-4 py-2 rounded-sm text-sm disabled:opacity-50"
                        onClick={() => approveTransaction(t.transaction_id)}
                        disabled={t.classification === "Member Withdrawal" && !withdrawalBankSelections[t.transaction_id]}
                      >
                        Approve
                      </button>
                      <button
                        className="border border-hairline px-4 py-2 rounded-sm text-sm"
                        onClick={() => rejectTransaction(t.transaction_id)}
                      >
                        Reject
                      </button>
                    </div>
                  </div>
                </div>
              ))}
              {pendingTransactions.length === 0 && !loadError && (
                <p className="text-sm text-ink-soft">No pending transactions</p>
              )}
              {pendingTransactions.length > 0 && filteredTransactions.length === 0 && (
                <p className="text-sm text-ink-soft">No matches for current search/filter</p>
              )}
            </div>
          </section>
        </div>
      </main>

      {openReceiptUrl && <ReceiptModal url={openReceiptUrl} onClose={() => setOpenReceiptUrl(null)} />}
    </>
  )
}
