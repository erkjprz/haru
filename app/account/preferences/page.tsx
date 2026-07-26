"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import Navbar from "@/app/components/Navbar"
import { supabase } from "@/lib/supabase"
import { useAuth } from "@/app/auth-context"
import { SkeletonPanel } from "@/app/components/Skeleton"

function isValidNonNegativeNumber(value: string): boolean {
  if (!value.trim()) return true // empty clears the preference
  const n = Number(value)
  return !Number.isNaN(n) && n >= 0
}

function AmountField({
  label,
  helper,
  value,
  onChange,
  bankId,
  onBankChange,
  banks,
  onSave,
  saving,
  message
}: {
  label: string
  helper: string
  value: string
  onChange: (v: string) => void
  bankId: string
  onBankChange: (v: string) => void
  banks: { id: string; bank_name: string; account_name: string | null }[]
  onSave: () => void
  saving: boolean
  message: string
}) {
  return (
    <div className="bg-paper-2 border border-hairline rounded-md p-5">
      <h2 className="font-display text-lg font-medium text-ink mb-1">{label}</h2>
      <p className="text-[13px] text-ink-soft">{helper}</p>

      <div className="mt-4 space-y-3">
        <div className="relative">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-soft font-mono">₱</span>
          <input
            type="number"
            inputMode="decimal"
            min="0"
            step="0.01"
            placeholder="Not set"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            className="border border-hairline bg-paper pl-7 pr-3 py-2 rounded-md w-full text-base font-mono [font-variant-numeric:tabular-nums] [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
          />
        </div>

        <div>
          <label className="block mb-1.5 text-xs uppercase tracking-wide text-ink-soft font-mono">
            Bank the transfer goes to
          </label>
          <select
            className="border border-hairline bg-paper text-ink text-sm rounded-md px-3 py-2 w-full"
            value={bankId}
            onChange={(e) => onBankChange(e.target.value)}
          >
            <option value="">Not set</option>
            {banks.map((bank) => (
              <option key={bank.id} value={bank.id}>
                {bank.account_name || bank.bank_name}
              </option>
            ))}
          </select>
        </div>

        {message && <p className="text-sm text-ink-soft">{message}</p>}

        <button
          onClick={onSave}
          disabled={saving || !isValidNonNegativeNumber(value)}
          className="bg-ink text-paper px-4 py-2 rounded-md text-sm disabled:opacity-60"
        >
          {saving ? "Saving..." : "Save"}
        </button>
      </div>
    </div>
  )
}

