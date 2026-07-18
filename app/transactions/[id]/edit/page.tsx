"use client"

import { useEffect, useState } from "react"
import { useRouter, useParams } from "next/navigation"
import { supabase } from "@/lib/supabase"
import Navbar from "@/app/components/Navbar"
import { useAuth } from "@/app/auth-context"
import { SkeletonPanel } from "@/app/components/Skeleton"

// Member-submitted types: editable by the member who owns the row, only
// while it's still pending. Loan Release is excluded -- it's paired with a
// "loans" row that has no equivalent "cancelled" state of its own.
const MEMBER_EDITABLE = ["Member Contribution", "Member Withdrawal", "Loan Repayment"]

// Admin-entered types: always inserted already-approved with no owning
// member, so "pending" never applies -- editable by an admin at any time
// (short of already being cancelled).
const ADMIN_EDITABLE = ["Bank Interest", "Expense", "Internal Transfer"]

const TYPE_LABEL: Record<string, string> = {
  "Member Contribution": "Contribution",
  "Member Withdrawal": "Withdrawal Request",
  "Loan Repayment": "Loan Payment",
  "Bank Interest": "Bank Interest",
  "Expense": "Expense",
  "Internal Transfer": "Bank Transfer"
}

const HELPER_TEXT: Record<string, string> = {
  "Member Contribution": "You've already sent this money. Attach proof of deposit.",
  "Member Withdrawal": "You're requesting money to be sent to you. No receipt needed yet.",
  "Loan Repayment": "You've already sent this repayment. Attach proof of deposit.",
  "Bank Interest": "Recording interest earned by a bank account. Goes in as approved -- splitting it across members is a separate manual step from Admin.",
  "Expense": "Recording money spent out of the fund. Goes straight in as approved.",
  "Internal Transfer": "Moving money between two of the fund's own banks. Doesn't affect total contributions or cash — it's just internal."
}

const FLOW: Record<string, { arrow: string; tone: "in" | "out" | "neutral" }> = {
  "Member Contribution": { arrow: "↑", tone: "in" },
  "Member Withdrawal": { arrow: "↓", tone: "out" },
  "Loan Repayment": { arrow: "↑", tone: "in" },
  "Bank Interest": { arrow: "↑", tone: "in" },
  "Expense": { arrow: "↓", tone: "out" },
  "Internal Transfer": { arrow: "⇄", tone: "neutral" }
}

function FlowBadge({ classification }: { classification: string }) {
  const flow = FLOW[classification] ?? { arrow: "•", tone: "in" }
  const toneClass =
    flow.tone === "in" ? "text-sage bg-sage/10" : flow.tone === "out" ? "text-rust bg-rust/10" : "text-gold bg-gold/10"

  return (
    <span className={`w-7 h-7 rounded flex items-center justify-center text-sm font-bold shrink-0 ${toneClass}`}>
      {flow.arrow}
    </span>
  )
}

const STATUS_TONE: Record<string, string> = {
  pending: "text-gold border-gold/40",
  approved: "text-sage border-sage/40",
  rejected: "text-rust border-rust/40"
}

function isValidPositiveNumber(value: string): boolean {
  if (!value.trim()) return false
  const n = Number(value)
  return !Number.isNaN(n) && n > 0
}

