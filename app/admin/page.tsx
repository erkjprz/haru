"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { supabase } from "@/lib/supabase"
import Navbar from "@/app/components/Navbar"
import ReceiptModal from "@/app/components/ReceiptModal"
import { useAuth } from "@/app/auth-context"
import { SkeletonCardList } from "@/app/components/Skeleton"
import { SearchFixSheet } from "@/app/components/admin/SearchFixSheet"
import { Sheet } from "@/app/components/Sheet"
import {
  FlowBadge,
  AmountHero,
  FieldRow,
  BankIcon,
  PersonIcon,
  rowSelectClass
} from "@/app/components/TransactionFormUI"
import { approveLoanRelease } from "@/lib/approveLoan"
import { approveBorrowerMember } from "@/lib/approveBorrower"
import { dateOnly } from "@/lib/currentValue"
import { TRANSACTION_TYPE_LABELS as typeLabels } from "@/lib/transactionLabels"
import { readCache, writeCache } from "@/lib/cache"

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

type Filter = "all" | "txn" | "signup"

// Same global admin approvals queue for any admin viewing it -- no
// per-user scoping needed, so a single fixed cache key covers everyone.
// loadError is deliberately left out: it should always start empty rather
// than replaying a stale error from a previous visit.
const ADMIN_QUEUE_CACHE_KEY = "admin:queue"

