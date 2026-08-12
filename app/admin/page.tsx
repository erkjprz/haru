"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { supabase } from "@/lib/supabase"
import Navbar from "@/app/components/Navbar"
import ReceiptModal from "@/app/components/ReceiptModal"
import { useAuth } from "@/app/auth-context"
import { SkeletonCardList } from "@/app/components/Skeleton"
import { getPendingBankInterestGroups, distributeBankInterestGroup, type PendingBankInterestGroup } from "@/lib/bankInterest"
import { SupportPanel } from "@/app/components/admin/SupportPanel"
import { FlowBadge } from "@/app/components/TransactionFormUI"
import { approveLoanRelease } from "@/lib/approveLoan"
import { approveBorrowerMember } from "@/lib/approveBorrower"
import { dateOnly } from "@/lib/currentValue"
import { TRANSACTION_TYPE_LABELS as typeLabels } from "@/lib/transactionLabels"

// Same in/out vocabulary as the transaction edit page's FLOW map -- money
// coming in (Contribution, Loan Repayment) has nothing left for an admin
// to decide, money going out (Withdrawal, Loan Release) always needs a
// disbursing bank picked, which is exactly the bulk/review split below.
const FLOW: Record<string, { arrow: string; tone: "in" | "out" | "neutral" }> = {
  "Member Contribution": { arrow: "↑", tone: "in" },
  "Member Withdrawal": { arrow: "↓", tone: "out" },
  "Loan Repayment": { arrow: "↑", tone: "in" },
  "Loan Release": { arrow: "↓", tone: "out" },
  "Investment Return": { arrow: "↑", tone: "in" }
}

// Contribution and Loan Repayment are both money coming in with nothing
// left for an admin to decide -- no bank to pick, no loan to activate --
// so they're safe to wave through in a batch. Withdrawal and Loan Release
// are money going out and always need an admin to choose which fund bank
// it's paid from (Loan Release also activates the loan), so they stay in
// the one-at-a-time review list. Shared between the bulk/review split
// below and approveBulkSelected's own query filter, so a tampered
// selectedBulkIds can't blanket-approve either of those two.
const BULK_CLASSIFICATIONS = new Set(["Member Contribution", "Loan Repayment"])

