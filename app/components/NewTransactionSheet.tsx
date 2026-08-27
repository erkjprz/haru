"use client"

import { useEffect, useState } from "react"
import { supabase } from "@/lib/supabase"
import { useAuth } from "@/app/auth-context"
import { Sheet } from "@/app/components/Sheet"
import { LoanPickerSheet, LoanRowIcon } from "@/app/components/LoanPickerSheet"
import { InvestmentPickerSheet, InvestmentRowIcon } from "@/app/components/InvestmentPickerSheet"
import { InterestRatePickerSheet } from "@/app/components/InterestRatePickerSheet"
import { TermPickerSheet } from "@/app/components/TermPickerSheet"
import { TypePickerSheet, TypeBadge } from "@/app/components/TypePickerSheet"
import {
  AmountHero,
  StepTrack,
  ReviewRow,
  ReceiptField,
  RequiredMark,
  FieldGroup,
  DateField
} from "@/app/components/TransactionFormUI"
import { totalRepayable, type InterestType } from "@/lib/loanMath"
import { dateOnly } from "@/lib/currentValue"
import { getCachedTransactionFormData, loadTransactionFormData } from "@/lib/transactionFormPrefetch"
import { snapshotInvestmentHold } from "@/lib/snapshotHold"

// The FAB's quick-entry sheet covers the types every member reaches for
// constantly (Contribution/Withdrawal/Loan Request/Loan Payment), plus
// Investment Return open to every member the same way, plus the
// admin-only fund-level bookkeeping types (Bank Interest/Expense/Bank
// Transfer/Investment) -- all mirroring /transactions/new's own
// isAdminEntry shape (member_id null, approved immediately, no
// on-behalf-of -- these aren't attributed to any one member). Investment
// Return is the one type with two different shapes depending on who
// submits it (see the isInvestmentReturn branch in handleSubmit): a
// member's own return is a pending, self-attributed row like a
// Contribution, but an admin's is fund-level like the four adminOnly
// types below it.
const ENTRY_TYPES = [
  { key: "contribution", label: "Contribution", adminOnly: false },
  { key: "withdrawal", label: "Withdrawal", adminOnly: false },
  { key: "loan_request", label: "Loan Request", adminOnly: false },
  { key: "loan_payment", label: "Loan Payment", adminOnly: false },
  { key: "investment_return", label: "Investment Return", adminOnly: false },
  { key: "bank_interest", label: "Bank Interest", adminOnly: true },
  { key: "expense", label: "Expense", adminOnly: true },
  { key: "bank_transfer", label: "Bank Transfer", adminOnly: true },
  { key: "investment", label: "Investment", adminOnly: true }
]

