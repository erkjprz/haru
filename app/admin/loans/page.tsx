"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { supabase } from "@/lib/supabase"
import Navbar from "@/app/components/Navbar"
import { closeLoanAndDistributeGain } from "@/lib/closeLoan"
import { useAuth } from "@/app/auth-context"

export default function AdminLoansPage() {
  const router = useRouter()
  const { loading: authLoading, member } = useAuth()
  const [dataLoading, setDataLoading] = useState(true)
  const checkingAccess = authLoading || dataLoading
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

  // Formats a start_date (YYYY-MM-DD string) as "Loan - Mon YYYY", matching
  // the convention used for existing loans (see 2026-07-16 migration).
  function defaultLoanName(startDate: string | null | undefined) {
    if (!startDate) return "Loan"
    const d = new Date(startDate + "T00:00:00")
    if (isNaN(d.getTime())) return "Loan"
    return `Loan - ${d.toLocaleDateString("en-US", { month: "short", year: "numeric" })}`
  }

  async function loadLoans() {
    const { data: loanList } = await supabase
      .from("loans")
      .select(`
        *,
        members ( name ),
        borrowers ( name )
      `)
      .order("start_date", { ascending: false })

    const { data: allTransactions } = await supabase
      .from("transactions")
      .select("loan_id, classification, amount, status")
      .not("loan_id", "is", null)
      .neq("status", "rejected")

    const withProgress = (loanList ?? []).map((loan) => {
      const related = (allTransactions ?? []).filter((t) => t.loan_id === loan.loan_id)

      // Loan releases are stored negative in the ledger; flip the sign so
      // "disbursed" reads as a positive magnitude.
      const disbursed = -related
        .filter((t) => t.classification === "Loan Release")
        .reduce((sum, t) => sum + Number(t.amount), 0)

      const repaid = related
        .filter((t) => t.classification === "Loan Repayment")
        .reduce((sum, t) => sum + Number(t.amount), 0)

      const repaidApproved = related
        .filter((t) => t.classification === "Loan Repayment" && t.status === "approved")
        .reduce((sum, t) => sum + Number(t.amount), 0)

      const totalRepayable =
        Number(loan.principal) + Number(loan.principal) * (Number(loan.interest_rate ?? 0) / 100)

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
    const bankId = approveBankChoice[loan.loan_id]
    if (!bankId) return

    setApprovingId(loan.loan_id)

    await supabase
      .from("loans")
      .update({ status: "active" })
      .eq("loan_id", loan.loan_id)

    await supabase
      .from("transactions")
      .update({ status: "approved", bank_account_id: bankId })
      .eq("loan_id", loan.loan_id)
      .eq("classification", "Loan Release")

    setApprovingId(null)
    loadLoans()
  }

  async function handleClose(loan: any) {
    setClosingId(loan.loan_id)

    await closeLoanAndDistributeGain({
      id: loan.loan_id,
      member_id: loan.member_id,
      principal: loan.principal,
      repaidApproved: loan.repaidApproved,
      borrowerName: loan.members?.name || loan.borrowers?.name
    })

    setClosingId(null)
    loadLoans()
  }

  async function reopenLoan(loan: any) {
    setReopeningId(loan.loan_id)

    await supabase.from("investment_allocations").delete().eq("loan_id", loan.loan_id)
    await supabase.from("transactions").delete().eq("loan_id", loan.loan_id).eq("classification", "Gain Allocation")
    await supabase.from("loans").update({ status: "active" }).eq("loan_id", loan.loan_id)

    setReopeningId(null)
    loadLoans()
  }

  function startEditLoan(loan: any) {
    setEditingLoanId(loan.loan_id)
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

    if (loan.status === "requested") {
      updates.principal = Number(editPrincipal)
    }

    await supabase.from("loans").update(updates).eq("loan_id", loan.loan_id)

    if (loan.status === "requested") {
      // Loan releases are stored negative in the ledger.
      await supabase
        .from("transactions")
        .update({ amount: -Number(editPrincipal) })
        .eq("loan_id", loan.loan_id)
        .eq("classification", "Loan Release")
        .eq("status", "pending")
    }

    setSavingEdit(false)
    setEditingLoanId(null)
    loadLoans()
  }

  useEffect(() => {
    if (authLoading) return

    if (!member) {
      router.push("/login")
      return
    }

    if (member.role !== "admin") {
      router.push("/dashboard")
      return
    }

    async function checkAdmin() {
      await loadBanks()
      await loadLoans()
      setDataLoading(false)
    }

    checkAdmin()
  }, [authLoading, member, router])

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
        <div className="max-w-3xl mx-auto px-5 pt-10 pb-24">
          <div className="text-[11px] tracking-[0.18em] uppercase text-gold font-mono mb-2">
            Admin
          </div>
          <h1 className="font-display text-4xl font-semibold text-ink">
            Loans
          </h1>
          <p className="text-xs text-ink-soft mt-2 max-w-md">
            Loans now close and distribute gain automatically once fully repaid — this page is for approving requests, editing terms, and manual overrides.
          </p>

          <div className="mt-8 space-y-4">
            {loans.map((loan) => {
              const netResult = loan.repaidApproved - Number(loan.principal)
              const isEditing = editingLoanId === loan.loan_id
              const displayName = loan.name || defaultLoanName(loan.start_date)

              return (
                <div
                  key={loan.loan_id}
                  className="bg-paper-2 border border-hairline rounded-sm relative overflow-hidden"
                >
                  <div className="absolute left-0 top-0 bottom-0 w-[3px] bg-gold" />
                  <div className="pl-6 pr-5 py-4">
                    <div className="flex justify-between items-start">
                      <div>
                        <p className="font-display text-lg font-medium">
                          {displayName}
                        </p>
                        <p className="text-xs text-ink-soft font-mono mt-1">
                          Borrower: {loan.members?.name || loan.borrowers?.name || "Unknown"}
                        </p>
                        <p className="text-xs text-ink-soft font-mono mt-0.5">
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
                              value={approveBankChoice[loan.loan_id] || ""}
                              onChange={(e) =>
                                setApproveBankChoice((prev) => ({ ...prev, [loan.loan_id]: e.target.value }))
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
                              disabled={!approveBankChoice[loan.loan_id] || approvingId === loan.loan_id}
                            >
                              {approvingId === loan.loan_id ? "Approving..." : "Approve & Activate"}
                            </button>
                          </div>
                        )}

                        {loan.status === "active" && loan.remainingApproved <= 0 && (
                          <button
                            className="mt-4 bg-gold text-ink px-4 py-2 rounded-sm text-sm font-semibold disabled:opacity-50"
                            onClick={() => handleClose(loan)}
                            disabled={closingId === loan.loan_id}
                          >
                            {closingId === loan.loan_id
                              ? "Closing & distributing..."
                              : `Close Loan & Distribute ₱${fmt(netResult)} Gain`}
                          </button>
                        )}

                        {loan.status === "active" && loan.remainingApproved > 0 && loan.remaining <= 0 && (
                          <p className="mt-4 text-xs text-gold font-mono">
                            Fully repaid, but ₱{fmt(loan.pendingRepayment)} of that is still pending approval — approve it in Transactions and this loan will close automatically.
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
                                handleClose(loan)
                              }
                            }}
                            disabled={closingId === loan.loan_id}
                          >
                            {closingId === loan.loan_id ? "Closing..." : "Close Early (Write Off)"}
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
                            disabled={reopeningId === loan.loan_id}
                          >
                            {reopeningId === loan.loan_id ? "Reopening..." : "Reopen Loan"}
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