type AdminQueueSnapshot = {
  pendingMembers: any[]
  unclaimedMembers: any[]
  banks: any[]
  pendingTransactions: any[]
  borrowerMembers: any[]
  unclaimedBorrowers: any[]
  linkedLoanNameByMemberId: Record<string, string>
}

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
  const cached = readCache<AdminQueueSnapshot>(ADMIN_QUEUE_CACHE_KEY)

  // Paints instantly from the last time the approvals queue loaded, before
  // the browser ever shows a frame -- loadData() below still runs right
  // after and replaces it with a fresh fetch, so a stale queue never
  // lingers past that first moment.
  const [dataLoading, setDataLoading] = useState(!cached)
  const checkingAccess = authLoading || dataLoading

  // Replaces the old two-tier tab system -- one flat queue, grouped by
  // what each item actually is rather than switched between screens; this
  // just narrows which groups show. Support has no queue of its own
  // (see showSearchFix below), so it isn't one of these.
  const [filter, setFilter] = useState<Filter>("all")
  const [showSearchFix, setShowSearchFix] = useState(false)

  // Each row across every group below is a compact summary that opens its
  // full form in a sheet instead of expanding in place -- one row's form
  // used to push every row after it down the page and fight the sheet
  // above (Search & Fix) for space when both happened to be open at once.
  const [reviewingTxnId, setReviewingTxnId] = useState<string | null>(null)
  const [reviewingSignupId, setReviewingSignupId] = useState<string | null>(null)
  const [reviewingBorrowerId, setReviewingBorrowerId] = useState<string | null>(null)

  const [pendingMembers, setPendingMembers] = useState<any[]>(cached?.pendingMembers ?? [])
  const [unclaimedMembers, setUnclaimedMembers] = useState<any[]>(cached?.unclaimedMembers ?? [])
  const [memberLinkChoice, setMemberLinkChoice] = useState<Record<string, string>>({})
  const [memberBusyId, setMemberBusyId] = useState<string | null>(null)

  const [pendingTransactions, setPendingTransactions] = useState<any[]>(cached?.pendingTransactions ?? [])
  const [banks, setBanks] = useState<any[]>(cached?.banks ?? [])
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

  const [borrowerMembers, setBorrowerMembers] = useState<any[]>(cached?.borrowerMembers ?? [])
  const [unclaimedBorrowers, setUnclaimedBorrowers] = useState<any[]>(cached?.unclaimedBorrowers ?? [])
  const [linkedLoanNameByMemberId, setLinkedLoanNameByMemberId] = useState<Record<string, string>>(
    cached?.linkedLoanNameByMemberId ?? {}
  )
  const [borrowerLinkChoice, setBorrowerLinkChoice] = useState<Record<string, string>>({})
  const [borrowerBusyId, setBorrowerBusyId] = useState<string | null>(null)

  const [loadError, setLoadError] = useState("")
  const [actionError, setActionError] = useState("")
  const [openReceiptUrl, setOpenReceiptUrl] = useState<string | null>(null)

  const [exporting, setExporting] = useState(false)
  const [exportError, setExportError] = useState("")

  async function loadData() {
    // Only show the blocking loader on a true cold start -- if we already
    // rendered cached data, refresh quietly behind it instead of flashing
    // back to a spinner on every navigation or post-mutation reload.
    if (!readCache(ADMIN_QUEUE_CACHE_KEY)) setDataLoading(true)

    const [
      pendingMembersRes,
      unclaimedMembersRes,
      banksRes,
      pendingTxnsRes,
      borrowerMembersRes,
      unclaimedBorrowersRes,
      linkedBorrowersRes
    ] = await Promise.all([
      // role='borrower' pending signups are handled entirely by the
      // Borrowers group (which offers borrower-record linking the generic
      // Members group doesn't) -- excluded here so a pending borrower isn't
      // double-counted across both groups' totals, or approved through the
      // wrong group and skip the chance to link their loan history.
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
      supabase.from("borrowers").select("name, member_id").not("member_id", "is", null)
    ])

    setPendingMembers(pendingMembersRes.data ?? [])
    setUnclaimedMembers(unclaimedMembersRes.data ?? [])
    setBanks(banksRes.data ?? [])

    setLoadError(pendingTxnsRes.error?.message || "")
    setPendingTransactions(pendingTxnsRes.error ? [] : pendingTxnsRes.data ?? [])

    setBorrowerMembers(borrowerMembersRes.data ?? [])
    setUnclaimedBorrowers(unclaimedBorrowersRes.data ?? [])
    const nextLinkedLoanNameByMemberId = Object.fromEntries(
      (linkedBorrowersRes.data ?? []).map((b: any) => [b.member_id as string, b.name as string])
    )
    setLinkedLoanNameByMemberId(nextLinkedLoanNameByMemberId)

    writeCache<AdminQueueSnapshot>(ADMIN_QUEUE_CACHE_KEY, {
      pendingMembers: pendingMembersRes.data ?? [],
      unclaimedMembers: unclaimedMembersRes.data ?? [],
      banks: banksRes.data ?? [],
      pendingTransactions: pendingTxnsRes.error ? [] : pendingTxnsRes.data ?? [],
      borrowerMembers: borrowerMembersRes.data ?? [],
      unclaimedBorrowers: unclaimedBorrowersRes.data ?? [],
      linkedLoanNameByMemberId: nextLinkedLoanNameByMemberId
    })
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
    // This is only ever invoked from approveTransaction, itself only wired to
    // a button's onClick -- never during render. react-hooks/purity's
    // whole-component reachability analysis loses track of that once this
    // file has enough closures in it (confirmed by bisection: unrelated JSX
    // added elsewhere in this component tips it into flagging this call,
    // with no change to this function or its call sites).
    // eslint-disable-next-line react-hooks/purity
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
      // same fix already used by the member-facing "Cancel entry" flow in
      // EditTransactionSheet.
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

  const bulkTransactions = pendingTransactions.filter((t) => BULK_CLASSIFICATIONS.has(t.classification))
  const reviewTransactions = pendingTransactions.filter((t) => !BULK_CLASSIFICATIONS.has(t.classification))
  const reviewingTxn = reviewTransactions.find((t) => t.transaction_id === reviewingTxnId) ?? null
  // Confirmed money rows have no sheet of their own to nest a reject prompt
  // inside (they're plain rows in the page, not opened via a sheet the way
  // everything else here is) -- rejectingId doubles as which row's own
  // reject sheet is open, bulkTransactions and reviewTransactions never
  // overlapping so this and Review Transaction's own reject state can never
  // both resolve to a real row at once.
  const rejectingBulkTxn = bulkTransactions.find((t) => t.transaction_id === rejectingId) ?? null

  const pendingAmountTotal = pendingTransactions.reduce((sum, t) => sum + Math.abs(Number(t.amount)), 0)
  const pendingBorrowers = borrowerMembers.filter((m) => m.status === "pending")
  const reviewingSignup = pendingMembers.find((m) => m.member_id === reviewingSignupId) ?? null
  const reviewingBorrower = pendingBorrowers.find((m) => m.member_id === reviewingBorrowerId) ?? null

  const signupsCount = pendingMembers.length + pendingBorrowers.length
  const totalCount = pendingTransactions.length + signupsCount

  const chips: { id: Filter; label: string; count: number }[] = [
    { id: "all", label: "All", count: totalCount },
    { id: "txn", label: "Transactions", count: pendingTransactions.length },
    { id: "signup", label: "Signups", count: signupsCount }
  ]

  const showTxns = filter === "all" || filter === "txn"
  const showSignups = filter === "all" || filter === "signup"

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

  return (
    <>
      <Navbar />
      <main className="min-h-screen bg-paper text-ink font-sans overflow-x-hidden relative">
        <div className="max-w-3xl mx-auto px-5 pt-10 pb-[calc(6rem+var(--dock-h)+env(safe-area-inset-bottom))]">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="text-[11px] tracking-[0.18em] uppercase text-gold font-mono mb-2">
                Administration
              </div>
              <h1 className="font-display text-3xl font-semibold">
                {totalCount > 0 ? (
                  <>
                    <span className="text-gold">{totalCount}</span> waiting on you
                  </>
                ) : (
                  "All caught up"
                )}
              </h1>
            </div>

            {/* Page-level action, not scoped to any group -- always exports
                the full transaction history regardless of what's filtered
                below. */}
            <button
              onClick={exportTransactionsCsv}
              disabled={exporting}
              className="shrink-0 inline-flex items-center justify-center w-9 h-9 text-ink-soft border border-hairline rounded-full hover:bg-paper-2 hover:text-ink transition-colors disabled:opacity-60"
              title="Export full transaction history (every status, not just what's shown below) as a CSV backup"
              aria-label="Export CSV"
            >
              {exporting ? (
                <span className="text-[10px] font-mono">...</span>
              ) : (
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
                  <path d="M12 3v13M7 11l5 5 5-5M5 20h14" />
                </svg>
              )}
            </button>
          </div>
          {exportError && (
            <p className="mt-1.5 text-xs text-rust text-right">Couldn&apos;t export: {exportError}</p>
          )}

          {loadError && (
            <p className="mt-4 text-sm text-rust">Couldn&apos;t load some data: {loadError}</p>
          )}

          {actionError && <p className="mt-4 text-sm text-rust">{actionError}</p>}

          {/* Filter chips -- narrow which groups show below, replacing the
              old two-tier tab system. Single-select, matching the pill
              vocabulary used elsewhere (TypePickerSheet, filter rows). */}
          <div className="mt-5 flex items-center gap-2 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {chips.map((c) => (
              <button
                key={c.id}
                onClick={() => setFilter(c.id)}
                className={`shrink-0 flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-sm font-semibold transition-colors ${
                  filter === c.id ? "bg-gold-soft text-ink" : "border border-hairline text-ink-soft"
                }`}
              >
                {c.label}
                <span className={`font-mono text-xs ${filter === c.id ? "text-ink" : "text-ink-soft"}`}>{c.count}</span>
              </button>
            ))}
          </div>

          <div className="mt-6 space-y-8">
            {/* Only on "All" -- switching to the Transactions or Signups
                chip with nothing pending already gets its own "Nothing
                pending right now" from that chip's own fallback section
                below, so showing this too duplicated the same message. */}
            {filter === "all" && totalCount === 0 && (
              <div className="text-center py-16">
                <p className="text-2xl mb-2">🌱</p>
                <p className="text-sm text-ink-soft">
                  New signups and transactions will show up here.
                </p>
              </div>
            )}

            {/* ---- Confirmed money (bulk) ---- */}
            {showTxns && bulkTransactions.length > 0 && (
              <section>
                <div className="flex items-center justify-between gap-3">
                  <label className="flex items-center gap-2.5 text-sm font-semibold cursor-pointer">
                    <input
                      type="checkbox"
                      className="w-[18px] h-[18px] accent-ink shrink-0"
                      checked={bulkTransactions.every((t) => selectedBulkIds.has(t.transaction_id))}
                      onChange={() => toggleSelectAllBulk(bulkTransactions.map((t) => t.transaction_id))}
                    />
                    Confirmed money
                  </label>
                  <span className="shrink-0 text-[11px] font-mono uppercase tracking-wide text-ink-soft border border-hairline rounded-full px-2.5 py-1">
                    {bulkTransactions.length} pending
                  </span>
                </div>
                <p className="mt-1.5 text-xs text-ink-soft">
                  Already in the bank — nothing left to decide, just to confirm.
                </p>

                <div className="mt-3 space-y-2">
                  {bulkTransactions.map((t) => (
                    <div key={t.transaction_id} className="bg-paper-2 border border-hairline rounded-md overflow-hidden">
                      <div className="flex items-center gap-3 px-4 py-3">
                        <input
                          type="checkbox"
                          className="w-[18px] h-[18px] accent-ink shrink-0"
                          checked={selectedBulkIds.has(t.transaction_id)}
                          onChange={() => toggleBulkSelected(t.transaction_id)}
                        />
                        <FlowBadge {...(FLOW[t.classification] ?? { arrow: "•", tone: "in" })} small />
                        <div className="min-w-0 flex-1">
                          <p className="font-display font-medium truncate text-sm">{t.members?.name || "Fund"}</p>
                          <p className="text-xs text-ink-soft truncate">
                            {typeLabels[t.classification] || t.classification}
                            {t.bank_accounts && ` · ${t.bank_accounts.account_name || t.bank_accounts.bank_name}`}
                          </p>
                        </div>
                        <div className="shrink-0 text-right">
                          <p className="text-sm font-mono">₱{fmt(t.amount)}</p>
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
                    </div>
                  ))}
                </div>

                {selectedBulkIds.size > 0 && (
                  <div className="sticky bottom-4 z-10 mt-3 flex items-center justify-between gap-3 bg-ink text-paper rounded-md px-4 py-3 shadow-lg">
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

                <button
                  onClick={() => router.push("/transactions")}
                  className="mt-4 inline-flex items-center gap-1.5 text-sm font-semibold text-gold border border-gold/40 rounded-full px-4 py-2 hover:bg-gold/10 transition-colors"
                >
                  View all transactions
                </button>
              </section>
            )}

            {/* ---- Transactions (empty-state fallback) ---- */}
            {/* Only when the Transactions chip is specifically selected --
                on "All" with nothing pending anywhere, the 🌱 empty state
                above already says so; repeating "nothing pending" once per
                category underneath it was redundant. */}
            {filter === "txn" && bulkTransactions.length === 0 && reviewTransactions.length === 0 && (
              <section>
                <span className="text-sm font-semibold">Transactions</span>
                <p className="mt-1.5 text-xs text-ink-soft">Nothing pending right now.</p>
                <button
                  onClick={() => router.push("/transactions")}
                  className="mt-3 inline-flex items-center gap-1.5 text-sm font-semibold text-gold border border-gold/40 rounded-full px-4 py-2 hover:bg-gold/10 transition-colors"
                >
                  View all transactions
                </button>
              </section>
            )}

            {/* ---- Needs a decision ---- */}
            {showTxns && reviewTransactions.length > 0 && (
              <section>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm font-semibold">Needs a decision</span>
                  <span className="shrink-0 text-[11px] font-mono uppercase tracking-wide text-gold border border-gold rounded-full px-2.5 py-1">
                    {reviewTransactions.length} pending
                  </span>
                </div>
                <p className="mt-1.5 text-xs text-ink-soft">
                  Money going out always needs a bank picked before it can move — Loan Release also activates
                  the loan. A member-submitted Investment Return lands here too, since it credits the shared
                  pool and is worth checking one at a time rather than batch-approving.
                </p>

                <div className="mt-3 space-y-2">
                  {reviewTransactions.map((t) => {
                    const needsWithdrawalBank = t.classification === "Member Withdrawal"
                    const needsLoanBank = t.classification === "Loan Release"

                    return (
                      <button
                        key={t.transaction_id}
                        type="button"
                        onClick={() => setReviewingTxnId(t.transaction_id)}
                        className="w-full bg-paper-2 border border-hairline rounded-md overflow-hidden flex items-center gap-3 px-4 py-3 text-left"
                      >
                        <FlowBadge {...(FLOW[t.classification] ?? { arrow: "•", tone: "out" })} small />
                        <div className="min-w-0 flex-1">
                          <p className="font-display font-medium truncate text-sm">{t.members?.name || "Fund"}</p>
                          <p className="text-xs text-ink-soft truncate">
                            {typeLabels[t.classification] || t.classification}
                            {needsLoanBank && " · requested"}
                            {needsWithdrawalBank && " · pick the disbursing bank"}
                            {t.classification === "Investment Return" && t.investments?.name && ` · ${t.investments.name}`}
                            {t.submitted_by_member && ` · by ${t.submitted_by_member.name}`}
                          </p>
                        </div>
                        <div className="shrink-0 text-right">
                          <p className="text-sm font-mono">₱{fmt(Math.abs(t.amount))}</p>
                          <p className="text-[11px] font-mono text-gold">Review →</p>
                        </div>
                      </button>
                    )
                  })}
                </div>

                <p className="mt-3 text-xs text-ink-soft font-mono">
                  ₱{fmt(pendingAmountTotal)} pending total
                </p>

                <button
                  onClick={() => router.push("/transactions")}
                  className="mt-4 inline-flex items-center gap-1.5 text-sm font-semibold text-gold border border-gold/40 rounded-full px-4 py-2 hover:bg-gold/10 transition-colors"
                >
                  View all transactions
                </button>
              </section>
            )}

            {/* ---- New signups ---- */}
            {showSignups && pendingMembers.length > 0 && (
              <section>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm font-semibold">New signups</span>
                  <span className="shrink-0 text-[11px] font-mono uppercase tracking-wide text-ink-soft border border-hairline rounded-full px-2.5 py-1">
                    {pendingMembers.length}
                  </span>
                </div>

                <div className="mt-3 space-y-2">
                  {pendingMembers.map((m) => (
                    <button
                      key={m.member_id}
                      type="button"
                      onClick={() => setReviewingSignupId(m.member_id)}
                      className="w-full bg-paper-2 border border-hairline rounded-md flex items-center gap-3 px-4 py-3 text-left"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="font-display font-medium truncate text-sm">{m.name}</p>
                        <p className="text-xs text-ink-soft truncate">
                          {m.email} · {timeAgo(m.created_at)}
                        </p>
                      </div>
                      <span className="shrink-0 text-[11px] font-mono text-gold">Review →</span>
                    </button>
                  ))}
                </div>
              </section>
            )}

            {/* ---- Borrower requests ---- */}
            {showSignups && pendingBorrowers.length > 0 && (
              <section>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm font-semibold">Borrower requests</span>
                  <span className="shrink-0 text-[11px] font-mono uppercase tracking-wide text-ink-soft border border-hairline rounded-full px-2.5 py-1">
                    {pendingBorrowers.length}
                  </span>
                </div>

                <div className="mt-3 space-y-2">
                  {pendingBorrowers.map((m) => {
                    const linkedName = linkedLoanNameByMemberId[m.member_id]
                    return (
                      <button
                        key={m.member_id}
                        type="button"
                        onClick={() => setReviewingBorrowerId(m.member_id)}
                        className="w-full bg-paper-2 border border-hairline rounded-md flex items-center gap-3 px-4 py-3 text-left"
                      >
                        <div className="min-w-0 flex-1">
                          <p className="font-display font-medium truncate text-sm">{m.name}</p>
                          <p className="text-xs text-ink-soft truncate">
                            {m.email || "No email"} · {timeAgo(m.created_at)}
                            {linkedName && ` · linked to ${linkedName}`}
                          </p>
                        </div>
                        <span className="shrink-0 text-[11px] font-mono text-gold">Review →</span>
                      </button>
                    )
                  })}
                </div>
              </section>
            )}

            {/* ---- Signups (empty-state fallback) ---- */}
            {/* Same reasoning as the Transactions fallback above -- only
                when the Signups chip is specifically selected. */}
            {filter === "signup" && pendingMembers.length === 0 && pendingBorrowers.length === 0 && (
              <section>
                <span className="text-sm font-semibold">Signups</span>
                <p className="mt-1.5 text-xs text-ink-soft">Nothing pending right now.</p>
                <div className="mt-3 flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => router.push("/admin/members")}
                    className="inline-flex items-center gap-1.5 text-sm font-semibold text-gold border border-gold/40 rounded-full px-4 py-2 hover:bg-gold/10 transition-colors"
                  >
                    Manage members
                  </button>
                  <button
                    type="button"
                    onClick={() => router.push("/admin/borrowers")}
                    className="inline-flex items-center gap-1.5 text-sm font-semibold text-gold border border-gold/40 rounded-full px-4 py-2 hover:bg-gold/10 transition-colors"
                  >
                    Manage borrowers
                  </button>
                </div>
              </section>
            )}
          </div>
        </div>

        {/* Admin's own FAB -- Navbar's "New Transaction" FAB is hidden on
            this page (see Navbar's showFab), so this is a separate button
            for Admin's own primary action: finding and fixing any
            transaction on record, replacing the old Support tab. */}
        <button
          onClick={() => setShowSearchFix(true)}
          aria-label="Search & Fix"
          className="fixed right-4 w-14 h-14 rounded-full bg-ink text-paper flex items-center justify-center shadow-lg shadow-gold/30 ring-1 ring-gold/40 z-40"
          style={{ bottom: "calc(var(--dock-h) + 0.75rem)" }}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-6 h-6">
            <circle cx="10.5" cy="10.5" r="6.5" />
            <path d="M20 20l-4.8-4.8" />
          </svg>
        </button>
      </main>

      {reviewingTxn && (() => {
        const t = reviewingTxn
        const needsWithdrawalBank = t.classification === "Member Withdrawal"
        const needsLoanBank = t.classification === "Loan Release"

        const canApprove =
          !!approvalReceipts[t.transaction_id] &&
          uploadingReceiptId !== t.transaction_id &&
          (!needsWithdrawalBank || !!withdrawalBankSelections[t.transaction_id]) &&
          (!needsLoanBank || !!loanReleaseBankSelections[t.transaction_id])

        const footer =
          rejectingId === t.transaction_id ? (
            <RejectReasonPrompt
              reason={rejectReason}
              onChangeReason={setRejectReason}
              onCancel={() => {
                setRejectingId(null)
                setRejectReason("")
              }}
              onConfirm={() => rejectTransaction(t.transaction_id, rejectReason)}
            />
          ) : (
            <>
              {actionError && <p className="text-sm text-rust mb-3">{actionError}</p>}
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  className="shrink-0 border border-rust text-rust px-5 py-3.5 rounded-full text-base font-semibold"
                  onClick={() => {
                    setRejectingId(t.transaction_id)
                    setRejectReason("")
                  }}
                >
                  Reject
                </button>
                <button
                  type="button"
                  className="flex-1 bg-ink text-paper px-6 py-3.5 rounded-full text-base font-bold shadow-lg shadow-gold/30 ring-1 ring-gold/40 motion-safe:transition-transform motion-safe:active:scale-[0.97] disabled:opacity-50 disabled:shadow-none disabled:ring-0"
                  onClick={() => approveTransaction(t.transaction_id)}
                  disabled={!canApprove}
                >
                  {uploadingReceiptId === t.transaction_id
                    ? "Uploading…"
                    : needsLoanBank
                    ? "Approve & activate"
                    : "Approve"}
                </button>
              </div>
            </>
          )

        return (
          <Sheet title="Review transaction" onClose={() => setReviewingTxnId(null)} footer={footer}>
            <div className="bg-paper-2 border border-hairline rounded-md overflow-hidden">
              <FieldRow icon={<FlowBadge {...(FLOW[t.classification] ?? { arrow: "•", tone: "out" })} small />}>
                <span className="flex-1 min-w-0 text-sm">
                  <span className="font-semibold text-ink">{t.members?.name || "Fund"}</span>
                  <span className="text-ink-soft"> · {typeLabels[t.classification] || t.classification}</span>
                </span>
              </FieldRow>
            </div>
            <p className="px-1 pt-2 text-xs text-ink-soft">
              {needsLoanBank && "Requested"}
              {t.classification === "Investment Return" && t.investments?.name && t.investments.name}
              {t.submitted_by_member && `Submitted by ${t.submitted_by_member.name}`}
            </p>

            <AmountHero
              value={editAmounts[t.transaction_id] ?? String(Math.abs(t.amount))}
              onChange={(v) => setEditAmounts((prev) => ({ ...prev, [t.transaction_id]: v }))}
              label="Amount"
            />

            {needsLoanBank && (
              <div className="grid grid-cols-2 gap-3 -mt-2 mb-4">
                <div>
                  <p className="mb-1.5 text-[11px] uppercase tracking-wide text-ink-soft font-mono">
                    {t.loans?.interest_type === "amount" ? "Interest (₱)" : "Interest rate (%)"}
                  </p>
                  <input
                    type="number"
                    inputMode="decimal"
                    className="border border-hairline bg-paper-2 text-ink text-sm rounded-md px-3.5 py-3 w-full"
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
                  <p className="mb-1.5 text-[11px] uppercase tracking-wide text-ink-soft font-mono">
                    Term (months)
                  </p>
                  <input
                    type="number"
                    inputMode="numeric"
                    className="border border-hairline bg-paper-2 text-ink text-sm rounded-md px-3.5 py-3 w-full"
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
              className="mb-4 border border-hairline text-ink-soft px-4 py-2 rounded-full text-sm font-semibold disabled:opacity-50"
              onClick={() => saveTransactionEdit(t)}
              disabled={savingEditId === t.transaction_id}
            >
              {savingEditId === t.transaction_id ? "Saving…" : "Save changes"}
            </button>

            <div>
              <p className="text-[11px] uppercase tracking-wide text-ink-soft font-mono mb-2 px-1">Details</p>
              <div className="bg-paper-2 border border-hairline rounded-md divide-y divide-hairline overflow-hidden">
                {needsWithdrawalBank && (
                  <FieldRow icon={<BankIcon />}>
                    <select
                      className={rowSelectClass}
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
                    <span className="text-ink-soft text-xs shrink-0 pointer-events-none">▾</span>
                  </FieldRow>
                )}

                {needsLoanBank && (
                  <FieldRow icon={<BankIcon />}>
                    <select
                      className={rowSelectClass}
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
                    <span className="text-ink-soft text-xs shrink-0 pointer-events-none">▾</span>
                  </FieldRow>
                )}

                <label className="flex items-center gap-3 px-4 py-3.5 cursor-pointer">
                  <span className="text-base shrink-0">📎</span>
                  <span className="flex-1 min-w-0 text-sm text-ink-soft truncate">
                    {approvalReceipts[t.transaction_id]?.name ?? "Proof of transfer"}
                  </span>
                  <input
                    type="file"
                    accept="image/*,.pdf"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0]
                      if (file) {
                        setApprovalReceipts((prev) => ({ ...prev, [t.transaction_id]: file }))
                      }
                    }}
                  />
                </label>
              </div>

              {needsWithdrawalBank && (
                <p className="px-1 pt-2 text-sm text-gold">
                  Which fund bank this pays out from is always an admin call.
                </p>
              )}
              {needsLoanBank && (
                <p className="px-1 pt-2 text-sm text-gold">
                  Approving here activates the loan and records the disbursing bank in one step, instead of
                  separately on the loan&apos;s own page.
                </p>
              )}
            </div>

            {(t.description || (!needsLoanBank && !needsWithdrawalBank) || t.receipt_url) && (
              <div className="mt-4 pt-4 border-t border-hairline space-y-2">
                {t.description && <p className="text-sm text-ink-soft">{t.description}</p>}
                {/* Withdrawal/Loan Release never have a bank on record yet at
                    this point -- that's exactly what the picker above is
                    for -- so this line would always read "Bank: None" right
                    next to a picker already showing what was just chosen,
                    contradicting it for no reason. Only worth showing for
                    types where the bank is already settled, not being
                    picked in this same sheet. */}
                {!needsLoanBank && !needsWithdrawalBank && (
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
          </Sheet>
        )
      })()}

      {reviewingSignup && (
        <Sheet
          title="New signup"
          onClose={() => setReviewingSignupId(null)}
          footer={
            <div className="flex items-center gap-3">
              {memberLinkChoice[reviewingSignup.member_id] && (
                <button
                  type="button"
                  className="shrink-0 border border-hairline text-ink-soft px-5 py-3.5 rounded-full text-base font-semibold disabled:opacity-50"
                  onClick={() => linkMember(reviewingSignup.member_id)}
                  disabled={memberBusyId === reviewingSignup.member_id}
                >
                  {memberBusyId === reviewingSignup.member_id ? "Linking…" : "Link & approve"}
                </button>
              )}
              <button
                type="button"
                className="flex-1 bg-ink text-paper px-6 py-3.5 rounded-full text-base font-bold shadow-lg shadow-gold/30 ring-1 ring-gold/40 motion-safe:transition-transform motion-safe:active:scale-[0.97] disabled:opacity-50 disabled:shadow-none disabled:ring-0"
                onClick={() => approveMember(reviewingSignup.member_id)}
                disabled={memberBusyId === reviewingSignup.member_id}
              >
                {memberBusyId === reviewingSignup.member_id ? "Approving…" : "Approve as new"}
              </button>
            </div>
          }
        >
          <div className="bg-paper-2 border border-hairline rounded-md overflow-hidden">
            <FieldRow icon={<PersonIcon />}>
              <span className="flex-1 min-w-0 text-sm">
                <span className="font-semibold text-ink">{reviewingSignup.name}</span>
              </span>
            </FieldRow>
          </div>
          <p className="px-1 pt-2 text-xs text-ink-soft">
            {reviewingSignup.email} · {timeAgo(reviewingSignup.created_at)}
          </p>

          {unclaimedMembers.length > 0 && (
            <div className="mt-4">
              <p className="text-[11px] uppercase tracking-wide text-ink-soft font-mono mb-2 px-1">
                Link to existing member
              </p>
              <p className="text-sm text-ink-soft mb-2 px-1">
                If this signup is actually one of the fund&apos;s existing members, link it to their
                record so their contributions, loans and investments carry over.
              </p>
              <div className="bg-paper-2 border border-hairline rounded-md overflow-hidden">
                <FieldRow icon={<PersonIcon />}>
                  <select
                    className={rowSelectClass}
                    value={memberLinkChoice[reviewingSignup.member_id] || ""}
                    onChange={(e) =>
                      setMemberLinkChoice((prev) => ({ ...prev, [reviewingSignup.member_id]: e.target.value }))
                    }
                  >
                    <option value="">Select a member</option>
                    {unclaimedMembers.map((um: any) => (
                      <option key={um.member_id} value={um.member_id}>
                        {um.name}
                      </option>
                    ))}
                  </select>
                  <span className="text-ink-soft text-xs shrink-0 pointer-events-none">▾</span>
                </FieldRow>
              </div>
            </div>
          )}
        </Sheet>
      )}

      {reviewingBorrower && (() => {
        const m = reviewingBorrower
        const linkedName = linkedLoanNameByMemberId[m.member_id]

        return (
          <Sheet
            title="Borrower request"
            onClose={() => setReviewingBorrowerId(null)}
            footer={
              <button
                type="button"
                className="w-full bg-ink text-paper px-6 py-3.5 rounded-full text-base font-bold shadow-lg shadow-gold/30 ring-1 ring-gold/40 motion-safe:transition-transform motion-safe:active:scale-[0.97] disabled:opacity-50 disabled:shadow-none disabled:ring-0"
                onClick={() => approveBorrower(m.member_id)}
                disabled={borrowerBusyId === m.member_id}
              >
                {borrowerBusyId === m.member_id
                  ? "Approving…"
                  : borrowerLinkChoice[m.member_id]
                  ? "Approve & link"
                  : "Approve"}
              </button>
            }
          >
            <div className="bg-paper-2 border border-hairline rounded-md overflow-hidden">
              <FieldRow icon={<PersonIcon />}>
                <span className="flex-1 min-w-0 text-sm">
                  <span className="font-semibold text-ink">{m.name}</span>
                </span>
              </FieldRow>
            </div>
            <p className="px-1 pt-2 text-xs text-ink-soft">
              {m.email || "No email"} · requests borrower access · {timeAgo(m.created_at)}
            </p>

            {linkedName ? (
              <p className="mt-4 text-xs text-sage font-mono px-1">Linked to loan record: {linkedName}</p>
            ) : (
              <div className="mt-4">
                <p className="text-[11px] uppercase tracking-wide text-ink-soft font-mono mb-2 px-1">
                  Link to an existing loan record (optional)
                </p>
                <div className="bg-paper-2 border border-hairline rounded-md overflow-hidden">
                  <FieldRow icon={<PersonIcon />}>
                    <select
                      className={rowSelectClass}
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
                    <span className="text-ink-soft text-xs shrink-0 pointer-events-none">▾</span>
                  </FieldRow>
                </div>
              </div>
            )}
          </Sheet>
        )
      })()}

      {rejectingBulkTxn && (
        <Sheet
          title="Reject transaction"
          onClose={() => {
            setRejectingId(null)
            setRejectReason("")
          }}
        >
          <div className="bg-paper-2 border border-hairline rounded-md overflow-hidden mb-4">
            <FieldRow icon={<FlowBadge {...(FLOW[rejectingBulkTxn.classification] ?? { arrow: "•", tone: "in" })} small />}>
              <span className="flex-1 min-w-0 text-sm">
                <span className="font-semibold text-ink">{rejectingBulkTxn.members?.name || "Fund"}</span>
                <span className="text-ink-soft"> · {typeLabels[rejectingBulkTxn.classification] || rejectingBulkTxn.classification}</span>
              </span>
              <span className="shrink-0 text-sm font-mono">₱{fmt(rejectingBulkTxn.amount)}</span>
            </FieldRow>
          </div>

          <RejectReasonPrompt
            reason={rejectReason}
            onChangeReason={setRejectReason}
            onCancel={() => {
              setRejectingId(null)
              setRejectReason("")
            }}
            onConfirm={() => rejectTransaction(rejectingBulkTxn.transaction_id, rejectReason)}
          />
        </Sheet>
      )}

      {showSearchFix && <SearchFixSheet onClose={() => setShowSearchFix(false)} />}
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
    <>
      <p className="mb-1.5 text-xs uppercase tracking-wide text-ink-soft font-mono">
        Reason (shown to the submitter)
      </p>
      <textarea
        autoFocus
        rows={2}
        value={reason}
        onChange={(e) => onChangeReason(e.target.value)}
        placeholder="e.g. Receipt doesn't match the amount"
        className="w-full border border-hairline rounded-md px-3.5 py-3 text-sm bg-paper-2 mb-3"
      />
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={onCancel}
          className="shrink-0 border border-hairline text-ink-soft px-5 py-3.5 rounded-full text-base font-semibold"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={onConfirm}
          className="flex-1 bg-rust text-paper px-6 py-3.5 rounded-full text-base font-bold motion-safe:transition-transform motion-safe:active:scale-[0.97]"
        >
          Confirm reject
        </button>
      </div>
    </>
  )
}
