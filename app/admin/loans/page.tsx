"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { supabase } from "@/lib/supabase"
import Navbar from "@/app/components/Navbar"

export default function AdminLoansPage() {
  const router = useRouter()
  const [checkingAccess, setCheckingAccess] = useState(true)
  const [loans, setLoans] = useState<any[]>([])
  const [banks, setBanks] = useState<any[]>([])
  const [approveBankChoice, setApproveBankChoice] = useState<Record<string, string>>({})
  const [closingId, setClosingId] = useState<string | null>(null)
  const [approvingId, setApprovingId] = useState<string | null>(null)
  const [reopeningId, setReopeningId] = useState<string | null>(null)

  const [editingLoanId, setEditingLoanId] = useState<string | null>(null)
  const [editPrincipal, setEditPrincipal] = useState("")
  const [editInterestRate, setEditInterestRate] = useState("")
  const [editTermMonths, setEditTermMonths] = useState("")
  const [editRepaymentFrequency, setEditRepaymentFrequency] = useState("monthly")
  const [editNotes, setEditNotes] = useState("")
  const [savingEdit, setSavingEdit] = useState(false)

  async function loadLoans() {
    const { data: loanList } = await supabase
      .from("loans")
      .select(`
        *,
        members ( name )
      `)
      .order("start_date", { ascending: false })

    const { data: allTransactions } = await supabase
      .from("transactions")
      .select("loan_id, type, amount, status")
      .not("loan_id", "is", null)
      .neq("status", "rejected")

    const withProgress = (loanList ?? []).map((loan) => {
      const related = (allTransactions ?? []).filter((t) => t.loan_id === loan.id)

      // Pending-inclusive numbers: shown on the card so the admin can see
      // the "current state" the same way members see it elsewhere.
      const disbursed = related
        .filter((t) => t.type === "loan_disbursement")
        .reduce((sum, t) => sum + Number(t.amount), 0)

      const repaid = related
        .filter((t) => t.type === "loan_repayment")
        .reduce((sum, t) => sum + Number(t.amount), 0)

      // Approved-only numbers: used to gate and compute the actual close/
      // distribute action, since that write is permanent and can't just be
      // recomputed away if a pending transaction later gets rejected.
      const repaidApproved = related
        .filter((t) => t.type === "loan_repayment" && t.status === "approved")
        .reduce((sum, t) => sum + Number(t.amount), 0)

      const totalRepayable =
        Number(loan.principal) + Number(loan.principal) * (Number(loan.interest_rate) / 100)

      const remaining = totalRepayable - repaid
      const remainingApproved = totalRepayable - repaidApproved
      const pendingRepayment = Math.max(0, repaid - repaidApproved)

      return {
        ...loan,
        disbursed,
        repaid,
        repaidApproved,
        totalRepayable,
        remaining,
        remainingApproved,
        pendingRepayment
      }
    })

    setLoans(withProgress)
  }

  async function loadBanks() {
    const { data } = await supabase
      .from("bank_accounts")
      .select("id, bank_name, account_name")
      .order("bank_name")

    setBanks(data ?? [])
  }

  async function approveLoan(loan: any) {
    const bankId = approveBankChoice[loan.id]
    if (!bankId) return

    setApprovingId(loan.id)

    await supabase
      .from("loans")
      .update({ status: "active" })
      .eq("id", loan.id)

    await supabase
      .from("transactions")
      .update({ status: "approved", bank_account_id: bankId })
      .eq("loan_id", loan.id)
      .eq("type", "loan_disbursement")

    setApprovingId(null)
    loadLoans()
  }

  async function closeLoanAndDistributeGain(loan: any) {
    setClosingId(loan.id)

    // Approved-only repaid amount vs principal. Can be negative — that's a
    // loss (member defaulted / stopped paying before covering principal).
    const gain = loan.repaidApproved - Number(loan.principal)

    const { data: allMembers } = await supabase
      .from("members")
      .select("id, name")

    const eligibleMembers = (allMembers ?? []).filter(
      (m) => m.id !== loan.member_id
    )

    const { data: allTransactions } = await supabase
      .from("transactions")
      .select("member_id, type, amount, status")
      .eq("status", "approved")

    const { data: priorAllocations } = await supabase
      .from("investment_allocations")
      .select("member_id, amount")

    const balances = eligibleMembers.map((member) => {
      const contributed = (allTransactions ?? [])
        .filter((t) => t.member_id === member.id && t.type === "contribution")
        .reduce((sum, t) => sum + Number(t.amount), 0)

      const withdrawn = (allTransactions ?? [])
        .filter((t) => t.member_id === member.id && t.type === "withdrawal")
        .reduce((sum, t) => sum + Number(t.amount), 0)

      const priorNet = (priorAllocations ?? [])
        .filter((a) => a.member_id === member.id)
        .reduce((sum, a) => sum + Number(a.amount), 0)

      // "Current Value" — same basis as /fund-breakdown — so this loan's
      // gain or loss is split by what each member actually has in the fund
      // today (including past gains/losses), not just raw contributions.
      return {
        member,
        balance: contributed - withdrawn + priorNet
      }
    })

    const totalBalance = balances.reduce((sum, b) => sum + b.balance, 0)

    if (gain !== 0 && totalBalance > 0) {
      const currentYear = new Date().getFullYear()
      const category = gain > 0 ? "loan_interest" : "loan_writeoff"
      const label = gain > 0 ? "gain" : "loss"

      const allocationRows = balances.map((b) => ({
        member_id: b.member.id,
        loan_id: loan.id,
        year: currentYear,
        category,
        amount: Number(((b.balance / totalBalance) * gain).toFixed(2)),
        notes: `${b.member.name} balance ₱${b.balance.toFixed(2)} / total ₱${totalBalance.toFixed(2)} of ₱${Math.abs(gain).toFixed(2)} ${label} from loan closed ${new Date().toISOString().slice(0,10)}`
      }))

      await supabase
        .from("investment_allocations")
        .insert(allocationRows)

      const transactionRows = allocationRows.map((row) => ({
        member_id: row.member_id,
        bank_account_id: null,
        loan_id: loan.id,
        type: "investment_allocation",
        amount: row.amount,
        description: `Share of ${currentYear} loan ${label} (from ${loan.members?.name || "a member"}'s loan)`,
        status: "approved"
      }))

      await supabase
        .from("transactions")
        .insert(transactionRows)
    }

    await supabase
      .from("loans")
      .update({ status: "closed" })
      .eq("id", loan.id)

    setClosingId(null)
    loadLoans()
  }

  async function reopenLoan(loan: any) {
    setReopeningId(loan.id)

    // Only removes allocation rows traceable to this loan (loan_id set).
    // Loans closed before the loan_id column existed won't have any —
    // those need manual cleanup in Supabase if they need reopening.
    await supabase.from("investment_allocations").delete().eq("loan_id", loan.id)
    await supabase.from("transactions").delete().eq("loan_id", loan.id).eq("type", "investment_allocation")
    await supabase.from("loans").update({ status: "active" }).eq("id", loan.id)

    setReopeningId(null)
    loadLoans()
  }

  function startEditLoan(loan: any) {
    setEditingLoanId(loan.id)
    setEditPrincipal(String(loan.principal ?? ""))
    setEditInterestRate(String(loan.interest_rate ?? ""))
    setEditTermMonths(String(loan.term_months ?? ""))
    setEditRepaymentFrequency(loan.repayment_frequency ?? "monthly")
    setEditNotes(loan.notes ?? "")
  }

  function cancelEditLoan() {
    setEditingLoanId(null)
  }

  async function saveLoanEdit(loan: any) {
    setSavingEdit(true)

    const updates: any = {
      interest_rate: Number(editInterestRate),
      term_months: Number(editTermMonths),
      repayment_frequency: editRepaymentFrequency,
      notes: editNotes
    }

    // Principal is only editable before disbursement is approved — after
    // that it must match the money that's actually already gone out.
    if (loan.status === "requested") {
      updates.principal = Number(editPrincipal)
    }

    await supabase.from("loans").update(updates).eq("id", loan.id)

    if (loan.status === "requested") {
      await supabase
        .from("transactions")
        .update({ amount: Number(editPrincipal) })
        .eq("loan_id", loan.id)
        .eq("type", "loan_disbursement")
        .eq("status", "pending")
    }

    setSavingEdit(false)
    setEditingLoanId(null)
    loadLoans()
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
      await loadLoans()
      setCheckingAccess(false)
    }

    checkAdmin()
  }, [])

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
          <h1 className="font-display text-4xl font-semibold text-ink">
            Loans
          </h1>

          <div className="mt-8 space-y-4">
            {loans.map((loan) => {
              const netResult = loan.repaidApproved - Number(loan.principal)
              const isEditing = editingLoanId === loan.id

              return (
                <div
                  key={loan.id}
                  className="bg-paper-2 border border-hairline rounded-sm relative overflow-hidden"
                >
                  <div className="absolute left-0 top-0 bottom-0 w-[3px] bg-gold" />
                  <div className="pl-6 pr-5 py-4">
                    <div className="flex justify-between items-start">
                      <div>
                        <p className="font-display text-lg font-medium">
                          {loan.members?.name || "Unknown"}
                        </p>
                        <p className="text-xs text-ink-soft font-mono mt-1">
                          {loan.start_date} · {loan.interest_rate}% · {loan.term_months}mo · {loan.repayment_frequency}
                        </p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span
                          className={`text-[10px] uppercase tracking-wide font-mono border rounded-full px-2 py-0.5 ${
                            loan.status === "active"
                              ? "text-sage border-sage"
                              : loan.status === "requested"
                              ? "text-gold border-gold"
                              : "text-ink-soft border-hairline"
                          }`}
                        >
                          {loan.status}
                        </span>
                        {loan.status !== "closed" && !isEditing && (
                          <button
                            className="text-xs text-ink-soft border border-hairline rounded-sm px-2 py-1"
                            onClick={() => startEditLoan(loan)}
                          >
                            Edit
                          </button>
                        )}
                      </div>
                    </div>

                    {isEditing ? (
                      <div className="mt-4 space-y-3">
                        {loan.status === "requested" && (
                          <div>
                            <label className="block mb-1 text-xs uppercase tracking-wide text-ink-soft font-mono">
                              Principal
                            </label>
                            <input
                              className="border border-hairline bg-paper text-ink text-sm rounded-sm px-3 py-2 w-full font-mono"
                              type="number"
                              value={editPrincipal}
                              onChange={(e) => setEditPrincipal(e.target.value)}
                            />
                          </div>
                        )}
                        <div className="grid grid-cols-2 gap-3">
                          <div>
                            <label className="block mb-1 text-xs uppercase tracking-wide text-ink-soft font-mono">
                              Interest rate (%)
                            </label>
                            <input
                              className="border border-hairline bg-paper text-ink text-sm rounded-sm px-3 py-2 w-full font-mono"
                              type="number"
                              value={editInterestRate}
                              onChange={(e) => setEditInterestRate(e.target.value)}
                            />
                          </div>
                          <div>
                            <label className="block mb-1 text-xs uppercase tracking-wide text-ink-soft font-mono">
                              Term (months)
                            </label>
                            <input
                              className="border border-hairline bg-paper text-ink text-sm rounded-sm px-3 py-2 w-full font-mono"
                              type="number"
                              value={editTermMonths}
                              onChange={(e) => setEditTermMonths(e.target.value)}
                            />
                          </div>
                        </div>
                        <div>
                          <label className="block mb-1 text-xs uppercase tracking-wide text-ink-soft font-mono">
                            Repayment mode
                          </label>
                          <select
                            className="border border-hairline bg-paper text-ink text-sm rounded-sm px-3 py-2 w-full"
                            value={editRepaymentFrequency}
                            onChange={(e) => setEditRepaymentFrequency(e.target.value)}
                          >
                            <option value="monthly">Monthly installments</option>
                            <option value="lump_sum">One lump sum at end of term</option>
                          </select>
                        </div>
                        <div>
                          <label className="block mb-1 text-xs uppercase tracking-wide text-ink-soft font-mono">
                            Notes
                          </label>
                          <input
                            className="border border-hairline bg-paper text-ink text-sm rounded-sm px-3 py-2 w-full"
                            value={editNotes}
                            onChange={(e) => setEditNotes(e.target.value)}
                          />
                        </div>
                        <div className="flex gap-2">
                          <button
                            className="bg-ink text-paper px-4 py-2 rounded-sm text-sm flex-1 disabled:opacity-50"
                            onClick={() => saveLoanEdit(loan)}
                            disabled={savingEdit}
                          >
                            {savingEdit ? "Saving..." : "Save Changes"}
                          </button>
                          <button
                            className="border border-hairline rounded-sm px-4 py-2 text-sm"
                            onClick={cancelEditLoan}
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <div className="mt-3 grid grid-cols-2 gap-2 text-xs font-mono text-ink-soft">
                          <div>Principal: ₱{fmt(loan.principal)}</div>
                          <div>Total repayable: ₱{fmt(loan.totalRepayable)}</div>
                          <div>
                            Repaid: ₱{fmt(loan.repaid)}
                            {loan.pendingRepayment > 0 && (
                              <span className="text-gold"> (₱{fmt(loan.pendingRepayment)} pending)</span>
                            )}
                          </div>
                          <div className={loan.remaining <= 0 ? "text-sage" : ""}>
                            {loan.remaining <= 0 ? "Fully repaid" : `Remaining: ₱${fmt(loan.remaining)}`}
                          </div>
                        </div>

                        {loan.status === "requested" && (
                          <div className="mt-4 space-y-2">
                            <label className="block text-xs uppercase tracking-wide text-ink-soft font-mono">
                              Disburse from bank
                            </label>
                            <select
                              className="border border-hairline bg-paper text-ink text-sm rounded-sm px-3 py-2 w-full"
                              value={approveBankChoice[loan.id] || ""}
                              onChange={(e) =>
                                setApproveBankChoice((prev) => ({ ...prev, [loan.id]: e.target.value }))
                              }
                            >
                              <option value="">Select a bank</option>
                              {banks.map((bank) => (
                                <option key={bank.id} value={bank.id}>
                                  {bank.account_name || bank.bank_name}
                                </option>
                              ))}
                            </select>
                            <button
                              className="bg-ink text-paper px-4 py-2 rounded-sm text-sm disabled:opacity-50"
                              onClick={() => approveLoan(loan)}
                              disabled={!approveBankChoice[loan.id] || approvingId === loan.id}
                            >
                              {approvingId === loan.id ? "Approving..." : "Approve & Activate"}
                            </button>
                          </div>
                        )}

                        {loan.status === "active" && loan.remainingApproved <= 0 && (
                          <button
                            className="mt-4 bg-gold text-ink px-4 py-2 rounded-sm text-sm font-semibold disabled:opacity-50"
                            onClick={() => closeLoanAndDistributeGain(loan)}
                            disabled={closingId === loan.id}
                          >
                            {closingId === loan.id
                              ? "Closing & distributing..."
                              : `Close Loan & Distribute ₱${fmt(netResult)} Gain`}
                          </button>
                        )}

                        {loan.status === "active" && loan.remainingApproved > 0 && loan.remaining <= 0 && (
                          <p className="mt-4 text-xs text-gold font-mono">
                            Fully repaid, but ₱{fmt(loan.pendingRepayment)} of that is still pending approval — approve it in Transactions before this loan can be closed.
                          </p>
                        )}

                        {loan.status === "active" && loan.remainingApproved > 0 && (
                          <button
                            className="mt-2 text-xs text-rust border border-rust rounded-sm px-3 py-2 disabled:opacity-50"
                            onClick={() => {
                              const loss = Math.abs(Math.min(0, netResult))
                              const confirmMsg =
                                netResult < 0
                                  ? `Close this loan now and record a ₱${fmt(loss)} loss, split across other members? This can't be undone from the app.`
                                  : `Close this loan now even though it's not fully repaid? This will distribute a ₱${fmt(netResult)} gain based on what's been repaid so far. This can't be undone from the app.`
                              if (confirm(confirmMsg)) {
                                closeLoanAndDistributeGain(loan)
                              }
                            }}
                            disabled={closingId === loan.id}
                          >
                            {closingId === loan.id ? "Closing..." : "Close Early (Write Off)"}
                          </button>
                        )}

                        {loan.status === "closed" && (
                          <button
                            className="mt-4 text-xs text-ink-soft border border-hairline rounded-sm px-3 py-2 disabled:opacity-50"
                            onClick={() => {
                              const confirmMsg =
                                "Reopen this loan? This will set it back to active and delete any gain/loss allocations recorded when it was closed (only if it was closed after loan reopening support was added — older closures may need manual cleanup in Supabase)."
                              if (confirm(confirmMsg)) {
                                reopenLoan(loan)
                              }
                            }}
                            disabled={reopeningId === loan.id}
                          >
                            {reopeningId === loan.id ? "Reopening..." : "Reopen Loan"}
                          </button>
                        )}
                      </>
                    )}
                  </div>
                </div>
              )
            })}

            {loans.length === 0 && (
              <p className="text-sm text-ink-soft">No loans yet.</p>
            )}
          </div>
        </div>
      </main>
    </>
  )
}
