"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { supabase } from "@/lib/supabase"
import BorrowerHeader from "@/app/components/BorrowerHeader"
import { useAuth } from "@/app/auth-context"
import { SkeletonPanel } from "@/app/components/Skeleton"
import SubmitConfirmation from "@/app/components/SubmitConfirmation"
import { totalRepayable, type InterestType } from "@/lib/loanMath"

function isValidPositiveNumber(value: string, allowZero = false): boolean {
  if (!value.trim()) return false
  const n = Number(value)
  if (Number.isNaN(n)) return false
  return allowZero ? n >= 0 : n > 0
}

export default function BorrowerRequestLoanPage() {
  const router = useRouter()
  const { loading: authLoading, member } = useAuth()
  const [dataLoading, setDataLoading] = useState(true)
  const checkingAccess = authLoading || dataLoading

  const [amount, setAmount] = useState("")
  const [interestType, setInterestType] = useState<InterestType>("rate")
  const [interestRate, setInterestRate] = useState("")
  const [interestAmount, setInterestAmount] = useState("")
  const [termMonths, setTermMonths] = useState("")
  const [repaymentFrequency, setRepaymentFrequency] = useState("monthly")
  const [description, setDescription] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [message, setMessage] = useState("")
  const [submitted, setSubmitted] = useState(false)

  useEffect(() => {
    if (authLoading) return

    if (!member) {
      router.push("/login")
      return
    }

    if (member.role !== "borrower") {
      router.push("/dashboard")
      return
    }

    if (member.status !== "approved") {
      router.push("/waiting")
      return
    }

    setDataLoading(false)
  }, [authLoading, member, router])

  const previewTotalRepayable =
    isValidPositiveNumber(amount) &&
    (interestType === "rate"
      ? isValidPositiveNumber(interestRate, true)
      : isValidPositiveNumber(interestAmount, true))
      ? totalRepayable(Number(amount), interestType, Number(interestRate || 0), Number(interestAmount || 0))
      : 0

  async function handleSubmit() {
    setMessage("")

    if (!isValidPositiveNumber(amount)) {
      setMessage("Enter a valid amount greater than zero.")
      return
    }

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

    setSubmitting(true)

    const { data: newLoan, error: loanError } = await supabase
      .from("loans")
      .insert({
        member_id: member!.member_id,
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
    const { error } = await supabase.from("transactions").insert({
      member_id: member!.member_id,
      bank_account_id: null,
      loan_id: newLoan.loan_id,
      classification: "Loan Release",
      amount: -Number(amount),
      description,
      receipt_url: null,
      status: "pending"
    })

    setSubmitting(false)

    if (error) {
      setMessage(error.message)
      return
    }

    setSubmitted(true)
  }

  const fmt = (n: number) =>
    Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })

  if (checkingAccess) {
    return (
      <>
        <BorrowerHeader />
        <main className="min-h-screen bg-paper text-ink font-sans overflow-x-hidden">
          <div className="max-w-lg mx-auto px-4 sm:px-5 pt-8 pb-24">
            <SkeletonPanel />
          </div>
        </main>
      </>
    )
  }

  if (submitted) {
    return (
      <>
        <BorrowerHeader />
        <main className="min-h-screen bg-paper text-ink font-sans overflow-x-hidden">
          <div className="max-w-lg mx-auto px-4 sm:px-5 pt-8 pb-24">
            <SubmitConfirmation
              amount={Number(amount)}
              label="Loan request submitted"
              pending
              continueLabel="View Your Loan →"
              onContinue={() => router.push("/borrower")}
            />
          </div>
        </main>
      </>
    )
  }

  return (
    <>
      <BorrowerHeader />
      <main className="min-h-screen bg-paper text-ink font-sans overflow-x-hidden">
        <div className="max-w-lg mx-auto px-4 sm:px-5 pt-8 pb-24">
          <button
            onClick={() => router.push("/borrower")}
            className="text-[13px] text-ink-soft mb-4 hover:text-ink transition-colors"
          >
            ← Your loan
          </button>

          <div className="text-xs tracking-[0.18em] uppercase text-gold font-mono mb-2">Request a Loan</div>
          <h1 className="font-display text-3xl sm:text-4xl font-semibold text-ink mb-6">How much do you need?</h1>

          <div className="bg-paper-2 border border-hairline rounded-md p-5 space-y-4">
            <div>
              <label className="block mb-2 text-sm uppercase tracking-wide text-ink-soft font-mono">
                Amount to borrow
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

            <div>
              <label className="block mb-2 text-sm uppercase tracking-wide text-ink-soft font-mono">Interest</label>
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
                <p className="text-sm text-ink-soft font-mono mb-2">Estimated repayment</p>
                <div className="flex justify-between text-base font-mono [font-variant-numeric:tabular-nums]">
                  <span className="text-ink-soft">Total repayable</span>
                  <span>₱{fmt(previewTotalRepayable)}</span>
                </div>
              </div>
            )}

            <div>
              <label className="block mb-2 text-sm uppercase tracking-wide text-ink-soft font-mono">
                What's it for?
              </label>
              <input
                className="border border-hairline bg-paper text-ink text-base rounded-md px-3 py-3 w-full"
                placeholder="Add a note"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </div>

            {message && <p className="text-sm text-rust">{message}</p>}

            <button
              className="w-full bg-ink text-paper px-4 py-3.5 rounded-md text-sm font-bold disabled:opacity-50"
              onClick={handleSubmit}
              disabled={submitting}
            >
              {submitting ? "Submitting..." : "Submit Request"}
            </button>
          </div>
        </div>
      </main>
    </>
  )
}
