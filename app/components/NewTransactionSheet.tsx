"use client"

import { useEffect, useState } from "react"
import { supabase } from "@/lib/supabase"
import { useAuth } from "@/app/auth-context"
import { Sheet } from "@/app/components/Sheet"
import { LoanPickerSheet, LoanRowIcon } from "@/app/components/LoanPickerSheet"
import {
  AmountHero,
  TypeDropdown,
  StepTrack,
  ReviewRow,
  ReceiptField,
  RequiredMark,
  FieldGroup,
  DateField
} from "@/app/components/TransactionFormUI"
import { totalRepayable, type InterestType } from "@/lib/loanMath"
import { dateOnly } from "@/lib/currentValue"

// The FAB's quick-entry sheet covers the four types a member submits
// themselves and reaches for constantly -- Bank Interest/Expense/Bank
// Transfer/Investment (admin-only, rare, fund-level) and Investment Return
// (open to members, but goes through its own admin-entry-shaped branch
// when an admin submits it) stay on the full /transactions/new page,
// reachable from Admin > Members' "New Transaction" link or a Dashboard
// shortcut, same as before.
const ENTRY_TYPES = [
  { key: "contribution", label: "Contribution", adminOnly: false },
  { key: "withdrawal", label: "Withdrawal", adminOnly: false },
  { key: "loan_request", label: "Loan Request", adminOnly: false },
  { key: "loan_payment", label: "Loan Payment", adminOnly: false }
]

const FLOW: Record<string, { arrow: string; tone: "in" | "out" | "neutral" }> = {
  contribution: { arrow: "↑", tone: "in" },
  withdrawal: { arrow: "↓", tone: "out" },
  loan_request: { arrow: "↓", tone: "out" },
  loan_payment: { arrow: "↑", tone: "in" }
}

function isValidPositiveNumber(value: string, allowZero = false): boolean {
  if (!value.trim()) return false
  const n = Number(value)
  if (Number.isNaN(n)) return false
  return allowZero ? n >= 0 : n > 0
}

function withFlow(options: typeof ENTRY_TYPES) {
  return options.map((o) => ({ ...o, ...(FLOW[o.key] ?? { arrow: "•", tone: "neutral" as const }) }))
}

const helperText: Record<string, string> = {
  contribution: "You've already sent this money. Attach proof of deposit.",
  withdrawal: "You're requesting money to be sent to you. No receipt needed yet.",
  loan_request: "You're requesting to borrow from the fund. No receipt needed yet.",
  loan_payment: "You've already sent this repayment. Attach proof of deposit."
}

// Plain metadata icons for the compact row layout below -- matching how
// budget-tracker's own TransactionModal treats its Note/Date/Recurrence
// rows: a bare muted icon inline, no colored circle (that's reserved for
// TypeDropdown's flow-tone badge, the one row here with real per-value
// styling to show).
function RowIcon({ children }: { children: React.ReactNode }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} className="w-5 h-5 text-ink-soft flex-shrink-0">
      {children}
    </svg>
  )
}

function BankIcon() {
  return (
    <RowIcon>
      <path d="M3 10l9-6 9 6M4 10v9M20 10v9M8 10v9M16 10v9M2 21h20" strokeLinecap="round" strokeLinejoin="round" />
    </RowIcon>
  )
}

function NoteIcon() {
  return (
    <RowIcon>
      <path d="M6 3h9l5 5v13a1 1 0 01-1 1H6a1 1 0 01-1-1V4a1 1 0 011-1z" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M9 12h6M9 16h6" strokeLinecap="round" />
    </RowIcon>
  )
}

function PersonIcon() {
  return (
    <RowIcon>
      <circle cx="12" cy="8" r="3.5" />
      <path d="M4.5 20c1.5-4 4.5-6 7.5-6s6 2 7.5 6" strokeLinecap="round" strokeLinejoin="round" />
    </RowIcon>
  )
}

