"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { supabase } from "@/lib/supabase"
import BorrowerHeader from "@/app/components/BorrowerHeader"
import { useAuth } from "@/app/auth-context"
import { SkeletonPanel } from "@/app/components/Skeleton"
import SubmitConfirmation from "@/app/components/SubmitConfirmation"
import { LoanTermsCard } from "@/app/components/LoanTermsCard"
import {
  AmountHero,
  FieldGroup,
  FieldRow,
  NoteIcon,
  ReviewRow,
  StepTrack,
  rowInputClass
} from "@/app/components/TransactionFormUI"
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
  // Same Details -> Review sub-flow a member's Loan Request uses in
  // NewTransactionSheet.
  const [formStep, setFormStep] = useState<1 | 2>(1)

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

  function detailsError(): string {
    if (!isValidPositiveNumber(amount)) return "Enter a valid amount greater than zero."
    if (interestType === "rate" && !isValidPositiveNumber(interestRate, true)) {
      return "Enter a valid interest rate (0 or higher)."
    }
    if (interestType === "amount" && !isValidPositiveNumber(interestAmount, true)) {
      return "Enter a valid interest amount (0 or higher)."
    }
    if (!isValidPositiveNumber(termMonths)) return "Enter a valid term, in months greater than zero."
    return ""
  }

  function handleContinueToReview() {
    const error = detailsError()
    if (error) {
      setMessage(error)
      return
    }
    setMessage("")
    setFormStep(2)
  }

  async function handleSubmit() {
    setMessage("")

    const detailsMessage = detailsError()
    if (detailsMessage) {
      setMessage(detailsMessage)
      return
    }

    setSubmitting(true)

    // Both the loans row and its paired "Loan Release" transaction are
    // written in one atomic RPC call -- previously these were two separate
    // client-side inserts, and a failure on the second one (dropped
    // connection, closed tab mid-submit) left an orphaned loan stuck at
    // "requested" with nothing in the approval queue to ever approve it
    // against, and no error shown. See submit_loan_request in Supabase.
    const { error } = await supabase.rpc("submit_loan_request", {
      p_member_id: member!.member_id,
      p_principal: Number(amount),
      p_interest_type: interestType,
      p_interest_rate: interestType === "rate" ? Number(interestRate) : 0,
      p_interest_amount: interestType === "amount" ? Number(interestAmount) : null,
      p_term_months: Number(termMonths),
      p_repayment_frequency: repaymentFrequency,
      p_start_date: new Date().toISOString().slice(0, 10),
      p_notes: description,
      p_description: description
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
          <h1 className="font-display text-3xl sm:text-4xl font-semibold text-ink mb-2">How much do you need?</h1>

          <AmountHero value={amount} onChange={setAmount} />

          <div className="space-y-4 mt-4">
            <StepTrack step={formStep} labels={["Details", "Review"]} />

            {formStep === 1 && (
              <>
                <div>
                  <p className="text-[11px] uppercase tracking-wide text-ink-soft font-mono mb-2 px-1">Details</p>
                  <div className="bg-paper-2 border border-hairline rounded-md divide-y divide-hairline overflow-hidden">
                    <FieldRow icon={<NoteIcon />}>
                      <input
                        className={rowInputClass}
                        placeholder="What's it for? (name & date already saved)"
                        value={description}
                        onChange={(e) => setDescription(e.target.value)}
                      />
                    </FieldRow>
                  </div>
                </div>

                <LoanTermsCard
                  amount={amount}
                  interestType={interestType}
                  setInterestType={setInterestType}
                  interestRate={interestRate}
                  setInterestRate={setInterestRate}
                  interestAmount={interestAmount}
                  setInterestAmount={setInterestAmount}
                  termMonths={termMonths}
                  setTermMonths={setTermMonths}
                  repaymentFrequency={repaymentFrequency}
                  setRepaymentFrequency={setRepaymentFrequency}
                />
              </>
            )}

            {formStep === 2 && (
              <FieldGroup>
                <ReviewRow label="Amount to borrow" value={`₱${fmt(isValidPositiveNumber(amount) ? Number(amount) : 0)}`} />
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

            {message && <p className="text-sm text-rust">{message}</p>}

            <div className="flex items-center gap-3">
              {formStep === 2 && (
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
                onClick={formStep === 1 ? handleContinueToReview : handleSubmit}
                disabled={submitting}
              >
                {submitting ? "Submitting…" : formStep === 1 ? "Continue" : "Submit Request"}
              </button>
            </div>
          </div>
        </div>
      </main>
    </>
  )
}
