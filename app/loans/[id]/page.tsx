"use client"

import { useEffect, useState } from "react"
import { useRouter, useParams } from "next/navigation"
import { supabase } from "@/lib/supabase"
import Navbar from "@/app/components/Navbar"
import { closeLoanAndDistributeGain } from "@/lib/closeLoan"
import { totalRepayable, type InterestType } from "@/lib/loanMath"
import { useAuth } from "@/app/auth-context"
import { SkeletonPanel } from "@/app/components/Skeleton"

type Loan = {
  loan_id: string
  loan: string
  status: "requested" | "active" | "closed"
  start_date: string
  closed_date: string | null
  borrower: string
  borrower_member_id: string | null
  principal: number
  repayment: number
  gain: number
  outstanding: number
  interest_rate: number | null
  term_months: number | null
  notes: string | null
}

type GainShare = {
  member_id: string
  member: string
  amount: number
}

type AdminLoan = {
  loan_id: string
  member_id: string | null
  status: "requested" | "active" | "closed"
  principal: number
  interest_type: InterestType
  interest_rate: number
  interest_amount: number
  term_months: number | null
  repayment_frequency: string
  notes: string | null
  disbursed: number
  repaid: number
  repaidApproved: number
  totalRepayable: number
  remaining: number
  remainingApproved: number
  pendingRepayment: number
}

