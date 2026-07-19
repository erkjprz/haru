"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { supabase } from "@/lib/supabase"
import Navbar from "@/app/components/Navbar"
import { useAuth } from "@/app/auth-context"
import { SkeletonCardList } from "@/app/components/Skeleton"

const CUTOVER_DATE = "2026-07-16"

type Bank = {
  bank: string
  balance: number
  interest_earned: number
  tax: number
  distributed: number
}

type BankAccount = {
  id: string
  bank_name: string
  account_name: string | null
  opening_balance: number
  interest_rate: number
}

export default function BanksPage() {
  const router = useRouter()
  const { loading: authLoading, member } = useAuth()
  const isAdmin = member?.role === "admin"
  const [dataLoading, setDataLoading] = useState(true)
  const checkingAccess = authLoading || dataLoading
  const [banks, setBanks] = useState<Bank[]>([])
  const [bankAccounts, setBankAccounts] = useState<BankAccount[]>([])
  const [loadError, setLoadError] = useState("")

  const [manageMode, setManageMode] = useState(false)
  const [showAddForm, setShowAddForm] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [bankName, setBankName] = useState("")
  const [accountName, setAccountName] = useState("")
  const [openingBalance, setOpeningBalance] = useState("")
  const [interestRate, setInterestRate] = useState("")
  const [saving, setSaving] = useState(false)
  const [formMessage, setFormMessage] = useState("")

  async function load() {
    const bankAccountsPromise = supabase.from("bank_accounts").select("*").order("bank_name")

    // v_bank_balances: running cash balance per bank from the ledger.
    const balancesPromise = supabase.from("v_bank_balances").select("*")

    // Interest earned and tax withheld per bank, all-time, approved only.
    // Mirrors v_bank_summary's own filter (Bank Interest / Tax, approved)
    // but pulled per-row here so we can pivot classification into columns.
    const interestPromise = supabase
      .from("transactions")
      .select("bank, classification, amount")
      .eq("status", "approved")
      .in("classification", ["Bank Interest", "Tax"])

    // What's actually been paid out to members so far, per bank.
    const distributedPromise = supabase.from("bank_interest_allocations").select("bank, amount")

    const [bankAccountsResult, balancesResult, interestResult, distributedResult] = await Promise.all([
      bankAccountsPromise,
      balancesPromise,
      interestPromise,
      distributedPromise
    ])

    if (bankAccountsResult.error) {
      setLoadError(bankAccountsResult.error.message)
      setDataLoading(false)
      return
    }

    setBankAccounts((bankAccountsResult.data as BankAccount[]) ?? [])

    // Seeded from bank_accounts (not just v_bank_balances) so a bank added
    // here shows up immediately, even before it has any ledger activity.
    const byBank: Record<string, Bank> = {}
    for (const acct of bankAccountsResult.data ?? []) {
      byBank[acct.bank_name] = { bank: acct.bank_name, balance: 0, interest_earned: 0, tax: 0, distributed: 0 }
    }

    if (!balancesResult.error) {
      for (const row of balancesResult.data ?? []) {
        if (!byBank[row.bank]) byBank[row.bank] = { bank: row.bank, balance: 0, interest_earned: 0, tax: 0, distributed: 0 }
        byBank[row.bank].balance = Number(row.balance)
      }
    } else {
      setLoadError(balancesResult.error.message)
    }

    if (!interestResult.error) {
      for (const row of interestResult.data ?? []) {
        if (!byBank[row.bank]) byBank[row.bank] = { bank: row.bank, balance: 0, interest_earned: 0, tax: 0, distributed: 0 }
        if (row.classification === "Bank Interest") byBank[row.bank].interest_earned += Number(row.amount)
        if (row.classification === "Tax") byBank[row.bank].tax += Number(row.amount)
      }
    }

    if (!distributedResult.error) {
      for (const row of distributedResult.data ?? []) {
        if (!byBank[row.bank]) byBank[row.bank] = { bank: row.bank, balance: 0, interest_earned: 0, tax: 0, distributed: 0 }
        byBank[row.bank].distributed += Number(row.amount)
      }
    }

    setBanks(Object.values(byBank).sort((a, b) => b.balance - a.balance))
    setDataLoading(false)
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

    load()
  }, [authLoading, member, router])

  function clearForm() {
    setShowAddForm(false)
    setEditingId(null)
    setBankName("")
    setAccountName("")
    setOpeningBalance("")
    setInterestRate("")
    setFormMessage("")
  }

  function startAdd() {
    clearForm()
    setShowAddForm(true)
  }

  function startEdit(acct: BankAccount) {
    clearForm()
    setEditingId(acct.id)
    setBankName(acct.bank_name ?? "")
    setAccountName(acct.account_name ?? "")
    setOpeningBalance(String(acct.opening_balance ?? ""))
    setInterestRate(String(acct.interest_rate ?? ""))
  }

  async function saveBank() {
    if (!bankName.trim()) {
      setFormMessage("Enter a bank name.")
      return
    }

    setSaving(true)

    if (editingId) {
      // Opening balance is the reconciled cutover value -- intentionally
      // not part of this update, so it can't drift by accident.
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
        setFormMessage(error.message)
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
        setFormMessage(error.message)
        return
      }
    }

    clearForm()
    load()
  }

  const fmt = (n: number) =>
    Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })

  if (checkingAccess) {
    return (
      <>
        <Navbar />
        <main className="min-h-screen bg-paper text-ink font-sans overflow-x-hidden">
          <div className="max-w-3xl mx-auto px-4 sm:px-5 pt-8 pb-[calc(3rem+env(safe-area-inset-bottom))]">
            <SkeletonCardList rows={3} />
          </div>
        </main>
      </>
    )
  }

  const totalBalance = banks.reduce((sum, b) => sum + b.balance, 0)

  return (
    <>
      <Navbar />
      <main className="min-h-screen bg-paper text-ink font-sans overflow-x-hidden">
        <div className="max-w-3xl mx-auto px-4 sm:px-5 pt-8 pb-[calc(3rem+env(safe-area-inset-bottom))]">
          <div className="text-[11px] tracking-[0.18em] uppercase text-gold font-mono mb-2">
            Fund accounts
          </div>

          <h1 className="font-display text-3xl sm:text-4xl font-semibold text-ink mb-1">Banks</h1>
          <p className="text-[13px] text-ink-soft mb-4">
            Where the fund's cash sits, and the interest each account has earned.
          </p>

          {isAdmin && (
            <div className="flex items-center gap-2 flex-wrap mb-5">
              {manageMode ? (
                <button
                  className="bg-ink text-paper px-4 py-2.5 rounded-sm text-sm font-medium shrink-0"
                  onClick={() => {
                    setManageMode(false)
                    clearForm()
                  }}
                >
                  Done
                </button>
              ) : (
                <button
                  className="border border-hairline text-ink-soft px-4 py-2.5 rounded-sm text-sm font-medium shrink-0"
                  onClick={() => {
                    setManageMode(true)
                    clearForm()
                  }}
                >
                  Manage
                </button>
              )}
              <button
                className="shrink-0 bg-gold text-ink px-4 py-2.5 rounded-sm text-sm font-semibold shadow-sm hover:opacity-90 transition-opacity flex items-center gap-1.5"
                onClick={startAdd}
              >
                <span className="text-lg leading-none">+</span>
                Add Bank
              </button>
            </div>
          )}

          {showAddForm && (
            <BankForm
              title="Add Bank Account"
              bankName={bankName}
              setBankName={setBankName}
              accountName={accountName}
              setAccountName={setAccountName}
              interestRate={interestRate}
              setInterestRate={setInterestRate}
              openingBalance={openingBalance}
              setOpeningBalance={setOpeningBalance}
              isEditing={false}
              saving={saving}
              message={formMessage}
              onSave={saveBank}
              onCancel={clearForm}
              saveLabel="Add Bank"
              fmt={fmt}
              className="mb-6"
            />
          )}

          {!loadError && banks.length > 0 && (
            <div className="bg-paper-2 border border-hairline rounded-md px-5 pt-4 pb-3.5 mb-6">
              <p className="text-[11px] uppercase tracking-wide text-ink-soft font-mono mb-1.5">
                Total Bank Balance
              </p>
              <p className="font-mono [font-variant-numeric:tabular-nums] text-3xl font-bold text-ink">
                ₱{fmt(totalBalance)}
              </p>
              <p className="text-[11px] text-ink-soft mt-1">
                across {banks.length} account{banks.length === 1 ? "" : "s"}
              </p>
            </div>
          )}

          {loadError && <p className="mb-4 text-sm text-rust">Couldn't load banks: {loadError}</p>}

          {!loadError && banks.length === 0 && (
            <p className="text-sm text-ink-soft text-center py-12">No bank accounts on record yet.</p>
          )}

          <div className="flex flex-col gap-3">
            {banks.map((b) => {
              const acct = bankAccounts.find((a) => a.bank_name === b.bank)
              const isEditingThis = isAdmin && manageMode && !!acct && editingId === acct.id

              return (
                <div key={b.bank}>
                  <BankCard
                    bank={b}
                    fmt={fmt}
                    onClick={() => router.push(`/bank/${encodeURIComponent(b.bank)}`)}
                    showEdit={isAdmin && manageMode}
                    fused={isEditingThis}
                    onEdit={acct ? () => startEdit(acct) : undefined}
                  />
                  {isEditingThis && acct && (
                    <BankForm
                      title="Edit Bank Account"
                      bankName={bankName}
                      setBankName={setBankName}
                      accountName={accountName}
                      setAccountName={setAccountName}
                      interestRate={interestRate}
                      setInterestRate={setInterestRate}
                      openingBalance={openingBalance}
                      setOpeningBalance={setOpeningBalance}
                      isEditing={true}
                      saving={saving}
                      message={formMessage}
                      onSave={saveBank}
                      onCancel={() => setEditingId(null)}
                      saveLabel="Save Changes"
                      fmt={fmt}
                      fused
                    />
                  )}
                </div>
              )
            })}
          </div>
        </div>
      </main>
    </>
  )
}

