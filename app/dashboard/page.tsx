"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { supabase } from "@/lib/supabase"
import Navbar from "@/app/components/Navbar"

const typeLabels: Record<string, string> = {
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
  "Opening Balance": "Opening Balance"
}

export default function DashboardPage() {
  const router = useRouter()
  const [checkingAccess, setCheckingAccess] = useState(true)
  const [memberName, setMemberName] = useState("")
  const [isAdmin, setIsAdmin] = useState(false)

  const [fundTotalCash, setFundTotalCash] = useState<number | null>(null)
  const [myNetBalance, setMyNetBalance] = useState<number | null>(null)
  const [pendingCount, setPendingCount] = useState(0)
  const [recent, setRecent] = useState<any[]>([])
  const [loadError, setLoadError] = useState("")

  useEffect(() => {
    async function loadDashboard() {
      const {
        data: { user }
      } = await supabase.auth.getUser()

      if (!user) {
        router.push("/login")
        return
      }

      const { data: member } = await supabase
        .from("members")
        .select("member_id, name, status, role")
        .eq("email", user.email)
        .single()

      if (!member || member.status !== "approved") {
        router.push("/waiting")
        return
      }

      setMemberName(member.name)
      setIsAdmin(member.role === "admin")

      // Fund-wide cash position: v_cash_ledger is a running balance ordered
      // by (txn_date, transaction_id) -- the same order the window function
      // itself accumulates in, so the top row in that same descending order
      // is the current total.
      const cashPromise = supabase
        .from("v_cash_ledger")
        .select("running_balance")
        .order("txn_date", { ascending: false })
        .order("transaction_id", { ascending: false })
        .limit(1)

      // v_member_ledger only exposes the member's name (not member_id), so
      // match on name -- names are unique across the fund's member roster.
      const memberLedgerPromise = supabase
        .from("v_member_ledger")
        .select("net")
        .eq("member", member.name)
        .single()

      const recentPromise = supabase
        .from("transactions")
        .select("transaction_id, classification, amount, description, status, created_at")
        .eq("member_id", member.member_id)
        .order("created_at", { ascending: false })
        .limit(5)

      const pendingPromise = member.role === "admin"
        ? supabase
            .from("transactions")
            .select("transaction_id", { count: "exact", head: true })
            .eq("status", "pending")
        : Promise.resolve({ count: 0 } as any)

      const [cashResult, memberResult, recentResult, pendingResult] = await Promise.all([
        cashPromise,
        memberLedgerPromise,
        recentPromise,
        pendingPromise
      ])

      if (cashResult.error) {
        setLoadError(cashResult.error.message)
      } else {
        setFundTotalCash(
          cashResult.data?.[0]?.running_balance != null
            ? Number(cashResult.data[0].running_balance)
            : 0
        )
      }

      if (!memberResult.error) {
        setMyNetBalance(memberResult.data?.net != null ? Number(memberResult.data.net) : 0)
      }

      setRecent(recentResult.data ?? [])
      setPendingCount(pendingResult.count ?? 0)
      setCheckingAccess(false)
    }

    loadDashboard()
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
      <main className="min-h-screen bg-paper text-ink font-sans overflow-x-hidden">
        <div className="max-w-3xl mx-auto px-5 pt-10 pb-24">
          <div className="text-[11px] tracking-[0.18em] uppercase text-gold font-mono mb-2">
            Welcome back
          </div>
          <h1 className="font-display text-3xl sm:text-4xl font-semibold text-ink">
            {memberName}
          </h1>

          {loadError && (
            <p className="mt-4 text-sm text-rust">
              Couldn't load some dashboard data: {loadError}
            </p>
          )}

          <div className="mt-8 grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="bg-paper-2 border border-hairline rounded-sm relative overflow-hidden">
              <div className="absolute left-0 top-0 bottom-0 w-[3px] bg-gold" />
              <div className="pl-6 pr-5 py-5">
                <p className="text-xs uppercase tracking-wide text-ink-soft font-mono mb-2">
                  Fund Total Cash
                </p>
                <p className="font-mono text-2xl font-semibold text-ink">
                  ₱{fundTotalCash != null ? fmt(fundTotalCash) : "—"}
                </p>
              </div>
            </div>

            <div className="bg-paper-2 border border-hairline rounded-sm relative overflow-hidden">
              <div className="absolute left-0 top-0 bottom-0 w-[3px] bg-sage" />
              <div className="pl-6 pr-5 py-5">
                <p className="text-xs uppercase tracking-wide text-ink-soft font-mono mb-2">
                  Your Net Contribution
                </p>
                <p className="font-mono text-2xl font-semibold text-ink">
                  ₱{myNetBalance != null ? fmt(myNetBalance) : "—"}
                </p>
              </div>
            </div>
          </div>

          {isAdmin && pendingCount > 0 && (
            <button
              onClick={() => router.push("/admin")}
              className="mt-4 w-full text-left bg-paper-2 border border-hairline rounded-sm relative overflow-hidden"
            >
              <div className="absolute left-0 top-0 bottom-0 w-[3px] bg-rust" />
              <div className="pl-6 pr-5 py-4 flex items-center justify-between">
                <div>
                  <p className="text-sm text-ink font-medium">
                    {pendingCount} {pendingCount === 1 ? "entry" : "entries"} awaiting approval
                  </p>
                  <p className="text-xs text-ink-soft mt-0.5">
                    Tap to review in Admin
                  </p>
                </div>
                <span className="text-ink-soft">→</span>
              </div>
            </button>
          )}

          <div className="mt-8 grid grid-cols-1 sm:grid-cols-3 gap-3">
            <button
              onClick={() => router.push("/transactions/new")}
              className="bg-gold text-ink px-5 py-4 rounded-sm text-sm font-semibold shadow-sm hover:opacity-90 transition-opacity flex items-center justify-center gap-1.5"
            >
              <span className="text-lg leading-none">+</span>
              New Transaction
            </button>
            <button
              onClick={() => router.push("/transactions")}
              className="border border-hairline rounded-sm px-5 py-4 text-sm font-medium text-ink hover:bg-paper-2 transition-colors"
            >
              View Transactions
            </button>
            <button
              onClick={() => router.push("/fund-breakdown")}
              className="border border-hairline rounded-sm px-5 py-4 text-sm font-medium text-ink hover:bg-paper-2 transition-colors"
            >
              Fund Breakdown
            </button>
          </div>

          {recent.length > 0 && (
            <div className="mt-10">
              <h2 className="font-display text-lg font-medium text-ink mb-3">
                Your Recent Activity
              </h2>
              <div className="bg-paper-2 border border-hairline rounded-sm relative overflow-hidden">
                <div className="absolute left-0 top-0 bottom-0 w-[3px] bg-gold" />
                <div className="pl-6 pr-5">
                  {recent.map((t, i) => (
                    <div
                      key={t.transaction_id}
                      className={`py-3 flex justify-between items-center gap-3 ${
                        i !== recent.length - 1 ? "border-b border-dashed border-hairline" : ""
                      }`}
                    >
                      <div className="min-w-0">
                        <p className="text-sm text-ink">
                          {typeLabels[t.classification] || t.classification}
                          <span className="text-ink-soft font-mono text-xs ml-2">
                            {new Date(t.created_at).toLocaleDateString()}
                          </span>
                        </p>
                        {t.description && (
                          <p className="text-xs text-ink-soft truncate">
                            {t.description}
                          </p>
                        )}
                      </div>
                      <div className="text-right shrink-0">
                        <p className="font-mono text-sm text-ink">
                          ₱{fmt(Math.abs(t.amount))}
                        </p>
                        <p className="text-[10px] uppercase text-ink-soft font-mono">
                          {t.status}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {recent.length === 0 && (
            <p className="mt-10 text-sm text-ink-soft text-center py-8">
              No activity yet — your first transaction will show up here.
            </p>
          )}
        </div>
      </main>
    </>
  )
}
