"use client"

// Admin escape hatch for fixing a mistake on an existing transaction --
// wrong amount, bank, date, receipt, or status -- regardless of who owns
// it or whether it's still pending. Deliberately narrower than the normal
// edit flow: only the core recorded fields are editable here, never the
// classification or its member/loan/investment links, and it never runs
// the side effects the real approve/reject buttons do (activating a loan,
// snapshotting a hold, etc.) -- this is for correcting what's on record,
// not a substitute for the normal approval workflow.
//
// "Gain Allocation" rows are generated from loan_gain_allocations /
// investment_allocations / bank_interest_allocations, not entered
// directly, so editing one here wouldn't touch its source table and would
// just create a new inconsistency -- they show up in search but can't be
// opened for editing.

import { useEffect, useMemo, useState } from "react"
import { supabase } from "@/lib/supabase"
import { getReceiptSignedUrl } from "@/lib/receiptUrl"
import { ReceiptField } from "@/app/components/TransactionFormUI"

const STATUS_OPTIONS = ["pending", "approved", "rejected", "cancelled"]

// Legacy migrated rows carry the bank as plain text in `bank` rather than a
// real link via `bank_account_id` -- and the list display prefers that
// legacy text whenever it's present (see bankBadge on the Transactions
// page), so editing bank_account_id alone here would silently do nothing
// visible. Best-effort match the legacy text to a real bank account so the
// dropdown starts pre-filled with the obvious fix instead of "No bank
// linked".
function matchLegacyBankText(banks: BankAccount[], legacyText: string | null): BankAccount | null {
  if (!legacyText) return null
  const needle = legacyText.trim().toLowerCase()
  return (
    banks.find(
      (b) => b.bank_name.toLowerCase() === needle || (b.account_name ?? "").toLowerCase() === needle
    ) ?? null
  )
}

const typeLabels: Record<string, string> = {
  "Member Contribution": "Contribution",
  "Member Withdrawal": "Withdrawal",
  "Loan Request": "Loan Request",
  "Expense": "Expense",
  "Loan Release": "Loan Disbursement",
  "Loan Repayment": "Loan Repayment",
  "Gain Allocation": "Investment Allocation",
  "Bank Interest": "Bank Interest",
  "Internal Transfer": "Bank Transfer",
  "Investment": "Investment",
  "Investment Return": "Investment Return",
  "Tax": "Tax",
  "Bank Write-off": "Bank Write-off"
}

const statusColor: Record<string, string> = {
  pending: "text-gold",
  approved: "text-sage",
  rejected: "text-rust",
  cancelled: "text-ink-soft"
}

type BankAccount = { id: string; bank_name: string; account_name: string | null }

