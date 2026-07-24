"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { supabase } from "@/lib/supabase"
import Navbar from "@/app/components/Navbar"
import ReceiptModal from "@/app/components/ReceiptModal"
import { useAuth } from "@/app/auth-context"
import { SkeletonCardList } from "@/app/components/Skeleton"
import { getPendingBankInterestGroups, distributeBankInterestGroup, type PendingBankInterestGroup } from "@/lib/bankInterest"

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

type Tab = "members" | "txns" | "borrowers" | "distrib"

type ExportRow = {
  txn_date: string | null
  classification: string
  status: string
  amount: number
  bank: string | null
  description: string | null
  members: { name: string } | null
  submitted_by_member: { name: string } | null
  loans: { name: string } | null
  investments: { name: string } | null
  from_bank_account: { bank_name: string; account_name: string | null } | null
  to_bank_account: { bank_name: string; account_name: string | null } | null
  created_at: string
}

function timeAgo(dateStr: string): string {
  const diffMs = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diffMs / 60000)
  if (mins < 1) return "just now"
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

export default function AdminPage() {
  const router = useRouter()
  const { loading: authLoading, member } = useAuth()
  const [dataLoading, setDataLoading] = useState(true)
  const checkingAccess = authLoading || dataLoading

  const [activeTab, setActiveTab] = useState<Tab>("txns")

  const [pendingMembers, setPendingMembers] = useState<any[]>([])
  const [unclaimedMembers, setUnclaimedMembers] = useState<any[]>([])
  const [memberLinkChoice, setMemberLinkChoice] = useState<Record<string, string>>({})
  const [memberBusyId, setMemberBusyId] = useState<string | null>(null)

  const [pendingTransactions, setPendingTransactions] = useState<any[]>([])
  const [banks, setBanks] = useState<any[]>([])
  const [withdrawalBankSelections, setWithdrawalBankSelections] = useState<Record<string, string>>({})
  const [loanReleaseBankSelections, setLoanReleaseBankSelections] = useState<Record<string, string>>({})

  const [borrowerMembers, setBorrowerMembers] = useState<any[]>([])
  const [unclaimedBorrowers, setUnclaimedBorrowers] = useState<any[]>([])
  const [linkedLoanNameByMemberId, setLinkedLoanNameByMemberId] = useState<Record<string, string>>({})
  const [borrowerLinkChoice, setBorrowerLinkChoice] = useState<Record<string, string>>({})
  const [borrowerBusyId, setBorrowerBusyId] = useState<string | null>(null)

  const [pendingGroups, setPendingGroups] = useState<PendingBankInterestGroup[]>([])
  const [distributingKey, setDistributingKey] = useState<string | null>(null)

  const [loadError, setLoadError] = useState("")
  const [openReceiptUrl, setOpenReceiptUrl] = useState<string | null>(null)

  const [memberSearch, setMemberSearch] = useState("")
  const [txnSearch, setTxnSearch] = useState("")
  const [txnTypeFilter, setTxnTypeFilter] = useState("")

  const [exporting, setExporting] = useState(false)
  const [exportError, setExportError] = useState("")

  async function loadData() {
    const [
      pendingMembersRes,
      unclaimedMembersRes,
      banksRes,
      pendingTxnsRes,
      borrowerMembersRes,
      unclaimedBorrowersRes,
      linkedBorrowersRes,
      pendingGroupsRes
    ] = await Promise.all([
      supabase.from("members").select("*").eq("status", "pending").order("created_at", { ascending: false }),
      supabase.rpc("list_unclaimed_members"),
      supabase.from("bank_accounts").select("id, bank_name, account_name").order("bank_name"),
      supabase
        .from("transactions")
        .select(
          `
          *,
          members!transactions_member_id_fkey ( name, email ),
          submitted_by_member:members!transactions_submitted_by_fkey ( name ),
          bank_accounts!transactions_bank_account_id_fkey ( bank_name, account_name )
        `
        )
        .eq("status", "pending")
        .order("created_at", { ascending: false }),
      supabase
        .from("members")
        .select("member_id, name, email, status, created_at")
        .eq("role", "borrower")
        .order("created_at", { ascending: false }),
      supabase.from("borrowers").select("borrower_id, name").is("member_id", null).order("name"),
      supabase.from("borrowers").select("name, member_id").not("member_id", "is", null),
      getPendingBankInterestGroups()
    ])

    setPendingMembers(pendingMembersRes.data ?? [])
    setUnclaimedMembers(unclaimedMembersRes.data ?? [])
    setBanks(banksRes.data ?? [])

    if (pendingTxnsRes.error) {
      setLoadError(pendingTxnsRes.error.message)
      setPendingTransactions([])
    } else {
      setLoadError("")
      setPendingTransactions(pendingTxnsRes.data ?? [])
    }

    setBorrowerMembers(borrowerMembersRes.data ?? [])
    setUnclaimedBorrowers(unclaimedBorrowersRes.data ?? [])
    setLinkedLoanNameByMemberId(
      Object.fromEntries((linkedBorrowersRes.data ?? []).map((b: any) => [b.member_id as string, b.name as string]))
    )

    setPendingGroups(pendingGroupsRes)
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

  // ---- Members ----

  async function approveMember(memberId: string) {
    setMemberBusyId(memberId)
    await supabase.from("members").update({ status: "approved" }).eq("member_id", memberId)
    setMemberBusyId(null)
    loadData()
  }

  async function linkMember(pendingId: string) {
    const targetId = memberLinkChoice[pendingId]
    if (!targetId) return

    setMemberBusyId(pendingId)
    const { error } = await supabase.rpc("admin_link_member", {
      p_pending_member_id: pendingId,
      p_target_member_id: targetId
    })
    setMemberBusyId(null)

    if (error) {
      setLoadError(error.message)
      return
    }

    loadData()
  }

  // ---- Transactions ----

  async function approveTransaction(transactionId: string) {
    const txn = pendingTransactions.find((t) => t.transaction_id === transactionId)
    if (!txn) return

    if (txn.classification === "Member Withdrawal") {
      const bankAccountId = withdrawalBankSelections[transactionId]
      if (!bankAccountId) return
      await supabase
        .from("transactions")
        .update({ status: "approved", bank_account_id: bankAccountId })
        .eq("transaction_id", transactionId)
    } else if (txn.classification === "Loan Release") {
      // Approving a Loan Release now does the same two updates
      // loans/[id]'s "Approve & Activate" does -- activates the loan AND
      // records the disbursing bank on the release transaction -- instead
      // of only marking the transaction approved and leaving the loan
      // stuck at "requested" (the previous behavior here).
      const bankAccountId = loanReleaseBankSelections[transactionId]
      if (!bankAccountId || !txn.loan_id) return
      await supabase.from("loans").update({ status: "active" }).eq("loan_id", txn.loan_id)
      await supabase
        .from("transactions")
        .update({ status: "approved", bank_account_id: bankAccountId })
        .eq("transaction_id", transactionId)
    } else {
      await supabase.from("transactions").update({ status: "approved" }).eq("transaction_id", transactionId)
    }

    loadData()
  }

  async function rejectTransaction(transactionId: string) {
    await supabase.from("transactions").update({ status: "rejected" }).eq("transaction_id", transactionId)
    loadData()
  }

  // ---- Borrowers ----

  async function approveBorrower(memberId: string) {
    setBorrowerBusyId(memberId)
    await supabase.from("members").update({ status: "approved" }).eq("member_id", memberId)

    const chosenBorrowerId = borrowerLinkChoice[memberId]
    if (chosenBorrowerId) {
      await supabase.from("borrowers").update({ member_id: memberId }).eq("borrower_id", chosenBorrowerId)
    }

    setBorrowerBusyId(null)
    loadData()
  }

  // ---- Export ----

  function csvCell(value: unknown): string {
    const str = value === null || value === undefined ? "" : String(value)
    return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str
  }

  // Full history including approved/rejected/cancelled rows, unlike the
  // pending-only queue above -- this is meant as a complete backup/audit
  // export replacing the manually maintained Excel sheet, not a working view.
  async function exportTransactionsCsv() {
    setExporting(true)
    setExportError("")

    const { data, error } = await supabase
      .from("transactions")
      .select(
        `
        txn_date,
        classification,
        status,
        amount,
        bank,
        description,
        members!transactions_member_id_fkey ( name ),
        submitted_by_member:members!transactions_submitted_by_fkey ( name ),
        loans!transactions_loan_id_fkey ( name ),
        investments!transactions_investment_id_fkey ( name ),
        from_bank_account:bank_accounts!transactions_bank_account_id_fkey ( bank_name, account_name ),
        to_bank_account:bank_accounts!transactions_to_bank_account_id_fkey ( bank_name, account_name ),
        created_at
      `
      )
      .order("txn_date", { ascending: true, nullsFirst: false })
      .order("created_at", { ascending: true })
      .range(0, 9999)

    setExporting(false)

    if (error) {
      setExportError(error.message)
      return
    }

    const headers = [
      "Date", "Type", "Status", "Member", "Amount", "Bank",
      "Transfer To", "Loan", "Investment", "Submitted By", "Description", "Recorded At"
    ]

    const rows = ((data ?? []) as unknown as ExportRow[]).map((t) => [
      t.txn_date ?? "",
      typeLabels[t.classification] || t.classification,
      t.status,
      t.members?.name ?? "",
      t.amount,
      // Legacy migrated rows carry the bank as plain text in `bank`; rows
      // created through the app link a real bank account via
      // bank_account_id instead -- same fallback used on /transactions.
      t.bank || t.from_bank_account?.account_name || t.from_bank_account?.bank_name || "",
      t.to_bank_account?.account_name || t.to_bank_account?.bank_name || "",
      t.loans?.name ?? "",
      t.investments?.name ?? "",
      t.submitted_by_member?.name ?? "",
      t.description ?? "",
      t.created_at ?? ""
    ])

    const csv = [headers, ...rows].map((row) => row.map(csvCell).join(",")).join("\n")
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" })
    const url = URL.createObjectURL(blob)
    const link = document.createElement("a")
    link.href = url
    link.download = `est-2017-transactions-${new Date().toISOString().slice(0, 10)}.csv`
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
  }

  // ---- Distributions ----

  async function distribute(group: PendingBankInterestGroup) {
    const key = `${group.year}-${group.bank}`
    setDistributingKey(key)
    await distributeBankInterestGroup(group)
    setDistributingKey(null)
    loadData()
  }

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
  const pendingBorrowers = borrowerMembers.filter((m) => m.status === "pending")

  if (checkingAccess) {
    return (
      <>
        <Navbar />
        <main className="min-h-screen bg-paper text-ink font-sans overflow-x-hidden">
          <div className="max-w-3xl mx-auto px-5 pt-10 pb-[calc(6rem+var(--dock-h)+env(safe-area-inset-bottom))]">
            <SkeletonCardList rows={3} />
          </div>
        </main>
      </>
    )
  }

  const tabs: { id: Tab; label: string; count: number }[] = [
    { id: "txns", label: "Txns", count: pendingTransactions.length },
    { id: "distrib", label: "Distrib.", count: pendingGroups.length },
    { id: "members", label: "Members", count: pendingMembers.length },
    { id: "borrowers", label: "Borrowers", count: pendingBorrowers.length }
  ]

  return (
    <>
      <Navbar />
      <main className="min-h-screen bg-paper text-ink font-sans overflow-x-hidden">
        <div className="max-w-3xl mx-auto px-5 pt-10 pb-[calc(6rem+var(--dock-h)+env(safe-area-inset-bottom))]">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="text-[11px] tracking-[0.18em] uppercase text-gold font-mono mb-2">
                Administration
              </div>
              <h1 className="font-display text-4xl font-semibold">Admin Panel</h1>
              <p className="text-sm text-ink-soft mt-2 max-w-md">
                Everything waiting on you: new signups, transactions to approve, borrower accounts to link, and
                bank interest ready to split across members.
              </p>
            </div>

            {/* Page-level action, not scoped to any tab -- always exports the
                full transaction history regardless of what's active below.
                Kept up here in the header, away from the tab content, so it
                doesn't read as "export this tab". */}
            <button
              onClick={exportTransactionsCsv}
              disabled={exporting}
              className="shrink-0 inline-flex items-center gap-1.5 text-xs font-medium text-ink-soft border border-hairline rounded-md px-3 py-2 hover:bg-paper-2 hover:text-ink transition-colors disabled:opacity-60"
              title="Export full transaction history (every status, not just what's shown below) as a CSV backup"
            >
              {exporting ? "Exporting..." : "⬇ Export"}
            </button>
          </div>
          {exportError && (
            <p className="mt-1.5 text-xs text-rust text-right">Couldn&apos;t export: {exportError}</p>
          )}

          {loadError && (
            <p className="mt-4 text-sm text-rust">Couldn&apos;t load some data: {loadError}</p>
          )}

          {/* Segmented control */}
          <div className="mt-6 flex bg-paper-2 border border-hairline rounded-md p-[3px]">
            {tabs.map((t) => (
              <button
                key={t.id}
                onClick={() => {
                  setActiveTab(t.id)
                  window.scrollTo(0, 0)
                }}
                className={`flex-1 py-2.5 rounded-[6px] text-sm font-semibold transition-colors ${
                  activeTab === t.id ? "bg-paper text-ink shadow-sm" : "text-ink-soft"
                }`}
              >
                {t.label}
                {t.count > 0 && (
                  <span className={activeTab === t.id ? "text-gold" : "text-ink-soft"}> {t.count}</span>
                )}
              </button>
            ))}
          </div>

          {/* ---- Members ---- */}
          {activeTab === "members" && (
            <section className="mt-6">
              {pendingMembers.length > 0 && (
                <input
                  className="border border-hairline bg-paper-2 text-ink text-sm rounded-md px-3 py-2 w-full"
                  placeholder="Search by name or email"
                  value={memberSearch}
                  onChange={(e) => setMemberSearch(e.target.value)}
                />
              )}

              <div className="mt-3 space-y-3">
                {filteredMembers.map((m) => (
                  <details key={m.member_id} className="group bg-paper-2 border border-hairline rounded-md overflow-hidden">
                    <summary className="p-4 flex items-start gap-3 cursor-pointer list-none [&::-webkit-details-marker]:hidden">
                      <div className="min-w-0 flex-1">
                        <p className="font-display font-medium truncate">{m.name}</p>
                        <p className="text-sm text-ink-soft truncate">{m.email}</p>
                        <p className="text-[11px] text-ink-soft font-mono mt-0.5">{timeAgo(m.created_at)}</p>
                      </div>
                      <span className="shrink-0 mt-0.5 inline-flex items-center gap-1 text-[11px] font-mono uppercase tracking-wide text-gold border border-gold rounded-full px-2.5 py-1">
                        <span className="group-open:hidden">Review</span>
                        <span className="hidden group-open:inline">Close</span>
                        <span className="inline-block transition-transform group-open:rotate-180">▾</span>
                      </span>
                    </summary>

                    <div className="px-4 pb-4 border-t border-hairline pt-3">
                      {unclaimedMembers.length > 0 && (
                        <div className="mb-3">
                          <label className="block mb-1 text-xs uppercase tracking-wide text-ink-soft font-mono">
                            Link to existing member
                          </label>
                          <p className="text-xs text-ink-soft mb-2">
                            If this signup is actually one of the fund&apos;s existing members, link it to their
                            record so their contributions, loans and investments carry over.
                          </p>
                          <select
                            className="border border-hairline bg-paper text-ink text-sm rounded-md px-3 py-2 w-full"
                            value={memberLinkChoice[m.member_id] || ""}
                            onChange={(e) =>
                              setMemberLinkChoice((prev) => ({ ...prev, [m.member_id]: e.target.value }))
                            }
                          >
                            <option value="">Select a member</option>
                            {unclaimedMembers.map((um: any) => (
                              <option key={um.member_id} value={um.member_id}>
                                {um.name}
                              </option>
                            ))}
                          </select>
                        </div>
                      )}

                      <div className="flex gap-2 flex-wrap">
                        <button
                          className="bg-ink text-paper px-4 py-2 rounded-md text-sm disabled:opacity-50"
                          onClick={() => approveMember(m.member_id)}
                          disabled={memberBusyId === m.member_id}
                        >
                          {memberBusyId === m.member_id ? "Approving..." : "Approve as new"}
                        </button>
                        {memberLinkChoice[m.member_id] && (
                          <button
                            className="border border-hairline px-4 py-2 rounded-md text-sm disabled:opacity-50"
                            onClick={() => linkMember(m.member_id)}
                            disabled={memberBusyId === m.member_id}
                          >
                            {memberBusyId === m.member_id ? "Linking..." : "Link & approve"}
                          </button>
                        )}
                      </div>
                    </div>
                  </details>
                ))}
                {pendingMembers.length === 0 && <p className="text-sm text-ink-soft">No pending members</p>}
                {pendingMembers.length > 0 && filteredMembers.length === 0 && (
                  <p className="text-sm text-ink-soft">No matches for &quot;{memberSearch}&quot;</p>
                )}
              </div>

              <button
                onClick={() => router.push("/admin/members")}
                className="mt-4 text-sm text-gold hover:underline"
              >
                Manage all members →
              </button>
            </section>
          )}

          {/* ---- Transactions ---- */}
          {activeTab === "txns" && (
            <section className="mt-6">
              {pendingTransactions.length > 0 && (
                <div className="flex flex-col sm:flex-row gap-3">
                  <input
                    className="border border-hairline bg-paper-2 text-ink text-sm rounded-md px-3 py-2 flex-1"
                    placeholder="Search by member, description, or amount"
                    value={txnSearch}
                    onChange={(e) => setTxnSearch(e.target.value)}
                  />
                  <select
                    className="border border-hairline bg-paper-2 text-ink text-sm rounded-md px-3 py-2"
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
              )}

              <div className="mt-3 space-y-3">
                {filteredTransactions.map((t) => {
                  const needsWithdrawalBank = t.classification === "Member Withdrawal"
                  const needsLoanBank = t.classification === "Loan Release"

                  return (
                    <details key={t.transaction_id} className="group bg-paper-2 border border-hairline rounded-md overflow-hidden">
                      <summary className="p-4 flex items-start gap-3 cursor-pointer list-none [&::-webkit-details-marker]:hidden">
                        <div className="min-w-0 flex-1">
                          <p className="font-display font-medium truncate">{t.members?.name || "Fund"}</p>
                          {t.submitted_by_member && (
                            <p className="text-[11px] text-gold font-mono truncate">Recorded by {t.submitted_by_member.name}</p>
                          )}
                          <p className="text-sm font-mono">₱{fmt(Math.abs(t.amount))}</p>
                          <p className="text-sm text-ink-soft">
                            {typeLabels[t.classification] || t.classification}
                            {needsLoanBank && " · requested"}
                            {needsWithdrawalBank && !t.bank_account_id && " · unconfirmed bank"}
                          </p>
                        </div>
                        <span className="shrink-0 mt-0.5 inline-flex items-center gap-1 text-[11px] font-mono uppercase tracking-wide text-gold border border-gold rounded-full px-2.5 py-1">
                          <span className="group-open:hidden">Review</span>
                          <span className="hidden group-open:inline">Close</span>
                          <span className="inline-block transition-transform group-open:rotate-180">▾</span>
                        </span>
                      </summary>

                      <div className="px-4 pb-4 border-t border-hairline pt-3">
                        {t.description && <p className="text-sm text-ink-soft mb-2">{t.description}</p>}
                        {!needsLoanBank && (
                          <p className="text-sm text-ink-soft mb-2">
                            Bank: {t.bank_accounts?.account_name || t.bank_accounts?.bank_name || "None"}
                          </p>
                        )}
                        {t.receipt_url && (
                          <button
                            type="button"
                            onClick={() => setOpenReceiptUrl(t.receipt_url)}
                            className="mb-3 inline-flex items-center gap-1.5 text-xs font-mono text-gold border border-gold rounded-full px-3 py-1.5 hover:bg-gold/10 transition-colors"
                          >
                            🧾 View Receipt
                          </button>
                        )}

                        {needsWithdrawalBank && (
                          <div className="mb-3">
                            <label className="block mb-1 text-xs uppercase tracking-wide text-ink-soft font-mono">
                              Withdraw from bank
                            </label>
                            <select
                              className="border border-hairline bg-paper text-ink text-sm rounded-md px-3 py-2 w-full"
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

                        {needsLoanBank && (
                          <div className="mb-3">
                            <p className="text-xs text-gold bg-gold/10 border border-gold rounded-md px-3 py-2 mb-2">
                              Approving here activates the loan and records the disbursing bank in one step,
                              instead of separately on the loan&apos;s own page.
                            </p>
                            <label className="block mb-1 text-xs uppercase tracking-wide text-ink-soft font-mono">
                              Disburse from bank
                            </label>
                            <select
                              className="border border-hairline bg-paper text-ink text-sm rounded-md px-3 py-2 w-full"
                              value={loanReleaseBankSelections[t.transaction_id] || ""}
                              onChange={(e) =>
                                setLoanReleaseBankSelections((prev) => ({ ...prev, [t.transaction_id]: e.target.value }))
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

                        <div className="flex gap-2">
                          <button
                            className="bg-ink text-paper px-4 py-2 rounded-md text-sm disabled:opacity-50"
                            onClick={() => approveTransaction(t.transaction_id)}
                            disabled={
                              (needsWithdrawalBank && !withdrawalBankSelections[t.transaction_id]) ||
                              (needsLoanBank && !loanReleaseBankSelections[t.transaction_id])
                            }
                          >
                            {needsLoanBank ? "Approve & activate" : "Approve"}
                          </button>
                          <button
                            className="border border-hairline px-4 py-2 rounded-md text-sm"
                            onClick={() => rejectTransaction(t.transaction_id)}
                          >
                            Reject
                          </button>
                        </div>
                      </div>
                    </details>
                  )
                })}
                {pendingTransactions.length === 0 && !loadError && (
                  <p className="text-sm text-ink-soft">No pending transactions</p>
                )}
                {pendingTransactions.length > 0 && filteredTransactions.length === 0 && (
                  <p className="text-sm text-ink-soft">No matches for current search/filter</p>
                )}
              </div>

              {pendingTransactions.length > 0 && (
                <p className="mt-3 text-xs text-ink-soft font-mono">
                  {filteredTransactions.length} of {pendingTransactions.length} · ₱{fmt(pendingAmountTotal)} pending total
                </p>
              )}

              <button
                onClick={() => router.push("/fund-breakdown?tab=loans")}
                className="mt-4 text-sm text-gold hover:underline"
              >
                View all loans →
              </button>
            </section>
          )}

          {/* ---- Borrowers ---- */}
          {activeTab === "borrowers" && (
            <section className="mt-6 space-y-3">
              {pendingBorrowers.map((m) => {
                const linkedName = linkedLoanNameByMemberId[m.member_id]
                return (
                  <div key={m.member_id} className="bg-paper-2 border border-hairline rounded-md p-4">
                    <p className="font-display font-medium break-words">{m.name}</p>
                    <p className="text-sm text-ink-soft break-words">{m.email || "No email"}</p>
                    <p className="text-[11px] text-ink-soft font-mono mt-0.5">requests borrower access · {timeAgo(m.created_at)}</p>

                    {linkedName ? (
                      <p className="mt-3 text-xs text-sage font-mono">Linked to loan record: {linkedName}</p>
                    ) : (
                      <div className="mt-3">
                        <label className="block mb-1 text-xs uppercase tracking-wide text-ink-soft font-mono">
                          Link to an existing loan record (optional)
                        </label>
                        <select
                          className="border border-hairline bg-paper text-ink text-sm rounded-md px-3 py-2 w-full"
                          value={borrowerLinkChoice[m.member_id] ?? ""}
                          onChange={(e) =>
                            setBorrowerLinkChoice((prev) => ({ ...prev, [m.member_id]: e.target.value }))
                          }
                        >
                          <option value="">No existing loan record</option>
                          {unclaimedBorrowers.map((b: any) => (
                            <option key={b.borrower_id} value={b.borrower_id}>
                              {b.name}
                            </option>
                          ))}
                        </select>
                      </div>
                    )}

                    <button
                      className="mt-3 bg-ink text-paper px-4 py-2 rounded-md text-sm disabled:opacity-50"
                      onClick={() => approveBorrower(m.member_id)}
                      disabled={borrowerBusyId === m.member_id}
                    >
                      {borrowerBusyId === m.member_id
                        ? "Approving..."
                        : borrowerLinkChoice[m.member_id]
                        ? "Approve & link"
                        : "Approve"}
                    </button>
                  </div>
                )
              })}
              {pendingBorrowers.length === 0 && <p className="text-sm text-ink-soft">No pending borrower signups</p>}

              <button
                onClick={() => router.push("/admin/borrowers")}
                className="text-sm text-gold hover:underline"
              >
                View all borrowers →
              </button>
            </section>
          )}

          {/* ---- Distributions ---- */}
          {activeTab === "distrib" && (
            <section className="mt-6 space-y-3">
              <p className="text-sm text-ink-soft">Approved interest that hasn&apos;t been split across members yet.</p>
              {pendingGroups.map((group) => {
                const key = `${group.year}-${group.bank}`
                return (
                  <div key={key} className="bg-paper-2 border border-hairline rounded-md p-4 flex items-center justify-between gap-3">
                    <div>
                      <p className="text-[11px] uppercase tracking-wide text-ink-soft font-mono">
                        {group.bank} · {group.year}
                      </p>
                      <p className="font-mono [font-variant-numeric:tabular-nums] text-xl font-bold text-ink">
                        ₱{fmt(Math.abs(group.totalAmount))}
                      </p>
                      <p className="text-xs text-ink-soft mt-0.5">
                        {group.transactionCount} transaction{group.transactionCount === 1 ? "" : "s"} combined
                      </p>
                    </div>
                    <button
                      className="shrink-0 bg-ink text-paper px-4 py-2 rounded-md text-sm disabled:opacity-50"
                      onClick={() => distribute(group)}
                      disabled={distributingKey === key}
                    >
                      {distributingKey === key ? "Distributing..." : "Distribute"}
                    </button>
                  </div>
                )
              })}
              {pendingGroups.length === 0 && <p className="text-sm text-ink-soft">Nothing waiting to be distributed</p>}

              <button
                onClick={() => router.push("/fund-breakdown?tab=banks")}
                className="text-sm text-gold hover:underline"
              >
                View bank interest history →
              </button>
            </section>
          )}

        </div>
      </main>

      {openReceiptUrl && <ReceiptModal path={openReceiptUrl} onClose={() => setOpenReceiptUrl(null)} />}
    </>
  )
}
