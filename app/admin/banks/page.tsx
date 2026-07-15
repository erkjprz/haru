"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { supabase } from "@/lib/supabase"
import Navbar from "@/app/components/Navbar"

const CUTOVER_DATE = "2026-01-01"

export default function AdminBanksPage() {
  const router = useRouter()
  const [checkingAccess, setCheckingAccess] = useState(true)
  const [banks, setBanks] = useState<any[]>([])
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [bankName, setBankName] = useState("")
  const [accountName, setAccountName] = useState("")
  const [openingBalance, setOpeningBalance] = useState("")
  const [interestRate, setInterestRate] = useState("")
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState("")

  async function loadBanks() {
    const { data: bankList } = await supabase
      .from("bank_accounts")
      .select("*")
      .order("created_at", { ascending: true })

    const { data: relevantTransactions } = await supabase
      .from("transactions")
      .select("bank_account_id, to_bank_account_id, type, amount, status, created_at")
      .eq("status", "approved")
      .gte("created_at", CUTOVER_DATE)

    const withBalance = (bankList ?? []).map((bank) => {
      const related = (relevantTransactions ?? []).filter(
        (t) => t.bank_account_id === bank.id || t.to_bank_account_id === bank.id
      )

      const netMovement = related.reduce((sum, t) => {
        if (t.type === "bank_transfer") {
          if (t.bank_account_id === bank.id) return sum - Number(t.amount)
          if (t.to_bank_account_id === bank.id) return sum + Number(t.amount)
          return sum
        }

        if (t.bank_account_id !== bank.id) return sum

        if (
          t.type === "contribution" ||
          t.type === "loan_repayment" ||
          t.type === "bank_interest"
        ) {
          return sum + Number(t.amount)
        }

        if (t.type === "expense" || t.type === "loan_disbursement") {
          return sum - Number(t.amount)
        }

        return sum
      }, 0)

      return {
        ...bank,
        currentBalance: Number(bank.opening_balance) + netMovement
      }
    })

    setBanks(withBalance)
  }

  useEffect(() => {
    async function checkAdmin() {
      const {
        data: { user }
      } = await supabase.auth.getUser()

      if (!user) {
        router.push("/login")
        return
      }

      const { data: member } = await supabase
        .from("members")
        .select("role")
        .eq("email", user.email)
        .single()

      if (!member || member.role !== "admin") {
        router.push("/dashboard")
        return
      }

      await loadBanks()
      setCheckingAccess(false)
    }

    checkAdmin()
  }, [])

  function clearForm() {
    setShowForm(false)
    setEditingId(null)
    setBankName("")
    setAccountName("")
    setOpeningBalance("")
    setInterestRate("")
    setMessage("")
  }

  function startAdd() {
    clearForm()
    setShowForm(true)
  }

  function editBank(bank: any) {
    setEditingId(bank.id)
    setBankName(bank.bank_name ?? "")
    setAccountName(bank.account_name ?? "")
    setOpeningBalance(String(bank.opening_balance ?? ""))
    setInterestRate(String(bank.interest_rate ?? ""))
    setShowForm(true)
    setMessage("")
  }

  async function saveBank() {
    if (!bankName.trim()) {
      setMessage("Enter a bank name.")
      return
    }

    setSaving(true)

    if (editingId) {
      // Opening balance is the reconciled Dec 31, 2025 cutover value —
      // intentionally not part of this update, so it can't drift by accident.
      const { error } = await supabase
        .from("bank_accounts")
        .update({
          bank_name: bankName,
          account_name: accountName,
          interest_rate: Number(interestRate) || 0
        })
        .eq("id", editingId)

      setSaving(false)

      if (error) {
        setMessage(error.message)
        return
      }
    } else {
      const { error } = await supabase.from("bank_accounts").insert({
        bank_name: bankName,
        account_name: accountName,
        opening_balance: Number(openingBalance) || 0,
        interest_rate: Number(interestRate) || 0
      })

      setSaving(false)

      if (error) {
        setMessage(error.message)
        return
      }
    }

    clearForm()
    loadBanks()
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
        <div className="max-w-3xl mx-auto px-5 pt-10 pb-24">
          <div className="text-[11px] tracking-[0.18em] uppercase text-gold font-mono mb-2">
            Admin
          </div>

          <div className="flex items-start justify-between gap-4">
            <h1 className="font-display text-4xl font-semibold text-ink">
              Banks
            </h1>
            {!showForm && (
              <button
                className="shrink-0 bg-gold text-ink px-5 py-3 rounded-sm text-sm font-semibold shadow-sm hover:opacity-90 transition-opacity flex items-center gap-1.5"
                onClick={startAdd}
              >
                <span className="text-lg leading-none">+</span>
                Add Bank
              </button>
            )}
          </div>

          {showForm && (
            <div className="mt-8 bg-paper-2 border border-hairline rounded-sm relative overflow-hidden">
              <div className="absolute left-0 top-0 bottom-0 w-[3px] bg-gold" />
              <div className="pl-6 pr-5 py-6 space-y-4">
                <p className="font-display text-lg font-medium">
                  {editingId ? "Edit Bank Account" : "Add Bank Account"}
                </p>

                <div>
                  <label className="block mb-2 text-xs uppercase tracking-wide text-ink-soft font-mono">
                    Bank name
                  </label>
                  <input
                    className="border border-hairline bg-paper text-ink text-sm rounded-sm px-3 py-3 w-full"
                    placeholder="e.g. BDO"
                    value={bankName}
                    onChange={(e) => setBankName(e.target.value)}
                  />
                </div>

                <div>
                  <label className="block mb-2 text-xs uppercase tracking-wide text-ink-soft font-mono">
                    Account name
                  </label>
                  <input
                    className="border border-hairline bg-paper text-ink text-sm rounded-sm px-3 py-3 w-full"
                    placeholder="e.g. Haru Fund Savings"
                    value={accountName}
                    onChange={(e) => setAccountName(e.target.value)}
                  />
                </div>

                {editingId ? (
                  <div>
                    <label className="block mb-2 text-xs uppercase tracking-wide text-ink-soft font-mono">
                      Opening balance
                    </label>
                    <p className="text-sm font-mono text-ink-soft border border-hairline rounded-sm px-3 py-3 bg-paper">
                      ₱{fmt(Number(openingBalance))}
                    </p>
                    <p className="text-xs text-ink-soft mt-1">
                      Locked — this is the reconciled Dec 31, 2025 cutover balance and can't be edited here.
                    </p>
                  </div>
                ) : (
                  <div>
                    <label className="block mb-2 text-xs uppercase tracking-wide text-ink-soft font-mono">
                      Opening balance
                    </label>
                    <input
                      className="border border-hairline bg-paper text-ink text-sm rounded-sm px-3 py-3 w-full font-mono"
                      type="number"
                      placeholder="0.00"
                      value={openingBalance}
                      onChange={(e) => setOpeningBalance(e.target.value)}
                    />
                    <p className="text-xs text-ink-soft mt-1">
                      The true balance as of the cutover date. Can't be changed after saving.
                    </p>
                  </div>
                )}

                <div>
                  <label className="block mb-2 text-xs uppercase tracking-wide text-ink-soft font-mono">
                    Interest rate (%)
                  </label>
                  <input
                    className="border border-hairline bg-paper text-ink text-sm rounded-sm px-3 py-3 w-full font-mono"
                    type="number"
                    placeholder="e.g. 0.25"
                    value={interestRate}
                    onChange={(e) => setInterestRate(e.target.value)}
                  />
                </div>

                <div className="flex gap-3">
                  <button
                    className="bg-ink text-paper px-4 py-3 rounded-sm text-sm font-medium flex-1 disabled:opacity-50"
                    onClick={saveBank}
                    disabled={saving}
                  >
                    {saving ? "Saving..." : editingId ? "Save Changes" : "Add Bank"}
                  </button>
                  <button
                    className="border border-hairline rounded-sm px-4 py-3 text-sm"
                    onClick={clearForm}
                  >
                    Cancel
                  </button>
                </div>

                {message && <p className="text-sm text-rust">{message}</p>}
              </div>
            </div>
          )}

          <div className="mt-8 space-y-4">
            {banks.map((bank) => (
              <div
                key={bank.id}
                className="bg-paper-2 border border-hairline rounded-sm relative overflow-hidden"
              >
                <div className="absolute left-0 top-0 bottom-0 w-[3px] bg-gold" />
                <div className="pl-6 pr-5 py-4">
                  <div className="flex justify-between items-start">
                    <div>
                      <p className="font-display text-lg font-medium">
                        {bank.account_name || bank.bank_name}
                      </p>
                      <p className="text-xs text-ink-soft font-mono mt-1">
                        {bank.bank_name} · {bank.interest_rate}% interest
                      </p>
                    </div>
                    <button
                      className="text-xs text-ink-soft border border-hairline rounded-sm px-3 py-1.5 shrink-0"
                      onClick={() => editBank(bank)}
                    >
                      Edit
                    </button>
                  </div>

                  <div className="mt-4 pt-4 border-t border-hairline flex justify-between items-baseline">
                    <span className="text-sm font-semibold text-ink">
                      Current Balance
                    </span>
                    <span className="font-display text-2xl font-semibold text-ink">
                      ₱{fmt(bank.currentBalance)}
                    </span>
                  </div>
                  <div className="flex justify-between text-xs font-mono text-ink-soft mt-1">
                    <span>Opening balance (Dec 31, 2025)</span>
                    <span>₱{fmt(bank.opening_balance)}</span>
                  </div>
                </div>
              </div>
            ))}

            {banks.length === 0 && (
              <p className="text-sm text-ink-soft">No banks yet.</p>
            )}
          </div>
        </div>
      </main>
    </>
  )
}