export default function EditTransactionPage() {
  const router = useRouter()
  const params = useParams()
  const transactionId = params?.id as string

  const { loading: authLoading, member } = useAuth()
  const isAdmin = member?.role === "admin"
  const [dataLoading, setDataLoading] = useState(true)
  const checkingAccess = authLoading || dataLoading
  const [notFound, setNotFound] = useState(false)

  const [banks, setBanks] = useState<any[]>([])
  const [myLoans, setMyLoans] = useState<any[]>([])

  const [classification, setClassification] = useState("")
  const [status, setStatus] = useState("")
  const [bankId, setBankId] = useState("")
  const [toBankId, setToBankId] = useState("")
  const [loanId, setLoanId] = useState("")
  const [amount, setAmount] = useState("")
  const [description, setDescription] = useState("")
  const [existingReceiptUrl, setExistingReceiptUrl] = useState<string | null>(null)
  const [receipt, setReceipt] = useState<File | null>(null)
  const [receiptPreview, setReceiptPreview] = useState<string | null>(null)
  const [dragActive, setDragActive] = useState(false)

  const [saving, setSaving] = useState(false)
  const [cancelling, setCancelling] = useState(false)
  const [message, setMessage] = useState("")

  useEffect(() => {
    if (authLoading) return

    if (!member) {
      router.push("/login")
      return
    }

    if (member.status !== "approved") {
      router.push("/waiting")
      return
    }

    async function load() {
      if (!member) return

      const { data: bankList } = await supabase
        .from("bank_accounts")
        .select("id, bank_name, account_name")
        .order("bank_name")

      setBanks(bankList ?? [])

      const { data: txn, error } = await supabase
        .from("transactions")
        .select("*")
        .eq("transaction_id", transactionId)
        .single()

      const isAdminType = txn ? ADMIN_EDITABLE.includes(txn.classification) : false
      const isMemberType = txn ? MEMBER_EDITABLE.includes(txn.classification) : false

      const editable =
        txn &&
        !error &&
        ((isMemberType && txn.member_id === member.member_id && txn.status === "pending") ||
          (isAdminType && isAdmin && txn.status !== "cancelled"))

      if (!editable) {
        setNotFound(true)
        setDataLoading(false)
        return
      }

      setClassification(txn.classification)
      setStatus(txn.status)
      setBankId(txn.bank_account_id ?? "")
      setToBankId(txn.to_bank_account_id ?? "")
      setLoanId(txn.loan_id ?? "")
      setAmount(String(Math.abs(Number(txn.amount))))
      setDescription(txn.description ?? "")
      setExistingReceiptUrl(txn.receipt_url ?? null)

      if (txn.classification === "Loan Repayment") {
        const { data: loans } = await supabase
          .from("loans")
          .select("loan_id, principal, interest_rate, term_months, status, start_date")
          .eq("member_id", member.member_id)
          .in("status", ["active", "requested"])
          .order("start_date", { ascending: false })

        setMyLoans(loans ?? [])
      }

      setDataLoading(false)
    }

    load()
  }, [authLoading, member, router, transactionId])

  const isBankTransfer = classification === "Internal Transfer"
  const isLoanPayment = classification === "Loan Repayment"
  const needsBank =
    classification === "Member Contribution" ||
    classification === "Loan Repayment" ||
    classification === "Bank Interest" ||
    classification === "Expense" ||
    isBankTransfer
  const needsReceipt = classification === "Member Contribution" || classification === "Loan Repayment"

  function setReceiptFile(file: File | null) {
    setReceipt(file)
    setReceiptPreview(file ? URL.createObjectURL(file) : null)
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault()
    setDragActive(false)
    const file = e.dataTransfer.files?.[0]
    if (file) setReceiptFile(file)
  }

  const fmt = (n: number) =>
    Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })

  function bankLabel(id: string) {
    const bank = banks.find((b) => b.id === id)
    return bank ? bank.account_name || bank.bank_name : "Bank"
  }

  const chips: { done: boolean; text: string }[] = []
  if (isBankTransfer) {
    chips.push(
      bankId && toBankId
        ? { done: true, text: `✓ ${bankLabel(bankId)} → ${bankLabel(toBankId)}` }
        : { done: false, text: "Select both banks" }
    )
  } else if (needsBank) {
    chips.push(bankId ? { done: true, text: "✓ Bank selected" } : { done: false, text: "Bank required" })
  }
  if (needsReceipt) {
    chips.push(
      receipt || existingReceiptUrl
        ? { done: true, text: "✓ Receipt attached" }
        : { done: false, text: "Receipt required" }
    )
  }
  if (isLoanPayment) {
    chips.push(loanId ? { done: true, text: "✓ Loan matched" } : { done: false, text: "Select a loan" })
  }
  if (!needsBank && !needsReceipt) {
    chips.push({ done: false, text: "No receipt needed" })
  }

  async function handleSave() {
    setMessage("")

    if (!isValidPositiveNumber(amount)) {
      setMessage("Enter a valid amount greater than zero.")
      return
    }

    if (needsBank && !bankId) {
      setMessage(isBankTransfer ? "Select a source bank." : "Select a bank.")
      return
    }

    if (isBankTransfer && !toBankId) {
      setMessage("Select a destination bank.")
      return
    }

    if (isBankTransfer && bankId === toBankId) {
      setMessage("Source and destination banks must be different.")
      return
    }

    if (needsReceipt && !receipt && !existingReceiptUrl) {
      setMessage("Attach a receipt.")
      return
    }

    if (isLoanPayment && !loanId) {
      setMessage("Select which loan you're paying.")
      return
    }

    setSaving(true)

    let receiptUrl = existingReceiptUrl

    if (receipt) {
      const fileName = `${member?.member_id}-${Date.now()}-${receipt.name}`

      const { error: uploadError } = await supabase.storage
        .from("Receipts")
        .upload(fileName, receipt, { contentType: receipt.type })

      if (uploadError) {
        setMessage(uploadError.message)
        setSaving(false)
        return
      }

      const { data: urlData } = supabase.storage.from("Receipts").getPublicUrl(fileName)
      receiptUrl = urlData.publicUrl
    }

    // Withdrawals and expenses are cash going out, so the ledger stores
    // them negative -- matches the sign convention handleSubmit uses on
    // /transactions/new.
    const signedAmount =
      classification === "Member Withdrawal" || classification === "Expense" ? -Number(amount) : Number(amount)

    const { error } = await supabase
      .from("transactions")
      .update({
        amount: signedAmount,
        bank_account_id: needsBank ? bankId : null,
        to_bank_account_id: isBankTransfer ? toBankId : null,
        loan_id: isLoanPayment ? loanId : null,
        description,
        receipt_url: receiptUrl
      })
      .eq("transaction_id", transactionId)

    setSaving(false)

    if (error) {
      setMessage(error.message)
      return
    }

    router.push("/transactions")
  }

  async function handleCancelEntry() {
    if (
      !confirm(
        "Cancel this entry? It'll be marked cancelled and removed from the transaction list -- this can't be undone from the app."
      )
    ) {
      return
    }

    setCancelling(true)

    const { error } = await supabase
      .from("transactions")
      .update({ status: "cancelled" })
      .eq("transaction_id", transactionId)

    setCancelling(false)

    if (error) {
      setMessage(error.message)
      return
    }

    router.push("/transactions")
  }

  if (checkingAccess) {
    return (
      <>
        <Navbar />
        <main className="min-h-screen bg-paper text-ink font-sans">
          <div className="max-w-lg mx-auto px-4 sm:px-5 pt-8 pb-24">
            <SkeletonPanel />
          </div>
        </main>
      </>
    )
  }

  if (notFound) {
    return (
      <>
        <Navbar />
        <main className="min-h-screen bg-paper text-ink font-sans">
          <div className="max-w-lg mx-auto px-4 sm:px-5 pt-8 pb-24">
            <p className="text-sm text-ink-soft">
              This entry isn't editable -- it may have already been reviewed, cancelled, or belongs to someone else.
            </p>
            <button
              type="button"
              onClick={() => router.push("/transactions")}
              className="mt-4 text-sm text-gold font-semibold"
            >
              ← Back to Transactions
            </button>
          </div>
        </main>
      </>
    )
  }

  return (
    <>
      <Navbar />
      <main className="min-h-screen bg-paper text-ink font-sans">
        <div className="max-w-lg mx-auto px-4 sm:px-5 pt-8 pb-48">
          <button
            type="button"
            onClick={() => router.push("/transactions")}
            className="text-sm text-gold font-semibold mb-4"
          >
            ← Back to Transactions
          </button>
          <div className="text-xs tracking-[0.18em] uppercase text-gold font-mono mb-2">
            Editing Entry
          </div>
          <div className="flex items-baseline gap-2.5 flex-wrap">
            <h1 className="font-display text-4xl sm:text-5xl font-semibold text-ink">
              Edit Transaction
            </h1>
            <span
              className={`text-[10px] font-bold uppercase tracking-wide border rounded-full px-2.5 py-1 font-mono ${
                STATUS_TONE[status] ?? "text-ink-soft border-hairline"
              }`}
            >
              {status}
            </span>
          </div>

          <div className="mt-8 bg-paper-2 border border-hairline rounded-md p-5">
            <p className="text-xs font-bold uppercase tracking-wide text-ink font-mono mb-3">
              ① Entry type
            </p>
            <div className="flex items-center justify-between gap-3 border border-hairline bg-paper/60 rounded-md px-3.5 py-3">
              <span className="flex items-center gap-2.5 min-w-0">
                <FlowBadge classification={classification} />
                <span className="text-base font-semibold text-ink truncate">
                  {TYPE_LABEL[classification]}
                </span>
              </span>
              <span className="shrink-0 text-xs text-ink-soft whitespace-nowrap">🔒 Can't be changed</span>
            </div>
            <p className="text-sm text-ink-soft mt-3">
              To record a different kind of entry, cancel this one below and start a new one.
            </p>
            <p className="text-sm text-ink-soft mt-1">{HELPER_TEXT[classification]}</p>

            <p className="text-xs font-bold uppercase tracking-wide text-ink font-mono mb-3 mt-6 pt-[18px] border-t border-hairline">
              ② Amount &amp; details
            </p>

            <div className="space-y-4">
              {isLoanPayment && (
                <div>
                  <label className="block mb-2 text-sm uppercase tracking-wide text-ink-soft font-mono">
                    Which loan
                  </label>
                  {myLoans.filter((l) => l.status === "active").length === 0 ? (
                    <p className="text-sm text-rust">No active loans to pay against.</p>
                  ) : (
                    <select
                      className="border border-hairline bg-paper text-ink text-base rounded-md px-3 py-3 w-full"
                      value={loanId}
                      onChange={(e) => setLoanId(e.target.value)}
                    >
                      <option value="">Select a loan</option>
                      {myLoans
                        .filter((l) => l.status === "active" || l.loan_id === loanId)
                        .map((loan) => (
                          <option key={loan.loan_id} value={loan.loan_id}>
                            ₱{fmt(loan.principal)} from {loan.start_date}
                          </option>
                        ))}
                    </select>
                  )}
                </div>
              )}

              <div>
                <label className="block mb-2 text-sm uppercase tracking-wide text-ink-soft font-mono">
                  Amount
                </label>
                <input
                  className="border border-hairline bg-paper text-ink text-base rounded-md px-3 py-3 w-full font-mono [font-variant-numeric:tabular-nums]"
                  type="number"
                  min="0.01"
                  step="0.01"
                  placeholder="0.00"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                />
              </div>

              {needsBank && (
                <div>
                  <label className="block mb-2 text-sm uppercase tracking-wide text-ink-soft font-mono">
                    {isBankTransfer ? "From bank" : "Bank"}
                  </label>
                  <select
                    className="border border-hairline bg-paper text-ink text-base rounded-md px-3 py-3 w-full"
                    value={bankId}
                    onChange={(e) => setBankId(e.target.value)}
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

              {isBankTransfer && (
                <div>
                  <label className="block mb-2 text-sm uppercase tracking-wide text-ink-soft font-mono">
                    To bank
                  </label>
                  <select
                    className="border border-hairline bg-paper text-ink text-base rounded-md px-3 py-3 w-full"
                    value={toBankId}
                    onChange={(e) => setToBankId(e.target.value)}
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

              <div>
                <label className="block mb-2 text-sm uppercase tracking-wide text-ink-soft font-mono">
                  Description
                </label>
                <input
                  className="border border-hairline bg-paper text-ink text-base rounded-md px-3 py-3 w-full"
                  placeholder="Add a note"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                />
              </div>

              {needsReceipt && (
                <div>
                  <label className="block mb-2 text-sm uppercase tracking-wide text-ink-soft font-mono">
                    Receipt
                  </label>

                  {!receiptPreview && existingReceiptUrl && (
                    <div className="relative border border-hairline rounded-md p-3 flex items-center gap-3">
                      <img
                        src={existingReceiptUrl}
                        alt="Current receipt"
                        className="w-16 h-16 object-cover rounded-md border border-hairline"
                      />
                      <div className="min-w-0 flex-1">
                        <p className="text-base text-ink">Current receipt</p>
                        <p className="text-sm text-ink-soft">Tap Replace to upload a different photo</p>
                      </div>
                      <label className="shrink-0 text-sm font-semibold text-gold border border-gold/40 rounded-full px-3 py-1.5 cursor-pointer">
                        Replace
                        <input
                          type="file"
                          accept="image/*"
                          className="hidden"
                          onChange={(e) => setReceiptFile(e.target.files?.[0] ?? null)}
                        />
                      </label>
                    </div>
                  )}

                  {!receiptPreview && !existingReceiptUrl && (
                    <label
                      onDragOver={(e) => {
                        e.preventDefault()
                        setDragActive(true)
                      }}
                      onDragLeave={() => setDragActive(false)}
                      onDrop={handleDrop}
                      className={`
                        flex flex-col items-center justify-center gap-2
                        border-2 border-dashed rounded-md
                        py-10 px-4 cursor-pointer text-center transition-colors
                        ${dragActive ? "border-gold bg-gold/5" : "border-hairline"}
                      `}
                    >
                      <span className="text-2xl">📎</span>
                      <span className="text-base text-ink">Tap to upload, or drag a photo here</span>
                      <span className="text-sm text-ink-soft">Screenshot or photo of your deposit slip</span>
                      <input
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={(e) => setReceiptFile(e.target.files?.[0] ?? null)}
                      />
                    </label>
                  )}

                  {receiptPreview && (
                    <div className="relative border border-hairline rounded-md p-3 flex items-center gap-3">
                      <img
                        src={receiptPreview}
                        alt="New receipt preview"
                        className="w-16 h-16 object-cover rounded-md border border-hairline"
                      />
                      <div className="min-w-0 flex-1">
                        <p className="text-base text-ink truncate">{receipt?.name}</p>
                        <p className="text-sm text-ink-soft">
                          {receipt ? `${(receipt.size / 1024).toFixed(0)} KB` : ""}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => setReceiptFile(null)}
                        className="text-sm text-rust border border-rust rounded-full px-2.5 py-1 shrink-0"
                      >
                        Remove
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          <button
            type="button"
            onClick={handleCancelEntry}
            disabled={cancelling}
            className="mt-4 text-sm text-rust disabled:opacity-50"
          >
            {cancelling ? "Cancelling…" : "Cancel this entry"}
          </button>
        </div>
      </main>

      <div
        className="fixed bottom-0 left-0 right-0 z-30 bg-paper border-t border-hairline"
        style={{ paddingBottom: "calc(1rem + env(safe-area-inset-bottom))" }}
      >
        <div className="max-w-lg mx-auto px-4 sm:px-5 pt-4 flex items-center gap-3">
          <div className="min-w-0 flex-1">
            <div className="text-xs uppercase tracking-wide text-ink-soft font-mono">Amount</div>
            <div className="font-mono [font-variant-numeric:tabular-nums] text-2xl font-bold text-ink truncate">
              ₱{isValidPositiveNumber(amount) ? fmt(Number(amount)) : "0.00"}
            </div>
            <div className="flex flex-wrap gap-1.5 mt-2">
              {chips.map((chip, i) => (
                <span
                  key={i}
                  className={`inline-flex items-center gap-1 text-xs font-semibold px-2 py-1 rounded-full border whitespace-nowrap ${
                    chip.done ? "text-sage border-sage/40" : "text-ink-soft border-hairline"
                  }`}
                >
                  {chip.text}
                </span>
              ))}
            </div>
          </div>
          <button
            className="shrink-0 bg-ink text-paper px-6 py-3.5 rounded-full text-base font-bold shadow-lg shadow-gold/30 ring-1 ring-gold/40 motion-safe:transition-transform motion-safe:active:scale-[0.97] disabled:opacity-50 disabled:shadow-none disabled:ring-0"
            onClick={handleSave}
            disabled={saving}
          >
            {saving ? "Saving…" : "Save Changes"}
          </button>
        </div>
        {message && (
          <div className="max-w-lg mx-auto px-4 sm:px-5 pt-2">
            <p className="text-sm text-rust">{message}</p>
          </div>
        )}
      </div>
    </>
  )
}
