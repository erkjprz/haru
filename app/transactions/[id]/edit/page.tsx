"use client"

import { useEffect, useState } from "react"
import { useRouter, useParams } from "next/navigation"
import { supabase } from "@/lib/supabase"
import Navbar from "@/app/components/Navbar"
import BorrowerHeader from "@/app/components/BorrowerHeader"
import { useAuth } from "@/app/auth-context"
import { SkeletonPanel } from "@/app/components/Skeleton"
import {
  AmountHero,
  FlowBadge,
  StepTrack,
  ReviewRow,
  ReceiptField,
  RequiredMark,
  FieldGroup
} from "@/app/components/TransactionFormUI"
import { totalRepayable, type InterestType } from "@/lib/loanMath"
import { getReceiptSignedUrl } from "@/lib/receiptUrl"

// Member-submitted types: editable by the member who owns the row, only
// while it's still pending.
const MEMBER_EDITABLE = ["Member Contribution", "Member Withdrawal", "Loan Repayment"]

// Admin-entered types: always inserted already-approved with no owning
// member, so "pending" never applies -- editable by an admin at any time
// (short of already being cancelled).
const ADMIN_EDITABLE = ["Bank Interest", "Expense", "Internal Transfer"]

// Loan Release is handled separately (see load()): it's paired with a
// "loans" row, so it's only editable by an admin, and only while that loan
// is still "requested" -- once approved/active, changes belong on the
// loan's own page instead.

const TYPE_LABEL: Record<string, string> = {
  "Member Contribution": "Contribution",
  "Member Withdrawal": "Withdrawal Request",
  "Loan Repayment": "Loan Payment",
  "Loan Release": "Loan Disbursement",
  "Bank Interest": "Bank Interest",
  "Expense": "Expense",
  "Internal Transfer": "Bank Transfer"
}

const HELPER_TEXT: Record<string, string> = {
  "Member Contribution": "You've already sent this money. Attach proof of deposit.",
  "Member Withdrawal": "You're requesting money to be sent to you. No receipt needed yet.",
  "Loan Repayment": "You've already sent this repayment. Attach proof of deposit.",
  "Loan Release": "This member is requesting to borrow from the fund. No bank is assigned until you approve it from the loan's own page.",
  "Bank Interest": "Recording interest earned by a bank account. Attach the bank statement or screenshot showing it credited. Goes in as approved -- splitting it across members is a separate manual step from Admin.",
  "Expense": "Recording money spent out of the fund. Attach a receipt or proof of payment. Goes straight in as approved.",
  "Internal Transfer": "Moving money between two of the fund's own banks. Attach a screenshot of the transfer confirmation. Doesn't affect total contributions or cash — it's just internal."
}

const FLOW: Record<string, { arrow: string; tone: "in" | "out" | "neutral" }> = {
  "Member Contribution": { arrow: "↑", tone: "in" },
  "Member Withdrawal": { arrow: "↓", tone: "out" },
  "Loan Repayment": { arrow: "↑", tone: "in" },
  "Loan Release": { arrow: "↓", tone: "out" },
  "Bank Interest": { arrow: "↑", tone: "in" },
  "Expense": { arrow: "↓", tone: "out" },
  "Internal Transfer": { arrow: "⇄", tone: "neutral" }
}

const STATUS_TONE: Record<string, string> = {
  pending: "text-gold border-gold/40",
  approved: "text-sage border-sage/40",
  rejected: "text-rust border-rust/40"
}

// allowZero: interest rate may legitimately be 0.
function isValidPositiveNumber(value: string, allowZero = false): boolean {
  if (!value.trim()) return false
  const n = Number(value)
  if (Number.isNaN(n)) return false
  return allowZero ? n >= 0 : n > 0
}

