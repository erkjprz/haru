"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { supabase } from "@/lib/supabase"
import BorrowerHeader from "@/app/components/BorrowerHeader"
import { useAuth } from "@/app/auth-context"
import { SkeletonPanel } from "@/app/components/Skeleton"
import SubmitConfirmation from "@/app/components/SubmitConfirmation"
import { AmountHero, FieldGroup, ReceiptField, RequiredMark } from "@/app/components/TransactionFormUI"
import { totalRepayable } from "@/lib/loanMath"

function isValidPositiveNumber(value: string): boolean {
  if (!value.trim()) return false
  const n = Number(value)
  return !Number.isNaN(n) && n > 0
}

export default function BorrowerRepayPage() {
  const router = useRouter()
  const { loading: authLoading, member } = useAuth()
  const [dataLoading, setDataLoading] = useState(true)
  const checkingAccess = authLoading || dataLoading

  const [banks, setBanks] = useState<any[]>([])
  const [myLoans, setMyLoans] = useState<any[]>([])
  const [loanRepaidTotals, setLoanRepaidTotals] = useState<Record<string, number>>({})
  const [selectedLoanId, setSelectedLoanId] = useState("")
  const [bankId, setBankId] = useState("")
  const [amount, setAmount] = useState("")
  const [description, setDescription] = useState("")
  const [receipt, setReceipt] = useState<File | null>(null)
  const [receiptPreview, setReceiptPreview] = useState<string | null>(null)
  const [dragActive, setDragActive] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [message, setMessage] = useState("")
  const [submitted, setSubmitted] = useState(false)
  const [loadError, setLoadError] = useState("")

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

    async function load() {
      const [{ data: bankList }, { data: borrowerRow }, { data: prefs }] = await Promise.all([
        supabase.from("bank_accounts").select("id, bank_name, account_name").order("bank_name"),
        supabase.from("borrowers").select("borrower_id").eq("member_id", member!.member_id).maybeSingle(),
        supabase
          .from("members")
          .select("default_loan_payment_amount, default_loan_payment_bank_id")
          .eq("member_id", member!.member_id)
          .single()
      ])

      setBanks(bankList ?? [])

      if (prefs?.default_loan_payment_amount != null) setAmount(String(prefs.default_loan_payment_amount))
      if (prefs?.default_loan_payment_bank_id) setBankId(prefs.default_loan_payment_bank_id)

      const filter = borrowerRow?.borrower_id
        ? `member_id.eq.${member!.member_id},borrower_id.eq.${borrowerRow.borrower_id}`
        : `member_id.eq.${member!.member_id}`

      const { data: loans, error: loansError } = await supabase
        .from("loans")
        .select("loan_id, name, principal, interest_type, interest_rate, interest_amount, status, start_date")
        .or(filter)
        .eq("status", "active")
        .order("start_date", { ascending: false })

      if (loansError) {
        setLoadError(loansError.message)
        setDataLoading(false)
        return
      }

      setMyLoans(loans ?? [])

      const loanIds = (loans ?? []).map((l) => l.loan_id)
      if (loanIds.length > 0) {
        const { data: repayments, error: repaymentsError } = await supabase
          .from("transactions")
          .select("loan_id, amount")
          .in("loan_id", loanIds)
          .eq("classification", "Loan Repayment")
          .in("status", ["pending", "approved"])

        if (repaymentsError) {
          setLoadError(repaymentsError.message)
          setDataLoading(false)
          return
        }

        const totals: Record<string, number> = {}
        ;(repayments ?? []).forEach((r) => {
          totals[r.loan_id] = (totals[r.loan_id] || 0) + Number(r.amount)
        })
        setLoanRepaidTotals(totals)
      }

      setDataLoading(false)
    }

    load()
  }, [authLoading, member, router])

  function setReceiptFile(file: File | null) {
    setReceipt(file)
    setReceiptPreview(file ? URL.createObjectURL(file) : null)
  }

  async function handleSubmit() {
    setMessage("")

    if (!selectedLoanId) {
      setMessage("Select which loan you're paying.")
      return
    }

    if (!isValidPositiveNumber(amount)) {
      setMessage("Enter a valid amount greater than zero.")
      return
    }

    if (!bankId) {
      setMessage("Select a bank.")
      return
    }

    if (!receipt) {
      setMessage("Attach a receipt.")
      return
    }

    setSubmitting(true)

    const fileName = `${member!.member_id}-${Date.now()}-${receipt.name}`

    const { error: uploadError } = await supabase.storage
      .from("Receipts")
      .upload(fileName, receipt, { contentType: receipt.type })

    if (uploadError) {
      setMessage(uploadError.message)
      setSubmitting(false)
      return
    }

    const { error } = await supabase.from("transactions").insert({
      member_id: member!.member_id,
      bank_account_id: bankId,
      loan_id: selectedLoanId,
      classification: "Loan Repayment",
      amount: Number(amount),
      description,
      receipt_url: fileName,
      status: "pending"
    })

    setSubmitting(false)

    if (error) {
      // The receipt already uploaded successfully above -- if the insert it
      // belongs to failed, clean it up rather than leaving it orphaned in
      // the bucket.
      await supabase.storage.from("Receipts").remove([fileName])
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
              label="Loan repayment submitted"
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

          <div className="text-xs tracking-[0.18em] uppercase text-gold font-mono mb-2">Make a Repayment</div>
          <h1 className="font-display text-3xl sm:text-4xl font-semibold text-ink mb-2">
            You've already sent this money
          </h1>

          {loadError && <p className="mb-4 text-sm text-rust">Couldn&apos;t load your loans: {loadError}</p>}

          {!loadError && myLoans.length === 0 ? (
            <p className="mt-4 text-sm text-ink-soft text-center py-12 bg-paper-2 border border-hairline rounded-md">
              You don't have an active loan to repay right now.
            </p>
          ) : !loadError && (
            <>
              <AmountHero value={amount} onChange={setAmount} label="Amount" />

              <div className="space-y-4 mt-4">
                <FieldGroup label="Details">
                  <div className="space-y-4">
                    <div>
                      <label className="block mb-2 text-xs uppercase tracking-wide text-ink-soft font-mono">
                        Which loan
                        <RequiredMark />
                      </label>
                      <select
                        className="border border-hairline bg-paper text-ink text-sm rounded-sm px-3 py-3 w-full"
                        value={selectedLoanId}
                        onChange={(e) => setSelectedLoanId(e.target.value)}
                      >
                        <option value="">Select a loan</option>
                        {myLoans.map((loan) => (
                          <option key={loan.loan_id} value={loan.loan_id}>
                            {loan.name || "Loan"} — ₱{fmt(loan.principal)} from {loan.start_date}
                          </option>
                        ))}
                      </select>
                      {selectedLoanId &&
                        (() => {
                          const loan = myLoans.find((l) => l.loan_id === selectedLoanId)
                          if (!loan) return null
                          const remaining =
                            totalRepayable(
                              Number(loan.principal),
                              loan.interest_type,
                              Number(loan.interest_rate || 0),
                              Number(loan.interest_amount || 0)
                            ) - (loanRepaidTotals[loan.loan_id] || 0)
                          return (
                            <p className="mt-2 text-sm text-ink-soft">
                              ₱{fmt(Math.max(0, remaining))} left to pay
                            </p>
                          )
                        })()}
                    </div>

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

                {message && <p className="text-sm text-rust">{message}</p>}

                <button
                  className="w-full bg-ink text-paper px-4 py-3.5 rounded-md text-sm font-bold disabled:opacity-50"
                  onClick={handleSubmit}
                  disabled={submitting}
                >
                  {submitting ? "Submitting..." : "Submit Repayment"}
                </button>
              </div>
            </>
          )}
        </div>
      </main>
    </>
  )
}
