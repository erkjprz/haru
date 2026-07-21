"use client"

import { useEffect, useLayoutEffect, useRef, useState } from "react"
import { useRouter, useParams } from "next/navigation"
import { supabase } from "@/lib/supabase"
import Navbar from "@/app/components/Navbar"
import BorrowerHeader from "@/app/components/BorrowerHeader"
import { useAuth } from "@/app/auth-context"
import { SkeletonPanel } from "@/app/components/Skeleton"
import {
  RowGroup,
  SelectRow,
  TextRow,
  NumberRow,
  AmountHero,
  TypeReadOnlyBadge,
  DangerRow
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

  // Defensive against iOS Safari restoring a previous scroll position on
  // back-forward-cache navigation -- this form should always start at the
  // top regardless of where the last page left off.
  useEffect(() => {
    window.scrollTo(0, 0)
  }, [])

  // The sticky bottom bar's height isn't fixed -- it grows when chips wrap
  // to a second line or a validation message appears. Measuring it and
  // feeding that back into the content's bottom padding means the last row
  // never sits hidden behind the bar, without having to pad every page for
  // the tallest bar that could ever occur.
  const bottomBarRef = useRef<HTMLDivElement>(null)
  const [bottomBarHeight, setBottomBarHeight] = useState(0)
  // useLayoutEffect, not useEffect -- this runs before the browser paints,
  // so the correct padding is in place for the very first frame instead of
  // a brief window at the old default (0) that a fast scroll could reach
  // and settle inside before the real measurement ever lands.
  useLayoutEffect(() => {
    const el = bottomBarRef.current
    if (!el) return
    // entry.contentRect excludes the element's own padding, and the bar
    // carries its safe-area padding directly -- reading offsetHeight instead
    // (on every resize, not just once) is what actually includes it, so this
    // doesn't quietly under-measure by that padding on notched phones.
    const update = () => setBottomBarHeight(el.offsetHeight)
    update()
    const observer = new ResizeObserver(update)
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

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
  if (isLoanRelease) {
    chips.push(
      previewTotalRepayable > 0 && isValidPositiveNumber(termMonths)
        ? { done: true, text: `Total ₱${fmt(previewTotalRepayable)}` }
        : { done: false, text: "Enter interest & term" }
    )
  } else if (isBankTransfer) {
    chips.push(
      bankId && toBankId && bankId !== toBankId
        ? { done: true, text: `✓ ${bankLabel(bankId)} → ${bankLabel(toBankId)}` }
        : { done: false, text: bankId && bankId === toBankId ? "Banks must differ" : "Select both banks" }
    )
  } else if (needsBank) {
    chips.push(bankId ? { done: true, text: "✓ Bank selected" } : { done: false, text: "Bank required" })
  } else if (!needsReceipt) {
    chips.push({ done: false, text: "No receipt needed" })
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

  // The submit button's label doubles as the readiness indicator instead of
  // a separate chip row -- "No receipt needed" is informational rather than
  // a requirement, so it's the one chip excluded from gating the button.
  const amountReady = isValidPositiveNumber(amount)
  const blockingChip = chips.find((c) => !c.done && c.text !== "No receipt needed")
  const readyToSave = amountReady && !blockingChip
  const saveLabel = !amountReady
    ? "Enter an amount to continue"
    : blockingChip
      ? blockingChip.text
      : "Save Changes"

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
        {/* Enough slack to clear the sticky footer even when it grows (wrapped
            chips, a validation message) without leaving a large empty gap
            below short content -- the old bottom bar crammed amount + chips
            + button into one row and needed much more headroom than the
            single-button bar this page has now. */}
        <div className="max-w-lg mx-auto px-4 sm:px-5 pt-8" style={{ paddingBottom: bottomBarHeight + 96 }}>
          <button
            type="button"
            onClick={() => router.push(backHref)}
            className="text-[13px] text-ink-soft mb-4 hover:text-ink transition-colors"
          >
            {backLabel}
          </button>
          <div className="text-[11px] tracking-[0.18em] uppercase text-gold font-mono mb-2">
            Editing Entry
          </div>
          <div className="flex items-baseline gap-2.5 flex-wrap mb-1">
            <h1 className="font-display text-3xl sm:text-4xl font-semibold text-ink">
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
          <p className="text-[13px] text-ink-soft mb-6">Update this entry before it's reviewed.</p>

          <TypeReadOnlyBadge
            arrow={(FLOW[classification] ?? { arrow: "•", tone: "in" }).arrow}
            tone={(FLOW[classification] ?? { arrow: "•", tone: "in" }).tone}
            label={TYPE_LABEL[classification]}
          />

          <AmountHero
            label={isLoanRelease ? "Amount to borrow" : "Amount"}
            value={amount}
            onChange={setAmount}
            helper={HELPER_TEXT[classification]}
          />

          {isLoanRelease && (
            <>
              <p className="text-xs font-bold uppercase tracking-wide text-ink-soft font-mono mb-2">Loan Terms</p>
              <RowGroup>
                <div className="px-4 py-3.5 border-b border-hairline">
                  <p className="text-sm text-ink-soft mb-2.5">Interest</p>
                  <div className="flex border border-hairline rounded-sm overflow-hidden mb-2">
                    <button
                      type="button"
                      onClick={() => setInterestType("rate")}
                      className={`flex-1 text-sm font-semibold py-2 transition-colors ${
                        interestType === "rate" ? "bg-ink text-paper" : "bg-paper text-ink-soft"
                      }`}
                    >
                      Rate (%)
                    </button>
                    <button
                      type="button"
                      onClick={() => setInterestType("amount")}
                      className={`flex-1 text-sm font-semibold py-2 transition-colors ${
                        interestType === "amount" ? "bg-ink text-paper" : "bg-paper text-ink-soft"
                      }`}
                    >
                      Fixed amount (₱)
                    </button>
                  </div>
                  {interestType === "rate" ? (
                    <input
                      className="border border-hairline bg-paper text-ink text-sm rounded-sm px-3 py-2.5 w-full font-mono [font-variant-numeric:tabular-nums]"
                      type="number"
                      min="0"
                      step="0.01"
                      placeholder="e.g. 5"
                      value={interestRate}
                      onChange={(e) => setInterestRate(e.target.value)}
                    />
                  ) : (
                    <input
                      className="border border-hairline bg-paper text-ink text-sm rounded-sm px-3 py-2.5 w-full font-mono [font-variant-numeric:tabular-nums]"
                      type="number"
                      min="0"
                      step="0.01"
                      placeholder="e.g. 5000"
                      value={interestAmount}
                      onChange={(e) => setInterestAmount(e.target.value)}
                    />
                  )}
                </div>

                <NumberRow label="Term" value={termMonths} onChange={setTermMonths} placeholder="e.g. 6" suffix="months" />

                <SelectRow
                  label="Repayment"
                  value={repaymentFrequency}
                  onChange={setRepaymentFrequency}
                  includeEmptyOption={false}
                  options={[
                    { value: "monthly", label: "Monthly installments" },
                    { value: "lump_sum", label: "Lump sum at end" }
                  ]}
                />
              </RowGroup>

              {previewTotalRepayable > 0 && isValidPositiveNumber(termMonths) && (
                <div className="border border-hairline rounded-md p-4 bg-paper-2 mt-3">
                  <p className="text-sm text-ink-soft font-mono mb-2">Estimated repayment</p>
                  <div className="flex justify-between text-base font-mono [font-variant-numeric:tabular-nums]">
                    <span className="text-ink-soft">Total repayable</span>
                    <span>₱{fmt(previewTotalRepayable)}</span>
                  </div>
                  <div className="flex justify-between text-base font-mono [font-variant-numeric:tabular-nums] mt-1">
                    <span className="text-ink-soft">
                      {repaymentFrequency === "monthly" ? `Per month × ${termMonths}` : `Due at ${termMonths} months`}
                    </span>
                    <span className="font-semibold">₱{fmt(previewPerInstallment)}</span>
                  </div>
                </div>
              )}

              <div className="h-5" />
            </>
          )}

          <RowGroup>
            {isLoanPayment && (
              <SelectRow
                label="Loan"
                value={loanId}
                onChange={setLoanId}
                placeholder="Select a loan"
                options={myLoans
                  .filter((l) => l.status === "active" || l.loan_id === loanId)
                  .map((loan) => ({ value: loan.loan_id, label: `₱${fmt(loan.principal)} from ${loan.start_date}` }))}
              />
            )}

            {needsBank && (
              <SelectRow
                label={isBankTransfer ? "From bank" : "Bank"}
                value={bankId}
                onChange={setBankId}
                placeholder="Select a bank"
                options={banks.map((bank) => ({ value: bank.id, label: bank.account_name || bank.bank_name }))}
              />
            )}

            {isBankTransfer && (
              <SelectRow
                label="To bank"
                value={toBankId}
                onChange={setToBankId}
                placeholder="Select a bank"
                options={banks.map((bank) => ({ value: bank.id, label: bank.account_name || bank.bank_name }))}
              />
            )}

            <TextRow label="Description" value={description} onChange={setDescription} placeholder="Add a note" />
          </RowGroup>

          {isLoanPayment && myLoans.filter((l) => l.status === "active").length === 0 && (
            <p className="text-sm text-rust mt-3">No active loans to pay against.</p>
          )}

          {needsReceipt && (
            <div className="mt-5">
              <p className="text-xs font-bold uppercase tracking-wide text-ink-soft font-mono mb-2">Receipt</p>

              {!receiptPreview && existingReceiptUrl && existingReceiptSignedUrl && (
                <div className="relative border border-hairline rounded-md p-3 flex items-center gap-3">
                  <img
                    src={existingReceiptSignedUrl}
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
                    <p className="text-sm text-ink-soft">{receipt ? `${(receipt.size / 1024).toFixed(0)} KB` : ""}</p>
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

          <p className="text-xs text-ink-soft mt-6 mb-2">
            {isLoanRelease
              ? "Changed your mind? This cancels the loan request and removes its pending disbursement entirely -- it can't be undone from the app."
              : "Changed your mind? This entry will be marked cancelled and removed from the transaction list -- it can't be undone from the app."}
          </p>
          <RowGroup>
            <DangerRow
              label={cancelling ? "Cancelling…" : "Cancel this entry"}
              onClick={handleCancelEntry}
              disabled={cancelling}
            />
          </RowGroup>
        </div>
      </main>

      <div
        ref={bottomBarRef}
        className="fixed bottom-0 left-0 right-0 z-30 bg-paper border-t border-hairline"
        // Same iOS Safari fix as Navbar's own fixed dock: without its own
        // GPU compositing layer, a `fixed` element can flicker, misplace
        // itself, or misjudge its own height mid-scroll -- exactly the
        // territory the ResizeObserver measurement above lives in.
        style={{
          paddingBottom: "calc(1rem + env(safe-area-inset-bottom))",
          transform: "translateZ(0)",
          willChange: "transform"
        }}
      >
        <div className="max-w-lg mx-auto px-4 sm:px-5 pt-4">
          <button
            className={
              readyToSave
                ? "w-full bg-ink text-paper py-3.5 rounded-md text-base font-bold shadow-lg shadow-gold/30 ring-1 ring-gold/40 motion-safe:transition-transform motion-safe:active:scale-[0.99] disabled:opacity-50 disabled:shadow-none disabled:ring-0"
                : "w-full bg-transparent text-ink-soft py-3.5 rounded-md text-base font-bold border border-hairline motion-safe:transition-transform motion-safe:active:scale-[0.99] disabled:opacity-50"
            }
            onClick={handleSave}
            disabled={saving}
          >
            {saving ? "Saving…" : saveLabel}
          </button>
        </div>
        {message && (
          <div className="max-w-lg mx-auto px-4 sm:px-5 pt-2 pb-1">
            <p className="text-sm text-rust">{message}</p>
          </div>
        )}
      </div>
    </>
  )
}
