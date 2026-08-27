"use client"

import { useCallback, useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { supabase } from "@/lib/supabase"
import Navbar from "@/app/components/Navbar"
import ScanToPayCard from "@/app/components/ScanToPayCard"
import { useAuth } from "@/app/auth-context"
import { SkeletonPanel } from "@/app/components/Skeleton"
import { TRANSACTION_TYPE_LABELS as TXN_TYPE_LABELS } from "@/lib/transactionLabels"
import { readCache, writeCache } from "@/lib/cache"
import { TRANSACTIONS_CHANGED_EVENT } from "@/lib/transactionEvents"

type RecentTransaction = {
  transaction_id: string
  date: string
  classification: string
  amount: number
  status: string
}

type DashboardSnapshot = {
  fundCash: number | null
  myBalance: number | null
  pendingCount: number
  recentTransactions: RecentTransaction[]
  asOf: string
}

export default function DashboardPage() {
  const router = useRouter()
  const { loading: authLoading, member } = useAuth()
  const cacheKey = member ? `dashboard:${member.member_id}` : null
  const cached = cacheKey ? readCache<DashboardSnapshot>(cacheKey) : undefined

  // Paints instantly from the last time this member's dashboard loaded,
  // before the browser ever shows a frame -- loadDashboard() below still
  // runs right after and replaces it with a fresh fetch, so a stale cache
  // never lingers past that first moment.
  const [dataLoading, setDataLoading] = useState(!cached)
  const [asOf, setAsOf] = useState<Date | null>(cached ? new Date(cached.asOf) : null)

  const [fundCash, setFundCash] = useState<number | null>(cached?.fundCash ?? null)
  const [myBalance, setMyBalance] = useState<number | null>(cached?.myBalance ?? null)
  const [pendingCount, setPendingCount] = useState(cached?.pendingCount ?? 0)
  const [recentTransactions, setRecentTransactions] = useState<RecentTransaction[]>(cached?.recentTransactions ?? [])
  const [loadError, setLoadError] = useState("")

  const memberName = member?.name ?? ""
  const isAdmin = member?.role === "admin"
  const checkingAccess = authLoading || dataLoading

  // Pulled out of the mount effect below so the FAB's quick-entry sheet
  // (in Navbar, above this page and unaware of it) can also trigger a
  // quiet refresh after saving a transaction -- see the listener effect
  // further down.
  const loadDashboard = useCallback(async () => {
      if (!member) return

      // Only show the blocking loader on a true cold start -- if we
      // already rendered cached data, refresh quietly behind it instead
      // of flashing back to a spinner on every navigation.
      if (!readCache(`dashboard:${member.member_id}`)) setDataLoading(true)

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
          : Promise.resolve({ count: 0, error: null })

      // Mirrors Admin's own "entries awaiting approval" total -- transactions,
      // pending member signups, and pending borrower signups. Distribution
      // groups are deliberately left out (getPendingBankInterestGroups()
      // does real aggregation work, not a cheap count, and isn't worth
      // paying for on every dashboard load). role='borrower' is excluded
      // from the members count the same way Admin's Members tab excludes
      // it -- pending borrowers are counted once, not double-counted
      // across both.
      const pendingMembersPromise =
        member.role === "admin"
          ? supabase
              .from("members")
              .select("member_id", { count: "exact", head: true })
              .eq("status", "pending")
              .neq("role", "borrower")
          : Promise.resolve({ count: 0, error: null })

      const pendingBorrowersPromise =
        member.role === "admin"
          ? supabase
              .from("members")
              .select("member_id", { count: "exact", head: true })
              .eq("status", "pending")
              .eq("role", "borrower")
          : Promise.resolve({ count: 0, error: null })

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
        pendingMembersResult,
        pendingBorrowersResult,
        recentTransactionsResult
      ] = await Promise.all([
        fundPromise,
        minePromise,
        pendingPromise,
        pendingMembersPromise,
        pendingBorrowersPromise,
        recentTransactionsPromise
      ])

      const firstError =
        fundResult.error ||
        mineResult.error ||
        pendingResult.error ||
        pendingMembersResult.error ||
        pendingBorrowersResult.error ||
        recentTransactionsResult.error
      if (firstError) setLoadError(firstError.message)

      const nextFundCash = !fundResult.error && fundResult.data ? Number(fundResult.data.total_cash) : fundCash
      const nextMyBalance = !mineResult.error && mineResult.data ? Number(mineResult.data.withdrawable_now) : myBalance
      const nextPendingCount = (pendingResult.count ?? 0) + (pendingMembersResult.count ?? 0) + (pendingBorrowersResult.count ?? 0)
      const nextRecentTransactions =
        !recentTransactionsResult.error && recentTransactionsResult.data
          ? recentTransactionsResult.data.map((r) => ({
              transaction_id: r.transaction_id,
              date: r.txn_date ?? r.created_at,
              classification: r.classification,
              amount: Number(r.amount),
              status: r.status
            }))
          : recentTransactions
      const nextAsOf = new Date()

      setFundCash(nextFundCash)
      setMyBalance(nextMyBalance)
      setPendingCount(nextPendingCount)
      setRecentTransactions(nextRecentTransactions)
      setAsOf(nextAsOf)
      setDataLoading(false)

      writeCache<DashboardSnapshot>(`dashboard:${member.member_id}`, {
        fundCash: nextFundCash,
        myBalance: nextMyBalance,
        pendingCount: nextPendingCount,
        recentTransactions: nextRecentTransactions,
        asOf: nextAsOf.toISOString()
      })
    // Depends only on member's id (see auth-context's own comment on why),
    // not on fundCash/myBalance/recentTransactions -- those are read only
    // as an error-path fallback, so a stale closure over them is harmless.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [member?.member_id])

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

    loadDashboard()
  }, [authLoading, member, router, loadDashboard])

  // The FAB's quick-entry sheet lives in Navbar, above this page and with
  // no reference to its load function -- this listens for the plain DOM
  // event it fires after a successful save instead, so a contribution/
  // withdrawal/etc. submitted from here shows up without needing a full
  // navigation away and back.
  useEffect(() => {
    window.addEventListener(TRANSACTIONS_CHANGED_EVENT, loadDashboard)
    return () => window.removeEventListener(TRANSACTIONS_CHANGED_EVENT, loadDashboard)
  }, [loadDashboard])

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

          <div className="mt-4">
            <ScanToPayCard />
          </div>

          <h2 className="font-display text-[17px] font-medium text-ink mt-2 mb-2.5">Shortcuts</h2>
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
            {/* Not adminOnly in ENTRY_TYPES (any member can log getting
                investment capital back), so this sits with the always-
                visible shortcuts above rather than the isAdmin-gated block
                below -- it had the same missing-entry-point gap as those,
                just for a different reason (no shortcut at all, not an
                admin restriction). */}
            <Shortcut
              label="Investment Return"
              onClick={() => router.push("/transactions/new?type=investment_return")}
              icon={
                <>
                  <path d="M4 19V9M9.5 19V5M15 19v-7" strokeLinecap="round" />
                  <path d="M4 19h11.5" strokeLinecap="round" />
                  <path d="M20 5v6.5M20 11.5l-3-3M20 11.5l3-3" strokeLinecap="round" strokeLinejoin="round" />
                </>
              }
            />
            {isAdmin && (
              <>
                {/* The rarer bookkeeping entry types (Bank Interest, Expense,
                    Bank Transfer, Investment) only had an entry point via
                    /transactions/new's own in-page type dropdown, reachable
                    only by first landing on the page through one of the
                    member-facing shortcuts above and then switching the
                    dropdown -- these give admins a direct one. */}
                <Shortcut
                  label="Bank Interest"
                  onClick={() => router.push("/transactions/new?type=bank_interest")}
                  icon={
                    <>
                      <rect x="3.5" y="7" width="17" height="12" rx="1.5" />
                      <path d="M3.5 11h17M8 7V5.5a1.5 1.5 0 011.5-1.5h5a1.5 1.5 0 011.5 1.5V7" />
                      <path d="M9.5 16.5l5-5M9.75 14a.25.25 0 100-.5.25.25 0 000 .5zM14.25 15.5a.25.25 0 100-.5.25.25 0 000 .5z" />
                    </>
                  }
                />
                <Shortcut
                  label="Expense"
                  onClick={() => router.push("/transactions/new?type=expense")}
                  icon={
                    <>
                      <path d="M6 3.5h9l3 3V19a1.5 1.5 0 01-1.5 1.5h-9A1.5 1.5 0 016 19V3.5z" />
                      <path d="M9 8.5h6M9 12h6M9 15.5h3.5" strokeLinecap="round" />
                    </>
                  }
                />
                <Shortcut
                  label="Bank Transfer"
                  onClick={() => router.push("/transactions/new?type=bank_transfer")}
                  icon={
                    <>
                      <path d="M4 8h13.5M17.5 8l-3.5-3.5M17.5 8L14 11.5" strokeLinecap="round" strokeLinejoin="round" />
                      <path d="M20 16H6.5M6.5 16L10 12.5M6.5 16L10 19.5" strokeLinecap="round" strokeLinejoin="round" />
                    </>
                  }
                />
                <Shortcut
                  label="Investment"
                  onClick={() => router.push("/transactions/new?type=investment")}
                  icon={
                    <>
                      <path d="M4 19V9M9.5 19V5M15 19v-7M20 19v-3" strokeLinecap="round" />
                      <path d="M4 19h16" strokeLinecap="round" />
                    </>
                  }
                />
              </>
            )}
          </div>

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
      className="flex flex-col items-center gap-2 bg-paper-2 border border-hairline rounded-md px-1.5 pt-3.5 pb-2.5 hover:bg-paper transition-colors"
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} className="w-[22px] h-[22px] text-gold">
        {icon}
      </svg>
      <span className="text-[10.5px] leading-tight text-ink-soft text-center">{label}</span>
    </button>
  )
}