export default function EditTransactionPage() {
  const router = useRouter()
  const params = useParams()
  const transactionId = params?.id as string

  const { loading: authLoading, member } = useAuth()
  const isAdmin = member?.role === "admin"
  const isBorrower = member?.role === "borrower"
  const backHref = isBorrower ? "/borrower" : "/transactions"
  const backLabel = isBorrower ? "← Your loan" : "← Transactions"
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
  const [interestType, setInterestType] = useState<InterestType>("rate")
  const [interestRate, setInterestRate] = useState("")
  const [interestAmount, setInterestAmount] = useState("")
  const [termMonths, setTermMonths] = useState("")
  const [repaymentFrequency, setRepaymentFrequency] = useState("monthly")
  const [description, setDescription] = useState("")
  const [existingReceiptUrl, setExistingReceiptUrl] = useState<string | null>(null)
  const [existingReceiptSignedUrl, setExistingReceiptSignedUrl] = useState<string | null>(null)
  const [receipt, setReceipt] = useState<File | null>(null)
  const [receiptPreview, setReceiptPreview] = useState<string | null>(null)
  const [dragActive, setDragActive] = useState(false)

  const [saving, setSaving] = useState(false)
  const [cancelling, setCancelling] = useState(false)
  const [message, setMessage] = useState("")

  // Loan Release is the one editable type with enough conditional fields
  // to earn its own Details -> Review sub-flow, matching /transactions/new.
  const [formStep, setFormStep] = useState<1 | 2>(1)

  useEffect(() => {
    if (!existingReceiptUrl) return

    let cancelled = false
    getReceiptSignedUrl(existingReceiptUrl).then((signedUrl) => {
      if (!cancelled) setExistingReceiptSignedUrl(signedUrl)
    })

    return () => {
      cancelled = true
    }
  }, [existingReceiptUrl])

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

    // Borrowers are otherwise routed away from the admin/member transaction
    // pages, but this edit page also serves their own pending Loan
    // Repayment entries (see MEMBER_EDITABLE below), so they're let through
    // here -- the `editable` check further down still keeps them out of
    // anything that isn't theirs.

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

      const isMemberType = txn ? MEMBER_EDITABLE.includes(txn.classification) : false
      const isAdminSimpleType = txn ? ADMIN_EDITABLE.includes(txn.classification) : false
      const isLoanReleaseType = txn ? txn.classification === "Loan Release" : false

      let loanRecord: any = null
      if (isLoanReleaseType && txn?.loan_id) {
        const { data: loan } = await supabase.from("loans").select("*").eq("loan_id", txn.loan_id).single()
        loanRecord = loan
      }

      const editable =
        txn &&
        !error &&
        ((isMemberType && txn.member_id === member.member_id && txn.status === "pending") ||
          (isAdminSimpleType && isAdmin && txn.status !== "cancelled") ||
          (isLoanReleaseType && isAdmin && txn.status === "pending" && loanRecord?.status === "requested"))

      if (!editable) {
        setNotFound(true)
        setDataLoading(false)
        return
      }

      setClassification(txn.classification)
      setStatus(txn.status)
      setBankId(txn.bank_account_id ?? "")
      setToBankId(txn.to_bank_account_id ?? "")
      setDescription(txn.description ?? "")
      setExistingReceiptUrl(txn.receipt_url ?? null)
      setFormStep(1)

      if (isLoanReleaseType && loanRecord) {
        setLoanId(loanRecord.loan_id)
        setAmount(String(Number(loanRecord.principal)))
        setInterestType(loanRecord.interest_type === "amount" ? "amount" : "rate")
        setInterestRate(String(Number(loanRecord.interest_rate ?? 0)))
        setInterestAmount(loanRecord.interest_amount != null ? String(Number(loanRecord.interest_amount)) : "")
        setTermMonths(loanRecord.term_months != null ? String(loanRecord.term_months) : "")
        setRepaymentFrequency(loanRecord.repayment_frequency ?? "monthly")
      } else {
        setLoanId(txn.loan_id ?? "")
        setAmount(String(Math.abs(Number(txn.amount))))
      }

      if (txn.classification === "Loan Repayment") {
        // Borrower-only loans (e.g. Joy, who isn't a fund member) link via
        // borrowers.borrower_id rather than member_id -- mirrors the OR
        // filter borrower/repay uses so a borrower editing their own
        // pending repayment still sees their loan in the dropdown.
        const { data: borrowerRow } = await supabase
          .from("borrowers")
          .select("borrower_id")
          .eq("member_id", member.member_id)
          .maybeSingle()

        const loanFilter = borrowerRow?.borrower_id
          ? `member_id.eq.${member.member_id},borrower_id.eq.${borrowerRow.borrower_id}`
          : `member_id.eq.${member.member_id}`

        const { data: loans } = await supabase
          .from("loans")
          .select("loan_id, principal, interest_rate, term_months, status, start_date")
          .or(loanFilter)
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
  const isLoanRelease = classification === "Loan Release"
  const needsBank =
    classification === "Member Contribution" ||
    classification === "Loan Repayment" ||
    classification === "Bank Interest" ||
    classification === "Expense" ||
    isBankTransfer
  // Every editable type requires a receipt except Member Withdrawal and
  // Loan Release, where nothing has actually moved yet -- mirrors the same
  // rule on /transactions/new (see the comment there for why admin-entered
  // types like Bank Interest/Expense/Internal Transfer are included).
  const needsReceipt = classification !== "Member Withdrawal" && !isLoanRelease

  const previewTotalRepayable =
    isLoanRelease &&
    isValidPositiveNumber(amount) &&
    (interestType === "rate"
      ? isValidPositiveNumber(interestRate, true)
      : isValidPositiveNumber(interestAmount, true))
      ? totalRepayable(Number(amount), interestType, Number(interestRate || 0), Number(interestAmount || 0))
      : 0

  const previewPerInstallment =
    previewTotalRepayable && isValidPositiveNumber(termMonths) && repaymentFrequency === "monthly"
      ? previewTotalRepayable / Number(termMonths)
      : previewTotalRepayable

  function setReceiptFile(file: File | null) {
    setReceipt(file)
    setReceiptPreview(file ? URL.createObjectURL(file) : null)
  }

  const fmt = (n: number) =>
    Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })

  // Gate for Loan Release's Details step "Continue" -- the same checks
  // handleSave itself makes for this type, just run earlier so the Review
  // step never shows something that can't actually be saved.
  function detailsStepError(): string {
    if (!isValidPositiveNumber(amount)) return "Enter a valid amount greater than zero."

    if (isLoanRelease) {
      if (interestType === "rate" && !isValidPositiveNumber(interestRate, true)) {
        return "Enter a valid interest rate (0 or higher)."
      }
      if (interestType === "amount" && !isValidPositiveNumber(interestAmount, true)) {
        return "Enter a valid interest amount (0 or higher)."
      }
      if (!isValidPositiveNumber(termMonths)) return "Enter a valid term, in months greater than zero."
    }

    return ""
  }

  function handleContinueToReview() {
    const error = detailsStepError()
    if (error) {
      setMessage(error)
      return
    }
    setMessage("")
    setFormStep(2)
  }


  async function handleSave() {
    setMessage("")

    if (!isValidPositiveNumber(amount)) {
      setMessage("Enter a valid amount greater than zero.")
      return
    }

    if (isLoanRelease) {
      if (interestType === "rate" && !isValidPositiveNumber(interestRate, true)) {
        setMessage("Enter a valid interest rate (0 or higher).")
        return
      }

      if (interestType === "amount" && !isValidPositiveNumber(interestAmount, true)) {
        setMessage("Enter a valid interest amount (0 or higher).")
        return
      }

      if (!isValidPositiveNumber(termMonths)) {
        setMessage("Enter a valid term, in months greater than zero.")
        return
      }
    } else {
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
    }

    setSaving(true)

    // Loan Release's amount mirrors the linked loan's principal, and its
    // rate/term/repayment mode live on the loan row, not the transaction --
    // both need updating together to stay in sync.
    if (isLoanRelease) {
      const { error: loanError } = await supabase
        .from("loans")
        .update({
          principal: Number(amount),
          interest_type: interestType,
          interest_rate: interestType === "rate" ? Number(interestRate) : 0,
          interest_amount: interestType === "amount" ? Number(interestAmount) : null,
          term_months: Number(termMonths),
          repayment_frequency: repaymentFrequency,
          notes: description
        })
        .eq("loan_id", loanId)

      if (loanError) {
        setMessage(loanError.message)
        setSaving(false)
        return
      }

      const { error } = await supabase
        .from("transactions")
        .update({ amount: -Number(amount), description })
        .eq("transaction_id", transactionId)

      setSaving(false)

      if (error) {
        setMessage(error.message)
        return
      }

      router.push(backHref)
      return
    }

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

      receiptUrl = fileName
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

    router.push(backHref)
  }

  async function handleCancelEntry() {
    const confirmMsg = isLoanRelease
      ? "Cancel this loan request? The pending disbursement and the loan record will both be removed -- this can't be undone from the app."
      : "Cancel this entry? It'll be marked cancelled and removed from the transaction list -- this can't be undone from the app."

    if (!confirm(confirmMsg)) {
      return
    }

    setCancelling(true)

    // Loan Release: the loan row is being deleted, so the reference to it
    // has to go first -- otherwise the foreign key stops the delete.
    const updates: Record<string, any> = { status: "cancelled" }
    if (isLoanRelease) updates.loan_id = null

    const { error } = await supabase.from("transactions").update(updates).eq("transaction_id", transactionId)

    if (!error && isLoanRelease && loanId) {
      const { error: loanError } = await supabase.from("loans").delete().eq("loan_id", loanId)

      if (loanError) {
        setCancelling(false)
        setMessage(loanError.message)
        return
      }
    }

    setCancelling(false)

    if (error) {
      setMessage(error.message)
      return
    }

    router.push(backHref)
  }

  if (checkingAccess) {
    return (
      <>
        {isBorrower ? <BorrowerHeader /> : <Navbar />}
        <main className="min-h-screen bg-paper text-ink font-sans overflow-x-hidden">
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
        {isBorrower ? <BorrowerHeader /> : <Navbar />}
        <main className="min-h-screen bg-paper text-ink font-sans overflow-x-hidden">
          <div className="max-w-lg mx-auto px-4 sm:px-5 pt-8 pb-24">
            <p className="text-sm text-ink-soft">
              This entry isn't editable -- it may have already been reviewed, cancelled, or belongs to someone else.
            </p>
            <button
              type="button"
              onClick={() => router.push(backHref)}
              className="mt-4 text-sm text-gold font-semibold"
            >
              {backLabel}
            </button>
          </div>
        </main>
      </>
    )
  }

  return (
    <>
      {isBorrower ? <BorrowerHeader /> : <Navbar />}
      <main className="min-h-screen bg-paper text-ink font-sans overflow-x-hidden">
        {/* pb-64 instead of the sticky footer's own ~pb-48 worth of space --
            the footer's height varies with wrapped chips or a validation
            message, so extra slack here keeps the bottom of the card from
            ever landing underneath it and becoming unreachable by scroll. */}
        <div className="max-w-lg mx-auto px-4 sm:px-5 pt-8 pb-64">
          <button
            type="button"
            onClick={() => router.push(backHref)}
            className="text-[13px] text-ink-soft mb-4 hover:text-ink transition-colors"
          >
            {backLabel}
          </button>

          <div className="bg-paper-2 border border-hairline rounded-md p-5">
            <AmountHero
              value={amount}
              onChange={setAmount}
              label={isLoanRelease ? "Amount to borrow" : "Amount"}
              helper={HELPER_TEXT[classification]}
            />

            <div className="flex items-center justify-between gap-3 border border-hairline bg-paper rounded-full pl-1.5 pr-3 py-1.5">
              <span className="flex items-center gap-2.5 min-w-0">
                <FlowBadge {...(FLOW[classification] ?? { arrow: "•", tone: "in" })} small />
                <span className="text-sm font-semibold text-ink truncate">
                  {TYPE_LABEL[classification]}
                </span>
              </span>
              <span className="shrink-0 flex items-center gap-2">
                <span
                  className={`text-[10px] font-bold uppercase tracking-wide border rounded-full px-2 py-0.5 font-mono ${
                    STATUS_TONE[status] ?? "text-ink-soft border-hairline"
                  }`}
                >
                  {status}
                </span>
                <span className="text-xs text-ink-soft" title="Type can't be changed">
                  🔒
                </span>
              </span>
            </div>
          </div>

          <div className="space-y-4 mt-4">
            {!isLoanRelease && (
              <>
                <FieldGroup label="Details">
                  <div className="space-y-4">
                    {isLoanPayment && (
                      <div>
                        <label className="block mb-2 text-xs uppercase tracking-wide text-ink-soft font-mono">
                          Which loan
                          <RequiredMark />
                        </label>
                        {myLoans.filter((l) => l.status === "active").length === 0 ? (
                          <p className="text-sm text-rust">No active loans to pay against.</p>
                        ) : (
                          <select
                            className="border border-hairline bg-paper text-ink text-sm rounded-sm px-3 py-3 w-full"
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

                    {needsBank && (
                      <div>
                        <label className="block mb-2 text-xs uppercase tracking-wide text-ink-soft font-mono">
                          {isBankTransfer ? "From bank" : "Bank"}
                          <RequiredMark />
                        </label>
                        <select
                          className="border border-hairline bg-paper text-ink text-sm rounded-sm px-3 py-3 w-full"
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
                        <label className="block mb-2 text-xs uppercase tracking-wide text-ink-soft font-mono">
                          To bank
                          <RequiredMark />
                        </label>
                        <select
                          className="border border-hairline bg-paper text-ink text-sm rounded-sm px-3 py-3 w-full"
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
                      <label className="block mb-2 text-xs uppercase tracking-wide text-ink-soft font-mono">
                        Description
                      </label>
                      <input
                        className="border border-hairline bg-paper text-ink text-sm rounded-sm px-3 py-3 w-full"
                        placeholder="Add a note"
                        value={description}
                        onChange={(e) => setDescription(e.target.value)}
                      />
                    </div>
                  </div>
                </FieldGroup>

                {needsReceipt && (
                  <FieldGroup label="Proof">
                    <div>
                      <label className="block mb-2 text-xs uppercase tracking-wide text-ink-soft font-mono">
                        Receipt
                        <RequiredMark />
                      </label>
                      <ReceiptField
                        receipt={receipt}
                        receiptPreview={receiptPreview}
                        existingReceiptUrl={existingReceiptUrl}
                        existingReceiptSignedUrl={existingReceiptSignedUrl}
                        dragActive={dragActive}
                        setDragActive={setDragActive}
                        onFileChange={setReceiptFile}
                      />
                    </div>
                  </FieldGroup>
                )}
              </>
            )}

            {isLoanRelease && (
              <>
                <StepTrack step={formStep} labels={["Details", "Review"]} />

                {formStep === 1 && (
                  <FieldGroup>
                    <div className="space-y-4">
                      <div>
                        <label className="block mb-2 text-xs uppercase tracking-wide text-ink-soft font-mono">
                          Interest
                          <RequiredMark />
                        </label>
                        <div className="flex border border-hairline rounded-sm overflow-hidden mb-2">
                          <button
                            type="button"
                            onClick={() => setInterestType("rate")}
                            className={`flex-1 text-sm font-semibold py-2.5 transition-colors ${
                              interestType === "rate" ? "bg-ink text-paper" : "bg-paper text-ink-soft"
                            }`}
                          >
                            Rate (%)
                          </button>
                          <button
                            type="button"
                            onClick={() => setInterestType("amount")}
                            className={`flex-1 text-sm font-semibold py-2.5 transition-colors ${
                              interestType === "amount" ? "bg-ink text-paper" : "bg-paper text-ink-soft"
                            }`}
                          >
                            Fixed amount (₱)
                          </button>
                        </div>
                        {interestType === "rate" ? (
                          <input
                            className="border border-hairline bg-paper text-ink text-sm rounded-sm px-3 py-3 w-full font-mono [font-variant-numeric:tabular-nums]"
                            type="number"
                            min="0"
                            step="0.01"
                            placeholder="e.g. 5"
                            value={interestRate}
                            onChange={(e) => setInterestRate(e.target.value)}
                          />
                        ) : (
                          <input
                            className="border border-hairline bg-paper text-ink text-sm rounded-sm px-3 py-3 w-full font-mono [font-variant-numeric:tabular-nums]"
                            type="number"
                            min="0"
                            step="0.01"
                            placeholder="e.g. 5000"
                            value={interestAmount}
                            onChange={(e) => setInterestAmount(e.target.value)}
                          />
                        )}
                      </div>

                      <div>
                        <label className="block mb-2 text-xs uppercase tracking-wide text-ink-soft font-mono">
                          Term (months)
                          <RequiredMark />
                        </label>
                        <input
                          className="border border-hairline bg-paper text-ink text-sm rounded-sm px-3 py-3 w-full font-mono [font-variant-numeric:tabular-nums]"
                          type="number"
                          min="1"
                          step="1"
                          placeholder="e.g. 6"
                          value={termMonths}
                          onChange={(e) => setTermMonths(e.target.value)}
                        />
                      </div>

                      <div>
                        <label className="block mb-2 text-xs uppercase tracking-wide text-ink-soft font-mono">
                          Repayment mode
                        </label>
                        <select
                          className="border border-hairline bg-paper text-ink text-sm rounded-sm px-3 py-3 w-full"
                          value={repaymentFrequency}
                          onChange={(e) => setRepaymentFrequency(e.target.value)}
                        >
                          <option value="monthly">Monthly installments</option>
                          <option value="lump_sum">One lump sum at end of term</option>
                        </select>
                      </div>

                      {previewTotalRepayable > 0 && isValidPositiveNumber(termMonths) && (
                        <div className="border border-hairline rounded-md p-4 bg-paper">
                          <p className="text-sm text-ink-soft font-mono mb-2">Estimated repayment</p>
                          <div className="flex justify-between text-base font-mono [font-variant-numeric:tabular-nums]">
                            <span className="text-ink-soft">Total repayable</span>
                            <span>₱{fmt(previewTotalRepayable)}</span>
                          </div>
                          <div className="flex justify-between text-base font-mono [font-variant-numeric:tabular-nums] mt-1">
                            <span className="text-ink-soft">
                              {repaymentFrequency === "monthly"
                                ? `Per month × ${termMonths}`
                                : `Due at ${termMonths} months`}
                            </span>
                            <span className="font-semibold">₱{fmt(previewPerInstallment)}</span>
                          </div>
                        </div>
                      )}

                      <div>
                        <label className="block mb-2 text-xs uppercase tracking-wide text-ink-soft font-mono">
                          Description
                        </label>
                        <input
                          className="border border-hairline bg-paper text-ink text-sm rounded-sm px-3 py-3 w-full"
                          placeholder="Add a note"
                          value={description}
                          onChange={(e) => setDescription(e.target.value)}
                        />
                      </div>
                    </div>
                  </FieldGroup>
                )}

                {formStep === 2 && (
                  <FieldGroup>
                    <ReviewRow label="Type" value={TYPE_LABEL[classification] ?? ""} />
                    <ReviewRow
                      label="Amount to borrow"
                      value={`₱${fmt(isValidPositiveNumber(amount) ? Number(amount) : 0)}`}
                    />
                    <ReviewRow
                      label="Interest"
                      value={
                        interestType === "rate"
                          ? `${interestRate || 0}%`
                          : `₱${fmt(Number(interestAmount) || 0)} fixed`
                      }
                    />
                    <ReviewRow label="Term" value={`${termMonths || 0} months`} />
                    <ReviewRow
                      label="Repayment"
                      value={repaymentFrequency === "monthly" ? "Monthly installments" : "Lump sum at end of term"}
                    />
                    {previewTotalRepayable > 0 && (
                      <ReviewRow label="Est. total repayable" value={`₱${fmt(previewTotalRepayable)}`} />
                    )}
                    {description && <ReviewRow label="Description" value={description} />}
                  </FieldGroup>
                )}
              </>
            )}

            <FieldGroup>
              <p className="text-xs text-ink-soft mb-3">
                {isLoanRelease
                  ? "Changed your mind? This cancels the loan request and removes its pending disbursement entirely -- it can't be undone from the app."
                  : "Changed your mind? This entry will be marked cancelled and removed from the transaction list -- it can't be undone from the app."}
              </p>
              <button
                type="button"
                onClick={handleCancelEntry}
                disabled={cancelling}
                className="w-full text-sm font-semibold text-rust border border-rust rounded-sm px-4 py-2.5 disabled:opacity-50"
              >
                {cancelling ? "Cancelling…" : "Cancel this entry"}
              </button>
            </FieldGroup>
          </div>
        </div>
      </main>

      <div
        className="fixed bottom-0 left-0 right-0 z-30 bg-paper border-t border-hairline"
        style={{ paddingBottom: "calc(1rem + env(safe-area-inset-bottom))" }}
      >
        {message && (
          <div className="max-w-lg mx-auto px-4 sm:px-5 pt-3">
            <p className="text-sm text-rust">{message}</p>
          </div>
        )}
        <div className="max-w-lg mx-auto px-4 sm:px-5 pt-3 flex items-center gap-3">
          {isLoanRelease && formStep === 2 && (
            <button
              className="shrink-0 border border-hairline text-ink-soft px-5 py-3.5 rounded-full text-base font-semibold"
              onClick={() => setFormStep(1)}
            >
              Back
            </button>
          )}
          <button
            className="flex-1 bg-ink text-paper px-6 py-3.5 rounded-full text-base font-bold shadow-lg shadow-gold/30 ring-1 ring-gold/40 motion-safe:transition-transform motion-safe:active:scale-[0.97] disabled:opacity-50 disabled:shadow-none disabled:ring-0"
            onClick={isLoanRelease && formStep === 1 ? handleContinueToReview : handleSave}
            disabled={saving}
          >
            {saving ? "Saving…" : isLoanRelease && formStep === 1 ? "Continue" : "Save Changes"}
          </button>
        </div>
      </div>
    </>
  )
}