function BankCard({
  bank,
  fmt,
  onClick,
  showEdit,
  fused,
  onEdit
}: {
  bank: Bank
  fmt: (n: number) => string
  onClick: () => void
  showEdit: boolean
  fused: boolean
  onEdit?: () => void
}) {
  const netInterest = bank.interest_earned - bank.tax
  const undistributed = netInterest - bank.distributed
  const distributedPct = netInterest > 0 ? Math.min(100, (bank.distributed / netInterest) * 100) : 0

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault()
          onClick()
        }
      }}
      className={`w-full text-left bg-paper-2 border border-hairline px-5 py-4 hover:bg-paper transition-colors cursor-pointer ${
        fused ? "rounded-t-md rounded-b-none border-b-0" : "rounded-md"
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-display text-[17px] font-semibold text-ink truncate">{bank.bank}</p>
          <p className="text-[12px] text-ink-soft">₱{fmt(bank.balance)} current balance</p>
        </div>
        {showEdit ? (
          <button
            onClick={(e) => {
              e.stopPropagation()
              onEdit?.()
            }}
            className="shrink-0 text-[11px] text-ink-soft border border-hairline rounded-sm px-2.5 py-1.5"
          >
            Edit
          </button>
        ) : (
          <span className="text-ink-soft shrink-0">→</span>
        )}
      </div>

      <div className="flex items-baseline justify-between mt-3.5">
        <div>
          <p className="text-[10px] uppercase tracking-wide text-ink-soft font-mono">Interest Earned</p>
          <p className="font-mono [font-variant-numeric:tabular-nums] text-sm font-semibold text-sage">
            +₱{fmt(netInterest)}
          </p>
        </div>
        <div className="text-right">
          <p className="text-[10px] uppercase tracking-wide text-ink-soft font-mono">Distributed</p>
          <p className="font-mono [font-variant-numeric:tabular-nums] text-sm font-semibold text-ink">
            ₱{fmt(bank.distributed)}
          </p>
        </div>
      </div>

      <div className="h-1.5 rounded-full bg-hairline overflow-hidden mt-2.5">
        <div className="h-full bg-sage" style={{ width: `${distributedPct}%` }} />
      </div>

      {undistributed > 0.01 && (
        <p className="text-[11px] text-gold mt-2">₱{fmt(undistributed)} not yet distributed to members</p>
      )}
    </div>
  )
}

function BankForm({
  title,
  bankName,
  setBankName,
  accountName,
  setAccountName,
  interestRate,
  setInterestRate,
  openingBalance,
  setOpeningBalance,
  isEditing,
  saving,
  message,
  onSave,
  onCancel,
  saveLabel,
  fmt,
  fused = false,
  className = ""
}: {
  title: string
  bankName: string
  setBankName: (v: string) => void
  accountName: string
  setAccountName: (v: string) => void
  interestRate: string
  setInterestRate: (v: string) => void
  openingBalance: string
  setOpeningBalance: (v: string) => void
  isEditing: boolean
  saving: boolean
  message: string
  onSave: () => void
  onCancel: () => void
  saveLabel: string
  fmt: (n: number) => string
  fused?: boolean
  className?: string
}) {
  return (
    <div
      className={`bg-paper-2 border border-hairline relative overflow-hidden ${
        fused ? "rounded-b-md" : "rounded-md"
      } ${className}`}
    >
      {!fused && <div className="absolute left-0 top-0 bottom-0 w-[3px] bg-gold" />}
      <div className={fused ? "px-5 py-5 space-y-4" : "pl-6 pr-5 py-6 space-y-4"}>
        <p className="font-display text-lg font-medium">{title}</p>

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

        {isEditing ? (
          <div>
            <label className="block mb-2 text-xs uppercase tracking-wide text-ink-soft font-mono">
              Opening balance
            </label>
            <p className="text-sm font-mono text-ink-soft border border-hairline rounded-sm px-3 py-3 bg-paper">
              ₱{fmt(Number(openingBalance))}
            </p>
            <p className="text-xs text-ink-soft mt-1">
              Locked — this is the reconciled cutover balance (as of {CUTOVER_DATE}) and can't be edited here.
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
            onClick={onSave}
            disabled={saving}
          >
            {saving ? "Saving..." : saveLabel}
          </button>
          <button className="border border-hairline rounded-sm px-4 py-3 text-sm" onClick={onCancel}>
            Cancel
          </button>
        </div>

        {message && <p className="text-sm text-rust">{message}</p>}
      </div>
    </div>
  )
}
