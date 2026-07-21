"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { supabase } from "@/lib/supabase"
import Navbar from "@/app/components/Navbar"
import { useAuth } from "@/app/auth-context"
import { SkeletonPanel } from "@/app/components/Skeleton"

const TXN_TYPE_LABELS: Record<string, string> = {
  "Member Contribution": "Contribution",
  "Member Withdrawal": "Withdrawal",
  "Expense": "Expense",
  "Loan Release": "Loan Disbursement",
  "Loan Repayment": "Loan Repayment",
  "Gain Allocation": "Investment Allocation",
  "Bank Interest": "Bank Interest",
  "Internal Transfer": "Bank Transfer",
  "Investment": "Investment",
  "Investment Return": "Investment Return",
  "Tax": "Tax",
  "Bank Write-off": "Bank Write-off",
  "Opening Balance": "Opening Balance"
}

type RecentTransaction = {
  transaction_id: string
  date: string
  classification: string
  amount: number
  status: string
}


export default function DashboardPage() {
  const router = useRouter()
  const { loading: authLoading, member } = useAuth()
  const [dataLoading, setDataLoading] = useState(true)
  const [asOf, setAsOf] = useState<Date | null>(null)

  const [fundCash, setFundCash] = useState<number | null>(null)
  const [myBalance, setMyBalance] = useState<number | null>(null)
  const [pendingCount, setPendingCount] = useState(0)
  const [myPendingCount, setMyPendingCount] = useState(0)
  const [myApprovedCount, setMyApprovedCount] = useState(0)
  const [myGainLoss, setMyGainLoss] = useState(0)
  const [recentTransactions, setRecentTransactions] = useState<RecentTransaction[]>([])
  const [loadError, setLoadError] = useState("")

  const memberName = member?.name ?? ""
  const isAdmin = member?.role === "admin"
  const checkingAccess = authLoading || dataLoading

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

    async function loadDashboard() {
      if (!member) return

      // v_fund_summary.total_cash is the same figure the Breakdown hub's
      // Fund tab shows as "Fund Total Cash" -- reuse it rather than
      // recomputing from bank balances.
      const fundPromise = supabase.from("v_fund_summary").select("total_cash").single()

      // v_member_performance.withdrawable_now is the same figure Breakdown's
      // You tab shows as "Available Balance."
      const minePromise = supabase
        .from("v_member_performance")
        .select("withdrawable_now")
        .eq("member_id", member.member_id)
        .single()

      const pendingPromise =
        member.role === "admin"
          ? supabase.from("transactions").select("transaction_id", { count: "exact", head: true }).eq("status", "pending")
          : Promise.resolve({ count: 0 } as any)

      const myPendingPromise = supabase
        .from("transactions")
        .select("transaction_id", { count: "exact", head: true })
        .eq("member_id", member.member_id)
        .eq("status", "pending")

      // Approved/Gain-Loss are all-time totals, not a recent window --
      // this fund transacts every few months rather than daily, so a
      // rolling 30-day (or even year-to-date) window reads as "broken zero"
      // for most members most of the time. Pending stays unwindowed too,
      // since a pending item is relevant for as long as it's pending.
      const myApprovedPromise = supabase
        .from("transactions")
        .select("transaction_id", { count: "exact", head: true })
        .eq("member_id", member.member_id)
        .eq("status", "approved")

      const bankInterestPromise = supabase
        .from("bank_interest_allocations")
        .select("amount")
        .eq("member_id", member.member_id)

      const loanGainPromise = supabase
        .from("loan_gain_allocations")
        .select("amount")
        .eq("member_id", member.member_id)

      const investmentAllocPromise = supabase
        .from("investment_allocations")
        .select("amount, allocation_type")
        .eq("member_id", member.member_id)

      // Bank write-offs aren't tracked in an allocations table like the
      // other three -- they're a signed "Bank Write-off" transaction
      // against the member directly. Has to be included here too, or this
      // total silently disagrees with Breakdown's "Total Gain/Loss" (which
      // does include it).
      const bankWriteoffPromise = supabase
        .from("transactions")
        .select("amount")
        .eq("member_id", member.member_id)
        .eq("status", "approved")
        .eq("classification", "Bank Write-off")

      const recentTransactionsPromise = supabase
        .from("transactions")
        .select("transaction_id, txn_date, created_at, classification, amount, status")
        .eq("member_id", member.member_id)
        .neq("status", "cancelled")
        .order("txn_date", { ascending: false, nullsFirst: false })
        .order("created_at", { ascending: false })
        .limit(5)

      const [
        fundResult,
        mineResult,
        pendingResult,
        myPendingResult,
        myApprovedResult,
        bankInterestResult,
        loanGainResult,
        investmentAllocResult,
        bankWriteoffResult,
        recentTransactionsResult
      ] = await Promise.all([
        fundPromise,
        minePromise,
        pendingPromise,
        myPendingPromise,
        myApprovedPromise,
        bankInterestPromise,
        loanGainPromise,
        investmentAllocPromise,
        bankWriteoffPromise,
        recentTransactionsPromise
      ])

      const firstError = fundResult.error || mineResult.error
      if (firstError) setLoadError(firstError.message)

      if (!fundResult.error && fundResult.data) {
        setFundCash(Number(fundResult.data.total_cash))
      }

      if (!mineResult.error && mineResult.data) {
        setMyBalance(Number(mineResult.data.withdrawable_now))
      }

      setPendingCount(pendingResult.count ?? 0)
      setMyPendingCount(myPendingResult.count ?? 0)
      setMyApprovedCount(myApprovedResult.count ?? 0)

      // Matches Breakdown's "Total Gain/Loss" exactly: bank interest + loan
      // gain share + investment gain/loss + bank write-off share, all-time.
      const gainLoss =
        (bankInterestResult.data ?? []).reduce((sum, r: any) => sum + Number(r.amount), 0) +
        (loanGainResult.data ?? []).reduce((sum, r: any) => sum + Number(r.amount), 0) +
        (investmentAllocResult.data ?? []).reduce(
          (sum, r: any) => sum + (r.allocation_type === "Investment Loss" ? -Number(r.amount) : Number(r.amount)),
          0
        ) +
        (bankWriteoffResult.data ?? []).reduce((sum, r: any) => sum + Number(r.amount), 0)
      setMyGainLoss(gainLoss)

      if (!recentTransactionsResult.error && recentTransactionsResult.data) {
        setRecentTransactions(
          recentTransactionsResult.data.map((r) => ({
            transaction_id: r.transaction_id,
            date: r.txn_date ?? r.created_at,
            classification: r.classification,
            amount: Number(r.amount),
            status: r.status
          }))
        )
      }

      setAsOf(new Date())
      setDataLoading(false)
    }

    loadDashboard()
  }, [authLoading, member, router])

  const fmt = (n: number) =>
    Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })

  const asOfLabel = asOf
    ? asOf.toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        year: "numeric",
        hour: "numeric",
        minute: "2-digit"
      })
    : ""

  if (checkingAccess) {
    return (
      <>
        <Navbar />
        <main className="min-h-screen bg-paper text-ink font-sans overflow-x-hidden">
          <div className="max-w-3xl mx-auto px-4 sm:px-5 pt-8 pb-[calc(2.5rem+var(--dock-h)+env(safe-area-inset-bottom))]">
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
        <div className="max-w-3xl mx-auto px-4 sm:px-5 pt-8 pb-[calc(2.5rem+var(--dock-h)+env(safe-area-inset-bottom))]">
          <div className="text-[11px] tracking-[0.18em] uppercase text-gold font-mono mb-2">
            Welcome back
          </div>
          <h1 className="font-display text-3xl sm:text-4xl font-semibold text-ink">
            {memberName}
          </h1>
          {asOfLabel && (
            <p className="text-[11px] text-ink-soft mt-1 mb-5">As of {asOfLabel}</p>
          )}

          {loadError && (
            <p className="mt-2 mb-4 text-sm text-rust">
              Couldn't load some dashboard data: {loadError}
            </p>
          )}

          {/* Admin-only: fund-wide items needing action -- the one thing on
              this page that isn't the signed-in member's own money, so it
              stays visually distinct (gold border) from everything below. */}
          {isAdmin && pendingCount > 0 && (
            <button
              onClick={() => router.push("/admin")}
              className="mb-5 w-full text-left bg-paper-2 border border-gold rounded-md px-5 py-4 flex items-center justify-between"
            >
              <div>
                <p className="text-sm text-ink font-medium">
                  {pendingCount} {pendingCount === 1 ? "entry" : "entries"} awaiting approval
                </p>
                <p className="text-xs text-gold mt-0.5">Tap to review in Admin</p>
              </div>
              <span className="text-ink-soft">→</span>
            </button>
          )}

          <button
            onClick={() => router.push("/fund-breakdown?tab=fund&view=you")}
            className="w-full text-left bg-paper-2 border border-hairline rounded-md px-5 pt-4 pb-3.5 hover:bg-paper transition-colors"
          >
            <p className="text-[11px] uppercase tracking-wide text-ink-soft font-mono mb-1.5">
              My Available Balance
            </p>
            <p className="font-mono [font-variant-numeric:tabular-nums] text-3xl font-bold text-ink">
              ₱{myBalance != null ? fmt(myBalance) : "—"}
            </p>
            <p className="text-[12px] text-gold font-semibold mt-2.5">View full breakdown →</p>
          </button>

          <button
            onClick={() => router.push("/fund-breakdown?tab=fund")}
            className="w-full text-left bg-paper-2 border border-hairline rounded-md px-5 pt-4 pb-3.5 mt-3 hover:bg-paper transition-colors"
          >
            <p className="text-[11px] uppercase tracking-wide text-ink-soft font-mono mb-1.5">
              Fund Available Balance
            </p>
            <p className="font-mono [font-variant-numeric:tabular-nums] text-2xl font-bold text-ink">
              ₱{fundCash != null ? fmt(fundCash) : "—"}
            </p>
            <p className="text-[12px] text-gold font-semibold mt-2.5">View fund breakdown →</p>
          </button>

          <h2 className="font-display text-[17px] font-medium text-ink mt-6 mb-2.5">Shortcuts</h2>
          <div className="grid grid-cols-4 gap-2">
            <Shortcut
              label="Add Contribution"
              onClick={() => router.push("/transactions/new?type=contribution")}
              icon={
                <path d="M12 19V5M12 5l-5 5M12 5l5 5" strokeLinecap="round" strokeLinejoin="round" />
              }
            />
            <Shortcut
              label="Request Withdrawal"
              onClick={() => router.push("/transactions/new?type=withdrawal")}
              icon={
                <path d="M12 5v14M12 19l-5-5M12 19l5-5" strokeLinecap="round" strokeLinejoin="round" />
              }
            />
            <Shortcut
              label="Request Loan"
              onClick={() => router.push("/transactions/new?type=loan_request")}
              icon={
                <>
                  <rect x="3.5" y="7" width="17" height="12" rx="1.5" />
                  <path d="M3.5 11h17M8 7V5.5a1.5 1.5 0 011.5-1.5h5a1.5 1.5 0 011.5 1.5V7" />
                </>
              }
            />
            <Shortcut
              label="Repay Loan"
              onClick={() => router.push("/transactions/new?type=loan_payment")}
              icon={
                <>
                  <path d="M4 12a8 8 0 0113.66-5.66M20 12a8 8 0 01-13.66 5.66" strokeLinecap="round" />
                  <path d="M17.5 3.5v3h-3M6.5 20.5v-3h3" strokeLinecap="round" strokeLinejoin="round" />
                </>
              }
            />
          </div>

          {/* At-a-glance activity for this member -- pending count mirrors
              what used to be its own banner. Approved/Gain-Loss are
              all-time totals rather than a recent window (see comment by
              the queries above for why), so the labels say so -- otherwise
              a quiet month reads as "broken zero" instead of "no activity."
              Gain/Loss deliberately sums the same four figures as
              Breakdown's "Total Gain/Loss" so the two numbers always
              agree -- an earlier version called this "Distributed" and
              left out Bank Write-off Share, which made it disagree with
              Breakdown for no good reason. */}
          <button
            onClick={() => router.push("/transactions")}
            className="w-full flex bg-paper-2 border border-hairline rounded-md overflow-hidden mt-5 hover:bg-paper transition-colors"
          >
            <div className="flex-1 px-2.5 py-3.5 text-center border-r border-hairline">
              <p className="font-mono text-xl font-bold text-gold leading-none mb-1">{myPendingCount}</p>
              <p className="text-[10px] uppercase tracking-wide text-ink-soft font-mono">Pending</p>
            </div>
            <div className="flex-1 px-2.5 py-3.5 text-center border-r border-hairline">
              <p className="font-mono text-xl font-bold text-ink leading-none mb-1">{myApprovedCount}</p>
              <p className="text-[10px] uppercase tracking-wide text-ink-soft font-mono">
                All-Time
                <br />
                Approved
              </p>
            </div>
            <div className="flex-1 px-2.5 py-3.5 text-center">
              <p
                className={`font-mono text-xl font-bold leading-none mb-1 ${
                  myGainLoss > 0 ? "text-sage" : myGainLoss < 0 ? "text-rust" : "text-ink"
                }`}
              >
                {myGainLoss < 0 ? "-" : "+"}₱{fmt(Math.abs(myGainLoss))}
              </p>
              <p className="text-[10px] uppercase tracking-wide text-ink-soft font-mono">
                All-Time
                <br />
                Gain/Loss
              </p>
            </div>
          </button>

          <div className="flex items-baseline justify-between gap-3 mt-6 mb-2.5">
            <h2 className="font-display text-[17px] font-medium text-ink">Recent Transactions</h2>
            <button onClick={() => router.push("/transactions")} className="shrink-0 text-[13px] font-medium text-gold">
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
              No transactions recorded yet.
            </p>
          )}
        </div>
      </main>
    </>
  )
}

function Shortcut({ label, onClick, icon }: { label: string; onClick: () => void; icon: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className="bg-paper-2 border border-hairline rounded-md px-1.5 pt-3.5 pb-2.5 text-center hover:bg-paper transition-colors"
    >
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.75}
        className="w-[22px] h-[22px] mx-auto mb-2 text-gold"
      >
        {icon}
      </svg>
      <span className="text-[10.5px] leading-tight text-ink-soft">{label}</span>
    </button>
  )
}
