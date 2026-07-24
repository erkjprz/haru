"use client"

import { Suspense, useEffect, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { supabase } from "@/lib/supabase"
import Navbar from "@/app/components/Navbar"
import { useAuth } from "@/app/auth-context"
import { SkeletonPanel } from "@/app/components/Skeleton"
import SubmitConfirmation from "@/app/components/SubmitConfirmation"
import {
  AmountHero,
  TypeDropdown,
  StepTrack,
  ReviewRow,
  ReceiptField,
  RequiredMark,
  FieldGroup
} from "@/app/components/TransactionFormUI"
import { totalRepayable, type InterestType } from "@/lib/loanMath"
import { snapshotInvestmentHold } from "@/lib/snapshotHold"
import { dateOnly } from "@/lib/currentValue"

const ENTRY_TYPES = [
  { key: "contribution", label: "Contribution", adminOnly: false },
  { key: "withdrawal", label: "Withdrawal Request", adminOnly: false },
  { key: "loan_request", label: "Loan Request", adminOnly: false },
  { key: "loan_payment", label: "Loan Payment", adminOnly: false },
  { key: "bank_interest", label: "Bank Interest", adminOnly: true },
  { key: "expense", label: "Expense", adminOnly: true },
  { key: "bank_transfer", label: "Bank Transfer", adminOnly: true },
  { key: "investment", label: "Investment", adminOnly: true },
  { key: "investment_return", label: "Investment Return", adminOnly: true }
]

const MEMBER_LINKED_TYPES = ["contribution", "withdrawal", "loan_request", "loan_payment"]
const MEMBER_TYPES = ENTRY_TYPES.filter((t) => !t.adminOnly)

// Direction the fund's cash moves for each entry type -- "in" (member pays
// the fund), "out" (fund pays a member/expense), or "neutral" (moves
// between the fund's own banks, doesn't change the total).
const FLOW: Record<string, { arrow: string; tone: "in" | "out" | "neutral" }> = {
  contribution: { arrow: "↑", tone: "in" },
  withdrawal: { arrow: "↓", tone: "out" },
  loan_request: { arrow: "↓", tone: "out" },
  loan_payment: { arrow: "↑", tone: "in" },
  bank_interest: { arrow: "↑", tone: "in" },
  expense: { arrow: "↓", tone: "out" },
  bank_transfer: { arrow: "⇄", tone: "neutral" },
  investment: { arrow: "↓", tone: "out" },
  investment_return: { arrow: "↑", tone: "in" }
}

// A number input is "valid" here if it's not empty, parses to a real
// number (not NaN -- e.g. a stray non-numeric paste), and clears the given
// floor. Number(amount) <= 0 alone lets NaN slip through silently, since
// every comparison against NaN is false.
function isValidPositiveNumber(value: string, allowZero = false): boolean {
  if (!value.trim()) return false
  const n = Number(value)
  if (Number.isNaN(n)) return false
  return allowZero ? n >= 0 : n > 0
}

// Merges each entry type with its flow arrow/tone so TypeDropdown (a shared,
// presentation-only component) doesn't need to know this page's FLOW map.
function withFlow(options: { key: string; label: string; adminOnly: boolean }[]) {
  return options.map((o) => ({ ...o, ...(FLOW[o.key] ?? { arrow: "•", tone: "neutral" as const }) }))
}

export default function NewTransactionPage() {
  return (
    <Suspense fallback={null}>
      <NewTransactionForm />
    </Suspense>
  )
}

function NewTransactionForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { loading: authLoading, member } = useAuth()
  const [dataLoading, setDataLoading] = useState(true)
  const checkingAccess = authLoading || dataLoading
  const memberId = member?.member_id ?? null
  const isAdmin = member?.role === "admin"
  const [banks, setBanks] = useState<any[]>([])
  const [allMembers, setAllMembers] = useState<any[]>([])
  const [myLoans, setMyLoans] = useState<any[]>([])
  const [investmentsList, setInvestmentsList] = useState<any[]>([])

  // Dashboard shortcuts (Add Contribution, Request Withdrawal, etc.) deep
  // link here with ?type= so the form opens straight to the right entry
  // type instead of always defaulting to Contribution.
  const [selectedType, setSelectedType] = useState(() => {
    const requested = searchParams.get("type")
    return MEMBER_TYPES.some((t) => t.key === requested) ? requested! : "contribution"
  })
  const [onBehalfOfId, setOnBehalfOfId] = useState("")
  const [investmentId, setInvestmentId] = useState("")
  const [bankId, setBankId] = useState("")
  const [toBankId, setToBankId] = useState("")
  const [amount, setAmount] = useState("")
  const [description, setDescription] = useState("")
  const [receipt, setReceipt] = useState<File | null>(null)
  const [receiptPreview, setReceiptPreview] = useState<string | null>(null)
  const [dragActive, setDragActive] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [message, setMessage] = useState("")
  const [confirmation, setConfirmation] = useState<{ amount: number; label: string; pending: boolean } | null>(null)

  const [interestType, setInterestType] = useState<InterestType>("rate")
  const [interestRate, setInterestRate] = useState("")
  const [interestAmount, setInterestAmount] = useState("")
  const [termMonths, setTermMonths] = useState("")
  const [repaymentFrequency, setRepaymentFrequency] = useState("monthly")
  const [selectedLoanId, setSelectedLoanId] = useState("")

  // Loan Request and Investment/Investment Return are the types with the
  // most conditional fields, so only those get a Details -> Review
  // sub-flow; every other type stays a single flowing view below the
  // amount hero and type picker.
  const [formStep, setFormStep] = useState<1 | 2>(1)

  async function loadLoansFor(id: string) {
    // Borrower-only loans (e.g. Joy, who isn't a fund member) link via
    // borrowers.borrower_id rather than member_id -- mirrors the OR filter
    // the edit page and borrower/repay use so a loan payment made on
    // behalf of a borrower-role member still finds their loan.
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
      .select("loan_id, principal, interest_rate, term_months, status, start_date")
      .or(loanFilter)
      .in("status", ["active", "requested"])
      .order("start_date", { ascending: false })

    setMyLoans(data ?? [])
  }

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

    if (member.role === "borrower") {
      router.push("/borrower")
      return
    }

    async function checkAccess() {
      if (!member) return

      const { data: bankList } = await supabase
        .from("bank_accounts")
        .select("id, bank_name, account_name")
        .order("bank_name")

      setBanks(bankList ?? [])

      if (member.role === "admin") {
        const { data: memberList } = await supabase
          .from("members")
          .select("member_id, name")
          .order("name")

        setAllMembers(memberList ?? [])

        const { data: investmentList } = await supabase
          .from("investments")
          .select("investment_id, name")
          .order("name")

        setInvestmentsList(investmentList ?? [])
      }

      await loadLoansFor(member.member_id)
      setDataLoading(false)
    }

    checkAccess()
  }, [authLoading, member, router])

  const isMemberLinkedType = MEMBER_LINKED_TYPES.includes(selectedType)
  const effectiveMemberId =
    isAdmin && isMemberLinkedType && onBehalfOfId ? onBehalfOfId : memberId

  // Who actually clicked submit, when it's not the same person the
  // transaction is recorded for. Null for normal self-submissions.
  const submittedByForOnBehalf =
    isAdmin && isMemberLinkedType && onBehalfOfId ? memberId : null

  const isBankTransfer = selectedType === "bank_transfer"
  const isInvestmentEntry = selectedType === "investment" || selectedType === "investment_return"
  const isAdminEntry =
    selectedType === "bank_interest" ||
    selectedType === "expense" ||
    selectedType === "bank_transfer" ||
    isInvestmentEntry
  // Every type requires a receipt except the two "request" types --
  // withdrawal and loan_request -- where nothing has actually moved yet at
  // the moment the entry is created. Everything else, admin-entered types
  // included, represents real money already having moved, with a real-world
  // equivalent to point to (a bank statement, an expense receipt, a
  // transfer confirmation, a wire receipt).
  const needsReceipt = selectedType !== "withdrawal" && selectedType !== "loan_request"
  const needsBank =
    selectedType === "contribution" ||
    selectedType === "loan_payment" ||
    selectedType === "bank_interest" ||
    selectedType === "expense" ||
    isBankTransfer ||
    isInvestmentEntry
  const isLoanRequest = selectedType === "loan_request"
  const isLoanPayment = selectedType === "loan_payment"
  const isStepped = isLoanRequest || isInvestmentEntry

  const helperText: Record<string, string> = {
    contribution: "You've already sent this money. Attach proof of deposit.",
    withdrawal: "You're requesting money to be sent to you. No receipt needed yet.",
    loan_request: "You're requesting to borrow from the fund. No receipt needed yet.",
    loan_payment: "You've already sent this repayment. Attach proof of deposit.",
    bank_interest: "Recording interest earned by a bank account. Attach the bank statement or screenshot showing it credited. Goes in as approved -- splitting it across members is a separate manual step from Admin.",
    expense: "Recording money spent out of the fund. Attach a receipt or proof of payment. Goes straight in as approved.",
    bank_transfer: "Moving money between two of the fund's own banks. Attach a screenshot of the transfer confirmation. Doesn't affect total contributions or cash — it's just internal.",
    investment: "Moving fund cash into a venture. Pick which investment this funds, and attach proof it went out (wire confirmation, receipt, etc). Goes in as approved.",
    investment_return: "Cash coming back from a venture -- a payout, sale, or exit. Attach proof of deposit. Goes in as approved."
  }

  const previewTotalRepayable =
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

  async function handleTypeChange(newType: string) {
    setSelectedType(newType)
    setFormStep(1)
    setMessage("")
    setReceiptFile(null)
    setBankId("")
    setToBankId("")
    setInterestType("rate")
    setInterestRate("")
    setInterestAmount("")
    setTermMonths("")
    setRepaymentFrequency("monthly")
    setSelectedLoanId("")
    setOnBehalfOfId("")
    setInvestmentId("")

    if (newType === "loan_payment" && memberId) {
      await loadLoansFor(memberId)
    }
  }

  // Gate for the Details step's "Continue" -- the same checks handleSubmit
  // itself makes for these two types, just run earlier so the Review step
  // never shows something that can't actually be submitted.
  function detailsStepError(): string {
    if (!isValidPositiveNumber(amount)) return "Enter a valid amount greater than zero."

    if (isInvestmentEntry) {
      if (!bankId) return "Select a bank."
      if (!investmentId) return "Select which investment this is for."
      if (!receipt) return "Attach a receipt."
    }

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

  async function handleOnBehalfChange(id: string) {
    setOnBehalfOfId(id)
    setSelectedLoanId("")

    if (selectedType === "loan_payment") {
      await loadLoansFor(id || memberId || "")
    }
  }

  async function handleSubmit() {
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

    if (needsReceipt && !receipt) {
      setMessage("Attach a receipt.")
      return
    }

    if (isInvestmentEntry && !investmentId) {
      setMessage("Select which investment this is for.")
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

    let receiptUrl = null

    if (receipt) {
      const fileName = `${effectiveMemberId}-${Date.now()}-${receipt.name}`

      const { error: uploadError } = await supabase.storage
        .from("Receipts")
        .upload(fileName, receipt, {
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
      const { data: newLoan, error: loanError } = await supabase
        .from("loans")
        .insert({
          member_id: effectiveMemberId,
          principal: Number(amount),
          interest_type: interestType,
          interest_rate: interestType === "rate" ? Number(interestRate) : 0,
          interest_amount: interestType === "amount" ? Number(interestAmount) : null,
          term_months: Number(termMonths),
          repayment_frequency: repaymentFrequency,
          status: "requested",
          start_date: new Date().toISOString().slice(0, 10),
          notes: description
        })
        .select()
        .single()

      if (loanError) {
        setMessage(loanError.message)
        setSubmitting(false)
        return
      }

      // Loan releases are cash going out, so the ledger stores them negative.
      const { error } = await supabase
        .from("transactions")
        .insert({
          member_id: effectiveMemberId,
          bank_account_id: null,
          loan_id: newLoan.loan_id,
          classification: "Loan Release",
          amount: -Number(amount),
          description,
          receipt_url: null,
          status: "pending",
          submitted_by: submittedByForOnBehalf
        })

      setSubmitting(false)

      if (error) {
        setMessage(error.message)
        return
      }

      setConfirmation({ amount: Number(amount), label: "Loan request submitted", pending: true })
      return
    }

    if (isBankTransfer) {
      // Cash-neutral: affects_cash 0 keeps it out of the cash ledger; the
      // per-bank balances use bank_account_id / to_bank_account_id instead.
      const { error } = await supabase
        .from("transactions")
        .insert({
          member_id: null,
          bank_account_id: bankId,
          to_bank_account_id: toBankId,
          classification: "Internal Transfer",
          affects_cash: 0,
          amount: Number(amount),
          description,
          receipt_url: null,
          status: "approved"
        })

      setSubmitting(false)

      if (error) {
        setMessage(error.message)
        return
      }

      setConfirmation({ amount: Number(amount), label: "Bank transfer recorded", pending: false })
      return
    }

    if (isAdminEntry) {
      // Expenses and new Investment outflows are cash going out, so the
      // ledger stores them negative -- matches v_investment_summary, which
      // reads "invested" as -amount on Investment rows and "returned" as
      // plain amount on Investment Return rows.
      // Bank Interest rows default to interest_distributed = false and sit
      // there until an admin manually distributes them from /admin --
      // this is no longer automatic.
      const classification =
        selectedType === "bank_interest"
          ? "Bank Interest"
          : selectedType === "expense"
          ? "Expense"
          : selectedType === "investment"
          ? "Investment"
          : "Investment Return"

      const { error } = await supabase
        .from("transactions")
        .insert({
          member_id: null,
          bank_account_id: bankId || null,
          investment_id: isInvestmentEntry ? investmentId : null,
          classification,
          amount: selectedType === "expense" || selectedType === "investment" ? -Number(amount) : Number(amount),
          description,
          receipt_url: null,
          status: "approved"
        })

      if (error) {
        setSubmitting(false)
        setMessage(error.message)
        return
      }

      // New capital into an investment changes who's staking it, so
      // re-snapshot the pool's shares for this investment's hold tracking.
      if (selectedType === "investment") {
        await snapshotInvestmentHold(investmentId, dateOnly(new Date()))
      }

      setSubmitting(false)
      setConfirmation({ amount: Number(amount), label: `${classification} recorded`, pending: false })
      return
    }

    const classification =
      selectedType === "loan_payment"
        ? "Loan Repayment"
        : selectedType === "withdrawal"
        ? "Member Withdrawal"
        : "Member Contribution"

    const status =
      isAdmin && isMemberLinkedType && onBehalfOfId ? "approved" : "pending"

    // Withdrawals are cash going out, so the ledger stores them negative.
    const { error } = await supabase
      .from("transactions")
      .insert({
        member_id: effectiveMemberId,
        bank_account_id: bankId || null,
        loan_id: isLoanPayment ? selectedLoanId : null,
        classification,
        amount: selectedType === "withdrawal" ? -Number(amount) : Number(amount),
        description,
        receipt_url: receiptUrl,
        status,
        submitted_by: submittedByForOnBehalf
      })

    setSubmitting(false)

    if (error) {
      setMessage(error.message)
      return
    }

    const typeLabel =
      selectedType === "loan_payment" ? "Loan repayment" : selectedType === "withdrawal" ? "Withdrawal" : "Contribution"
    setConfirmation({
      amount: Number(amount),
      label: `${typeLabel} ${status === "pending" ? "submitted" : "recorded"}`,
      pending: status === "pending"
    })
  }

  const fmt = (n: number) =>
    Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })

  function bankLabel(id: string) {
    const bank = banks.find((b) => b.id === id)
    return bank ? bank.account_name || bank.bank_name : "Bank"
  }

  if (checkingAccess) {
    return (
      <>
        <Navbar />
        <main className="min-h-screen bg-paper text-ink font-sans overflow-x-hidden">
          <div className="max-w-lg mx-auto px-4 sm:px-5 pt-8 pb-24">
            <SkeletonPanel />
          </div>
        </main>
      </>
    )
  }

  if (confirmation) {
    return (
      <>
        <Navbar />
        <main className="min-h-screen bg-paper text-ink font-sans overflow-x-hidden">
          <div className="max-w-lg mx-auto px-4 sm:px-5 pt-8 pb-24">
            <SubmitConfirmation
              amount={confirmation.amount}
              label={confirmation.label}
              pending={confirmation.pending}
              continueLabel="View Transactions →"
              onContinue={() => router.push("/transactions")}
            />
          </div>
        </main>
      </>
    )
  }

  // Shared between the flowing and stepped Details cards -- loan_request
  // is member-linked too, so this can show up in either one depending on
  // the selected type.
  const onBehalfOfField = isAdmin && isMemberLinkedType && (
    <div>
      <label className="block mb-2 text-xs uppercase tracking-wide text-ink-soft font-mono">On behalf of</label>
      <select
        className="border border-hairline bg-paper text-ink text-sm rounded-sm px-3 py-3 w-full"
        value={onBehalfOfId}
        onChange={(e) => handleOnBehalfChange(e.target.value)}
      >
        <option value="">Myself</option>
        {allMembers
          .filter((m) => m.member_id !== memberId)
          .map((m) => (
            <option key={m.member_id} value={m.member_id}>
              {m.name}
            </option>
          ))}
      </select>
      {onBehalfOfId && (
        <p className="text-sm text-gold mt-2">
          This will be recorded as approved immediately for {allMembers.find((m) => m.member_id === onBehalfOfId)?.name}.
        </p>
      )}
    </div>
  )

  return (
    <>
      <Navbar />
      <main className="min-h-screen bg-paper text-ink font-sans overflow-x-hidden">
        <div className="max-w-lg mx-auto px-4 sm:px-5 pt-8 pb-48">
          <button
            onClick={() => router.push("/transactions")}
            className="text-[13px] text-ink-soft mb-4 hover:text-ink transition-colors"
          >
            ← Transactions
          </button>

          <div className="bg-paper-2 border border-hairline rounded-md p-5">
            <AmountHero
              value={amount}
              onChange={setAmount}
              label={isLoanRequest ? "Amount to borrow" : "Amount"}
              helper={helperText[selectedType]}
            />

            <TypeDropdown
              options={withFlow(isAdmin ? ENTRY_TYPES : MEMBER_TYPES)}
              value={selectedType}
              onChange={handleTypeChange}
            />
          </div>

          <div className="space-y-4 mt-4">
            {!isStepped && (
              <>
                <FieldGroup label="Details">
                  <div className="space-y-4">
                  {onBehalfOfField}

                  {isLoanPayment && (
                    <div>
                      <label className="block mb-2 text-xs uppercase tracking-wide text-ink-soft font-mono">
                        Which loan
                        <RequiredMark />
                      </label>
                      {myLoans.filter((l) => l.status === "active").length === 0 ? (
                        <p className="text-sm text-rust">
                          No active loans to pay against.
                        </p>
                      ) : (
                        <select
                          className="border border-hairline bg-paper text-ink text-sm rounded-sm px-3 py-3 w-full"
                          value={selectedLoanId}
                          onChange={(e) => setSelectedLoanId(e.target.value)}
                        >
                          <option value="">Select a loan</option>
                          {myLoans
                            .filter((l) => l.status === "active")
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
                    <FieldGroup>
                      <div className="space-y-4">
                      {onBehalfOfField}

                      {isInvestmentEntry && (
                        <div>
                          <label className="block mb-2 text-xs uppercase tracking-wide text-ink-soft font-mono">
                            Investment
                            <RequiredMark />
                          </label>
                          <select
                            className="border border-hairline bg-paper text-ink text-sm rounded-sm px-3 py-3 w-full"
                            value={investmentId}
                            onChange={(e) => setInvestmentId(e.target.value)}
                          >
                            <option value="">Select an investment</option>
                            {investmentsList.map((inv) => (
                              <option key={inv.investment_id} value={inv.investment_id}>
                                {inv.name}
                              </option>
                            ))}
                          </select>
                          {investmentsList.length === 0 && (
                            <p className="text-sm text-ink-soft mt-2">
                              No investments yet -- add one from the Investments page first.
                            </p>
                          )}
                        </div>
                      )}

                      {isLoanRequest && (
                        <>
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
                              <p className="text-sm text-ink-soft font-mono mb-2">
                                Estimated repayment
                              </p>
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
                                <span className="font-semibold">
                                  ₱{fmt(previewPerInstallment)}
                                </span>
                              </div>
                            </div>
                          )}
                        </>
                      )}

                      {needsBank && (
                        <div>
                          <label className="block mb-2 text-xs uppercase tracking-wide text-ink-soft font-mono">
                            Bank
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
                            dragActive={dragActive}
                            setDragActive={setDragActive}
                            onFileChange={setReceiptFile}
                          />
                        </div>
                      </FieldGroup>
                    )}
                  </>
                )}

                {formStep === 2 && (
                  <FieldGroup>
                    <ReviewRow
                      label="Type"
                      value={(isAdmin ? ENTRY_TYPES : MEMBER_TYPES).find((t) => t.key === selectedType)?.label ?? ""}
                    />
                    <ReviewRow
                      label={isLoanRequest ? "Amount to borrow" : "Amount"}
                      value={`₱${fmt(isValidPositiveNumber(amount) ? Number(amount) : 0)}`}
                    />
                    {onBehalfOfId && (
                      <ReviewRow
                        label="On behalf of"
                        value={allMembers.find((m) => m.member_id === onBehalfOfId)?.name ?? ""}
                      />
                    )}
                    {isInvestmentEntry && (
                      <>
                        <ReviewRow
                          label="Investment"
                          value={investmentsList.find((i) => i.investment_id === investmentId)?.name ?? "—"}
                        />
                        <ReviewRow label="Bank" value={bankLabel(bankId)} />
                      </>
                    )}
                    {isLoanRequest && (
                      <>
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
                      </>
                    )}
                    {description && <ReviewRow label="Description" value={description} />}
                    {needsReceipt && <ReviewRow label="Receipt" value={receipt ? receipt.name : "—"} />}
                  </FieldGroup>
                )}
              </>
            )}
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
          {isStepped && formStep === 2 && (
            <button
              className="shrink-0 border border-hairline text-ink-soft px-5 py-3.5 rounded-full text-base font-semibold"
              onClick={() => setFormStep(1)}
            >
              Back
            </button>
          )}
          <button
            className="flex-1 bg-ink text-paper px-6 py-3.5 rounded-full text-base font-bold shadow-lg shadow-gold/30 ring-1 ring-gold/40 motion-safe:transition-transform motion-safe:active:scale-[0.97] disabled:opacity-50 disabled:shadow-none disabled:ring-0"
            onClick={isStepped && formStep === 1 ? handleContinueToReview : handleSubmit}
            disabled={submitting}
          >
            {submitting ? "Submitting…" : isStepped && formStep === 1 ? "Continue" : "Submit"}
          </button>
        </div>
      </div>
    </>
  )
}