type Tab = "members" | "txns" | "borrowers" | "distrib" | "support"

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
  // Remembers which approvals sub-tab was open before switching to Support,
  // so coming back to "Approvals" restores it instead of always resetting
  // to Txns.
  const [lastApprovalsTab, setLastApprovalsTab] = useState<Exclude<Tab, "support">>("txns")

  const [pendingMembers, setPendingMembers] = useState<any[]>([])
  const [unclaimedMembers, setUnclaimedMembers] = useState<any[]>([])
  const [memberLinkChoice, setMemberLinkChoice] = useState<Record<string, string>>({})
  const [memberBusyId, setMemberBusyId] = useState<string | null>(null)

  const [pendingTransactions, setPendingTransactions] = useState<any[]>([])
  const [banks, setBanks] = useState<any[]>([])
  const [withdrawalBankSelections, setWithdrawalBankSelections] = useState<Record<string, string>>({})
  const [loanReleaseBankSelections, setLoanReleaseBankSelections] = useState<Record<string, string>>({})
  const [approvalReceipts, setApprovalReceipts] = useState<Record<string, File>>({})
  const [uploadingReceiptId, setUploadingReceiptId] = useState<string | null>(null)
  const [selectedBulkIds, setSelectedBulkIds] = useState<Set<string>>(new Set())
  const [bulkApproving, setBulkApproving] = useState(false)
  const [rejectingId, setRejectingId] = useState<string | null>(null)
  const [rejectReason, setRejectReason] = useState("")
  const [editAmounts, setEditAmounts] = useState<Record<string, string>>({})
  const [editInterestRate, setEditInterestRate] = useState<Record<string, string>>({})
  const [editInterestAmount, setEditInterestAmount] = useState<Record<string, string>>({})
  const [editTermMonths, setEditTermMonths] = useState<Record<string, string>>({})
  const [savingEditId, setSavingEditId] = useState<string | null>(null)

  const [borrowerMembers, setBorrowerMembers] = useState<any[]>([])
  const [unclaimedBorrowers, setUnclaimedBorrowers] = useState<any[]>([])
  const [linkedLoanNameByMemberId, setLinkedLoanNameByMemberId] = useState<Record<string, string>>({})
  const [borrowerLinkChoice, setBorrowerLinkChoice] = useState<Record<string, string>>({})
  const [borrowerBusyId, setBorrowerBusyId] = useState<string | null>(null)

  const [pendingGroups, setPendingGroups] = useState<PendingBankInterestGroup[]>([])
  const [distributingKey, setDistributingKey] = useState<string | null>(null)
  const [distributeError, setDistributeError] = useState("")

  const [loadError, setLoadError] = useState("")
  const [actionError, setActionError] = useState("")
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
      // role='borrower' pending signups are handled entirely by the
      // Borrowers tab (which offers borrower-record linking the generic
      // Members tab doesn't) -- excluded here so a pending borrower isn't
      // double-counted across both tabs' totals, or approved through the
      // wrong tab and skip the chance to link their loan history.
      supabase
        .from("members")
        .select("*")
        .eq("status", "pending")
        .neq("role", "borrower")
        .order("created_at", { ascending: false }),
      supabase.rpc("list_unclaimed_members"),
      supabase.from("bank_accounts").select("id, bank_name, account_name").order("bank_name"),
      supabase
        .from("transactions")
        .select(
          `
          *,
          members!transactions_member_id_fkey ( name, email ),
          submitted_by_member:members!transactions_submitted_by_fkey ( name ),
          bank_accounts!transactions_bank_account_id_fkey ( bank_name, account_name ),
          loans!transactions_loan_id_fkey ( interest_type, interest_rate, interest_amount, term_months ),
          investments!transactions_investment_id_fkey ( name )
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
      // getPendingBankInterestGroups() now throws on a query failure (see
      // its own comment) instead of silently returning an empty list --
      // caught and folded in here rather than left to reject the whole
      // Promise.all, which would otherwise take every other query on this
      // page down with it and leave loadData() stuck mid-await forever.
      getPendingBankInterestGroups().then(
        (groups) => ({ groups, error: null as string | null }),
        (err) => ({ groups: [] as PendingBankInterestGroup[], error: err instanceof Error ? err.message : "Something went wrong." })
      )
    ])

    setPendingMembers(pendingMembersRes.data ?? [])
    setUnclaimedMembers(unclaimedMembersRes.data ?? [])
    setBanks(banksRes.data ?? [])

    const combinedError = pendingTxnsRes.error?.message || pendingGroupsRes.error || ""
    setLoadError(combinedError)
    setPendingTransactions(pendingTxnsRes.error ? [] : pendingTxnsRes.data ?? [])

    setBorrowerMembers(borrowerMembersRes.data ?? [])
    setUnclaimedBorrowers(unclaimedBorrowersRes.data ?? [])
    setLinkedLoanNameByMemberId(
      Object.fromEntries((linkedBorrowersRes.data ?? []).map((b: any) => [b.member_id as string, b.name as string]))
    )

    setPendingGroups(pendingGroupsRes.groups)
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
    setActionError("")
    const { error } = await supabase.from("members").update({ status: "approved" }).eq("member_id", memberId)
    setMemberBusyId(null)

    if (error) {
      setActionError(error.message)
      return
    }

    loadData()
  }

  async function linkMember(pendingId: string) {
    const targetId = memberLinkChoice[pendingId]
    if (!targetId) return

    setMemberBusyId(pendingId)
    setActionError("")
    const { error } = await supabase.rpc("admin_link_member", {
      p_pending_member_id: pendingId,
      p_target_member_id: targetId
    })
    setMemberBusyId(null)

    if (error) {
      setActionError(error.message)
      return
    }

    loadData()
  }

  // ---- Transactions ----

  // Withdrawal and Loan Release move real money out of the fund, and until
  // now there was no evidence trail for it at all -- receipt_url stayed
  // null from submission straight through approval. Requires the admin to
  // attach proof of the actual outgoing transfer before either can be
  // approved, same storage bucket/naming convention member-side receipts
  // already use.
  async function uploadApprovalReceipt(file: File, memberId: string | null): Promise<string | null> {
    const fileName = `${memberId || "admin"}-${Date.now()}-${file.name}`
    const { error } = await supabase.storage.from("Receipts").upload(fileName, file, { contentType: file.type })
    if (error) {
      setActionError(error.message)
      return null
    }
    return fileName
  }

  async function approveTransaction(transactionId: string) {
    const txn = pendingTransactions.find((t) => t.transaction_id === transactionId)
    if (!txn) return

    setActionError("")

    // Tracked across both receipt-uploading branches below so the catch
    // handler can clean up an orphaned upload if the write after it fails.
    let uploadedReceiptUrl: string | null = null

    try {
      if (txn.classification === "Member Withdrawal") {
        const bankAccountId = withdrawalBankSelections[transactionId]
        const receiptFile = approvalReceipts[transactionId]
        if (!bankAccountId || !receiptFile) return

        setUploadingReceiptId(transactionId)
        const receiptUrl = await uploadApprovalReceipt(receiptFile, txn.member_id)
        setUploadingReceiptId(null)
        if (!receiptUrl) return
        uploadedReceiptUrl = receiptUrl

        const { error } = await supabase
          .from("transactions")
          .update({ status: "approved", bank_account_id: bankAccountId, receipt_url: receiptUrl })
          .eq("transaction_id", transactionId)
        if (error) throw error
      } else if (txn.classification === "Loan Release") {
        // Approving a Loan Release does the same thing loans/[id]'s
        // "Approve & Activate" does -- both call the same atomic RPC, which
        // verifies a pending disbursement transaction actually exists,
        // activates the loan, records the disbursing bank/receipt, and
        // freezes each eligible member's pool share for this loan's hold,
        // all in one DB transaction.
        const bankAccountId = loanReleaseBankSelections[transactionId]
        const receiptFile = approvalReceipts[transactionId]
        if (!bankAccountId || !receiptFile || !txn.loan_id) return

        setUploadingReceiptId(transactionId)
        const receiptUrl = await uploadApprovalReceipt(receiptFile, txn.member_id)
        setUploadingReceiptId(null)
        if (!receiptUrl) return
        uploadedReceiptUrl = receiptUrl

        await approveLoanRelease({
          loanId: txn.loan_id,
          borrowerMemberId: txn.member_id,
          bankAccountId,
          receiptUrl,
          releaseDate: dateOnly(new Date())
        })
      } else {
        const { error } = await supabase
          .from("transactions")
          .update({ status: "approved" })
          .eq("transaction_id", transactionId)
        if (error) throw error
      }
    } catch (err) {
      // The receipt already uploaded successfully above -- if the write it
      // belongs to failed, clean it up rather than leaving it orphaned in
      // the bucket.
      if (uploadedReceiptUrl) await supabase.storage.from("Receipts").remove([uploadedReceiptUrl])
      setActionError(err instanceof Error ? err.message : "Something went wrong.")
      return
    }

    setApprovalReceipts((prev) => {
      const next = { ...prev }
      delete next[transactionId]
      return next
    })
    loadData()
  }

  async function rejectTransaction(transactionId: string, reason: string) {
    const txn = pendingTransactions.find((t) => t.transaction_id === transactionId)
    const isLoanRelease = txn?.classification === "Loan Release" && txn.loan_id

    setActionError("")

    try {
      // transactions.loan_id has a foreign key into loans with no cascade, so
      // the reference has to be cleared before the loan row can be deleted --
      // same fix already used by the member-facing "Cancel entry" flow on
      // /transactions/[id]/edit.
      const trimmedReason = reason.trim() || null
      const { error: txnError } = await supabase
        .from("transactions")
        .update(
          isLoanRelease
            ? { status: "rejected", loan_id: null, rejection_reason: trimmedReason }
            : { status: "rejected", rejection_reason: trimmedReason }
        )
        .eq("transaction_id", transactionId)
      if (txnError) throw txnError

      // A rejected Loan Release never disbursed anything -- the loan it was
      // requesting has nothing else attached to it yet (no hold, no
      // repayments, no gain), so deleting it removes the request cleanly.
      // Leaving the loans row behind at "requested" would strand it with no
      // pending transaction to ever act on again, while LoanDetailPanel's
      // "Approve & Activate" would still be reachable on it -- clicking that
      // would flip the loan to "active" and snapshot a hold with no actual
      // disbursement transaction behind it.
      if (isLoanRelease) {
        const { error: loanError } = await supabase.from("loans").delete().eq("loan_id", txn.loan_id)
        if (loanError) throw loanError
      }
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Something went wrong.")
      return
    }

    // Rejecting a bulk row (Contribution/Loan Repayment) directly, without
    // going through the bulk bar, left its id checked in selectedBulkIds
    // even after it dropped out of pendingTransactions -- the sticky "N
    // selected" bar stayed stuck showing a row that no longer existed.
    setSelectedBulkIds((prev) => {
      if (!prev.has(transactionId)) return prev
      const next = new Set(prev)
      next.delete(transactionId)
      return next
    })

    setRejectingId(null)
    setRejectReason("")
    loadData()
  }

  function toggleBulkSelected(transactionId: string) {
    setSelectedBulkIds((prev) => {
      const next = new Set(prev)
      if (next.has(transactionId)) next.delete(transactionId)
      else next.add(transactionId)
      return next
    })
  }

  function toggleSelectAllBulk(visibleIds: string[]) {
    const allSelected = visibleIds.length > 0 && visibleIds.every((id) => selectedBulkIds.has(id))
    setSelectedBulkIds((prev) => {
      const next = new Set(prev)
      visibleIds.forEach((id) => (allSelected ? next.delete(id) : next.add(id)))
      return next
    })
  }

  async function approveBulkSelected() {
    const ids = Array.from(selectedBulkIds)
    if (ids.length === 0) return
    setBulkApproving(true)
    setActionError("")

    // The UI only ever offers bulk-select checkboxes for Contribution/Loan
    // Repayment rows, but selectedBulkIds is still just client state --
    // scoping the write itself to BULK_CLASSIFICATIONS means a stale or
    // tampered selection can't blanket-approve a Withdrawal or Loan Release,
    // which would skip the bank/receipt evidence requirement entirely, and
    // for Loan Release, skip the atomic RPC that actually activates the loan.
    const { data, error } = await supabase
      .from("transactions")
      .update({ status: "approved" })
      .in("transaction_id", ids)
      .in("classification", Array.from(BULK_CLASSIFICATIONS))
      .select("transaction_id")

    setBulkApproving(false)

    if (error) {
      setActionError(error.message)
      return
    }

    if (!data || data.length !== ids.length) {
      setActionError(
        "Some selected transactions couldn't be bulk-approved and were skipped -- use the individual review flow for those instead."
      )
    }

    setSelectedBulkIds(new Set())
    loadData()
  }

  // Withdrawal and Loan Release amounts (and, for Loan Release, the loan's
  // own terms) are editable in the review card before approval -- a
  // separate Save step, not bundled into Approve, so an admin can fix a
  // borrower's typo without also having picked a bank yet. Loan Release
  // duplicates the amount across transactions.amount (negative, cash out)
  // and loans.principal (positive) -- both need to move together.
  async function saveTransactionEdit(t: any) {
    const id = t.transaction_id
    const amountStr = editAmounts[id]
    const newAmount = amountStr !== undefined && amountStr !== "" ? Number(amountStr) : Math.abs(Number(t.amount))
    if (!Number.isFinite(newAmount) || newAmount <= 0) return

    setSavingEditId(id)
    setActionError("")

    try {
      const signedAmount = Number(t.amount) < 0 ? -newAmount : newAmount
      const { error: txnError } = await supabase.from("transactions").update({ amount: signedAmount }).eq("transaction_id", id)
      if (txnError) throw txnError

      if (t.classification === "Loan Release" && t.loan_id) {
        const loanUpdate: Record<string, number> = { principal: newAmount }

        if (t.loans?.interest_type === "amount") {
          const v = editInterestAmount[id]
          if (v !== undefined && v !== "") loanUpdate.interest_amount = Number(v)
        } else {
          const v = editInterestRate[id]
          if (v !== undefined && v !== "") loanUpdate.interest_rate = Number(v)
        }

        const termV = editTermMonths[id]
        if (termV !== undefined && termV !== "") loanUpdate.term_months = Number(termV)

        const { error: loanError } = await supabase.from("loans").update(loanUpdate).eq("loan_id", t.loan_id)
        if (loanError) throw loanError
      }
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Something went wrong.")
      setSavingEditId(null)
      return
    }

    setSavingEditId(null)
    setEditAmounts((prev) => { const next = { ...prev }; delete next[id]; return next })
    setEditInterestRate((prev) => { const next = { ...prev }; delete next[id]; return next })
    setEditInterestAmount((prev) => { const next = { ...prev }; delete next[id]; return next })
    setEditTermMonths((prev) => { const next = { ...prev }; delete next[id]; return next })
    loadData()
  }

  // ---- Borrowers ----

  async function approveBorrower(memberId: string) {
    setBorrowerBusyId(memberId)
    setActionError("")

    try {
      await approveBorrowerMember(memberId, borrowerLinkChoice[memberId])
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Something went wrong.")
      setBorrowerBusyId(null)
      return
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

    // Supabase/PostgREST caps how many rows a single request can return
    // (1000 by default) regardless of the .range() asked for, and just
    // silently returns fewer rows rather than erroring -- a single
    // .range(0, 9999) request was quietly getting truncated to the
    // oldest 1000 rows only, dropping everything more recent. Paginate
    // in pages of 1000 instead, accumulating every page, and only stop
    // once a page comes back short (including possibly-empty) -- that's
    // the only reliable "no more rows" signal regardless of the actual
    // server-side cap.
    const PAGE_SIZE = 1000
    const allRows: ExportRow[] = []
    let from = 0

    while (true) {
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
        .range(from, from + PAGE_SIZE - 1)

      if (error) {
        setExporting(false)
        setExportError(error.message)
        return
      }

      const batch = (data ?? []) as unknown as ExportRow[]
      allRows.push(...batch)

      if (batch.length < PAGE_SIZE) break
      from += PAGE_SIZE
    }

    setExporting(false)

    const headers = [
      "Date", "Type", "Status", "Member", "Amount", "Bank",
      "Transfer To", "Loan", "Investment", "Submitted By", "Description", "Recorded At"
    ]

    const rows = allRows.map((t) => [
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
    setDistributeError("")

    try {
      await distributeBankInterestGroup(group)
      loadData()
    } catch (err) {
      setDistributeError(err instanceof Error ? err.message : "Something went wrong.")
    } finally {
      setDistributingKey(null)
    }
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

  const bulkTransactions = filteredTransactions.filter((t) => BULK_CLASSIFICATIONS.has(t.classification))
  const reviewTransactions = filteredTransactions.filter((t) => !BULK_CLASSIFICATIONS.has(t.classification))

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

  // Support isn't an approval queue like the other four -- it's a tool you
  // reach for, not a queue that reaches for you -- so it never carries a
  // count. It still gets equal billing as a top-level tab (see topTabs
  // below) rather than a header button, so it isn't easy to miss.
  const tabs: { id: Exclude<Tab, "support">; label: string; count: number }[] = [
    { id: "txns", label: "Txns", count: pendingTransactions.length },
    { id: "distrib", label: "Distrib.", count: pendingGroups.length },
    { id: "members", label: "Members", count: pendingMembers.length },
    { id: "borrowers", label: "Borrowers", count: pendingBorrowers.length }
  ]
  const totalApprovalsCount = tabs.reduce((sum, t) => sum + t.count, 0)

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

            {/* Page-level action, not scoped to any tab -- always exports
                the full transaction history regardless of what's active
                below. Kept up here in the header, away from the tab
                content, so it doesn't read as "export this tab". */}
            <button
              onClick={exportTransactionsCsv}
              disabled={exporting}
              className="shrink-0 inline-flex items-center gap-1.5 text-xs font-medium text-ink-soft border border-hairline rounded-md px-3 py-2 hover:bg-paper-2 hover:text-ink transition-colors disabled:opacity-60"
              title="Export full transaction history (every status, not just what's shown below) as a CSV backup"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5">
                <path d="M12 3v13M7 11l5 5 5-5M5 20h14" />
              </svg>
              {exporting ? "Exporting..." : "Export"}
            </button>
          </div>
          {exportError && (
            <p className="mt-1.5 text-xs text-rust text-right">Couldn&apos;t export: {exportError}</p>
          )}

          {loadError && (
            <p className="mt-4 text-sm text-rust">Couldn&apos;t load some data: {loadError}</p>
          )}

          {actionError && <p className="mt-4 text-sm text-rust">{actionError}</p>}

          {/* Top-level section nav -- plain underline tabs, matching
              Breakdown's page-level pattern, distinct from the pill toggle
              nested inside Approvals below. Support sits here as an equal
              peer tab instead of a header button. */}
          <div className="mt-6 flex border-b border-hairline">
            <button
              onClick={() => {
                setActiveTab(lastApprovalsTab)
                window.scrollTo(0, 0)
              }}
              className={`flex-1 text-[14px] font-semibold pt-1 pb-2.5 border-b-2 -mb-px transition-colors ${
                activeTab !== "support" ? "text-ink border-gold" : "text-ink-soft border-transparent"
              }`}
            >
              Approvals
              {totalApprovalsCount > 0 && (
                <span
                  className={`ml-1.5 text-[10px] font-mono font-bold rounded-full px-1.5 py-0.5 ${
                    activeTab !== "support" ? "text-gold bg-gold/15" : "text-ink-soft bg-ink-soft/10"
                  }`}
                >
                  {totalApprovalsCount}
                </span>
              )}
            </button>
            <button
              onClick={() => {
                setActiveTab("support")
                window.scrollTo(0, 0)
              }}
              className={`flex-1 text-[14px] font-semibold pt-1 pb-2.5 border-b-2 -mb-px transition-colors ${
                activeTab === "support" ? "text-ink border-gold" : "text-ink-soft border-transparent"
              }`}
            >
              🔧 Support
            </button>
          </div>

          {/* Segmented control -- hidden while Support is active, nested
              one level inside the "Approvals" top tab. */}
          {activeTab !== "support" && (
          <div className="mt-4 flex bg-paper-2 border border-hairline rounded-md p-[3px]">
            {tabs.map((t) => (
              <button
                key={t.id}
                onClick={() => {
                  setActiveTab(t.id)
                  setLastApprovalsTab(t.id)
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
          )}

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
                    {Object.keys(FLOW).map((key) => (
                      <option key={key} value={key}>
                        {typeLabels[key]}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div className="mt-3 space-y-6">
                {bulkTransactions.length > 0 && (
                  <div>
                    <div className="flex items-center justify-between gap-3">
                      <label className="flex items-center gap-2.5 text-sm font-semibold cursor-pointer">
                        <input
                          type="checkbox"
                          className="w-[18px] h-[18px] accent-ink shrink-0"
                          checked={bulkTransactions.every((t) => selectedBulkIds.has(t.transaction_id))}
                          onChange={() => toggleSelectAllBulk(bulkTransactions.map((t) => t.transaction_id))}
                        />
                        Contributions &amp; Loan Repayments
                      </label>
                      <span className="shrink-0 text-[11px] font-mono uppercase tracking-wide text-ink-soft border border-hairline rounded-full px-2.5 py-1">
                        {bulkTransactions.length} pending
                      </span>
                    </div>
                    <p className="mt-1.5 text-xs text-ink-soft">
                      Money already confirmed in the bank — nothing left to decide, just to confirm.
                    </p>

                    <div className="mt-3 border-t border-hairline">
                      {bulkTransactions.map((t) => (
                        <div key={t.transaction_id} className="border-b border-hairline">
                          <div className="flex items-center gap-3 py-3">
                            <input
                              type="checkbox"
                              className="w-[18px] h-[18px] accent-ink shrink-0"
                              checked={selectedBulkIds.has(t.transaction_id)}
                              onChange={() => toggleBulkSelected(t.transaction_id)}
                            />
                            <FlowBadge {...(FLOW[t.classification] ?? { arrow: "•", tone: "in" })} small />
                            <div className="min-w-0 flex-1">
                              <p className="font-display font-medium truncate">{t.members?.name || "Fund"}</p>
                              <p className="text-xs text-ink-soft">
                                {typeLabels[t.classification] || t.classification}
                                {t.bank_accounts && ` · ${t.bank_accounts.account_name || t.bank_accounts.bank_name}`}
                              </p>
                            </div>
                            <div className="shrink-0 text-right">
                              <p className="text-sm font-mono">₱{fmt(Math.abs(t.amount))}</p>
                              <div className="flex items-center justify-end gap-2 mt-0.5">
                                {t.receipt_url && (
                                  <button
                                    type="button"
                                    onClick={() => setOpenReceiptUrl(t.receipt_url)}
                                    className="text-[11px] text-gold hover:underline"
                                  >
                                    🧾 Receipt
                                  </button>
                                )}
                                <button
                                  type="button"
                                  onClick={() => {
                                    setRejectingId(t.transaction_id)
                                    setRejectReason("")
                                  }}
                                  className="text-[11px] text-ink-soft hover:text-rust hover:underline"
                                >
                                  Reject
                                </button>
                              </div>
                            </div>
                          </div>
                          {rejectingId === t.transaction_id && (
                            <RejectReasonPrompt
                              reason={rejectReason}
                              onChangeReason={setRejectReason}
                              onCancel={() => {
                                setRejectingId(null)
                                setRejectReason("")
                              }}
                              onConfirm={() => rejectTransaction(t.transaction_id, rejectReason)}
                            />
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Sticky and placed right after the bulk list, not after
                    the whole page, so it's still visible while scrolling
                    through a long review section below -- a sticky element
                    only starts pinning once you've scrolled past where it
                    would normally sit, so putting it after everything else
                    meant it stayed invisible until you'd scrolled past all
                    the review cards too. */}
                {selectedBulkIds.size > 0 && (
                  <div className="sticky bottom-4 z-10 flex items-center justify-between gap-3 bg-ink text-paper rounded-md px-4 py-3 shadow-lg">
                    <span className="text-sm font-mono">{selectedBulkIds.size} selected</span>
                    <div className="flex gap-2">
                      <button
                        className="border border-paper/30 text-paper px-3 py-2 rounded-md text-sm"
                        onClick={() => setSelectedBulkIds(new Set())}
                      >
                        Clear
                      </button>
                      <button
                        className="bg-paper text-ink px-4 py-2 rounded-md text-sm font-semibold disabled:opacity-50"
                        onClick={approveBulkSelected}
                        disabled={bulkApproving}
                      >
                        {bulkApproving ? "Approving..." : `Approve ${selectedBulkIds.size}`}
                      </button>
                    </div>
                  </div>
                )}

                {reviewTransactions.length > 0 && (
                  <div>
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-sm font-semibold">Needs a closer look</span>
                      <span className="shrink-0 text-[11px] font-mono uppercase tracking-wide text-gold border border-gold rounded-full px-2.5 py-1">
                        {reviewTransactions.length} pending
                      </span>
                    </div>
                    <p className="mt-1.5 text-xs text-ink-soft">
                      Money going out always needs a bank picked before it can move — Loan Release also activates
                      the loan. A member-submitted Investment Return lands here too, since it credits the shared
                      pool and is worth checking one at a time rather than batch-approving.
                    </p>

                    <div className="mt-3 space-y-3">
                      {reviewTransactions.map((t) => {
                        const needsWithdrawalBank = t.classification === "Member Withdrawal"
                        const needsLoanBank = t.classification === "Loan Release"

                        return (
                          <details key={t.transaction_id} className="group bg-paper-2 border border-hairline rounded-md overflow-hidden">
                            <summary className="p-4 flex items-start gap-3 cursor-pointer list-none [&::-webkit-details-marker]:hidden">
                              <FlowBadge {...(FLOW[t.classification] ?? { arrow: "•", tone: "out" })} small />
                              <div className="min-w-0 flex-1">
                                <p className="font-display font-medium truncate">{t.members?.name || "Fund"}</p>
                                {t.submitted_by_member && (
                                  <p className="text-[11px] text-gold font-mono truncate">Recorded by {t.submitted_by_member.name}</p>
                                )}
                                <p className="text-sm font-mono">₱{fmt(Math.abs(t.amount))}</p>
                                <p className="text-sm text-ink-soft">
                                  {typeLabels[t.classification] || t.classification}
                                  {needsLoanBank && " · requested"}
                                  {needsWithdrawalBank && " · pick the disbursing bank"}
                                  {t.classification === "Investment Return" && t.investments?.name && ` · ${t.investments.name}`}
                                </p>
                              </div>
                              <span className="shrink-0 mt-0.5 inline-flex items-center gap-1 text-[11px] font-mono uppercase tracking-wide text-gold border border-gold rounded-full px-2.5 py-1">
                                <span className="group-open:hidden">Review</span>
                                <span className="hidden group-open:inline">Close</span>
                                <span className="inline-block transition-transform group-open:rotate-180">▾</span>
                              </span>
                            </summary>

                            <div className="px-4 pb-4 border-t border-hairline pt-3">
                              <div className="mb-3">
                                <label className="block mb-1 text-xs uppercase tracking-wide text-ink-soft font-mono">
                                  Amount
                                </label>
                                <input
                                  type="number"
                                  inputMode="decimal"
                                  className="border border-hairline bg-paper text-ink text-sm rounded-md px-3 py-2 w-full"
                                  value={editAmounts[t.transaction_id] ?? String(Math.abs(t.amount))}
                                  onChange={(e) =>
                                    setEditAmounts((prev) => ({ ...prev, [t.transaction_id]: e.target.value }))
                                  }
                                />
                              </div>

                              {needsLoanBank && (
                                <div className="mb-3 grid grid-cols-2 gap-3">
                                  <div>
                                    <label className="block mb-1 text-xs uppercase tracking-wide text-ink-soft font-mono">
                                      {t.loans?.interest_type === "amount" ? "Interest (₱)" : "Interest rate (%)"}
                                    </label>
                                    <input
                                      type="number"
                                      inputMode="decimal"
                                      className="border border-hairline bg-paper text-ink text-sm rounded-md px-3 py-2 w-full"
                                      value={
                                        t.loans?.interest_type === "amount"
                                          ? editInterestAmount[t.transaction_id] ?? String(t.loans?.interest_amount ?? "")
                                          : editInterestRate[t.transaction_id] ?? String(t.loans?.interest_rate ?? "")
                                      }
                                      onChange={(e) => {
                                        const value = e.target.value
                                        if (t.loans?.interest_type === "amount") {
                                          setEditInterestAmount((prev) => ({ ...prev, [t.transaction_id]: value }))
                                        } else {
                                          setEditInterestRate((prev) => ({ ...prev, [t.transaction_id]: value }))
                                        }
                                      }}
                                    />
                                  </div>
                                  <div>
                                    <label className="block mb-1 text-xs uppercase tracking-wide text-ink-soft font-mono">
                                      Term (months)
                                    </label>
                                    <input
                                      type="number"
                                      inputMode="numeric"
                                      className="border border-hairline bg-paper text-ink text-sm rounded-md px-3 py-2 w-full"
                                      value={editTermMonths[t.transaction_id] ?? String(t.loans?.term_months ?? "")}
                                      onChange={(e) =>
                                        setEditTermMonths((prev) => ({ ...prev, [t.transaction_id]: e.target.value }))
                                      }
                                    />
                                  </div>
                                </div>
                              )}

                              <button
                                type="button"
                                className="mb-4 border border-hairline px-3 py-1.5 rounded-md text-xs disabled:opacity-50"
                                onClick={() => saveTransactionEdit(t)}
                                disabled={savingEditId === t.transaction_id}
                              >
                                {savingEditId === t.transaction_id ? "Saving..." : "Save changes"}
                              </button>

                              {needsWithdrawalBank && (
                                <div className="mb-3">
                                  <p className="text-xs text-gold bg-gold/10 border border-gold rounded-md px-3 py-2 mb-2">
                                    Which fund bank this pays out from is always an admin call.
                                  </p>
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

                              <div className="mb-3">
                                <label className="block mb-1 text-xs uppercase tracking-wide text-ink-soft font-mono">
                                  Proof of transfer
                                </label>
                                <input
                                  type="file"
                                  accept="image/*,.pdf"
                                  className="block w-full text-xs text-ink-soft file:mr-3 file:py-1.5 file:px-3 file:rounded-md file:border file:border-hairline file:bg-paper file:text-xs file:text-ink"
                                  onChange={(e) => {
                                    const file = e.target.files?.[0]
                                    if (file) {
                                      setApprovalReceipts((prev) => ({ ...prev, [t.transaction_id]: file }))
                                    }
                                  }}
                                />
                                {approvalReceipts[t.transaction_id] && (
                                  <p className="mt-1 text-[11px] text-ink-soft truncate">
                                    {approvalReceipts[t.transaction_id].name}
                                  </p>
                                )}
                              </div>

                              <div className="flex gap-2">
                                <button
                                  className="bg-ink text-paper px-4 py-2 rounded-md text-sm disabled:opacity-50"
                                  onClick={() => approveTransaction(t.transaction_id)}
                                  disabled={
                                    !approvalReceipts[t.transaction_id] ||
                                    uploadingReceiptId === t.transaction_id ||
                                    (needsWithdrawalBank && !withdrawalBankSelections[t.transaction_id]) ||
                                    (needsLoanBank && !loanReleaseBankSelections[t.transaction_id])
                                  }
                                >
                                  {uploadingReceiptId === t.transaction_id
                                    ? "Uploading..."
                                    : needsLoanBank
                                    ? "Approve & activate"
                                    : "Approve"}
                                </button>
                                <button
                                  className="border border-hairline px-4 py-2 rounded-md text-sm"
                                  onClick={() => {
                                    setRejectingId(t.transaction_id)
                                    setRejectReason("")
                                  }}
                                >
                                  Reject
                                </button>
                              </div>

                              {rejectingId === t.transaction_id && (
                                <RejectReasonPrompt
                                  reason={rejectReason}
                                  onChangeReason={setRejectReason}
                                  onCancel={() => {
                                    setRejectingId(null)
                                    setRejectReason("")
                                  }}
                                  onConfirm={() => rejectTransaction(t.transaction_id, rejectReason)}
                                />
                              )}

                              {(t.description || !needsLoanBank || t.receipt_url) && (
                                <div className="mt-4 pt-3 border-t border-hairline space-y-2">
                                  {t.description && <p className="text-sm text-ink-soft">{t.description}</p>}
                                  {!needsLoanBank && (
                                    <p className="text-sm text-ink-soft">
                                      Bank: {t.bank_accounts?.account_name || t.bank_accounts?.bank_name || "None"}
                                    </p>
                                  )}
                                  {t.receipt_url && (
                                    <button
                                      type="button"
                                      onClick={() => setOpenReceiptUrl(t.receipt_url)}
                                      className="inline-flex items-center gap-1.5 text-xs font-mono text-gold border border-gold rounded-full px-3 py-1.5 hover:bg-gold/10 transition-colors"
                                    >
                                      🧾 View Receipt
                                    </button>
                                  )}
                                </div>
                              )}
                            </div>
                          </details>
                        )
                      })}
                    </div>
                  </div>
                )}

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
                onClick={() => router.push("/transactions")}
                className="mt-4 text-sm text-gold hover:underline"
              >
                View all transactions →
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
              {distributeError && <p className="text-sm text-rust">{distributeError}</p>}

              <button
                onClick={() => router.push("/fund-breakdown?tab=banks")}
                className="text-sm text-gold hover:underline"
              >
                View bank interest history →
              </button>
            </section>
          )}

          {/* ---- Support ---- */}
          {activeTab === "support" && <SupportPanel />}

        </div>
      </main>

      {openReceiptUrl && <ReceiptModal path={openReceiptUrl} onClose={() => setOpenReceiptUrl(null)} />}
    </>
  )
}

// Inline reason box shown under a row once its Reject button is clicked.
// The reason is saved on the transaction and pushed to the submitter as
// part of their "not approved" notification, so it's optional but
// encouraged -- rejecting with nothing typed still goes through.
function RejectReasonPrompt({
  reason,
  onChangeReason,
  onCancel,
  onConfirm
}: {
  reason: string
  onChangeReason: (value: string) => void
  onCancel: () => void
  onConfirm: () => void
}) {
  return (
    <div className="pb-3 -mt-1">
      <label className="block mb-1 text-xs uppercase tracking-wide text-ink-soft font-mono">
        Reason (shown to the submitter)
      </label>
      <textarea
        autoFocus
        rows={2}
        value={reason}
        onChange={(e) => onChangeReason(e.target.value)}
        placeholder="e.g. Receipt doesn't match the amount"
        className="w-full border border-hairline rounded-md px-3 py-2 text-sm bg-paper"
      />
      <div className="flex gap-2 mt-2">
        <button
          type="button"
          className="bg-rust text-paper px-3 py-1.5 rounded-md text-sm"
          onClick={onConfirm}
        >
          Confirm reject
        </button>
        <button
          type="button"
          className="border border-hairline px-3 py-1.5 rounded-md text-sm"
          onClick={onCancel}
        >
          Cancel
        </button>
      </div>
    </div>
  )
}
