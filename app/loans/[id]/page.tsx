"use client"

import { useEffect, useState } from "react"
import { useRouter, useParams } from "next/navigation"
import { supabase } from "@/lib/supabase"
import Navbar from "@/app/components/Navbar"
import { closeLoanAndDistributeGain } from "@/lib/closeLoan"
import { snapshotLoanHold } from "@/lib/snapshotHold"
import { dateOnly } from "@/lib/currentValue"
import { totalRepayable, type InterestType } from "@/lib/loanMath"
import { formatInterestLabel } from "@/lib/loanFormat"
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
  total_repayable: number
  interest_type: InterestType | null
  interest_rate: number | null
  interest_amount: number | null
  term_months: number | null
  notes: string | null
}

type GainShare = {
  member_id: string
  member: string
  amount: number
  current_value: number
  pct_share: number
}

type RecentTransaction = {
  transaction_id: string
  date: string
  classification: string
  amount: number
  status: string
}

const TXN_TYPE_LABELS: Record<string, string> = {
  "Loan Release": "Loan Disbursement",
  "Loan Repayment": "Loan Repayment",
  "Gain Allocation": "Investment Allocation"
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
  const [recentTransactions, setRecentTransactions] = useState<RecentTransaction[]>([])
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
      .select("amount, member_id, current_value, pct_share, members(name)")
      .eq("loan_id", loanId)
      .order("amount", { ascending: false })

    // Most recent 5 transactions tied to this loan, newest first -- a quick
    // "what's happened lately" glance, with a link to the full ledger
    // (pre-filtered to this loan) for anything older.
    const recentTxnsPromise = supabase
      .from("transactions")
      .select("transaction_id, txn_date, created_at, classification, amount, status")
      .eq("loan_id", loanId)
      .neq("status", "cancelled")
      .order("txn_date", { ascending: false, nullsFirst: false })
      .order("created_at", { ascending: false })
      .limit(5)

    const [loanResult, sharesResult, recentTxnsResult] = await Promise.all([
      loanPromise,
      sharesPromise,
      recentTxnsPromise
    ])

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
          amount: Number(r.amount),
          current_value: Number(r.current_value),
          pct_share: Number(r.pct_share)
        }))
      )
    } else if (sharesResult.error) {
      setLoadError(sharesResult.error.message)
    }

    if (!recentTxnsResult.error && recentTxnsResult.data) {
      setRecentTransactions(
        recentTxnsResult.data.map((r) => ({
          transaction_id: r.transaction_id,
          date: r.txn_date ?? r.created_at,
          classification: r.classification,
          amount: Number(r.amount),
          status: r.status
        }))
      )
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

    if (member.role === "borrower") {
      router.push("/borrower")
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

    // Freezes each eligible member's pool share as of release -- the money
    // moving out to fund this loan is "on hold" for them until it's repaid.
    await snapshotLoanHold(adminLoan.loan_id, adminLoan.member_id, dateOnly(new Date()))

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
        <main className="min-h-screen bg-paper text-ink font-sans overflow-x-hidden">
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

  const repaidPct = loan.total_repayable > 0
    ? Math.min(100, ((loan.total_repayable - loan.outstanding) / loan.total_repayable) * 100)
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
            {loan.status !== "closed" && (
              <p className="text-[12px] font-mono font-bold text-gold mt-1">
                of ₱{fmt(loan.total_repayable)} total ·{" "}
                {formatInterestLabel(loan.interest_type, loan.interest_rate, loan.interest_amount, fmt)} interest
              </p>
            )}
            <div className="mt-3">
              <div className="h-2 rounded-full bg-hairline overflow-hidden">
                <div
                  className={`h-full ${loan.status === "closed" ? "bg-sage" : "bg-gold"}`}
                  style={{ width: `${repaidPct}%` }}
                />
              </div>
              <p className="text-[11px] text-ink-soft mt-1.5">
                ₱{fmt(loan.total_repayable - loan.outstanding)} repaid of ₱{fmt(loan.total_repayable)} total repayable
              </p>
            </div>
          </div>

          {/* Capital / Performance boxes, matching Dashboard's InfoBox pattern */}
          <div className="bg-paper-2 border border-hairline rounded-md p-5 mt-4">
            <InfoBox label="Loan">
              <InfoRow label="Principal" value={`₱${fmt(loan.principal)}`} />
              <InfoRow label="Total repayable" value={`₱${fmt(loan.total_repayable)}`} />
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
                      <div className="bg-paper rounded-lg px-4 py-3.5">
                        <div className="flex items-center justify-between mb-2">
                          <p className="text-[10px] uppercase tracking-[0.1em] text-ink-soft font-mono">
                            Loan terms
                          </p>
                          {adminLoan.status !== "closed" && (
                            <button
                              className="text-[11px] text-ink-soft border border-hairline rounded-sm px-2.5 py-1"
                              onClick={startEditLoan}
                            >
                              Edit
                            </button>
                          )}
                        </div>
                        <div className="space-y-1.5">
                          <div className="flex items-baseline justify-between gap-3">
                            <span className="text-[13px] text-ink-soft">Principal</span>
                            <span className="font-mono [font-variant-numeric:tabular-nums] text-[13px] font-semibold text-ink whitespace-nowrap">
                              ₱{fmt(adminLoan.principal)}
                            </span>
                          </div>
                          <div className="flex items-baseline justify-between gap-3">
                            <span className="text-[13px] text-ink-soft">Total repayable</span>
                            <span className="font-mono [font-variant-numeric:tabular-nums] text-[13px] font-semibold text-ink whitespace-nowrap">
                              ₱{fmt(adminLoan.totalRepayable)}
                            </span>
                          </div>
                          <div className="flex items-baseline justify-between gap-3">
                            <span className="text-[13px] text-ink-soft">Repaid</span>
                            <span className="font-mono [font-variant-numeric:tabular-nums] text-[13px] font-semibold text-ink whitespace-nowrap">
                              ₱{fmt(adminLoan.repaid)}
                              {adminLoan.pendingRepayment > 0 && (
                                <span className="text-gold"> (₱{fmt(adminLoan.pendingRepayment)} pending)</span>
                              )}
                            </span>
                          </div>
                          <div className="flex items-baseline justify-between gap-3">
                            <span className="text-[13px] text-ink-soft">Remaining</span>
                            <span
                              className={`font-mono [font-variant-numeric:tabular-nums] text-[13px] font-semibold whitespace-nowrap ${
                                adminLoan.remaining <= 0 ? "text-sage" : "text-ink"
                              }`}
                            >
                              {adminLoan.remaining <= 0 ? "Fully repaid" : `₱${fmt(adminLoan.remaining)}`}
                            </span>
                          </div>
                          <div className="flex items-baseline justify-between gap-3">
                            <span className="text-[13px] text-ink-soft">Interest</span>
                            <span className="font-mono [font-variant-numeric:tabular-nums] text-[13px] font-semibold text-ink whitespace-nowrap">
                              {adminLoan.interest_type === "amount"
                                ? `₱${fmt(adminLoan.interest_amount)} flat`
                                : `${adminLoan.interest_rate}%`}
                            </span>
                          </div>
                          <div className="flex items-baseline justify-between gap-3">
                            <span className="text-[13px] text-ink-soft">Term</span>
                            <span className="font-mono [font-variant-numeric:tabular-nums] text-[13px] font-semibold text-ink whitespace-nowrap">
                              {adminLoan.term_months}mo ·{" "}
                              {adminLoan.repayment_frequency === "monthly" ? "monthly" : "lump sum"}
                            </span>
                          </div>
                        </div>
                      </div>

                      <div className="mt-5 pt-4 border-t border-hairline">
                        <p className="text-[10px] uppercase tracking-[0.1em] text-ink-soft font-mono mb-3">
                          Actions
                        </p>

                        {adminLoan.status === "requested" && (
                          <div className="space-y-2.5">
                            <label className="block text-xs uppercase tracking-wide text-ink-soft font-mono">
                              Disburse from bank
                            </label>
                            <select
                              className="border border-hairline bg-paper text-ink text-sm rounded-sm px-3 py-2.5 w-full"
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
                              className="w-full bg-ink text-paper px-4 py-2.5 rounded-sm text-sm font-semibold disabled:opacity-50"
                              onClick={approveLoan}
                              disabled={!approveBankChoice || approving}
                            >
                              {approving ? "Approving..." : "Approve & Activate"}
                            </button>
                          </div>
                        )}

                        {adminLoan.status === "active" && adminLoan.remainingApproved <= 0 && (
                          <button
                            className="w-full bg-gold text-ink px-4 py-3 rounded-sm text-sm font-semibold shadow-sm disabled:opacity-50"
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
                            <p className="text-xs text-gold font-mono bg-gold/10 border border-gold/30 rounded-sm px-3 py-2.5">
                              Fully repaid, but ₱{fmt(adminLoan.pendingRepayment)} of that is still pending approval
                              — approve it in Transactions, then come back here to close this loan.
                            </p>
                          )}

                        {adminLoan.status === "active" && adminLoan.remainingApproved > 0 && (
                          <button
                            className={`w-full text-xs text-rust border border-rust rounded-sm px-3 py-2.5 disabled:opacity-50 ${
                              adminLoan.remaining <= 0 ? "mt-2.5" : ""
                            }`}
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
                            className="w-full text-xs text-ink-soft border border-hairline rounded-sm px-3 py-2.5 disabled:opacity-50"
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
                      </div>
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

          {/* Recent transactions */}
          <section className="mt-8">
            <div className="flex items-baseline justify-between gap-3 mb-3">
              <h2 className="font-display text-lg font-medium text-ink">Recent Transactions</h2>
              <button
                onClick={() => router.push(`/transactions?loan=${loanId}`)}
                className="shrink-0 text-[13px] font-medium text-gold"
              >
                View all →
              </button>
            </div>

            {recentTransactions.length > 0 ? (
              <div className="bg-paper-2 border border-hairline rounded-md px-5">
                {recentTransactions.map((t, i) => (
                  <div
                    key={t.transaction_id}
                    className={`py-3 flex justify-between items-center gap-3 ${
                      i !== recentTransactions.length - 1 ? "border-b border-dashed border-hairline" : ""
                    }`}
                  >
                    <div className="min-w-0">
                      <p className="text-sm text-ink truncate">
                        {TXN_TYPE_LABELS[t.classification] ?? t.classification}
                      </p>
                      <p className="text-[11px] text-ink-soft font-mono">
                        {/* t.date is a plain "YYYY-MM-DD" when txn_date is
                            set (the common case) -- append a local midnight
                            time so parsing doesn't roll it back a day in
                            timezones behind UTC. Falls back to the full
                            created_at timestamp as-is when txn_date is
                            null, which needs no such adjustment. */}
                        {new Date(t.date.length === 10 ? `${t.date}T00:00:00` : t.date).toLocaleDateString(undefined, {
                          day: "numeric",
                          month: "short",
                          year: "numeric"
                        })}
                        {t.status === "pending" ? " · pending" : ""}
                      </p>
                    </div>
                    <p
                      className={`shrink-0 font-mono [font-variant-numeric:tabular-nums] text-sm font-semibold ${
                        t.amount < 0 ? "text-rust" : "text-sage"
                      }`}
                    >
                      {t.amount < 0 ? "-" : "+"}₱{fmt(Math.abs(t.amount))}
                    </p>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-ink-soft text-center py-8 bg-paper-2 border border-hairline rounded-md">
                No transactions recorded for this loan yet.
              </p>
            )}
          </section>

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
                      <div className="flex flex-col items-end shrink-0">
                        <p className="font-mono [font-variant-numeric:tabular-nums] text-sm font-semibold text-sage">
                          +₱{fmt(s.amount)}
                        </p>
                        <p className="text-[11px] text-ink-soft font-mono whitespace-nowrap">
                          {s.pct_share.toFixed(2)}% of ₱{fmt(s.current_value)}
                        </p>
                      </div>
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