export function SupportPanel() {
  const [loading, setLoading] = useState(true)
  const [transactions, setTransactions] = useState<any[]>([])
  const [banks, setBanks] = useState<BankAccount[]>([])
  const [loadError, setLoadError] = useState("")
  const [query, setQuery] = useState("")
  const [editingId, setEditingId] = useState<string | null>(null)

  // Loaded once, when this tab is actually opened (this component only
  // mounts then) -- not up front with the rest of Admin's data, since this
  // pulls every transaction regardless of status (unlike the Txns tab's
  // pending-only query) and isn't needed until someone opens Support.
  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function load() {
    setLoading(true)
    setLoadError("")

    const [txnsResult, banksResult] = await Promise.all([
      supabase
        .from("transactions")
        .select(
          `
          *,
          members!transactions_member_id_fkey ( name ),
          loans!transactions_loan_id_fkey ( name, status ),
          investments!transactions_investment_id_fkey ( name ),
          bank_accounts!transactions_bank_account_id_fkey ( bank_name, account_name )
        `
        )
        .order("txn_date", { ascending: false, nullsFirst: false })
        .order("created_at", { ascending: false })
        .range(0, 4999),
      supabase.from("bank_accounts").select("id, bank_name, account_name").order("bank_name")
    ])

    if (txnsResult.error) {
      setLoadError(txnsResult.error.message)
      setLoading(false)
      return
    }

    setTransactions(txnsResult.data ?? [])
    setBanks((banksResult.data as BankAccount[]) ?? [])
    setLoading(false)
  }

  const results = useMemo(() => {
    const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
    if (words.length === 0) return []

    return transactions
      .filter((t) => {
        const haystack = [
          t.members?.name,
          t.description,
          t.bank,
          t.bank_accounts?.bank_name,
          t.bank_accounts?.account_name,
          t.classification,
          typeLabels[t.classification],
          t.loans?.name,
          t.investments?.name,
          t.status,
          String(t.amount),
          t.txn_date
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase()

        return words.every((w) => haystack.includes(w))
      })
      .slice(0, 30)
  }, [transactions, query])

  const fmt = (n: number) =>
    Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })

  return (
    <section className="mt-6">
      <p className="text-[13px] text-ink-soft mb-4">
        Find any transaction, regardless of who it belongs to or its status, to fix a mistake -- wrong amount,
        bank, date, receipt, or status. This only corrects what&apos;s on record; it doesn&apos;t run approval
        side effects like activating a loan, so use the Approvals tab for routine approvals.
      </p>

      {loading && <p className="text-sm text-ink-soft">Loading…</p>}
      {loadError && <p className="text-sm text-rust">Couldn&apos;t load transactions: {loadError}</p>}

      {!loading && !loadError && (
        <>
          <input
            className="border border-hairline bg-paper-2 text-ink text-sm rounded-md px-3 py-2.5 w-full"
            placeholder="Search by member, bank, description, amount, date…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />

          {query.trim() && (
            <p className="text-xs text-ink-soft mt-2">
              {results.length} match{results.length === 1 ? "" : "es"}
              {results.length === 30 ? " (showing first 30)" : ""}
            </p>
          )}

          <div className="mt-3 flex flex-col gap-3">
            {results.map((t) => (
              <SupportRow
                key={t.transaction_id}
                t={t}
                banks={banks}
                fmt={fmt}
                isEditing={editingId === t.transaction_id}
                onToggle={() => setEditingId(editingId === t.transaction_id ? null : t.transaction_id)}
                onSaved={(updated) => {
                  setTransactions((rows) =>
                    rows.map((r) => (r.transaction_id === updated.transaction_id ? { ...r, ...updated } : r))
                  )
                  setEditingId(null)
                }}
              />
            ))}
          </div>
        </>
      )}
    </section>
  )
}

function SupportRow({
  t,
  banks,
  fmt,
  isEditing,
  onToggle,
  onSaved
}: {
  t: any
  banks: BankAccount[]
  fmt: (n: number) => string
  isEditing: boolean
  onToggle: () => void
  onSaved: (updated: any) => void
}) {
  const isGainAllocation = t.classification === "Gain Allocation"
  const displayName = t.members?.name || t.loans?.name || t.investments?.name || "Fund"

  return (
    <div className="bg-paper-2 border border-hairline rounded-md">
      <button
        type="button"
        onClick={onToggle}
        disabled={isGainAllocation}
        className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left disabled:cursor-default"
      >
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap mb-1">
            <span className="text-[9px] uppercase tracking-widest font-mono border border-hairline text-ink-soft rounded-full px-2 py-0.5">
              {typeLabels[t.classification] || t.classification}
            </span>
            <span className={`text-[9px] uppercase font-mono ${statusColor[t.status] ?? "text-ink-soft"}`}>
              {t.status}
            </span>
          </div>
          <p className="text-sm text-ink truncate">{displayName}</p>
          <p className="text-[11px] text-ink-soft font-mono">{t.txn_date ?? t.created_at?.slice(0, 10)}</p>
        </div>
        <div className="shrink-0 text-right">
          <p className="font-mono [font-variant-numeric:tabular-nums] text-sm font-semibold text-ink whitespace-nowrap">
            ₱{fmt(Math.abs(Number(t.amount)))}
          </p>
          {!isGainAllocation && <p className="text-[11px] text-gold mt-0.5">{isEditing ? "Close" : "Fix →"}</p>}
        </div>
      </button>

      {isGainAllocation && (
        <p className="px-4 pb-3 text-[11px] text-ink-soft">
          Generated from a loan/investment/bank interest distribution -- fix the source allocation instead of
          this row.
        </p>
      )}

      {isEditing && <SupportEditForm t={t} banks={banks} onSaved={onSaved} onCancel={onToggle} />}
    </div>
  )
}

