"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { supabase } from "@/lib/supabase"
import BorrowerHeader from "@/app/components/BorrowerHeader"
import { useAuth } from "@/app/auth-context"
import { SkeletonPanel } from "@/app/components/Skeleton"
import SubmitConfirmation from "@/app/components/SubmitConfirmation"

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
      const [{ data: bankList }, { data: borrowerRow }] = await Promise.all([
        supabase.from("bank_accounts").select("id, bank_name, account_name").order("bank_name"),
        supabase.from("borrowers").select("borrower_id").eq("member_id", member!.member_id).maybeSingle()
      ])

      setBanks(bankList ?? [])

      const filter = borrowerRow?.borrower_id
        ? `member_id.eq.${member!.member_id},borrower_id.eq.${borrowerRow.borrower_id}`
        : `member_id.eq.${member!.member_id}`

      const { data: loans } = await supabase
        .from("loans")
        .select("loan_id, name, principal, status, start_date")
        .or(filter)
        .eq("status", "active")
        .order("start_date", { ascending: false })

      setMyLoans(loans ?? [])
      setDataLoading(false)
    }

    load()
  }, [authLoading, member, router])

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

    const { data: urlData } = supabase.storage.from("Receipts").getPublicUrl(fileName)

    const { error } = await supabase.from("transactions").insert({
      member_id: member!.member_id,
      bank_account_id: bankId,
      loan_id: selectedLoanId,
      classification: "Loan Repayment",
      amount: Number(amount),
      description,
      receipt_url: urlData.publicUrl,
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
          <h1 className="font-display text-3xl sm:text-4xl font-semibold text-ink mb-6">
            You've already sent this money
          </h1>

          {myLoans.length === 0 ? (
            <p className="text-sm text-ink-soft text-center py-12 bg-paper-2 border border-hairline rounded-md">
              You don't have an active loan to repay right now.
            </p>
          ) : (
            <div className="bg-paper-2 border border-hairline rounded-md p-5 space-y-4">
              <div>
                <label className="block mb-2 text-sm uppercase tracking-wide text-ink-soft font-mono">
                  Which loan
                </label>
                <select
                  className="border border-hairline bg-paper text-ink text-base rounded-md px-3 py-3 w-full"
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
              </div>

              <div>
                <label className="block mb-2 text-sm uppercase tracking-wide text-ink-soft font-mono">Amount</label>
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
                <label className="block mb-2 text-sm uppercase tracking-wide text-ink-soft font-mono">Bank</label>
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

              <div>
                <label className="block mb-2 text-sm uppercase tracking-wide text-ink-soft font-mono">Receipt</label>

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

              {message && <p className="text-sm text-rust">{message}</p>}

              <button
                className="w-full bg-ink text-paper px-4 py-3.5 rounded-md text-sm font-bold disabled:opacity-50"
                onClick={handleSubmit}
                disabled={submitting}
              >
                {submitting ? "Submitting..." : "Submit Repayment"}
              </button>
            </div>
          )}
        </div>
      </main>
    </>
  )
}
