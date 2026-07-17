"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { supabase } from "@/lib/supabase"
import Navbar from "@/app/components/Navbar"
import { autoCloseLoanIfFullyRepaid } from "@/lib/closeLoan"

const typeLabels: Record<string, string> = {
  "Member Contribution": "Contribution",
  "Member Withdrawal": "Withdrawal",
  "Expense": "Expense",
  "Loan Release": "Loan Disbursement",
  "Loan Repayment": "Loan Repayment",
  "Gain Allocation": "Investment Allocation",
  "Bank Interest": "Bank Interest",
  "Internal Transfer": "Bank Transfer"
}

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
  const router = useRouter()
  const [checkingAccess, setCheckingAccess] = useState(true)
  const [memberId, setMemberId] = useState<string | null>(null)
  const [isAdmin, setIsAdmin] = useState(false)
  const [banks, setBanks] = useState<any[]>([])
  const [allMembers, setAllMembers] = useState<any[]>([])
  const [recent, setRecent] = useState<any[]>([])
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

  const [interestRate, setInterestRate] = useState("")
  const [termMonths, setTermMonths] = useState("")
  const [repaymentFrequency, setRepaymentFrequency] = useState("monthly")
  const [selectedLoanId, setSelectedLoanId] = useState("")

  async function loadRecent(id: string) {
    const { data } = await supabase
      .from("transactions")
      .select("transaction_id, classification, amount, description, status, created_at")
      .eq("member_id", id)
      .order("created_at", { ascending: false })
      .limit(5)

    setRecent(data ?? [])
  }

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
    async function checkAccess() {
      const {
        data: { user }
      } = await supabase.auth.getUser()

      if (!user) {
        router.push("/login")
        return
      }

      const { data: member } = await supabase
        .from("members")
        .select("member_id, status, role")
        .eq("email", user.email)
        .single()

      if (!member || member.status !== "approved") {
        router.push("/waiting")
        return
      }

      setMemberId(member.member_id)
      setIsAdmin(member.role === "admin")

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

      await loadRecent(member.member_id)
      await loadLoansFor(member.member_id)
      setCheckingAccess(false)
    }

    checkAccess()
  }, [])

  const visibleTypes = ENTRY_TYPES.filter((t) => !t.adminOnly || isAdmin)
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
    isValidPositiveNumber(amount) && isValidPositiveNumber(interestRate, true)
      ? Number(amount) + Number(amount) * (Number(interestRate) / 100)
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
    setInterestRate("")
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

    if (isLoanRequest && !isValidPositiveNumber(interestRate, true)) {
      setMessage("Enter a valid interest rate (0 or higher).")
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
          interest_rate: Number(interestRate),
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

    // If an admin just instant-approved a repayment on someone's behalf and
    // it fully covers the loan, close it and distribute gain automatically.
    if (isLoanPayment && status === "approved" && selectedLoanId) {
      await autoCloseLoanIfFullyRepaid(selectedLoanId)
    }

    router.push("/transactions")
  }

  const fmt = (n: number) =>
    Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })

  if (checkingAccess) {
    return (
      <>
        <Navbar />
        <main className="p-6 bg-paper min-h-screen text-ink font-sans" />
      </>
    )
  }

  return (
    <>
      <Navbar />
      <main className="min-h-screen bg-paper text-ink font-sans">
        <div className="max-w-lg mx-auto px-4 sm:px-5 pt-8 pb-24">
          <div className="text-[11px] tracking-[0.18em] uppercase text-gold font-mono mb-2">
            New Entry
          </div>
          <h1 className="font-display text-3xl sm:text-4xl font-semibold text-ink">
            New Transaction
          </h1>

          <div className="mt-8 bg-paper-2 border border-hairline rounded-md p-5 space-y-4">
              <div>
                <label className="block mb-2 text-xs uppercase tracking-wide text-ink-soft font-mono">
                  Type
                </label>
                <select
                  className="border border-hairline bg-paper text-ink text-sm rounded-md px-3 py-3 w-full"
                  value={selectedType}
                  onChange={(e) => handleTypeChange(e.target.value)}
                >
                  {visibleTypes.map((t) => (
                    <option key={t.key} value={t.key}>
                      {t.label}
                    </option>
                  ))}
                </select>
                <p className="text-xs text-ink-soft mt-2">
                  {helperText[selectedType]}
                </p>
              </div>

              {isAdmin && isMemberLinkedType && (
                <div>
                  <label className="block mb-2 text-xs uppercase tracking-wide text-ink-soft font-mono">
                    On behalf of
                  </label>
                  <select
                    className="border border-hairline bg-paper text-ink text-sm rounded-md px-3 py-3 w-full"
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
                    <p className="text-xs text-gold mt-2">
                      This will be recorded as approved immediately for {allMembers.find((m) => m.member_id === onBehalfOfId)?.name}.
                    </p>
                  )}
                </div>
              )}

              {isLoanPayment && (
                <div>
                  <label className="block mb-2 text-xs uppercase tracking-wide text-ink-soft font-mono">
                    Which loan
                  </label>
                  {myLoans.filter((l) => l.status === "active").length === 0 ? (
                    <p className="text-xs text-rust">
                      No active loans to pay against.
                    </p>
                  ) : (
                    <select
                      className="border border-hairline bg-paper text-ink text-sm rounded-md px-3 py-3 w-full"
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
                <label className="block mb-2 text-xs uppercase tracking-wide text-ink-soft font-mono">
                  {isLoanRequest ? "Amount to borrow" : "Amount"}
                </label>
                <input
                  className="border border-hairline bg-paper text-ink text-sm rounded-md px-3 py-3 w-full font-mono [font-variant-numeric:tabular-nums]"
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
                    <label className="block mb-2 text-xs uppercase tracking-wide text-ink-soft font-mono">
                      Interest rate (%)
                    </label>
                    <input
                      className="border border-hairline bg-paper text-ink text-sm rounded-md px-3 py-3 w-full font-mono [font-variant-numeric:tabular-nums]"
                      type="number"
                      min="0"
                      step="0.01"
                      placeholder="e.g. 5"
                      value={interestRate}
                      onChange={(e) => setInterestRate(e.target.value)}
                    />
                  </div>

                  <div>
                    <label className="block mb-2 text-xs uppercase tracking-wide text-ink-soft font-mono">
                      Term (months)
                    </label>
                    <input
                      className="border border-hairline bg-paper text-ink text-sm rounded-md px-3 py-3 w-full font-mono [font-variant-numeric:tabular-nums]"
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
                      className="border border-hairline bg-paper text-ink text-sm rounded-md px-3 py-3 w-full"
                      value={repaymentFrequency}
                      onChange={(e) => setRepaymentFrequency(e.target.value)}
                    >
                      <option value="monthly">Monthly installments</option>
                      <option value="lump_sum">One lump sum at end of term</option>
                    </select>
                  </div>

                  {previewTotalRepayable > 0 && isValidPositiveNumber(termMonths) && (
                    <div className="border border-hairline rounded-md p-4 bg-paper">
                      <p className="text-xs text-ink-soft font-mono mb-2">
                        Estimated repayment
                      </p>
                      <div className="flex justify-between text-sm font-mono [font-variant-numeric:tabular-nums]">
                        <span className="text-ink-soft">Total repayable</span>
                        <span>₱{fmt(previewTotalRepayable)}</span>
                      </div>
                      <div className="flex justify-between text-sm font-mono [font-variant-numeric:tabular-nums] mt-1">
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
                    {isBankTransfer ? "From bank" : "Bank"}
                  </label>
                  <select
                    className="border border-hairline bg-paper text-ink text-sm rounded-md px-3 py-3 w-full"
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
                  </label>
                  <select
                    className="border border-hairline bg-paper text-ink text-sm rounded-md px-3 py-3 w-full"
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
                  className="border border-hairline bg-paper text-ink text-sm rounded-md px-3 py-3 w-full"
                  placeholder="Add a note"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                />
              </div>

              {needsReceipt && (
                <div>
                  <label className="block mb-2 text-xs uppercase tracking-wide text-ink-soft font-mono">
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
                      <span className="text-sm text-ink">
                        Tap to upload, or drag a photo here
                      </span>
                      <span className="text-xs text-ink-soft">
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
                        <p className="text-sm text-ink truncate">
                          {receipt?.name}
                        </p>
                        <p className="text-xs text-ink-soft">
                          {receipt ? `${(receipt.size / 1024).toFixed(0)} KB` : ""}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => setReceiptFile(null)}
                        className="text-xs text-rust border border-rust rounded-full px-2 py-1 shrink-0"
                      >
                        Remove
                      </button>
                    </div>
                  )}
                </div>
              )}

              <button
                className="bg-ink text-paper px-4 py-3 rounded-md w-full font-medium disabled:opacity-50"
                onClick={handleSubmit}
                disabled={submitting}
              >
                {submitting ? "Submitting..." : "Submit"}
              </button>

              {message && (
                <p className="text-sm text-rust">
                  {message}
                </p>
              )}
          </div>

          {recent.length > 0 && (
            <div className="mt-10">
              <h2 className="font-display text-lg font-medium text-ink mb-3">
                Your Recent Activity
              </h2>
              <div className="bg-paper-2 border border-hairline rounded-md px-5">
                  {recent.map((t, i) => (
                    <div
                      key={t.transaction_id}
                      className={`py-3 flex justify-between items-center gap-3 ${
                        i !== recent.length - 1 ? "border-b border-dashed border-hairline" : ""
                      }`}
                    >
                      <div className="min-w-0">
                        <p className="text-sm text-ink">
                          {typeLabels[t.classification] || t.classification}
                          <span className="text-ink-soft font-mono text-xs ml-2">
                            {new Date(t.created_at).toLocaleDateString()}
                          </span>
                        </p>
                        {t.description && (
                          <p className="text-xs text-ink-soft truncate">
                            {t.description}
                          </p>
                        )}
                      </div>
                      <div className="text-right shrink-0">
                        <p className="font-mono [font-variant-numeric:tabular-nums] text-sm text-ink">
                          ₱{fmt(Math.abs(t.amount))}
                        </p>
                        <p className="text-[10px] uppercase text-ink-soft font-mono">
                          {t.status}
                        </p>
                      </div>
                    </div>
                  ))}
              </div>
            </div>
          )}
        </div>
      </main>
    </>
  )
}