function PercentIcon() {
  return (
    <RowIcon>
      <circle cx="7" cy="7" r="2.5" />
      <circle cx="17" cy="17" r="2.5" />
      <path d="M18 6L6 18" strokeLinecap="round" />
    </RowIcon>
  )
}

function ClockIcon() {
  return (
    <RowIcon>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7v5l3.5 2" strokeLinecap="round" strokeLinejoin="round" />
    </RowIcon>
  )
}

// Same shape as Dashboard's "Repay Loan" shortcut icon.
function RepeatIcon() {
  return (
    <RowIcon>
      <path d="M4 12a8 8 0 0113.66-5.66M20 12a8 8 0 01-13.66 5.66" strokeLinecap="round" />
      <path d="M17.5 3.5v3h-3M6.5 20.5v-3h3" strokeLinecap="round" strokeLinejoin="round" />
    </RowIcon>
  )
}

// One row of the compact Details card -- icon + inline content, divided
// from its siblings by the card's own divide-y rather than its own border.
function FieldRow({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 px-4 py-3.5">
      {icon}
      {children}
    </div>
  )
}

const rowSelectClass = "flex-1 min-w-0 bg-transparent text-sm text-ink outline-none"
const rowInputClass = "flex-1 min-w-0 bg-transparent text-sm text-ink outline-none placeholder:text-ink-soft"