const FLOW: Record<string, { arrow: string; tone: "in" | "out" | "neutral" }> = {
  contribution: { arrow: "↑", tone: "in" },
  withdrawal: { arrow: "↓", tone: "out" },
  loan_request: { arrow: "↓", tone: "out" },
  loan_payment: { arrow: "↑", tone: "in" },
  investment_return: { arrow: "↑", tone: "in" },
  bank_interest: { arrow: "↑", tone: "in" },
  expense: { arrow: "↓", tone: "out" },
  bank_transfer: { arrow: "⇄", tone: "neutral" },
  investment: { arrow: "↓", tone: "out" }
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

// A growth/trend icon rather than a literal "%" glyph -- this row already
// has its own % / ₱ toggle right in it, and a percent-shaped icon right
// next to a percent-labeled button read as two competing %s instead of an
// icon plus a control.
function InterestIcon() {
  return (
    <RowIcon>
      <path d="M3 17l6-6 4 4 8-8" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M15 7h6v6" strokeLinecap="round" strokeLinejoin="round" />
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

  // Navbar starts warming this the moment a page has a signed-in member
  // (see its own effect) -- by the time someone actually taps the FAB,
  // the fetch below is very often already done. Seeding state from
  // whatever's cached (possibly nothing, on a very fast tap) means
  // dataLoading only starts true when there's genuinely nothing to show
  // yet, instead of unconditionally flashing "Loading..." every time.
  const cached = memberId ? getCachedTransactionFormData(memberId, isAdmin) : null

  const [dataLoading, setDataLoading] = useState(!cached)
  const [loadError, setLoadError] = useState("")
  const [banks, setBanks] = useState<any[]>(cached?.banks ?? [])
  const [allMembers, setAllMembers] = useState<any[]>(cached?.allMembers ?? [])
  const [myLoans, setMyLoans] = useState<any[]>(cached?.myLoans ?? [])
  const [loanRepaidTotals, setLoanRepaidTotals] = useState<Record<string, number>>(cached?.loanRepaidTotals ?? {})
  const [investmentsList, setInvestmentsList] = useState<any[]>(cached?.investmentsList ?? [])

  const [selectedType, setSelectedType] = useState("contribution")
  const [showTypePicker, setShowTypePicker] = useState(false)
  const [onBehalfOfId, setOnBehalfOfId] = useState("")
  const [bankId, setBankId] = useState(cached?.contributionBankDefault ?? "")
  const [toBankId, setToBankId] = useState("")
  const [investmentId, setInvestmentId] = useState("")
  const [amount, setAmount] = useState(cached?.contributionDefault != null ? String(cached.contributionDefault) : "")
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
  const [showInvestmentPicker, setShowInvestmentPicker] = useState(false)
  const [showInterestRatePicker, setShowInterestRatePicker] = useState(false)
  const [showTermPicker, setShowTermPicker] = useState(false)
  // Picker is the default interaction for both -- these only flip to true
  // when someone explicitly picks "Custom" from the sheet, swapping the
  // row over to the plain number input for direct typing.
  const [interestRateCustom, setInterestRateCustom] = useState(false)
  const [termCustom, setTermCustom] = useState(false)

  const [contributionDefault, setContributionDefault] = useState<number | null>(cached?.contributionDefault ?? null)
  const [contributionBankDefault, setContributionBankDefault] = useState<string | null>(cached?.contributionBankDefault ?? null)
  const [loanPaymentDefault, setLoanPaymentDefault] = useState<number | null>(cached?.loanPaymentDefault ?? null)
  const [loanPaymentBankDefault, setLoanPaymentBankDefault] = useState<string | null>(cached?.loanPaymentBankDefault ?? null)
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

  // If `cached` was already there at mount, state above is already fully
  // seeded and dataLoading started false -- nothing to do. Otherwise this
  // is the fallback path: Navbar's own prefetch (see its effect) hasn't
  // finished yet, most likely because the FAB got tapped within the very
  // first instant of a page load, so fetch the same data directly.
  useEffect(() => {
    if (!member || cached) return

    async function load() {
      const { data, error } = await loadTransactionFormData(member!.member_id, member!.role === "admin")
      if (error || !data) {
        setLoadError(error ?? "Couldn't load transaction data.")
        setDataLoading(false)
        return
      }

      setBanks(data.banks)
      setAllMembers(data.allMembers)
      setInvestmentsList(data.investmentsList)
      setMyLoans(data.myLoans)
      setLoanRepaidTotals(data.loanRepaidTotals)
      setContributionDefault(data.contributionDefault)
      setContributionBankDefault(data.contributionBankDefault)
      setLoanPaymentDefault(data.loanPaymentDefault)
      setLoanPaymentBankDefault(data.loanPaymentBankDefault)

      // selectedType starts at "contribution" above, so only that default
      // needs applying here -- loan_payment's own default is applied by
      // handleTypeChange whenever someone actually switches to it.
      if (data.contributionDefault != null) setAmount(String(data.contributionDefault))
      if (data.contributionBankDefault) setBankId(data.contributionBankDefault)

      setDataLoading(false)
    }

    load()
    // cached is a plain value captured at mount (whether the sheet opened
    // already warm), not state -- it isn't expected to change through this
    // instance's lifetime, so it's deliberately left out of the deps list.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [member])

  const effectiveMemberId = isAdmin && onBehalfOfId ? onBehalfOfId : memberId
  const submittedByForOnBehalf = isAdmin && onBehalfOfId ? memberId : null

  const activeLoans = myLoans.filter((l) => l.status === "active")
  const selectedLoan = activeLoans.find((l) => l.loan_id === selectedLoanId) ?? null
  const selectedInvestment = investmentsList.find((inv) => inv.investment_id === investmentId) ?? null

  const isLoanRequest = selectedType === "loan_request"
  const isLoanPayment = selectedType === "loan_payment"
  const isContribution = selectedType === "contribution"
  const isInvestmentReturn = selectedType === "investment_return"
  const isBankInterest = selectedType === "bank_interest"
  const isExpense = selectedType === "expense"
  const isBankTransfer = selectedType === "bank_transfer"
  const isInvestment = selectedType === "investment"
  // Both Investment and Investment Return need the same investment picker
  // and the same affects_cash mirroring of the selected investment -- see
  // the two admin-fund-level branches in handleSubmit.
  const isInvestmentEntry = isInvestment || isInvestmentReturn
  // The four adminOnly types are fund-level entries, not attributed to
  // any one member -- no on-behalf-of concept, same as Investment Return
  // when an admin submits it (see the isInvestmentReturn branch in
  // handleSubmit). Only the original four member-facing types support
  // picking who a submission is "for".
  const isAdminFundEntry = isBankInterest || isExpense || isBankTransfer || isInvestment
  const supportsOnBehalfOf = isContribution || selectedType === "withdrawal" || isLoanRequest || isLoanPayment
  const isStepped = isLoanRequest
  const needsReceipt = selectedType !== "withdrawal" && selectedType !== "loan_request"
  const needsBank = isContribution || isLoanPayment || isInvestmentEntry || isBankInterest || isExpense || isBankTransfer
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
    setToBankId("")
    setAmount("")
    setInterestType("rate")
    setInterestRate("")
    setInterestAmount("")
    setTermMonths("")
    setRepaymentFrequency("monthly")
    setSelectedLoanId("")
    setInvestmentId("")
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
    if (isInvestmentEntry && !investmentId) {
      setMessage(isInvestment ? "Select which investment this funds." : "Select which investment this is returning from.")
      return
    }
    if (isBankTransfer && !toBankId) {
      setMessage("Select the destination bank.")
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

    // Unlike the other four types, Investment Return has two different
    // shapes depending on who submits it -- mirrors /transactions/new's
    // own isAdminEntry vs. its final generic branch. An admin's is a
    // fund-level entry (member_id null, approved immediately, no
    // on-behalf-of concept -- it isn't attributed to any one member).
    // A regular member's own return is a pending, self-attributed row
    // like a Contribution, going into the approval queue.
    if (isInvestmentReturn) {
      const selectedInvestment = investmentsList.find((inv) => inv.investment_id === investmentId)
      const status = isAdmin ? "approved" : "pending"

      const { error } = await supabase.from("transactions").insert({
        member_id: isAdmin ? null : memberId,
        bank_account_id: bankId || null,
        investment_id: investmentId,
        classification: "Investment Return",
        amount: Number(amount),
        txn_date: txnDate,
        description,
        receipt_url: receiptUrl,
        status,
        submitted_by: isAdmin ? memberId : null,
        affects_cash: selectedInvestment?.affects_cash ? 1 : 0
      })

      setSubmitting(false)
      if (error) {
        if (receiptUrl) await supabase.storage.from("Receipts").remove([receiptUrl])
        setMessage(error.message)
        return
      }
      onSaved(`Investment return ${status === "pending" ? "submitted" : "recorded"}`)
      return
    }

    // Cash-neutral: affects_cash 0 keeps it out of the cash ledger; the
    // per-bank balances use bank_account_id / to_bank_account_id instead.
    // Mirrors /transactions/new's own isBankTransfer branch exactly.
    if (isBankTransfer) {
      const { error } = await supabase.from("transactions").insert({
        member_id: null,
        bank_account_id: bankId,
        to_bank_account_id: toBankId,
        classification: "Internal Transfer",
        affects_cash: 0,
        amount: Number(amount),
        txn_date: txnDate,
        description,
        receipt_url: receiptUrl,
        status: "approved",
        submitted_by: memberId
      })

      setSubmitting(false)
      if (error) {
        if (receiptUrl) await supabase.storage.from("Receipts").remove([receiptUrl])
        setMessage(error.message)
        return
      }
      onSaved("Bank transfer recorded")
      return
    }

    // Bank Interest, Expense, and new Investment outflows -- fund-level
    // entries same shape as Investment Return's own admin path above,
    // just always approved immediately (no member-submitted pending
    // version of these exists). Mirrors /transactions/new's isAdminEntry
    // branch: Expense and new Investment capital are cash going out, so
    // the ledger stores them negative (matches v_investment_summary,
    // which reads "invested" as -amount on Investment rows). Bank
    // Interest rows default to interest_distributed = false and sit
    // there until an admin manually distributes them from /admin.
    if (isBankInterest || isExpense || isInvestment) {
      const classification = isBankInterest ? "Bank Interest" : isExpense ? "Expense" : "Investment"
      const selectedInvestment = isInvestment ? investmentsList.find((inv) => inv.investment_id === investmentId) : null

      const { error } = await supabase.from("transactions").insert({
        member_id: null,
        bank_account_id: bankId || null,
        investment_id: isInvestment ? investmentId : null,
        classification,
        amount: isExpense || isInvestment ? -Number(amount) : Number(amount),
        txn_date: txnDate,
        description,
        receipt_url: receiptUrl,
        status: "approved",
        submitted_by: memberId,
        ...(isInvestment ? { affects_cash: selectedInvestment?.affects_cash ? 1 : 0 } : {})
      })

      if (error) {
        setSubmitting(false)
        if (receiptUrl) await supabase.storage.from("Receipts").remove([receiptUrl])
        setMessage(error.message)
        return
      }

      // New capital into an investment changes who's staking it, so
      // re-snapshot the pool's shares for this investment's hold
      // tracking -- same as /transactions/new does. The transaction
      // itself already succeeded, so a failure here shouldn't block the
      // confirmation or invite a duplicate resubmit, just surface it.
      let holdWarning = ""
      if (isInvestment) {
        try {
          await snapshotInvestmentHold(investmentId, dateOnly(new Date()))
        } catch (err) {
          holdWarning = ` (hold recompute failed: ${err instanceof Error ? err.message : "unknown error"} -- an admin should retry)`
        }
      }

      setSubmitting(false)
      onSaved(`${classification} recorded${holdWarning}`)
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

  const selectedTypeOption = withFlow(ENTRY_TYPES).find((o) => o.key === selectedType)!

  // First row of the Details card, matching budget-tracker's own Category
  // row -- same "Label: value" shape, same colored flow-tone badge instead
  // of a bare icon (the one row here with real per-value styling to show,
  // same reasoning FlowBadge already got when TypeDropdown was still a
  // standalone dropdown), and opens a picker sheet on tap instead of the
  // old inline-expanding list.
  const typeField = (
    <button
      type="button"
      onClick={() => setShowTypePicker(true)}
      className="w-full flex items-center gap-3 px-4 py-3.5 text-left"
    >
      <TypeBadge arrow={selectedTypeOption.arrow} tone={selectedTypeOption.tone} />
      <span className="flex-1 min-w-0 text-sm">
        <span className="text-ink-soft">Type: </span>
        <span className="font-semibold text-ink">{selectedTypeOption.label}</span>
      </span>
      <span className="text-ink-soft text-xs shrink-0">▾</span>
    </button>
  )

  // Only the original four member-facing types support on-behalf-of --
  // Investment Return (as an admin) and the four adminOnly fund-level
  // types are all entries attributed to no one member (see handleSubmit),
  // not something done "for" a specific member the way a Contribution can
  // be.
  const onBehalfOfField = isAdmin && supportsOnBehalfOf && (
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

  const investmentField = isInvestmentEntry && (
    // Same tappable-row pattern as the Loan Payment field below -- both are
    // just "pick one of a short list," and InvestmentPickerSheet already
    // has its own graceful "No open investments" empty state, same as
    // LoanPickerSheet does.
    <button
      type="button"
      onClick={() => setShowInvestmentPicker(true)}
      className="w-full flex items-center gap-3 px-4 py-3.5 text-left"
    >
      <InvestmentRowIcon />
      <span className="flex-1 min-w-0 text-sm">
        {selectedInvestment ? (
          <span className="text-ink">{selectedInvestment.name}</span>
        ) : (
          <span className="text-ink-soft">Which investment</span>
        )}
      </span>
      <span className="text-ink-soft text-xs shrink-0">▾</span>
    </button>
  )

  const toBankField = isBankTransfer && (
    <FieldRow icon={<BankIcon />}>
      <select className={rowSelectClass} value={toBankId} onChange={(e) => setToBankId(e.target.value)}>
        <option value="">To which bank</option>
        {banks.map((bank) => (
          <option key={bank.id} value={bank.id}>
            {bank.account_name || bank.bank_name}
          </option>
        ))}
      </select>
    </FieldRow>
  )

  const onBehalfOfNote = isAdmin && supportsOnBehalfOf && onBehalfOfId && (
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
          <AmountHero value={amount} onChange={setAmount} />

          <div className="space-y-4 mt-4">
            {!isStepped && (
              <>
                <div>
                  <p className="text-[11px] uppercase tracking-wide text-ink-soft font-mono mb-2 px-1">Details</p>
                  <div className="bg-paper-2 border border-hairline rounded-md divide-y divide-hairline overflow-hidden">
                    {typeField}

                    {onBehalfOfField}

                    <DateField value={txnDate} onChange={setTxnDate} placeholder="Date" bare />

                    {investmentField}

                    {isLoanPayment && (
                      // Same pattern as investmentField -- always render the
                      // tappable row regardless of whether there's anything
                      // to pick; LoanPickerSheet already shows its own
                      // graceful "No active loans" empty state, so a second,
                      // redder version of that same message here was
                      // redundant.
                      <button
                        type="button"
                        onClick={() => setShowLoanPicker(true)}
                        className="w-full flex items-center gap-3 px-4 py-3.5 text-left"
                      >
                        <LoanRowIcon />
                        <span className="flex-1 min-w-0 text-sm">
                          {selectedLoan ? (
                            <span className="text-ink">
                              ₱{fmt(selectedLoan.principal)} from {selectedLoan.start_date}
                            </span>
                          ) : (
                            <span className="text-ink-soft">Which loan</span>
                          )}
                        </span>
                        <span className="text-ink-soft text-xs shrink-0">▾</span>
                      </button>
                    )}

                    {needsBank && (
                      <FieldRow icon={<BankIcon />}>
                        <select className={rowSelectClass} value={bankId} onChange={(e) => setBankId(e.target.value)}>
                          <option value="">{isBankTransfer ? "From which bank" : "Select a bank"}</option>
                          {banks.map((bank) => (
                            <option key={bank.id} value={bank.id}>
                              {bank.account_name || bank.bank_name}
                            </option>
                          ))}
                        </select>
                      </FieldRow>
                    )}

                    {toBankField}

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
                  <div>
                    <p className="text-[11px] uppercase tracking-wide text-ink-soft font-mono mb-2 px-1">
                      Receipt
                      <RequiredMark />
                    </p>
                    <ReceiptField
                      receipt={receipt}
                      receiptPreview={receiptPreview}
                      dragActive={dragActive}
                      setDragActive={setDragActive}
                      onFileChange={setReceiptFile}
                    />
                  </div>
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
                        {typeField}

                        {onBehalfOfField}

                        <DateField value={txnDate} onChange={setTxnDate} placeholder="Date" bare />

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
                        <FieldRow icon={<InterestIcon />}>
                          {interestType === "rate" && !interestRateCustom ? (
                            // Picker is the default way in -- tapping the
                            // value area itself opens the same sheet the
                            // trailing ▾ does, not just a narrow target.
                            <button
                              type="button"
                              onClick={() => setShowInterestRatePicker(true)}
                              className="flex-1 min-w-0 text-left text-sm"
                            >
                              {interestRate ? (
                                <span className="text-ink">{interestRate}%</span>
                              ) : (
                                <span className="text-ink-soft">Interest rate, e.g. 5</span>
                              )}
                            </button>
                          ) : (
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
                              autoFocus={interestType === "rate" && interestRateCustom}
                            />
                          )}
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
                          {/* Fixed peso amounts have no sensible universal
                              presets, so the picker shortcut only applies
                              to the rate side -- the input itself stays the
                              only way to enter a fixed amount either way. */}
                          {interestType === "rate" && (
                            <button
                              type="button"
                              onClick={() => setShowInterestRatePicker(true)}
                              aria-label="Choose a common interest rate"
                              className="text-ink-soft text-xs shrink-0 px-1"
                            >
                              ▾
                            </button>
                          )}
                        </FieldRow>

                        <FieldRow icon={<ClockIcon />}>
                          {!termCustom ? (
                            <button
                              type="button"
                              onClick={() => setShowTermPicker(true)}
                              className="flex-1 min-w-0 text-left text-sm"
                            >
                              {termMonths ? (
                                <span className="text-ink">
                                  {termMonths} {termMonths === "1" ? "month" : "months"}
                                </span>
                              ) : (
                                <span className="text-ink-soft">Term, e.g. 6</span>
                              )}
                            </button>
                          ) : (
                            <>
                              <input
                                className={rowInputClass}
                                type="number"
                                inputMode="numeric"
                                min="1"
                                step="1"
                                placeholder="Term, e.g. 6"
                                value={termMonths}
                                onChange={(e) => setTermMonths(e.target.value)}
                                autoFocus
                              />
                              <span className="text-xs text-ink-soft shrink-0">months</span>
                            </>
                          )}
                          <button
                            type="button"
                            onClick={() => setShowTermPicker(true)}
                            aria-label="Choose a common payment term"
                            className="text-ink-soft text-xs shrink-0 px-1"
                          >
                            ▾
                          </button>
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

                        {/* Right in the same card, directly under the fields that produce
                            it -- previously a separate box below the card, easy to miss
                            without scrolling since nothing here visually tied it to Interest/
                            Term/Repayment above it. bg-gold/10 is the app's own "highlighted
                            result" accent (StepTrack, the selected row in a dropdown, the FAB
                            glow) rather than the plain bg-paper the old box used, which in
                            dark mode is darker than the card itself and read as dead. */}
                        {previewTotalRepayable > 0 && isValidPositiveNumber(termMonths) && (
                          <>
                            <div className="flex items-center justify-between px-4 py-3 bg-gold/10">
                              <span className="text-sm font-semibold text-ink">Total repayable</span>
                              <span className="text-sm font-bold font-mono [font-variant-numeric:tabular-nums] text-gold">
                                ₱{fmt(previewTotalRepayable)}
                              </span>
                            </div>
                            <div className="flex items-center justify-between px-4 py-3 bg-gold/10">
                              <span className="text-sm text-ink-soft">
                                {repaymentFrequency === "monthly" ? `Per month × ${termMonths}` : `Due at ${termMonths} months`}
                              </span>
                              <span className="text-sm font-semibold font-mono [font-variant-numeric:tabular-nums] text-ink">
                                ₱{fmt(previewPerInstallment)}
                              </span>
                            </div>
                          </>
                        )}
                      </div>
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

    {showInvestmentPicker && (
      <InvestmentPickerSheet
        investments={investmentsList}
        onClose={() => setShowInvestmentPicker(false)}
        onSelect={(investment) => {
          setInvestmentId(investment.investment_id)
          setShowInvestmentPicker(false)
        }}
      />
    )}

    {showInterestRatePicker && (
      <InterestRatePickerSheet
        value={interestRate}
        onClose={() => setShowInterestRatePicker(false)}
        onSelect={(rate) => {
          setInterestRate(String(rate))
          setInterestRateCustom(false)
          setShowInterestRatePicker(false)
        }}
        onCustom={() => {
          setInterestRateCustom(true)
          setShowInterestRatePicker(false)
        }}
      />
    )}

    {showTermPicker && (
      <TermPickerSheet
        value={termMonths}
        onClose={() => setShowTermPicker(false)}
        onSelect={(months) => {
          setTermMonths(String(months))
          setTermCustom(false)
          setShowTermPicker(false)
        }}
        onCustom={() => {
          setTermCustom(true)
          setShowTermPicker(false)
        }}
      />
    )}

    {showTypePicker && (
      <TypePickerSheet
        options={withFlow(
          ENTRY_TYPES.filter((t) => {
            if (t.adminOnly && !isAdmin) return false
            // Loan Payment is only hidden for a member picking for
            // themselves -- an admin's own activeLoans here is *their own*
            // loans, not whichever member they might pick on-behalf-of a
            // moment later (that field only appears after the type is
            // already chosen), so hiding it for admins could block a
            // payment for a member who does have one.
            if (t.key === "loan_payment" && !isAdmin && activeLoans.length === 0) return false
            // Investments are fund-level, not owned by any one member --
            // if there's nothing open fund-wide, there's genuinely nothing
            // for anyone, admin included, to pick.
            if (t.key === "investment_return" && investmentsList.length === 0) return false
            return true
          })
        )}
        value={selectedType}
        onClose={() => setShowTypePicker(false)}
        onSelect={(key) => {
          handleTypeChange(key)
          setShowTypePicker(false)
        }}
      />
    )}
    </>
  )
}