export default function PreferencesPage() {
  const router = useRouter()
  const { loading: authLoading, member } = useAuth()

  const [dataLoading, setDataLoading] = useState(true)
  const [banks, setBanks] = useState<{ id: string; bank_name: string; account_name: string | null }[]>([])
  const [contributionAmount, setContributionAmount] = useState("")
  const [contributionBankId, setContributionBankId] = useState("")
  const [loanPaymentAmount, setLoanPaymentAmount] = useState("")
  const [loanPaymentBankId, setLoanPaymentBankId] = useState("")

  const [savingContribution, setSavingContribution] = useState(false)
  const [contributionMessage, setContributionMessage] = useState("")
  const [savingLoanPayment, setSavingLoanPayment] = useState(false)
  const [loanPaymentMessage, setLoanPaymentMessage] = useState("")

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
    if (member.role === "borrower") router.push("/borrower")
  }, [authLoading, member, router])

  useEffect(() => {
    if (authLoading || !member || member.status !== "approved" || member.role === "borrower") return

    async function load() {
      const [{ data }, { data: bankList }] = await Promise.all([
        supabase
          .from("members")
          .select(
            "default_contribution_amount, default_contribution_bank_id, default_loan_payment_amount, default_loan_payment_bank_id"
          )
          .eq("member_id", member!.member_id)
          .single(),
        supabase.from("bank_accounts").select("id, bank_name, account_name").order("bank_name")
      ])

      setBanks(bankList ?? [])

      if (data?.default_contribution_amount != null) {
        setContributionAmount(String(data.default_contribution_amount))
      }
      if (data?.default_contribution_bank_id) {
        setContributionBankId(data.default_contribution_bank_id)
      }
      if (data?.default_loan_payment_amount != null) {
        setLoanPaymentAmount(String(data.default_loan_payment_amount))
      }
      if (data?.default_loan_payment_bank_id) {
        setLoanPaymentBankId(data.default_loan_payment_bank_id)
      }
      setDataLoading(false)
    }

    load()
  }, [authLoading, member])

  async function saveContribution() {
    if (savingContribution) return
    setSavingContribution(true)
    setContributionMessage("")

    const [{ error }, { error: bankError }] = await Promise.all([
      supabase.rpc("set_default_contribution_amount", {
        p_amount: contributionAmount.trim() ? Number(contributionAmount) : null
      }),
      supabase.rpc("set_default_contribution_bank", { p_bank_id: contributionBankId || null })
    ])

    setSavingContribution(false)
    setContributionMessage(error?.message || bankError?.message || "Saved.")
  }

  async function saveLoanPayment() {
    if (savingLoanPayment) return
    setSavingLoanPayment(true)
    setLoanPaymentMessage("")

    const [{ error }, { error: bankError }] = await Promise.all([
      supabase.rpc("set_default_loan_payment_amount", {
        p_amount: loanPaymentAmount.trim() ? Number(loanPaymentAmount) : null
      }),
      supabase.rpc("set_default_loan_payment_bank", { p_bank_id: loanPaymentBankId || null })
    ])

    setSavingLoanPayment(false)
    setLoanPaymentMessage(error?.message || bankError?.message || "Saved.")
  }

  if (authLoading || !member || member.status !== "approved" || member.role === "borrower" || dataLoading) {
    return (
      <>
        <Navbar />
        <main className="min-h-screen bg-paper text-ink font-sans overflow-x-hidden">
          <div className="max-w-3xl mx-auto px-4 sm:px-5 pt-8 pb-[calc(6rem+var(--dock-h)+env(safe-area-inset-bottom))]">
            <SkeletonPanel />
          </div>
        </main>
      </>
    )
  }

  return (
    <>
      <Navbar />
      <main className="min-h-screen bg-paper text-ink font-sans overflow-x-hidden">
        <div className="max-w-3xl mx-auto px-4 sm:px-5 pt-8 pb-[calc(6rem+var(--dock-h)+env(safe-area-inset-bottom))]">

          <button
            onClick={() => router.push("/menu")}
            className="text-[13px] text-ink-soft mb-4 hover:text-ink transition-colors"
          >
            ← Menu
          </button>

          <div className="text-[11px] tracking-[0.18em] uppercase text-gold font-mono mb-2">
            Account
          </div>
          <h1 className="font-display text-3xl sm:text-4xl font-semibold text-ink mb-1">
            Preferences
          </h1>
          <p className="text-[13px] text-ink-soft mb-6">
            Set default amounts and banks for transactions you make often. Leave a field blank to clear it.
          </p>

          <div className="space-y-4">
            <AmountField
              label="Default Contribution Amount"
              helper="Pre-fills the amount and bank when you start a Contribution in New Transaction."
              value={contributionAmount}
              onChange={setContributionAmount}
              bankId={contributionBankId}
              onBankChange={setContributionBankId}
              banks={banks}
              onSave={saveContribution}
              saving={savingContribution}
              message={contributionMessage}
            />

            <AmountField
              label="Default Loan Payment Amount"
              helper="Pre-fills the amount and bank when you start a Loan Payment in New Transaction."
              value={loanPaymentAmount}
              onChange={setLoanPaymentAmount}
              bankId={loanPaymentBankId}
              onBankChange={setLoanPaymentBankId}
              banks={banks}
              onSave={saveLoanPayment}
              saving={savingLoanPayment}
              message={loanPaymentMessage}
            />
          </div>

        </div>
      </main>
    </>
  )
}
