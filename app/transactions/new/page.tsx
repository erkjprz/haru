"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { supabase } from "@/lib/supabase"
import Navbar from "@/app/components/Navbar"
import { useAuth } from "@/app/auth-context"
import { SkeletonPanel } from "@/app/components/Skeleton"
import { totalRepayable, type InterestType } from "@/lib/loanMath"

const ENTRY_TYPES = [
  { key: "contribution", label: "Contribution", adminOnly: false },
  { key: "withdrawal", label: "Withdrawal Request", adminOnly: false },
  { key: "loan_request", label: "Loan Request", adminOnly: false },
  { key: "loan_payment", label: "Loan Payment", adminOnly: false },
  { key: "bank_interest", label: "Bank Interest", adminOnly: true },
  { key: "expense", label: "Expense", adminOnly: true },
  { key: "bank_transfer", label: "Bank Transfer", adminOnly: true }
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
  bank_transfer: { arrow: "⇄", tone: "neutral" }
}

function FlowBadge({ type }: { type: string }) {
  const flow = FLOW[type] ?? { arrow: "•", tone: "neutral" }
  const toneClass =
    flow.tone === "in"
      ? "text-sage bg-sage/10"
      : flow.tone === "out"
      ? "text-rust bg-rust/10"
      : "text-gold bg-gold/10"

  return (
    <span className={`w-7 h-7 rounded flex items-center justify-center text-sm font-bold shrink-0 ${toneClass}`}>
      {flow.arrow}
    </span>
  )
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

function SectionLabel({ children, first }: { children: React.ReactNode; first?: boolean }) {
  return (
    <p
      className={`text-xs font-bold uppercase tracking-wide text-ink font-mono mb-3 ${
        first ? "" : "mt-6 pt-[18px] border-t border-hairline"
      }`}
    >
      {children}
    </p>
  )
}

// Collapsed by default -- just the current selection -- and expands in
// place into the full list on tap. Admin-only entries sit inline with an
// "Admin" tag rather than a separate section, since the tag travels with
// the item wherever it sorts.
function TypeSelector({
  options,
  value,
  onChange
}: {
  options: { key: string; label: string; adminOnly: boolean }[]
  value: string
  onChange: (key: string) => void
}) {
  const [open, setOpen] = useState(false)
  const selected = options.find((o) => o.key === value)

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between gap-3 border border-hairline bg-paper rounded-md px-3.5 py-3"
      >
        <span className="flex items-center gap-2.5 min-w-0">
          <FlowBadge type={value} />
          <span className="text-base font-semibold text-ink truncate">{selected?.label}</span>
        </span>
        <span
          className={`text-ink-soft text-xs shrink-0 motion-safe:transition-transform ${open ? "rotate-180" : ""}`}
        >
          ▾
        </span>
      </button>

      {open && (
        <div className="mt-1.5 border border-hairline rounded-md overflow-hidden">
          {options.map((o) => (
            <button
              key={o.key}
              type="button"
              onClick={() => {
                onChange(o.key)
                setOpen(false)
              }}
              className={`w-full flex items-center justify-between gap-3 px-3.5 py-3 text-sm text-left border-b border-hairline last:border-b-0 transition-colors ${
                o.key === value ? "bg-gold/10 text-ink font-semibold" : "bg-paper text-ink-soft"
              }`}
            >
              <span className="flex items-center gap-2.5 min-w-0">
                <FlowBadge type={o.key} />
                <span className="truncate">{o.label}</span>
              </span>
              {o.adminOnly && (
                <span className="shrink-0 text-[9px] font-bold uppercase tracking-wide text-gold border border-gold/40 rounded-full px-2 py-0.5">
                  Admin
                </span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function Chip({ done, children }: { done?: boolean; children: React.ReactNode }) {
  return (
    <span
      className={`inline-flex items-center gap-1 text-xs font-semibold px-2 py-1 rounded-full border whitespace-nowrap ${
        done ? "text-sage border-sage/40" : "text-ink-soft border-hairline"
      }`}
    >
      {children}
    </span>
  )
}

export default function NewTransactionPage() {
  const router = useRouter()
  const { loading: authLoading, member } = useAuth()
  const [dataLoading, setDataLoading] = useState(true)
  const checkingAccess = authLoading || dataLoading
  const memberId = member?.member_id ?? null
  const isAdmin = member?.role === "admin"
  const [banks, setBanks] = useState<any[]>([])
  const [allMembers, setAllMembers] = useState<any[]>([])
  const [myLoans, setMyLoans] = useState<any[]>([])

  const [selectedType, setSelectedType] = useState("contribution")
  const [onBehalfOfId, setOnBehalfOfId] = useState("")
  const [bankId, setBankId] = useState("")
  const [toBankId, setToBankId] = useState("")
  const [amount, setAmount] = useState("")
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

  async function loadLoansFor(id: string) {
    const { data } = await supabase
      .from("loans")
      .select("loan_id, principal, interest_rate, term_months, status, start_date")
      .eq("member_id", id)
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
  const isAdminEntry =
    selectedType === "bank_interest" ||
    selectedType === "expense" ||
    selectedType === "bank_transfer"
  const needsReceipt =
    (selectedType === "contribution" || selectedType === "loan_payment") && !isAdminEntry
  const needsBank =
    selectedType === "contribution" ||
    selectedType === "loan_payment" ||
    selectedType === "bank_interest" ||
    selectedType === "expense" ||
    isBankTransfer
  const isLoanRequest = selectedType === "loan_request"
  const isLoanPayment = selectedType === "loan_payment"

  const helperText: Record<string, string> = {
    contribution: "You've already sent this money. Attach proof of deposit.",
    withdrawal: "You're requesting money to be sent to you. No receipt needed yet.",
    loan_request: "You're requesting to borrow from the fund. No receipt needed yet.",
    loan_payment: "You've already sent this repayment. Attach proof of deposit.",
    bank_interest: "Recording interest earned by a bank account. Goes in as approved -- splitting it across members is a separate manual step from Admin.",
    expense: "Recording money spent out of the fund. Goes straight in as approved.",
    bank_transfer: "Moving money between two of the fund's own banks. Doesn't affect total contributions or cash — it's just internal."
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

      const { data: urlData } = supabase.storage
        .from("Receipts")
        .getPublicUrl(fileName)

      receiptUrl = urlData.publicUrl
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

      router.push("/transactions")
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

      router.push("/transactions")
      return
    }

    if (isAdminEntry) {
      // Expenses are cash going out, so the ledger stores them negative.
      // Bank Interest rows default to interest_distributed = false and sit
      // there until an admin manually distributes them from /admin --
      // this is no longer automatic.
      const { error } = await supabase
        .from("transactions")
        .insert({
          member_id: null,
          bank_account_id: bankId || null,
          classification: selectedType === "bank_interest" ? "Bank Interest" : "Expense",
          amount: selectedType === "expense" ? -Number(amount) : Number(amount),
          description,
          receipt_url: null,
          status: "approved"
        })

      setSubmitting(false)

      if (error) {
        setMessage(error.message)
        return
      }

      router.push("/transactions")
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

    router.push("/transactions")
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
    chips.push({ done: true, text: "Doesn't affect cash total" })
  } else if (selectedType === "bank_interest" || selectedType === "expense") {
    chips.push(bankId ? { done: true, text: "✓ Bank selected" } : { done: false, text: "Bank required" })
    chips.push({ done: true, text: "Posts as approved" })
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

  return (
    <>
      <Navbar />
      <main className="min-h-screen bg-paper text-ink font-sans">
        <div className="max-w-lg mx-auto px-4 sm:px-5 pt-8 pb-48">
          <div className="text-xs tracking-[0.18em] uppercase text-gold font-mono mb-2">
            New Entry
          </div>
          <h1 className="font-display text-4xl sm:text-5xl font-semibold text-ink">
            New Transaction
          </h1>

          <div className="mt-8 bg-paper-2 border border-hairline rounded-md p-5">
              <SectionLabel first>① Entry type</SectionLabel>
              <TypeSelector
                options={isAdmin ? ENTRY_TYPES : MEMBER_TYPES}
                value={selectedType}
                onChange={handleTypeChange}
              />

              <p className="text-sm text-ink-soft mt-3">
                {helperText[selectedType]}
              </p>

              <SectionLabel>② Amount &amp; details</SectionLabel>

              <div className="space-y-4">
              {isAdmin && isMemberLinkedType && (
                <div>
                  <label className="block mb-2 text-sm uppercase tracking-wide text-ink-soft font-mono">
                    On behalf of
                  </label>
                  <select
                    className="border border-hairline bg-paper text-ink text-base rounded-md px-3 py-3 w-full"
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
              )}

              {isLoanPayment && (
                <div>
                  <label className="block mb-2 text-sm uppercase tracking-wide text-ink-soft font-mono">
                    Which loan
                  </label>
                  {myLoans.filter((l) => l.status === "active").length === 0 ? (
                    <p className="text-sm text-rust">
                      No active loans to pay against.
                    </p>
                  ) : (
                    <select
                      className="border border-hairline bg-paper text-ink text-base rounded-md px-3 py-3 w-full"
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

              <div>
                <label className="block mb-2 text-sm uppercase tracking-wide text-ink-soft font-mono">
                  {isLoanRequest ? "Amount to borrow" : "Amount"}
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

              {isLoanRequest && (
                <>
                  <div>
                    <label className="block mb-2 text-sm uppercase tracking-wide text-ink-soft font-mono">
                      Interest
                    </label>
                    <div className="flex border border-hairline rounded-md overflow-hidden mb-2">
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
                        className="border border-hairline bg-paper text-ink text-base rounded-md px-3 py-3 w-full font-mono [font-variant-numeric:tabular-nums]"
                        type="number"
                        min="0"
                        step="0.01"
                        placeholder="e.g. 5"
                        value={interestRate}
                        onChange={(e) => setInterestRate(e.target.value)}
                      />
                    ) : (
                      <input
                        className="border border-hairline bg-paper text-ink text-base rounded-md px-3 py-3 w-full font-mono [font-variant-numeric:tabular-nums]"
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
                    <label className="block mb-2 text-sm uppercase tracking-wide text-ink-soft font-mono">
                      Term (months)
                    </label>
                    <input
                      className="border border-hairline bg-paper text-ink text-base rounded-md px-3 py-3 w-full font-mono [font-variant-numeric:tabular-nums]"
                      type="number"
                      min="1"
                      step="1"
                      placeholder="e.g. 6"
                      value={termMonths}
                      onChange={(e) => setTermMonths(e.target.value)}
                    />
                  </div>

                  <div>
                    <label className="block mb-2 text-sm uppercase tracking-wide text-ink-soft font-mono">
                      Repayment mode
                    </label>
                    <select
                      className="border border-hairline bg-paper text-ink text-base rounded-md px-3 py-3 w-full"
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
                      <span className="text-base text-ink">
                        Tap to upload, or drag a photo here
                      </span>
                      <span className="text-sm text-ink-soft">
                        Screenshot or photo of your deposit slip
                      </span>
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
                        <p className="text-base text-ink truncate">
                          {receipt?.name}
                        </p>
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
        </div>
      </main>

      <div
        className="fixed bottom-0 left-0 right-0 z-30 bg-paper border-t border-hairline"
        style={{ paddingBottom: "calc(1rem + env(safe-area-inset-bottom))" }}
      >
        <div className="max-w-lg mx-auto px-4 sm:px-5 pt-4 flex items-center gap-3">
          <div className="min-w-0 flex-1">
            <div className="text-xs uppercase tracking-wide text-ink-soft font-mono">
              Amount
            </div>
            <div className="font-mono [font-variant-numeric:tabular-nums] text-2xl font-bold text-ink truncate">
              ₱{isValidPositiveNumber(amount) ? fmt(Number(amount)) : "0.00"}
            </div>
            <div className="flex flex-wrap gap-1.5 mt-2">
              {chips.map((chip, i) => (
                <Chip key={i} done={chip.done}>{chip.text}</Chip>
              ))}
            </div>
          </div>
          <button
            className="shrink-0 bg-ink text-paper px-6 py-3.5 rounded-full text-base font-bold shadow-lg shadow-gold/30 ring-1 ring-gold/40 motion-safe:transition-transform motion-safe:active:scale-[0.97] disabled:opacity-50 disabled:shadow-none disabled:ring-0"
            onClick={handleSubmit}
            disabled={submitting}
          >
            {submitting ? "Submitting…" : "Submit"}
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