export function NewTransactionSheet({ onClose, onSaved }: { onClose: () => void; onSaved: (message: string) => void }) {
  const { member } = useAuth()
  const memberId = member?.member_id ?? null
  const isAdmin = member?.role === "admin"

  const [dataLoading, setDataLoading] = useState(true)
  const [loadError, setLoadError] = useState("")
  const [banks, setBanks] = useState<any[]>([])
  const [allMembers, setAllMembers] = useState<any[]>([])
  const [myLoans, setMyLoans] = useState<any[]>([])
  const [loanRepaidTotals, setLoanRepaidTotals] = useState<Record<string, number>>({})

  const [selectedType, setSelectedType] = useState("contribution")
  const [onBehalfOfId, setOnBehalfOfId] = useState("")
  const [bankId, setBankId] = useState("")
  const [amount, setAmount] = useState("")
  const [txnDate, setTxnDate] = useState(() => dateOnly(new Date()))
  const [description, setDescription] = useState("")
  const [receipt, setReceipt] = useState<File | null>(null)
  const [receiptPreview, setReceiptPreview] = useState<string | null>(null)
  const [dragActive, setDragActive] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [message, setMessage] = useState("")

  const [interestType, setInterestType] = useState<InterestType>("rate")
  const [interestRate, setInterestRate] = useState("")
  const [interestAmount, setInterestAmount] = useState("")
  const [termMonths, setTermMonths] = useState("")
  const [repaymentFrequency, setRepaymentFrequency] = useState("monthly")
  const [selectedLoanId, setSelectedLoanId] = useState("")
  const [showLoanPicker, setShowLoanPicker] = useState(false)

  const [contributionDefault, setContributionDefault] = useState<number | null>(null)
  const [contributionBankDefault, setContributionBankDefault] = useState<string | null>(null)
  const [loanPaymentDefault, setLoanPaymentDefault] = useState<number | null>(null)
  const [loanPaymentBankDefault, setLoanPaymentBankDefault] = useState<string | null>(null)
  const [saveAsDefault, setSaveAsDefault] = useState(false)

  // Loan Request is the only type in this reduced set with enough
  // conditional fields to earn its own Details -> Review sub-flow --
  // Contribution/Withdrawal/Loan Payment stay a single flowing view.
  const [formStep, setFormStep] = useState<1 | 2>(1)

  async function loadLoansFor(id: string) {
    const { data: borrowerRow } = await supabase
      .from("borrowers")
      .select("borrower_id")
      .eq("member_id", id)
      .maybeSingle()

    const loanFilter = borrowerRow?.borrower_id
      ? `member_id.eq.${id},borrower_id.eq.${borrowerRow.borrower_id}`
      : `member_id.eq.${id}`

    const { data } = await supabase
      .from("loans")
      .select("loan_id, principal, interest_type, interest_rate, interest_amount, term_months, status, start_date")
      .or(loanFilter)
      .in("status", ["active", "requested"])
      .order("start_date", { ascending: false })

    setMyLoans(data ?? [])

    const loanIds = (data ?? []).map((l) => l.loan_id)
    if (loanIds.length > 0) {
      const { data: repayments } = await supabase
        .from("transactions")
        .select("loan_id, amount")
        .in("loan_id", loanIds)
        .eq("classification", "Loan Repayment")
        .in("status", ["pending", "approved"])

      const totals: Record<string, number> = {}
      ;(repayments ?? []).forEach((r) => {
        totals[r.loan_id] = (totals[r.loan_id] || 0) + Number(r.amount)
      })
      setLoanRepaidTotals(totals)
    } else {
      setLoanRepaidTotals({})
    }
  }

  async function loadPreferencesFor(id: string) {
    const { data } = await supabase
      .from("members")
      .select(
        "default_contribution_amount, default_contribution_bank_id, default_loan_payment_amount, default_loan_payment_bank_id"
      )
      .eq("member_id", id)
      .maybeSingle()

    const contrib = data?.default_contribution_amount != null ? Number(data.default_contribution_amount) : null
    const contribBank = data?.default_contribution_bank_id ?? null
    const loanPay = data?.default_loan_payment_amount != null ? Number(data.default_loan_payment_amount) : null
    const loanPayBank = data?.default_loan_payment_bank_id ?? null
    setContributionDefault(contrib)
    setContributionBankDefault(contribBank)
    setLoanPaymentDefault(loanPay)
    setLoanPaymentBankDefault(loanPayBank)
    return { contrib, contribBank, loanPay, loanPayBank }
  }

  useEffect(() => {
    if (!member) return

    async function load() {
      const { data: bankList, error: bankError } = await supabase
        .from("bank_accounts")
        .select("id, bank_name, account_name")
        .order("bank_name")

      if (bankError) {
        setLoadError(bankError.message)
        setDataLoading(false)
        return
      }
      setBanks(bankList ?? [])

      if (member!.role === "admin") {
        const { data: memberList } = await supabase.from("members").select("member_id, name").order("name")
        setAllMembers(memberList ?? [])
      }

      await loadLoansFor(member!.member_id)

      // selectedType starts at "contribution" above, so only that default
      // needs applying here -- loan_payment's own default is applied by
      // handleTypeChange whenever someone actually switches to it.
      const { contrib, contribBank } = await loadPreferencesFor(member!.member_id)
      if (contrib != null) setAmount(String(contrib))
      if (contribBank) setBankId(contribBank)

      setDataLoading(false)
    }

    load()
  }, [member])

  const effectiveMemberId = isAdmin && onBehalfOfId ? onBehalfOfId : memberId
  const submittedByForOnBehalf = isAdmin && onBehalfOfId ? memberId : null

  const activeLoans = myLoans.filter((l) => l.status === "active")
  const selectedLoan = activeLoans.find((l) => l.loan_id === selectedLoanId) ?? null

  const isLoanRequest = selectedType === "loan_request"
  const isLoanPayment = selectedType === "loan_payment"
  const isContribution = selectedType === "contribution"
  const isStepped = isLoanRequest
  const needsReceipt = selectedType !== "withdrawal" && selectedType !== "loan_request"
  const needsBank = isContribution || isLoanPayment
  // Contribution and Loan Payment collect bank + receipt right here, so an
  // on-behalf-of submission can safely skip the queue -- see the longer
  // explanation on this same flag in /transactions/new.
  const willAutoApproveOnBehalf = isAdmin && !!onBehalfOfId && (isContribution || isLoanPayment)
  const showSaveAsDefault =
    (isContribution && (contributionDefault == null || contributionBankDefault == null)) ||
    (isLoanPayment && (loanPaymentDefault == null || loanPaymentBankDefault == null))

  const previewTotalRepayable =
    isValidPositiveNumber(amount) &&
    (interestType === "rate" ? isValidPositiveNumber(interestRate, true) : isValidPositiveNumber(interestAmount, true))
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

  async function handleTypeChange(newType: string) {
    setSelectedType(newType)
    setFormStep(1)
    setMessage("")
    setReceiptFile(null)
    setBankId("")
    setAmount("")
    setInterestType("rate")
    setInterestRate("")
    setInterestAmount("")
    setTermMonths("")
    setRepaymentFrequency("monthly")
    setSelectedLoanId("")
    setSaveAsDefault(false)

    if (newType === "loan_payment" && memberId) {
      await loadLoansFor(onBehalfOfId || memberId)
    }

    if ((newType === "contribution" || newType === "loan_payment") && memberId) {
      const { contrib, contribBank, loanPay, loanPayBank } = await loadPreferencesFor(onBehalfOfId || memberId)
      if (newType === "contribution" && contrib != null) setAmount(String(contrib))
      if (newType === "loan_payment" && loanPay != null) setAmount(String(loanPay))
      if (newType === "contribution" && contribBank) setBankId(contribBank)
      if (newType === "loan_payment" && loanPayBank) setBankId(loanPayBank)
    }
  }

  async function handleOnBehalfChange(id: string) {
    setOnBehalfOfId(id)
    setSelectedLoanId("")
    setSaveAsDefault(false)

    if (selectedType === "loan_payment") {
      await loadLoansFor(id || memberId || "")
    }

    if (selectedType === "contribution" || selectedType === "loan_payment") {
      const { contrib, contribBank, loanPay, loanPayBank } = await loadPreferencesFor(id || memberId || "")
      if (!amount) {
        if (selectedType === "contribution" && contrib != null) setAmount(String(contrib))
        if (selectedType === "loan_payment" && loanPay != null) setAmount(String(loanPay))
      }
      if (!bankId) {
        if (selectedType === "contribution" && contribBank) setBankId(contribBank)
        if (selectedType === "loan_payment" && loanPayBank) setBankId(loanPayBank)
      }
    }
  }

  function detailsStepError(): string {
    if (!isValidPositiveNumber(amount)) return "Enter a valid amount greater than zero."
    if (isLoanRequest) {
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

  async function handleSubmit() {
    setMessage("")

    if (!isValidPositiveNumber(amount)) {
      setMessage("Enter a valid amount greater than zero.")
      return
    }
    if (!txnDate) {
      setMessage("Select a date.")
      return
    }
    if (needsBank && !bankId) {
      setMessage("Select a bank.")
      return
    }
    if (needsReceipt && !receipt) {
      setMessage("Attach a receipt.")
      return
    }
    if (isLoanRequest && interestType === "rate" && !isValidPositiveNumber(interestRate, true)) {
      setMessage("Enter a valid interest rate (0 or higher).")
      return
    }
    if (isLoanRequest && interestType === "amount" && !isValidPositiveNumber(interestAmount, true)) {
      setMessage("Enter a valid interest amount (0 or higher).")
      return
    }
    if (isLoanRequest && !isValidPositiveNumber(termMonths)) {
      setMessage("Enter a valid term, in months greater than zero.")
      return
    }
    if (isLoanPayment && !selectedLoanId) {
      setMessage("Select which loan you're paying.")
      return
    }

    setSubmitting(true)

    let receiptUrl: string | null = null
    if (receipt) {
      const fileName = `${effectiveMemberId}-${Date.now()}-${receipt.name}`
      const { error: uploadError } = await supabase.storage.from("Receipts").upload(fileName, receipt, {
        contentType: receipt.type
      })
      if (uploadError) {
        setMessage(uploadError.message)
        setSubmitting(false)
        return
      }
      receiptUrl = fileName
    }

    if (isLoanRequest) {
      const { error } = await supabase.rpc("submit_loan_request", {
        p_member_id: effectiveMemberId,
        p_principal: Number(amount),
        p_interest_type: interestType,
        p_interest_rate: interestType === "rate" ? Number(interestRate) : 0,
        p_interest_amount: interestType === "amount" ? Number(interestAmount) : null,
        p_term_months: Number(termMonths),
        p_repayment_frequency: repaymentFrequency,
        p_start_date: txnDate,
        p_notes: description,
        p_description: description,
        p_submitted_by: submittedByForOnBehalf
      })

      setSubmitting(false)
      if (error) {
        setMessage(error.message)
        return
      }
      onSaved("Loan request submitted")
      return
    }

    const classification =
      selectedType === "loan_payment" ? "Loan Repayment" : selectedType === "withdrawal" ? "Member Withdrawal" : "Member Contribution"
    const status = willAutoApproveOnBehalf ? "approved" : "pending"

    const { error } = await supabase.from("transactions").insert({
      member_id: effectiveMemberId,
      bank_account_id: bankId || null,
      loan_id: isLoanPayment ? selectedLoanId : null,
      classification,
      amount: selectedType === "withdrawal" ? -Number(amount) : Number(amount),
      txn_date: txnDate,
      description,
      receipt_url: receiptUrl,
      status,
      submitted_by: submittedByForOnBehalf
    })

    if (error) {
      setSubmitting(false)
      if (receiptUrl) await supabase.storage.from("Receipts").remove([receiptUrl])
      setMessage(error.message)
      return
    }

    let defaultSaveWarning = ""
    if (saveAsDefault && (isContribution || isLoanPayment)) {
      if (effectiveMemberId === memberId) {
        const [{ error: amountError }, { error: bankError }] = await Promise.all([
          supabase.rpc(isContribution ? "set_default_contribution_amount" : "set_default_loan_payment_amount", {
            p_amount: Number(amount)
          }),
          supabase.rpc(isContribution ? "set_default_contribution_bank" : "set_default_loan_payment_bank", {
            p_bank_id: bankId || null
          })
        ])
        if (amountError || bankError) defaultSaveWarning = " (couldn't save as default -- try again next time)"
      } else {
        const { error: defaultError } = await supabase
          .from("members")
          .update(
            isContribution
              ? { default_contribution_amount: Number(amount), default_contribution_bank_id: bankId || null }
              : { default_loan_payment_amount: Number(amount), default_loan_payment_bank_id: bankId || null }
          )
          .eq("member_id", effectiveMemberId)
        if (defaultError) defaultSaveWarning = " (couldn't save as default -- try again next time)"
      }
    }

    setSubmitting(false)

    const typeLabel = selectedType === "loan_payment" ? "Loan repayment" : selectedType === "withdrawal" ? "Withdrawal" : "Contribution"
    onSaved(`${typeLabel} ${status === "pending" ? "submitted" : "recorded"}${defaultSaveWarning}`)
  }

  const fmt = (n: number) => Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })

  function bankLabel(id: string) {
    const bank = banks.find((b) => b.id === id)
    return bank ? bank.account_name || bank.bank_name : "Bank"
  }

  const onBehalfOfField = isAdmin && (
    <FieldRow icon={<PersonIcon />}>
      <select className={rowSelectClass} value={onBehalfOfId} onChange={(e) => handleOnBehalfChange(e.target.value)}>
        <option value="">Myself</option>
        {allMembers
          .filter((m) => m.member_id !== memberId)
          .map((m) => (
            <option key={m.member_id} value={m.member_id}>
              {m.name}
            </option>
          ))}
      </select>
    </FieldRow>
  )

  const onBehalfOfNote = isAdmin && onBehalfOfId && (
    <p className="px-1 pt-2 text-sm text-gold">
      {willAutoApproveOnBehalf
        ? `This will be recorded as approved immediately for ${allMembers.find((m) => m.member_id === onBehalfOfId)?.name}.`
        : `This still goes through the normal approval process for ${allMembers.find((m) => m.member_id === onBehalfOfId)?.name} -- it isn't approved immediately.`}
    </p>
  )

  return (
    <>
    <Sheet
      title="New Transaction"
      onClose={onClose}
      footer={
        <>
          {message && <p className="text-sm text-rust mb-3">{message}</p>}
          <div className="flex items-center gap-3">
            {isStepped && formStep === 2 && (
              <button
                type="button"
                className="shrink-0 border border-hairline text-ink-soft px-5 py-3.5 rounded-full text-base font-semibold"
                onClick={() => setFormStep(1)}
              >
                Back
              </button>
            )}
            <button
              type="button"
              className="flex-1 bg-ink text-paper px-6 py-3.5 rounded-full text-base font-bold shadow-lg shadow-gold/30 ring-1 ring-gold/40 motion-safe:transition-transform motion-safe:active:scale-[0.97] disabled:opacity-50 disabled:shadow-none disabled:ring-0"
              onClick={isStepped && formStep === 1 ? handleContinueToReview : handleSubmit}
              disabled={submitting || dataLoading}
            >
              {submitting ? "Submitting…" : isStepped && formStep === 1 ? "Continue" : "Submit"}
            </button>
          </div>
        </>
      }
    >
      {dataLoading ? (
        <div className="py-12 text-center text-sm text-ink-soft">Loading…</div>
      ) : loadError ? (
        <p className="py-12 text-center text-sm text-rust">Couldn&apos;t load: {loadError}</p>
      ) : (
        <>
          <AmountHero
            value={amount}
            onChange={setAmount}
            label={isLoanRequest ? "Amount to borrow" : "Amount"}
            helper={helperText[selectedType]}
          />

          <TypeDropdown options={withFlow(ENTRY_TYPES)} value={selectedType} onChange={handleTypeChange} />

          <div className="space-y-4 mt-4">
            {!isStepped && (
              <>
                <div>
                  <p className="text-[11px] uppercase tracking-wide text-ink-soft font-mono mb-2 px-1">Details</p>
                  <div className="bg-paper-2 border border-hairline rounded-md divide-y divide-hairline overflow-hidden">
                    <DateField value={txnDate} onChange={setTxnDate} placeholder="Date" bare />

                    {onBehalfOfField}

                    {isLoanPayment && (
                      <button
                        type="button"
                        onClick={() => activeLoans.length > 0 && setShowLoanPicker(true)}
                        className="w-full flex items-center gap-3 px-4 py-3.5 text-left"
                      >
                        <LoanRowIcon />
                        <span className="flex-1 min-w-0 text-sm">
                          {selectedLoan ? (
                            <span className="text-ink">
                              ₱{fmt(selectedLoan.principal)} from {selectedLoan.start_date}
                            </span>
                          ) : (
                            <span className={activeLoans.length === 0 ? "text-rust" : "text-ink-soft"}>
                              {activeLoans.length === 0 ? "No active loans to pay against" : "Which loan"}
                            </span>
                          )}
                        </span>
                        {activeLoans.length > 0 && <span className="text-ink-soft text-xs shrink-0">▾</span>}
                      </button>
                    )}

                    {needsBank && (
                      <FieldRow icon={<BankIcon />}>
                        <select className={rowSelectClass} value={bankId} onChange={(e) => setBankId(e.target.value)}>
                          <option value="">Select a bank</option>
                          {banks.map((bank) => (
                            <option key={bank.id} value={bank.id}>
                              {bank.account_name || bank.bank_name}
                            </option>
                          ))}
                        </select>
                      </FieldRow>
                    )}

                    <FieldRow icon={<NoteIcon />}>
                      <input
                        className={rowInputClass}
                        placeholder="Add a note"
                        value={description}
                        onChange={(e) => setDescription(e.target.value)}
                      />
                    </FieldRow>
                  </div>

                  {onBehalfOfNote}

                  {isLoanPayment &&
                    selectedLoanId &&
                    (() => {
                      if (!selectedLoan) return null
                      const remaining =
                        totalRepayable(
                          Number(selectedLoan.principal),
                          selectedLoan.interest_type,
                          Number(selectedLoan.interest_rate || 0),
                          Number(selectedLoan.interest_amount || 0)
                        ) - (loanRepaidTotals[selectedLoan.loan_id] || 0)
                      return <p className="px-1 pt-2 text-sm text-ink-soft">₱{fmt(Math.max(0, remaining))} left to pay</p>
                    })()}

                  {showSaveAsDefault && isValidPositiveNumber(amount) && (
                    <label className="flex items-start gap-2.5 text-sm text-ink-soft px-1 pt-3">
                      <input
                        type="checkbox"
                        checked={saveAsDefault}
                        onChange={(e) => setSaveAsDefault(e.target.checked)}
                        className="w-4 h-4 mt-0.5 shrink-0"
                      />
                      Save ₱{fmt(Number(amount))}
                      {bankId ? ` and ${bankLabel(bankId)}` : ""} as{" "}
                      {onBehalfOfId ? `${allMembers.find((m) => m.member_id === onBehalfOfId)?.name}'s` : "my"} default{" "}
                      {isContribution ? "contribution" : "loan payment"} {bankId ? "amount and bank" : "amount"}
                    </label>
                  )}
                </div>

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
                        dragActive={dragActive}
                        setDragActive={setDragActive}
                        onFileChange={setReceiptFile}
                      />
                    </div>
                  </FieldGroup>
                )}
              </>
            )}

            {isStepped && (
              <>
                <StepTrack step={formStep} labels={["Details", "Review"]} />

                {formStep === 1 && (
                  <>
                    <div>
                      <p className="text-[11px] uppercase tracking-wide text-ink-soft font-mono mb-2 px-1">Details</p>
                      <div className="bg-paper-2 border border-hairline rounded-md divide-y divide-hairline overflow-hidden">
                        <DateField value={txnDate} onChange={setTxnDate} placeholder="Date" bare />

                        {onBehalfOfField}

                        <FieldRow icon={<NoteIcon />}>
                          <input
                            className={rowInputClass}
                            placeholder="Add a note"
                            value={description}
                            onChange={(e) => setDescription(e.target.value)}
                          />
                        </FieldRow>
                      </div>

                      {onBehalfOfNote}
                    </div>

                    <div className="mt-4">
                      <p className="text-[11px] uppercase tracking-wide text-ink-soft font-mono mb-2 px-1">Loan Terms</p>
                      <div className="bg-paper-2 border border-hairline rounded-md divide-y divide-hairline overflow-hidden">
                        {/* Toggle + value share one row instead of stacking (toggle, then a
                            second full-width input below it) -- the toggle only ever needs
                            two glyphs' worth of width once it's not also carrying "Rate (%)"/
                            "Fixed amount (₱)" as button text. */}
                        <FieldRow icon={<PercentIcon />}>
                          <input
                            className={rowInputClass}
                            type="number"
                            inputMode="decimal"
                            min="0"
                            step="0.01"
                            placeholder={interestType === "rate" ? "Interest rate, e.g. 5" : "Interest amount, e.g. 5000"}
                            value={interestType === "rate" ? interestRate : interestAmount}
                            onChange={(e) =>
                              interestType === "rate" ? setInterestRate(e.target.value) : setInterestAmount(e.target.value)
                            }
                          />
                          <div className="flex border border-hairline rounded-sm overflow-hidden shrink-0">
                            <button
                              type="button"
                              onClick={() => setInterestType("rate")}
                              aria-label="Interest as a rate"
                              className={`w-8 py-1.5 text-xs font-semibold transition-colors ${
                                interestType === "rate" ? "bg-ink text-paper" : "text-ink-soft"
                              }`}
                            >
                              %
                            </button>
                            <button
                              type="button"
                              onClick={() => setInterestType("amount")}
                              aria-label="Interest as a fixed amount"
                              className={`w-8 py-1.5 text-xs font-semibold border-l border-hairline transition-colors ${
                                interestType === "amount" ? "bg-ink text-paper" : "text-ink-soft"
                              }`}
                            >
                              ₱
                            </button>
                          </div>
                        </FieldRow>

                        <FieldRow icon={<ClockIcon />}>
                          <input
                            className={rowInputClass}
                            type="number"
                            inputMode="numeric"
                            min="1"
                            step="1"
                            placeholder="Term, e.g. 6"
                            value={termMonths}
                            onChange={(e) => setTermMonths(e.target.value)}
                          />
                          <span className="text-xs text-ink-soft shrink-0">months</span>
                        </FieldRow>

                        <FieldRow icon={<RepeatIcon />}>
                          <div className="flex-1 flex border border-hairline rounded-sm overflow-hidden">
                            <button
                              type="button"
                              onClick={() => setRepaymentFrequency("monthly")}
                              className={`flex-1 text-xs font-semibold py-2 transition-colors ${
                                repaymentFrequency === "monthly" ? "bg-ink text-paper" : "text-ink-soft"
                              }`}
                            >
                              Monthly
                            </button>
                            <button
                              type="button"
                              onClick={() => setRepaymentFrequency("lump_sum")}
                              className={`flex-1 text-xs font-semibold py-2 border-l border-hairline transition-colors ${
                                repaymentFrequency === "lump_sum" ? "bg-ink text-paper" : "text-ink-soft"
                              }`}
                            >
                              Lump sum
                            </button>
                          </div>
                        </FieldRow>
                      </div>

                      {previewTotalRepayable > 0 && isValidPositiveNumber(termMonths) && (
                        <div className="border border-hairline rounded-md p-4 bg-paper mt-3">
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
                    </div>
                  </>
                )}

                {formStep === 2 && (
                  <FieldGroup>
                    <ReviewRow label="Type" value={ENTRY_TYPES.find((t) => t.key === selectedType)?.label ?? ""} />
                    <ReviewRow label="Amount to borrow" value={`₱${fmt(isValidPositiveNumber(amount) ? Number(amount) : 0)}`} />
                    <ReviewRow
                      label="Date"
                      value={new Date(`${txnDate}T00:00:00`).toLocaleDateString(undefined, {
                        day: "numeric",
                        month: "short",
                        year: "numeric"
                      })}
                    />
                    {onBehalfOfId && (
                      <ReviewRow label="On behalf of" value={allMembers.find((m) => m.member_id === onBehalfOfId)?.name ?? ""} />
                    )}
                    <ReviewRow
                      label="Interest"
                      value={interestType === "rate" ? `${interestRate || 0}%` : `₱${fmt(Number(interestAmount) || 0)} fixed`}
                    />
                    <ReviewRow label="Term" value={`${termMonths || 0} months`} />
                    <ReviewRow
                      label="Repayment"
                      value={repaymentFrequency === "monthly" ? "Monthly installments" : "Lump sum at end of term"}
                    />
                    {previewTotalRepayable > 0 && <ReviewRow label="Est. total repayable" value={`₱${fmt(previewTotalRepayable)}`} />}
                    {description && <ReviewRow label="Description" value={description} />}
                  </FieldGroup>
                )}
              </>
            )}
          </div>
        </>
      )}
    </Sheet>

    {showLoanPicker && (
      <LoanPickerSheet
        loans={activeLoans}
        repaidTotals={loanRepaidTotals}
        onClose={() => setShowLoanPicker(false)}
        onSelect={(loan) => {
          setSelectedLoanId(loan.loan_id)
          setShowLoanPicker(false)
        }}
      />
    )}
    </>
  )
}
