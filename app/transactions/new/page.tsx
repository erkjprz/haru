"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { supabase } from "@/lib/supabase"
import Navbar from "@/app/components/Navbar"

const typeLabels: Record<string, string> = {
  contribution: "Contribution",
  withdrawal: "Withdrawal",
  expense: "Expense",
  loan_disbursement: "Loan Disbursement",
  loan_repayment: "Loan Repayment",
  investment_allocation: "Investment Allocation"
}

const ENTRY_TYPES = [
  { key: "contribution", label: "Contribution" },
  { key: "withdrawal", label: "Withdrawal Request" },
  { key: "loan_request", label: "Loan Request" },
  { key: "loan_payment", label: "Loan Payment" }
]

export default function NewTransactionPage() {
  const router = useRouter()
  const [checkingAccess, setCheckingAccess] = useState(true)
  const [memberId, setMemberId] = useState<string | null>(null)
  const [banks, setBanks] = useState<any[]>([])
  const [recent, setRecent] = useState<any[]>([])
  const [myLoans, setMyLoans] = useState<any[]>([])

  const [selectedType, setSelectedType] = useState("contribution")
  const [bankId, setBankId] = useState("")
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
      .select("id, type, amount, description, status, created_at")
      .eq("member_id", id)
      .order("created_at", { ascending: false })
      .limit(5)

    setRecent(data ?? [])
  }

  async function loadMyLoans(id: string) {
    const { data } = await supabase
      .from("loans")
      .select("id, principal, interest_rate, term_months, status, start_date")
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
        .select("id, status")
        .eq("email", user.email)
        .single()

      if (!member || member.status !== "approved") {
        router.push("/waiting")
        return
      }

      setMemberId(member.id)

      const { data: bankList } = await supabase
        .from("bank_accounts")
        .select("id, bank_name, account_name")
        .order("bank_name")

      setBanks(bankList ?? [])
      await loadRecent(member.id)
      await loadMyLoans(member.id)
      setCheckingAccess(false)
    }

    checkAccess()
  }, [])

  const needsReceipt = selectedType === "contribution" || selectedType === "loan_payment"
  const needsBank = selectedType === "contribution" || selectedType === "loan_payment"
  const isLoanRequest = selectedType === "loan_request"
  const isLoanPayment = selectedType === "loan_payment"

  const helperText: Record<string, string> = {
    contribution: "You've already sent this money. Attach proof of deposit.",
    withdrawal: "You're requesting money to be sent to you. No receipt needed yet.",
    loan_request: "You're requesting to borrow from the fund. No receipt needed yet.",
    loan_payment: "You've already sent this repayment. Attach proof of deposit."
  }

  const previewTotalRepayable =
    amount && interestRate
      ? Number(amount) + Number(amount) * (Number(interestRate) / 100)
      : 0

  const previewPerInstallment =
    previewTotalRepayable && termMonths && repaymentFrequency === "monthly"
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

  function resetTypeFields() {
    setReceiptFile(null)
    setBankId("")
    setInterestRate("")
    setTermMonths("")
    setRepaymentFrequency("monthly")
    setSelectedLoanId("")
  }

  async function handleSubmit() {
    setMessage("")

    if (!amount || Number(amount) <= 0) {
      setMessage("Enter a valid amount.")
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

    if (isLoanRequest && (!interestRate || !termMonths)) {
      setMessage("Enter interest rate and term.")
      return
    }

    if (isLoanPayment && !selectedLoanId) {
      setMessage("Select which loan you're paying.")
      return
    }

    setSubmitting(true)

    let receiptUrl = null

    if (receipt) {
      const fileName = `${memberId}-${Date.now()}-${receipt.name}`

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
          member_id: memberId,
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

      const { error } = await supabase
        .from("transactions")
        .insert({
          member_id: memberId,
          bank_account_id: null,
          loan_id: newLoan.id,
          type: "loan_disbursement",
          amount: Number(amount),
          description,
          receipt_url: null,
          status: "pending"
        })

      setSubmitting(false)

      if (error) {
        setMessage(error.message)
        return
      }

      router.push("/transactions")
      return
    }

    const dbType =
      selectedType === "loan_payment" ? "loan_repayment" : selectedType

    const { error } = await supabase
      .from("transactions")
      .insert({
        member_id: memberId,
        bank_account_id: bankId || null,
        loan_id: isLoanPayment ? selectedLoanId : null,
        type: dbType,
        amount: Number(amount),
        description,
        receipt_url: receiptUrl,
        status: "pending"
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

  if (checkingAccess) {
    return (
      <>
        <Navbar />
        <main className="p-6 bg-paper min-h-screen text-ink font-sans">
          Loading...
        </main>
      </>
    )
  }

  return (
    <>
      <Navbar />
      <main className="min-h-screen bg-paper text-ink font-sans">
        <div className="max-w-lg mx-auto px-5 pt-10 pb-24">
          <div className="text-[11px] tracking-[0.18em] uppercase text-gold font-mono mb-2">
            New Entry
          </div>
          <h1 className="font-display text-4xl font-semibold text-ink">
            New Transaction
          </h1>

          <div className="mt-8 bg-paper-2 border border-hairline rounded-sm relative overflow-hidden">
            <div className="absolute left-0 top-0 bottom-0 w-[3px] bg-gold" />
            <div className="pl-6 pr-5 py-6 space-y-4">
              <div>
                <label className="block mb-2 text-xs uppercase tracking-wide text-ink-soft font-mono">
                  Type
                </label>
                <select
                  className="border border-hairline bg-paper text-ink text-sm rounded-sm px-3 py-3 w-full"
                  value={selectedType}
                  onChange={(e) => {
                    setSelectedType(e.target.value)
                    resetTypeFields()
                  }}
                >
                  {ENTRY_TYPES.map((t) => (
                    <option key={t.key} value={t.key}>
                      {t.label}
                    </option>
                  ))}
                </select>
                <p className="text-xs text-ink-soft mt-2">
                  {helperText[selectedType]}
                </p>
              </div>

              {isLoanPayment && (
                <div>
                  <label className="block mb-2 text-xs uppercase tracking-wide text-ink-soft font-mono">
                    Which loan
                  </label>
                  {myLoans.filter((l) => l.status === "active").length === 0 ? (
                    <p className="text-xs text-rust">
                      You have no active loans to pay against.
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
                          <option key={loan.id} value={loan.id}>
                            ₱{fmt(loan.principal)} from {loan.start_date}
                          </option>
                        ))}
                    </select>
                  )}
                </div>
              )}

              <div>
                <label className="block mb-2 text-xs uppercase tracking-wide text-ink-soft font-mono">
                  {isLoanRequest ? "Amount you want to borrow" : "Amount"}
                </label>
                <input
                  className="border border-hairline bg-paper text-ink text-sm rounded-sm px-3 py-3 w-full font-mono"
                  type="number"
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
                      className="border border-hairline bg-paper text-ink text-sm rounded-sm px-3 py-3 w-full font-mono"
                      type="number"
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
                      className="border border-hairline bg-paper text-ink text-sm rounded-sm px-3 py-3 w-full font-mono"
                      type="number"
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

                  {Number(amount) > 0 && Number(interestRate) > 0 && Number(termMonths) > 0 && (
                    <div className="border border-hairline rounded-sm p-4 bg-paper">
                      <p className="text-xs text-ink-soft font-mono mb-2">
                        Estimated repayment
                      </p>
                      <div className="flex justify-between text-sm font-mono">
                        <span className="text-ink-soft">Total repayable</span>
                        <span>₱{fmt(previewTotalRepayable)}</span>
                      </div>
                      <div className="flex justify-between text-sm font-mono mt-1">
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
                        border-2 border-dashed rounded-sm
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
                    <div className="relative border border-hairline rounded-sm p-3 flex items-center gap-3">
                      <img
                        src={receiptPreview}
                        alt="Receipt preview"
                        className="w-16 h-16 object-cover rounded-sm border border-hairline"
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
                className="bg-ink text-paper px-4 py-3 rounded-sm w-full font-medium disabled:opacity-50"
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
          </div>

          {recent.length > 0 && (
            <div className="mt-10">
              <h2 className="font-display text-lg font-medium text-ink mb-3">
                Your Recent Activity
              </h2>
              <div className="bg-paper-2 border border-hairline rounded-sm relative overflow-hidden">
                <div className="absolute left-0 top-0 bottom-0 w-[3px] bg-gold" />
                <div className="pl-6 pr-5">
                  {recent.map((t, i) => (
                    <div
                      key={t.id}
                      className={`py-3 flex justify-between items-center gap-3 ${
                        i !== recent.length - 1 ? "border-b border-dashed border-hairline" : ""
                      }`}
                    >
                      <div className="min-w-0">
                        <p className="text-sm text-ink">
                          {typeLabels[t.type] || t.type}
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
                        <p className="font-mono text-sm text-ink">
                          ₱{fmt(t.amount)}
                        </p>
                        <p className="text-[10px] uppercase text-ink-soft font-mono">
                          {t.status}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      </main>
    </>
  )
}