function SupportEditForm({
  t,
  banks,
  onSaved,
  onCancel
}: {
  t: any
  banks: BankAccount[]
  onSaved: (updated: any) => void
  onCancel: () => void
}) {
  const [amount, setAmount] = useState(String(t.amount))
  const [description, setDescription] = useState(t.description ?? "")
  const legacyBankMatch = useMemo(() => matchLegacyBankText(banks, t.bank), [banks, t.bank])
  const [bankAccountId, setBankAccountId] = useState(t.bank_account_id ?? legacyBankMatch?.id ?? "")
  const [txnDate, setTxnDate] = useState(t.txn_date ?? "")
  const [status, setStatus] = useState(t.status)
  const [receipt, setReceipt] = useState<File | null>(null)
  const [receiptPreview, setReceiptPreview] = useState<string | null>(null)
  const [dragActive, setDragActive] = useState(false)
  const [existingReceiptSignedUrl, setExistingReceiptSignedUrl] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState("")

  useEffect(() => {
    if (t.receipt_url) {
      getReceiptSignedUrl(t.receipt_url).then(setExistingReceiptSignedUrl)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function setReceiptFile(file: File | null) {
    setReceipt(file)
    setReceiptPreview(file ? URL.createObjectURL(file) : null)
  }

  async function save() {
    const amountNum = Number(amount)
    if (amount.trim() === "" || Number.isNaN(amountNum)) {
      setMessage("Enter a valid amount.")
      return
    }

    // Withdrawal and Loan Release move real money out, and their receipt is
    // proof of the actual transfer amount -- changing the amount without
    // attaching a new receipt would leave one on file that no longer
    // matches what's recorded.
    const isMoneyOut = t.classification === "Member Withdrawal" || t.classification === "Loan Release"
    if (isMoneyOut && amountNum !== Number(t.amount) && !receipt) {
      setMessage("Amount changed for a withdrawal/loan disbursement -- attach an updated receipt before saving.")
      return
    }

    // This tool deliberately never activates a loan or snapshots a hold --
    // setting a still-"requested" loan's Loan Release to "approved" here
    // would leave the loan stuck at "requested" (with a reachable but
    // now-unusable "Approve & Activate", since that flow requires a
    // *pending* Loan Release transaction and this one would already be
    // "approved") with no path back through the UI. Approving a
    // disbursement always has to go through the real approval flow so the
    // loan and hold snapshot move together with it.
    if (t.classification === "Loan Release" && status === "approved" && t.loans?.status === "requested") {
      setMessage(
        "Can't approve a loan disbursement here -- it wouldn't activate the loan or snapshot the hold. Use the Approvals tab or the loan's own \"Approve & Activate\" instead."
      )
      return
    }

    // Moving a still-unapproved Loan Release to rejected/cancelled here
    // needs the same fix the normal admin reject button and the member's
    // own "Cancel entry" flow already apply: null the transaction's
    // loan_id (transactions.loan_id has a non-cascading foreign key into
    // loans) and delete the now-unreferenced loan -- otherwise it's
    // stranded at "requested" forever with a reachable "Approve &
    // Activate" that would activate it with nothing actually disbursed.
    // Only safe while the loan is still "requested": once it's active or
    // closed it has repayments, a hold snapshot, maybe a gain split, and
    // deleting it would destroy real data, so this tool leaves it alone
    // in that case.
    const isUnapprovedLoanRelease =
      t.classification === "Loan Release" &&
      t.loan_id &&
      t.loans?.status === "requested" &&
      (status === "rejected" || status === "cancelled")

    setSaving(true)
    setMessage("")

    let receiptUrl = t.receipt_url ?? null
    if (receipt) {
      const fileName = `${t.transaction_id}-${Date.now()}-${receipt.name}`
      const { error: uploadError } = await supabase.storage
        .from("Receipts")
        .upload(fileName, receipt, { contentType: receipt.type })

      if (uploadError) {
        setSaving(false)
        setMessage(uploadError.message)
        return
      }
      receiptUrl = fileName
    }

    const updates: Record<string, unknown> = {
      amount: amountNum,
      description: description || null,
      bank_account_id: bankAccountId || null,
      // Once a real bank account is linked, clear the legacy free-text
      // bank -- the list display prefers that text over the link whenever
      // it's present, so leaving it would make this fix invisible.
      bank: bankAccountId ? null : t.bank,
      txn_date: txnDate || null,
      status,
      receipt_url: receiptUrl
    }
    if (isUnapprovedLoanRelease) updates.loan_id = null

    const { data, error } = await supabase
      .from("transactions")
      .update(updates)
      .eq("transaction_id", t.transaction_id)
      .select(
        `
        *,
        members!transactions_member_id_fkey ( name ),
        loans!transactions_loan_id_fkey ( name, status ),
        investments!transactions_investment_id_fkey ( name ),
        bank_accounts!transactions_bank_account_id_fkey ( bank_name, account_name )
      `
      )
      .single()

    if (error) {
      setSaving(false)
      setMessage(error.message)
      return
    }

    if (isUnapprovedLoanRelease) {
      const { error: loanError } = await supabase.from("loans").delete().eq("loan_id", t.loan_id)
      if (loanError) {
        setSaving(false)
        setMessage(loanError.message)
        return
      }
    } else if (t.classification === "Loan Release" && t.loan_id && amountNum !== Number(t.amount)) {
      // loans.principal drives total_repayable/outstanding/gain everywhere
      // (v_loan_summary, the close-loan gain split, etc.) -- none of that
      // reads transactions.amount directly, so fixing only the transaction
      // here would be cosmetic-only in the ledger and never reach the
      // number that actually matters financially. Loan Release amounts are
      // stored negative; principal is always positive.
      const { error: loanError } = await supabase
        .from("loans")
        .update({ principal: Math.abs(amountNum) })
        .eq("loan_id", t.loan_id)
      if (loanError) {
        setSaving(false)
        setMessage(loanError.message)
        return
      }
    }

    setSaving(false)
    onSaved(data)
  }

  return (
    <div className="border-t border-hairline px-4 pt-4 pb-4 space-y-3">
      {t.classification === "Bank Interest" && t.interest_distributed && (
        <p className="text-[11px] text-gold bg-gold/10 border border-gold rounded-md px-3 py-2">
          This interest has already been split across members. Changing the amount here only corrects this
          transaction -- it won&apos;t update what members were already credited in bank_interest_allocations.
        </p>
      )}

      <div>
        <label className="block mb-1.5 text-xs uppercase tracking-wide text-ink-soft font-mono">
          Amount (as stored, including sign)
        </label>
        <input
          className="border border-hairline bg-paper text-ink text-sm rounded-sm px-3 py-2.5 w-full font-mono [font-variant-numeric:tabular-nums]"
          type="number"
          step="0.01"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
        />
      </div>

      <div>
        <label className="block mb-1.5 text-xs uppercase tracking-wide text-ink-soft font-mono">Date</label>
        <input
          className="border border-hairline bg-paper text-ink text-sm rounded-sm px-3 py-2.5 w-full font-mono"
          type="date"
          value={txnDate ?? ""}
          onChange={(e) => setTxnDate(e.target.value)}
        />
      </div>

      <div>
        <label className="block mb-1.5 text-xs uppercase tracking-wide text-ink-soft font-mono">Bank</label>
        <select
          className="border border-hairline bg-paper text-ink text-sm rounded-sm px-3 py-2.5 w-full"
          value={bankAccountId}
          onChange={(e) => setBankAccountId(e.target.value)}
        >
          <option value="">No bank linked</option>
          {banks.map((b) => (
            <option key={b.id} value={b.id}>
              {b.account_name || b.bank_name}
            </option>
          ))}
        </select>
        {t.bank_account_id == null && t.bank && (
          <p className="text-[11px] text-ink-soft mt-1.5">
            {legacyBankMatch
              ? `Currently showing "${t.bank}" as legacy text on the list -- pre-filled with the matching account above; saving will switch it to a real link.`
              : `Currently showing "${t.bank}" as legacy text on the list, with no matching bank account -- pick one above to link it properly, or leave as-is to keep the text.`}
          </p>
        )}
      </div>

      <div>
        <label className="block mb-1.5 text-xs uppercase tracking-wide text-ink-soft font-mono">Status</label>
        <select
          className="border border-hairline bg-paper text-ink text-sm rounded-sm px-3 py-2.5 w-full"
          value={status}
          onChange={(e) => setStatus(e.target.value)}
        >
          {STATUS_OPTIONS.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className="block mb-1.5 text-xs uppercase tracking-wide text-ink-soft font-mono">Description</label>
        <input
          className="border border-hairline bg-paper text-ink text-sm rounded-sm px-3 py-2.5 w-full"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
      </div>

      <div>
        <label className="block mb-1.5 text-xs uppercase tracking-wide text-ink-soft font-mono">Receipt</label>
        <ReceiptField
          receipt={receipt}
          receiptPreview={receiptPreview}
          existingReceiptUrl={t.receipt_url}
          existingReceiptSignedUrl={existingReceiptSignedUrl}
          dragActive={dragActive}
          setDragActive={setDragActive}
          onFileChange={setReceiptFile}
        />
      </div>

      {message && <p className="text-sm text-rust">{message}</p>}

      <div className="flex gap-2">
        <button
          className="bg-ink text-paper px-4 py-2.5 rounded-sm text-sm font-semibold flex-1 disabled:opacity-50"
          onClick={save}
          disabled={saving}
        >
          {saving ? "Saving..." : "Save fix"}
        </button>
        <button className="border border-hairline rounded-sm px-4 py-2.5 text-sm" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  )
}
