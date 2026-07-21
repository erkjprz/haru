"use client"

import { Suspense, useEffect, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { supabase } from "@/lib/supabase"
import Navbar from "@/app/components/Navbar"
import { useAuth } from "@/app/auth-context"
import { SkeletonPanel } from "@/app/components/Skeleton"
import SubmitConfirmation from "@/app/components/SubmitConfirmation"
import {
  Chip,
  RowGroup,
  SelectRow,
  TextRow,
  NumberRow,
  AmountHero,
  TypeTabs,
  TypeChipRow
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

  async function loadLoansFor(id: string) {
    const { data } = await supabase
      .from("loans")
      .select("loan_id, principal, interest_rate, term_months, status, start_date")
      .eq("member_id", id)
      .in("status", ["active", "requested"])
      .order("start_date", { ascending: false })

    setMyLoans(data ?? [])
  }

  // Defensive against iOS Safari restoring a previous scroll position on
  // back-forward-cache navigation -- this form should always start at the
  // top regardless of where the last page (or the last visit here) left off.
  useEffect(() => {
    window.scrollTo(0, 0)
  }, [])

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

  function handleDrop(e: React.DragEvent) {
    e.preventDefault()
    setDragActive(false)
    const file = e.dataTransfer.files?.[0]
    if (file) setReceiptFile(file)
  }

  async function handleTypeChange(newType: string) {
    setSelectedType(newType)
    // Switching type can swap in a much shorter (or longer) set of fields --
    // same idiom as Dashboard's You/Fund tabs, so the new fields are never
    // left scrolled halfway down a page whose content just changed height.
    window.scrollTo(0, 0)
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

  // Readiness chips for the sticky summary bar -- one branch per entry
  // type's actual requirements, mirroring the validation in handleSubmit.
  const chips: { done: boolean; text: string }[] = []

  if (selectedType === "contribution" || isLoanPayment) {
    chips.push(bankId ? { done: true, text: "✓ Bank selected" } : { done: false, text: "Bank required" })
    chips.push(receipt ? { done: true, text: "✓ Receipt attached" } : { done: false, text: "Receipt required" })
    if (isLoanPayment) {
      chips.push(selectedLoanId ? { done: true, text: "✓ Loan matched" } : { done: false, text: "Select a loan" })
    }
  } else if (selectedType === "withdrawal") {
    chips.push({ done: false, text: "No receipt needed" })
  } else if (isLoanRequest) {
    chips.push(
      previewTotalRepayable > 0
        ? { done: true, text: `Total ₱${fmt(previewTotalRepayable)}` }
        : { done: false, text: "Enter interest & term" }
    )
  } else if (isBankTransfer) {
    chips.push(
      bankId && toBankId
        ? { done: true, text: `✓ ${bankLabel(bankId)} → ${bankLabel(toBankId)}` }
        : { done: false, text: "Select both banks" }
    )
    chips.push(receipt ? { done: true, text: "✓ Receipt attached" } : { done: false, text: "Receipt required" })
    chips.push({ done: true, text: "Doesn't affect cash total" })
  } else if (isInvestmentEntry) {
    chips.push(bankId ? { done: true, text: "✓ Bank selected" } : { done: false, text: "Bank required" })
    chips.push(investmentId ? { done: true, text: "✓ Investment selected" } : { done: false, text: "Investment required" })
    chips.push(receipt ? { done: true, text: "✓ Receipt attached" } : { done: false, text: "Receipt required" })
    chips.push({ done: true, text: "Posts as approved" })
  } else if (selectedType === "bank_interest" || selectedType === "expense") {
    chips.push(bankId ? { done: true, text: "✓ Bank selected" } : { done: false, text: "Bank required" })
    chips.push(receipt ? { done: true, text: "✓ Receipt attached" } : { done: false, text: "Receipt required" })
    chips.push({ done: true, text: "Posts as approved" })
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

  return (
    <>
      <Navbar />
      <main className="min-h-screen bg-paper text-ink font-sans overflow-x-hidden">
        <div className="max-w-lg mx-auto px-4 sm:px-5 pt-8 pb-36">
          <button
            onClick={() => router.push("/transactions")}
            className="text-[13px] text-ink-soft mb-4 hover:text-ink transition-colors"
          >
            ← Transactions
          </button>
          <div className="text-[11px] tracking-[0.18em] uppercase text-gold font-mono mb-2">
            New Entry
          </div>
          <h1 className="font-display text-3xl sm:text-4xl font-semibold text-ink mb-1">
            New Transaction
          </h1>
          <p className="text-[13px] text-ink-soft mb-6">Add a new ledger entry for the fund.</p>

          {isAdmin ? (
            <TypeChipRow options={ENTRY_TYPES} value={selectedType} onChange={handleTypeChange} />
          ) : (
            <TypeTabs options={MEMBER_TYPES} value={selectedType} onChange={handleTypeChange} />
          )}

          <AmountHero
            label={isLoanRequest ? "Amount to borrow" : "Amount"}
            value={amount}
            onChange={setAmount}
            helper={helperText[selectedType]}
          />

          {isLoanRequest && (
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
            {isAdmin && isMemberLinkedType && (
              <SelectRow
                label="On behalf of"
                value={onBehalfOfId}
                onChange={handleOnBehalfChange}
                placeholder="Myself"
                options={allMembers
                  .filter((m) => m.member_id !== memberId)
                  .map((m) => ({ value: m.member_id, label: m.name }))}
              />
            )}

            {isInvestmentEntry && (
              <SelectRow
                label="Investment"
                value={investmentId}
                onChange={setInvestmentId}
                placeholder="Select an investment"
                options={investmentsList.map((inv) => ({ value: inv.investment_id, label: inv.name }))}
              />
            )}

            {isLoanPayment && (
              <SelectRow
                label="Loan"
                value={selectedLoanId}
                onChange={setSelectedLoanId}
                placeholder="Select a loan"
                options={myLoans
                  .filter((l) => l.status === "active")
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

          {isAdmin && isMemberLinkedType && onBehalfOfId && (
            <p className="text-sm text-gold mt-3">
              This will be recorded as approved immediately for{" "}
              {allMembers.find((m) => m.member_id === onBehalfOfId)?.name}.
            </p>
          )}
          {isInvestmentEntry && investmentsList.length === 0 && (
            <p className="text-sm text-ink-soft mt-3">
              No investments yet -- add one from the Investments page first.
            </p>
          )}
          {isLoanPayment && myLoans.filter((l) => l.status === "active").length === 0 && (
            <p className="text-sm text-rust mt-3">No active loans to pay against.</p>
          )}

          {needsReceipt && (
            <div className="mt-5">
              <p className="text-xs font-bold uppercase tracking-wide text-ink-soft font-mono mb-2">Receipt</p>

              {!receiptPreview ? (
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
              ) : (
                <div className="relative border border-hairline rounded-md p-3 flex items-center gap-3">
                  <img
                    src={receiptPreview}
                    alt="Receipt preview"
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
        </div>
      </main>

      <div
        className="fixed bottom-0 left-0 right-0 z-30 bg-paper border-t border-hairline"
        style={{ paddingBottom: "calc(1rem + env(safe-area-inset-bottom))" }}
      >
        <div className="max-w-lg mx-auto px-4 sm:px-5 pt-4">
          {chips.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mb-3">
              {chips.map((chip, i) => (
                <Chip key={i} done={chip.done}>
                  {chip.text}
                </Chip>
              ))}
            </div>
          )}
          <button
            className="w-full bg-ink text-paper py-3.5 rounded-md text-base font-bold shadow-lg shadow-gold/30 ring-1 ring-gold/40 motion-safe:transition-transform motion-safe:active:scale-[0.99] disabled:opacity-50 disabled:shadow-none disabled:ring-0"
            onClick={handleSubmit}
            disabled={submitting}
          >
            {submitting ? "Submitting…" : "Submit"}
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