export default function LoanDetailPage() {
  const router = useRouter()
  const params = useParams()
  const loanId = params?.id as string

  const { loading: authLoading, member } = useAuth()
  const isAdmin = member?.role === "admin"
  const [dataLoading, setDataLoading] = useState(true)
  const checkingAccess = authLoading || dataLoading
  const [loan, setLoan] = useState<Loan | null>(null)
  const [shares, setShares] = useState<GainShare[]>([])
  const myMemberId = member?.member_id ?? null
  const [notFound, setNotFound] = useState(false)
  const [loadError, setLoadError] = useState("")

  // Admin-only management data/state -- mirrors what the old /admin/loans
  // page tracked, scoped down to just this one loan.
  const [adminLoan, setAdminLoan] = useState<AdminLoan | null>(null)
  const [banks, setBanks] = useState<any[]>([])
  const [manageOpen, setManageOpen] = useState(false)
  const [manageOpenInitialized, setManageOpenInitialized] = useState(false)
  const [approveBankChoice, setApproveBankChoice] = useState("")
  const [closing, setClosing] = useState(false)
  const [approving, setApproving] = useState(false)
  const [reopening, setReopening] = useState(false)

  const [isEditing, setIsEditing] = useState(false)
  const [editPrincipal, setEditPrincipal] = useState("")
  const [editInterestType, setEditInterestType] = useState<InterestType>("rate")
  const [editInterestRate, setEditInterestRate] = useState("")
  const [editInterestAmount, setEditInterestAmount] = useState("")
  const [editTermMonths, setEditTermMonths] = useState("")
  const [editRepaymentFrequency, setEditRepaymentFrequency] = useState("monthly")
  const [editNotes, setEditNotes] = useState("")
  const [savingEdit, setSavingEdit] = useState(false)

  async function loadMemberFacing() {
    const loanPromise = supabase.from("v_loan_summary").select("*").eq("loan_id", loanId).single()

    // Gain share per member, per Section 14 of the audit doc: split
    // proportional to each eligible member's current value at the
    // moment this loan closed, borrower excluded, joined here to
    // members for display names and sorted highest share first.
    const sharesPromise = supabase
      .from("loan_gain_allocations")
      .select("amount, member_id, members(name)")
      .eq("loan_id", loanId)
      .order("amount", { ascending: false })

    const [loanResult, sharesResult] = await Promise.all([loanPromise, sharesPromise])

    if (loanResult.error || !loanResult.data) {
      setNotFound(true)
    } else {
      setLoan(loanResult.data as Loan)
    }

    if (!sharesResult.error && sharesResult.data) {
      setShares(
        sharesResult.data.map((r: any) => ({
          member_id: r.member_id,
          member: r.members?.name ?? "Unknown",
          amount: Number(r.amount)
        }))
      )
    } else if (sharesResult.error) {
      setLoadError(sharesResult.error.message)
    }
  }

  async function loadAdminData() {
    const [{ data: rawLoan }, { data: related }, { data: bankList }] = await Promise.all([
      supabase.from("loans").select("*").eq("loan_id", loanId).single(),
      supabase
        .from("transactions")
        .select("classification, amount, status")
        .eq("loan_id", loanId)
        .neq("status", "rejected")
        .neq("status", "cancelled"),
      supabase.from("bank_accounts").select("id, bank_name, account_name").order("bank_name")
    ])

    setBanks(bankList ?? [])

    if (!rawLoan) return

    // Loan releases are stored negative in the ledger; flip the sign so
    // "disbursed" reads as a positive magnitude.
    const disbursed = -(related ?? [])
      .filter((t) => t.classification === "Loan Release")
      .reduce((sum, t) => sum + Number(t.amount), 0)

    const repaid = (related ?? [])
      .filter((t) => t.classification === "Loan Repayment")
      .reduce((sum, t) => sum + Number(t.amount), 0)

    const repaidApproved = (related ?? [])
      .filter((t) => t.classification === "Loan Repayment" && t.status === "approved")
      .reduce((sum, t) => sum + Number(t.amount), 0)

    const interestType: InterestType = rawLoan.interest_type === "amount" ? "amount" : "rate"
    const totalRepayableVal = totalRepayable(
      Number(rawLoan.principal),
      interestType,
      Number(rawLoan.interest_rate ?? 0),
      Number(rawLoan.interest_amount ?? 0)
    )

    const remaining = totalRepayableVal - repaid
    const remainingApproved = totalRepayableVal - repaidApproved
    const pendingRepayment = Math.max(0, repaid - repaidApproved)

    const next: AdminLoan = {
      loan_id: rawLoan.loan_id,
      member_id: rawLoan.member_id,
      status: rawLoan.status,
      principal: Number(rawLoan.principal),
      interest_type: interestType,
      interest_rate: Number(rawLoan.interest_rate ?? 0),
      interest_amount: Number(rawLoan.interest_amount ?? 0),
      term_months: rawLoan.term_months,
      repayment_frequency: rawLoan.repayment_frequency ?? "monthly",
      notes: rawLoan.notes,
      disbursed,
      repaid,
      repaidApproved,
      totalRepayable: totalRepayableVal,
      remaining,
      remainingApproved,
      pendingRepayment
    }

    setAdminLoan(next)

    if (!manageOpenInitialized) {
      const needsAttention = next.status === "requested" || (next.status === "active" && next.remainingApproved <= 0)
      setManageOpen(needsAttention)
      setManageOpenInitialized(true)
    }
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

    async function load() {
      await loadMemberFacing()
      if (member!.role === "admin") {
        await loadAdminData()
      }
      setDataLoading(false)
    }

    if (loanId) load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loanId, authLoading, member, router])

  async function reloadAll() {
    await loadMemberFacing()
    if (isAdmin) await loadAdminData()
  }

  function startEditLoan() {
    if (!adminLoan) return
    setEditPrincipal(String(adminLoan.principal))
    setEditInterestType(adminLoan.interest_type)
    setEditInterestRate(String(adminLoan.interest_rate))
    setEditInterestAmount(String(adminLoan.interest_amount))
    setEditTermMonths(String(adminLoan.term_months ?? ""))
    setEditRepaymentFrequency(adminLoan.repayment_frequency)
    setEditNotes(adminLoan.notes ?? "")
    setIsEditing(true)
  }

  function cancelEditLoan() {
    setIsEditing(false)
  }

  async function saveLoanEdit() {
    if (!adminLoan) return
    setSavingEdit(true)

    const updates: any = {
      interest_type: editInterestType,
      interest_rate: editInterestType === "rate" ? Number(editInterestRate) : 0,
      interest_amount: editInterestType === "amount" ? Number(editInterestAmount) : null,
      term_months: Number(editTermMonths),
      repayment_frequency: editRepaymentFrequency,
      notes: editNotes
    }

    if (adminLoan.status === "requested") {
      updates.principal = Number(editPrincipal)
    }

    await supabase.from("loans").update(updates).eq("loan_id", adminLoan.loan_id)

    if (adminLoan.status === "requested") {
      // Loan releases are stored negative in the ledger.
      await supabase
        .from("transactions")
        .update({ amount: -Number(editPrincipal) })
        .eq("loan_id", adminLoan.loan_id)
        .eq("classification", "Loan Release")
        .eq("status", "pending")
    }

    setSavingEdit(false)
    setIsEditing(false)
    await reloadAll()
  }

  async function approveLoan() {
    if (!adminLoan || !approveBankChoice) return
    setApproving(true)

    await supabase.from("loans").update({ status: "active" }).eq("loan_id", adminLoan.loan_id)

    await supabase
      .from("transactions")
      .update({ status: "approved", bank_account_id: approveBankChoice })
      .eq("loan_id", adminLoan.loan_id)
      .eq("classification", "Loan Release")
      .eq("status", "pending")

    setApproving(false)
    await reloadAll()
  }

  async function handleClose() {
    if (!adminLoan) return
    setClosing(true)

    await closeLoanAndDistributeGain({
      id: adminLoan.loan_id,
      member_id: adminLoan.member_id,
      principal: adminLoan.principal,
      repaidApproved: adminLoan.repaidApproved,
      borrowerName: loan?.borrower
    })

    setClosing(false)
    await reloadAll()
  }

  async function reopenLoan() {
    if (!adminLoan) return
    setReopening(true)

    await supabase.from("investment_allocations").delete().eq("loan_id", adminLoan.loan_id)
    await supabase.from("transactions").delete().eq("loan_id", adminLoan.loan_id).eq("classification", "Gain Allocation")
    await supabase.from("loans").update({ status: "active" }).eq("loan_id", adminLoan.loan_id)

    setReopening(false)
    await reloadAll()
  }

  const fmt = (n: number) =>
    Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })

  if (checkingAccess) {
    return (
      <>
        <Navbar />
        <main className="min-h-screen bg-paper text-ink font-sans overflow-x-hidden">
          <div className="max-w-3xl mx-auto px-4 sm:px-5 pt-8 pb-[calc(3rem+env(safe-area-inset-bottom))]">
            <SkeletonPanel />
          </div>
        </main>
      </>
    )
  }

  if (notFound || !loan) {
    return (
      <>
        <Navbar />
        <main className="min-h-screen bg-paper text-ink font-sans">
          <div className="max-w-3xl mx-auto px-4 sm:px-5 pt-8">
            <p className="text-sm text-ink-soft">This loan couldn't be found.</p>
            <button
              onClick={() => router.push("/loans")}
              className="mt-4 text-sm font-medium text-gold"
            >
              ← Back to Loans
            </button>
          </div>
        </main>
      </>
    )
  }

  const statusMeta: Record<Loan["status"], { label: string; dot: string; text: string }> = {
    closed: { label: "Repaid in full", dot: "bg-sage", text: "text-sage" },
    active: { label: "Active", dot: "bg-gold", text: "text-gold" },
    requested: { label: "Requested", dot: "bg-ink-soft", text: "text-ink-soft" }
  }
  const meta = statusMeta[loan.status]

  const repaidPct = loan.principal > 0
    ? Math.min(100, ((loan.principal - loan.outstanding) / loan.principal) * 100)
    : 0

  const startLabel = new Date(loan.start_date).toLocaleDateString(undefined, {
    month: "long",
    day: "numeric",
    year: "numeric"
  })
  const closedLabel = loan.closed_date
    ? new Date(loan.closed_date).toLocaleDateString(undefined, {
        month: "long",
        day: "numeric",
        year: "numeric"
      })
    : null

  const totalShared = shares.reduce((sum, s) => sum + s.amount, 0)
  const netResult = adminLoan ? adminLoan.repaidApproved - adminLoan.principal : 0

  return (
    <>
      <Navbar />
      <main className="min-h-screen bg-paper text-ink font-sans overflow-x-hidden">
        <div className="max-w-3xl mx-auto px-4 sm:px-5 pt-8 pb-[calc(3rem+env(safe-area-inset-bottom))]">
          <button
            onClick={() => router.push("/loans")}
            className="text-[13px] text-ink-soft mb-4 hover:text-ink transition-colors"
          >
            ← Loans
          </button>

          <div className="flex items-center gap-2 mb-1">
            <span className={`w-1.5 h-1.5 rounded-full ${meta.dot}`} />
            <span className={`text-[11px] font-mono uppercase tracking-wide ${meta.text}`}>{meta.label}</span>
          </div>
          <h1 className="font-display text-3xl sm:text-4xl font-semibold text-ink mb-1">{loan.loan}</h1>
          <p className="text-[13px] text-ink-soft mb-6">
            Borrowed by {loan.borrower}
            {loan.borrower_member_id === myMemberId && " (you)"} · released {startLabel}
          </p>

          {/* Principal / repayment overview */}
          <div className="bg-paper-2 border border-hairline rounded-md px-5 pt-4 pb-3.5">
            <p className="text-[11px] uppercase tracking-wide text-ink-soft font-mono mb-1.5">
              {loan.status === "closed" ? "Total Repaid" : "Outstanding Balance"}
            </p>
            <p className="font-mono [font-variant-numeric:tabular-nums] text-3xl font-bold text-ink">
              ₱{fmt(loan.status === "closed" ? loan.repayment : loan.outstanding)}
            </p>
            <div className="mt-3">
              <div className="h-2 rounded-full bg-hairline overflow-hidden">
                <div
                  className={`h-full ${loan.status === "closed" ? "bg-sage" : "bg-gold"}`}
                  style={{ width: `${repaidPct}%` }}
                />
              </div>
              <p className="text-[11px] text-ink-soft mt-1.5">
                ₱{fmt(loan.principal - loan.outstanding)} repaid of ₱{fmt(loan.principal)} principal
              </p>
            </div>
          </div>

          {/* Capital / Performance boxes, matching Dashboard's InfoBox pattern */}
          <div className="bg-paper-2 border border-hairline rounded-md p-5 mt-4">
            <InfoBox label="Loan">
              <InfoRow label="Principal" value={`₱${fmt(loan.principal)}`} />
              <InfoRow label="Repaid so far" value={`₱${fmt(loan.repayment)}`} />
              <InfoRow
                label="Outstanding"
                value={`₱${fmt(loan.outstanding)}`}
                valueClass={loan.outstanding > 0 ? "text-gold" : "text-ink"}
              />
            </InfoBox>

            <InfoBox label="Gain">
              <InfoRow
                label={loan.status === "closed" ? "Interest earned" : "Interest so far"}
                value={loan.status === "closed" ? `+₱${fmt(loan.gain)}` : "—"}
                valueClass={loan.status === "closed" ? "text-sage" : "text-ink-soft"}
                bold
              />
              {closedLabel && <InfoRow label="Closed" value={closedLabel} />}
            </InfoBox>
          </div>

          {/* Admin-only: manage this loan -- approve, edit terms, close/reopen */}
          {isAdmin && adminLoan && (
            <div className="bg-paper-2 border border-gold/50 rounded-md mt-4 overflow-hidden">
              <button
                type="button"
                onClick={() => setManageOpen(!manageOpen)}
                className="w-full flex items-center justify-between px-5 py-3.5"
              >
                <span className="text-[11px] uppercase tracking-[0.1em] text-gold font-mono font-bold">
                  Manage loan
                </span>
                <span className="text-ink-soft text-xs">{manageOpen ? "▴" : "▾"}</span>
              </button>

              {manageOpen && (
                <div className="px-5 pb-5 border-t border-hairline pt-4">
                  {!isEditing ? (
                    <>
                      <div className="flex justify-between items-start gap-3">
                        <div className="grid grid-cols-2 gap-2 text-xs font-mono text-ink-soft flex-1">
                          <div>Principal: ₱{fmt(adminLoan.principal)}</div>
                          <div>Total repayable: ₱{fmt(adminLoan.totalRepayable)}</div>
                          <div>
                            Repaid: ₱{fmt(adminLoan.repaid)}
                            {adminLoan.pendingRepayment > 0 && (
                              <span className="text-gold"> (₱{fmt(adminLoan.pendingRepayment)} pending)</span>
                            )}
                          </div>
                          <div className={adminLoan.remaining <= 0 ? "text-sage" : ""}>
                            {adminLoan.remaining <= 0 ? "Fully repaid" : `Remaining: ₱${fmt(adminLoan.remaining)}`}
                          </div>
                          <div>
                            {adminLoan.interest_type === "amount"
                              ? `Interest: ₱${fmt(adminLoan.interest_amount)} flat`
                              : `Interest: ${adminLoan.interest_rate}%`}
                          </div>
                          <div>
                            {adminLoan.term_months}mo · {adminLoan.repayment_frequency}
                          </div>
                        </div>
                        {adminLoan.status !== "closed" && (
                          <button
                            className="text-xs text-ink-soft border border-hairline rounded-sm px-2 py-1 shrink-0"
                            onClick={startEditLoan}
                          >
                            Edit
                          </button>
                        )}
                      </div>

                      {adminLoan.status === "requested" && (
                        <div className="mt-4 space-y-2">
                          <label className="block text-xs uppercase tracking-wide text-ink-soft font-mono">
                            Disburse from bank
                          </label>
                          <select
                            className="border border-hairline bg-paper text-ink text-sm rounded-sm px-3 py-2 w-full"
                            value={approveBankChoice}
                            onChange={(e) => setApproveBankChoice(e.target.value)}
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
                            onClick={approveLoan}
                            disabled={!approveBankChoice || approving}
                          >
                            {approving ? "Approving..." : "Approve & Activate"}
                          </button>
                        </div>
                      )}

                      {adminLoan.status === "active" && adminLoan.remainingApproved <= 0 && (
                        <button
                          className="mt-4 bg-gold text-ink px-4 py-2 rounded-sm text-sm font-semibold disabled:opacity-50"
                          onClick={handleClose}
                          disabled={closing}
                        >
                          {closing
                            ? "Closing & distributing..."
                            : `Close Loan & Distribute ₱${fmt(netResult)} Gain`}
                        </button>
                      )}

                      {adminLoan.status === "active" &&
                        adminLoan.remainingApproved > 0 &&
                        adminLoan.remaining <= 0 && (
                          <p className="mt-4 text-xs text-gold font-mono">
                            Fully repaid, but ₱{fmt(adminLoan.pendingRepayment)} of that is still pending approval —
                            approve it in Transactions, then come back here to close this loan.
                          </p>
                        )}

                      {adminLoan.status === "active" && adminLoan.remainingApproved > 0 && (
                        <button
                          className="mt-2 text-xs text-rust border border-rust rounded-sm px-3 py-2 disabled:opacity-50"
                          onClick={() => {
                            const loss = Math.abs(Math.min(0, netResult))
                            const confirmMsg =
                              netResult < 0
                                ? `Close this loan now and record a ₱${fmt(loss)} loss, split across other members? This can't be undone from the app.`
                                : `Close this loan now even though it's not fully repaid? This will distribute a ₱${fmt(netResult)} gain based on what's been repaid so far. This can't be undone from the app.`
                            if (confirm(confirmMsg)) {
                              handleClose()
                            }
                          }}
                          disabled={closing}
                        >
                          {closing ? "Closing..." : "Close Early (Write Off)"}
                        </button>
                      )}

                      {adminLoan.status === "closed" && (
                        <button
                          className="mt-4 text-xs text-ink-soft border border-hairline rounded-sm px-3 py-2 disabled:opacity-50"
                          onClick={() => {
                            const confirmMsg =
                              "Reopen this loan? This will set it back to active and delete any gain/loss allocations recorded when it was closed (only if it was closed after loan reopening support was added — older closures may need manual cleanup in Supabase)."
                            if (confirm(confirmMsg)) {
                              reopenLoan()
                            }
                          }}
                          disabled={reopening}
                        >
                          {reopening ? "Reopening..." : "Reopen Loan"}
                        </button>
                      )}
                    </>
                  ) : (
                    <div className="space-y-3">
                      {adminLoan.status === "requested" && (
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

                      <div>
                        <label className="block mb-1 text-xs uppercase tracking-wide text-ink-soft font-mono">
                          Interest
                        </label>
                        <div className="flex border border-hairline rounded-sm overflow-hidden mb-2">
                          <button
                            type="button"
                            onClick={() => setEditInterestType("rate")}
                            className={`flex-1 text-xs font-semibold py-1.5 transition-colors ${
                              editInterestType === "rate" ? "bg-ink text-paper" : "bg-paper text-ink-soft"
                            }`}
                          >
                            Rate (%)
                          </button>
                          <button
                            type="button"
                            onClick={() => setEditInterestType("amount")}
                            className={`flex-1 text-xs font-semibold py-1.5 transition-colors ${
                              editInterestType === "amount" ? "bg-ink text-paper" : "bg-paper text-ink-soft"
                            }`}
                          >
                            Fixed amount (₱)
                          </button>
                        </div>
                        {editInterestType === "rate" ? (
                          <input
                            className="border border-hairline bg-paper text-ink text-sm rounded-sm px-3 py-2 w-full font-mono"
                            type="number"
                            value={editInterestRate}
                            onChange={(e) => setEditInterestRate(e.target.value)}
                          />
                        ) : (
                          <input
                            className="border border-hairline bg-paper text-ink text-sm rounded-sm px-3 py-2 w-full font-mono"
                            type="number"
                            value={editInterestAmount}
                            onChange={(e) => setEditInterestAmount(e.target.value)}
                          />
                        )}
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
                          onClick={saveLoanEdit}
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
                  )}
                </div>
              )}
            </div>
          )}

          {/* Gain share per member */}
          <section className="mt-8">
            <h2 className="font-display text-lg font-medium text-ink mb-1">Gain Share per Member</h2>
            <p className="text-[13px] text-ink-soft mb-3">
              {loan.status === "closed"
                ? `${loan.borrower} doesn't share in this loan's own gain. The rest is split by each member's value in the fund on the day it closed.`
                : "This loan hasn't closed yet — gain will be split among eligible members once it's fully repaid."}
            </p>

            {loadError && <p className="text-sm text-rust">{loadError}</p>}

            {loan.status === "closed" && shares.length > 0 && (
              <div className="bg-paper-2 border border-hairline rounded-md">
                <div className="px-5">
                  {shares.map((s, i) => (
                    <div
                      key={s.member_id}
                      className={`py-3 flex justify-between items-center gap-3 ${
                        i !== shares.length - 1 ? "border-b border-dashed border-hairline" : ""
                      }`}
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <p className="text-sm text-ink truncate">{s.member}</p>
                        {s.member_id === myMemberId && (
                          <span className="shrink-0 text-[9px] uppercase tracking-wide font-mono text-gold border border-gold/40 rounded px-1.5 py-0.5">
                            You
                          </span>
                        )}
                      </div>
                      <p className="font-mono [font-variant-numeric:tabular-nums] text-sm font-semibold text-sage shrink-0">
                        +₱{fmt(s.amount)}
                      </p>
                    </div>
                  ))}
                </div>
                <div className="px-5 py-3 border-t border-hairline flex justify-between items-center">
                  <p className="text-[11px] uppercase tracking-wide text-ink-soft font-mono">
                    Split among {shares.length} member{shares.length === 1 ? "" : "s"}
                  </p>
                  <p className="font-mono [font-variant-numeric:tabular-nums] text-[13px] font-semibold text-ink">
                    ₱{fmt(totalShared)}
                  </p>
                </div>
              </div>
            )}

            {loan.status === "closed" && shares.length === 0 && !loadError && (
              <p className="text-sm text-ink-soft text-center py-8 bg-paper-2 border border-hairline rounded-md">
                No gain was distributed for this loan.
              </p>
            )}
          </section>
        </div>
      </main>
    </>
  )
}

function InfoBox({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="bg-paper rounded-lg px-4 py-3.5 mb-3 last:mb-0">
      <p className="text-[10px] uppercase tracking-[0.1em] text-ink-soft font-mono mb-2">{label}</p>
      <div className="space-y-1.5">{children}</div>
    </div>
  )
}

function InfoRow({
  label,
  value,
  valueClass = "text-ink",
  bold = false
}: {
  label: string
  value: string
  valueClass?: string
  bold?: boolean
}) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className={`text-[13px] ${bold ? "text-ink font-semibold" : "text-ink-soft"}`}>{label}</span>
      <span
        className={`font-mono [font-variant-numeric:tabular-nums] whitespace-nowrap ${
          bold ? "text-[15px] font-bold" : "text-[13px] font-semibold"
        } ${valueClass}`}
      >
        {value}
      </span>
    </div>
  )
}
