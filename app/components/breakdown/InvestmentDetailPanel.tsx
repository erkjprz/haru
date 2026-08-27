"use client"

// Inline replacement for the old standalone /investment/[id] route --
// rendered in place inside InvestmentsPanel so the Breakdown header and
// tab row stay on screen instead of a full page navigation.

import { useCallback, useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { supabase } from "@/lib/supabase"
import { useAuth } from "@/app/auth-context"
import { SkeletonPanel } from "@/app/components/Skeleton"
import { InfoBox, InfoRow } from "@/app/components/breakdown/InfoBox"
import { distributeInvestmentGain, getUndistributedInvestmentGain } from "@/lib/distributeInvestment"
import { closeInvestmentAndDistributeGain } from "@/lib/closeInvestment"
import { dateOnly } from "@/lib/currentValue"
import { TRANSACTION_TYPE_LABELS as TXN_TYPE_LABELS } from "@/lib/transactionLabels"
import { readCache, writeCache } from "@/lib/cache"

type Investment = {
  investment_id: string
  investment: string
  affects_cash: number
  invested: number
  returned: number
  gain_loss: number
  status: "open" | "closed"
  closed_date: string | null
}

type Share = {
  id: string
  member_id: string
  member: string
  amount: number
  allocation_type: string
  notes: string | null
}

type RecentTransaction = {
  transaction_id: string
  date: string
  classification: string
  amount: number
  status: string
}

type InvestmentDetailSnapshot = {
  investment: Investment | null
  shares: Share[]
  recentTransactions: RecentTransaction[]
}

export function InvestmentDetailPanel({ investmentId, onBack }: { investmentId: string; onBack: () => void }) {
  const router = useRouter()
  const { member } = useAuth()
  const isAdmin = member?.role === "admin"
  const myMemberId = member?.member_id ?? null

  const cacheKey = `investment-detail:${investmentId}`
  const cached = readCache<InvestmentDetailSnapshot>(cacheKey)

  const [dataLoading, setDataLoading] = useState(!cached)
  const [investment, setInvestment] = useState<Investment | null>(cached?.investment ?? null)
  const [shares, setShares] = useState<Share[]>(cached?.shares ?? [])
  const [recentTransactions, setRecentTransactions] = useState<RecentTransaction[]>(cached?.recentTransactions ?? [])
  const [notFound, setNotFound] = useState(false)
  const [loadError, setLoadError] = useState("")

  const [showDistributeForm, setShowDistributeForm] = useState(false)
  const [distributeDate, setDistributeDate] = useState(dateOnly(new Date()))
  const [distributeAmount, setDistributeAmount] = useState("")
  const [distributeNotes, setDistributeNotes] = useState("")
  const [closeOnDistribute, setCloseOnDistribute] = useState(false)
  const [distributing, setDistributing] = useState(false)
  const [distributeMessage, setDistributeMessage] = useState("")
  const [suggestedAmount, setSuggestedAmount] = useState<number | null>(null)
  const [reopening, setReopening] = useState(false)
  const [reopenError, setReopenError] = useState("")

  const loadInvestment = useCallback(async () => {
    const { data, error } = await supabase
      .from("v_investment_summary")
      .select("*")
      .eq("investment_id", investmentId)
      .single()

    if (error || !data) {
      setNotFound(true)
      return investment
    }

    const next = data as Investment
    setInvestment(next)
    return next
  }, [investmentId])

  const loadShares = useCallback(async () => {
    // Per-member split, per Section 8: Perfume Biz is a flat equal
    // split across all 10 members; Farmon's realized loss is spread
    // across 9 (Yabie isn't allocated a share, a pre-existing artifact
    // of this table's history, not something decided in this pass).
    const { data, error } = await supabase
      .from("investment_allocations")
      .select("id, amount, allocation_type, member_id, notes, members(name)")
      .eq("investment_id", investmentId)

    if (!error && data) {
      const next = data.map((r: any) => ({
        id: r.id,
        member_id: r.member_id,
        member: r.members?.name ?? "Unknown",
        amount: Number(r.amount),
        allocation_type: r.allocation_type,
        notes: r.notes ?? null
      }))
      setShares(next)
      setLoadError("")
      return next
    } else if (error) {
      setLoadError(error.message)
    }
    return shares
  }, [investmentId])

  const loadRecentTransactions = useCallback(async () => {
    const { data } = await supabase
      .from("transactions")
      .select("transaction_id, txn_date, created_at, classification, amount, status")
      .eq("investment_id", investmentId)
      .neq("status", "cancelled")
      .order("txn_date", { ascending: false, nullsFirst: false })
      .order("created_at", { ascending: false })
      .limit(5)

    const next = (data ?? []).map((r) => ({
      transaction_id: r.transaction_id,
      date: r.txn_date ?? r.created_at,
      classification: r.classification,
      amount: Number(r.amount),
      status: r.status
    }))
    setRecentTransactions(next)
    return next
  }, [investmentId])

  // Opening a drill-down while the list is scrolled down would otherwise
  // leave the Breakdown header out of view -- jump back to top so it's
  // visible the instant the detail mounts.
  useEffect(() => {
    window.scrollTo(0, 0)
  }, [])

  useEffect(() => {
    let cancelled = false

    async function load() {
      // Only show the blocking loader on a true cold start -- if we
      // already rendered cached data, refresh quietly behind it instead
      // of flashing back to a spinner on every navigation.
      if (!readCache(cacheKey)) setDataLoading(true)

      const [nextInvestment, nextShares, nextRecentTransactions] = await Promise.all([
        loadInvestment(),
        loadShares(),
        loadRecentTransactions()
      ])
      if (cancelled) return
      setDataLoading(false)

      writeCache<InvestmentDetailSnapshot>(cacheKey, {
        investment: nextInvestment,
        shares: nextShares,
        recentTransactions: nextRecentTransactions
      })
    }

    if (investmentId) load()
    return () => {
      cancelled = true
    }
  }, [investmentId, member, loadInvestment, loadShares, loadRecentTransactions])

  // startClosed pre-checks the "close after distributing" box for the
  // dedicated Close Investment entry point -- same form either way, since
  // closing is just a distribution that also flips the investment's status
  // (see runDistribute). The checkbox stays editable either way, so opening
  // via either button just sets where you start.
  async function openDistribute(startClosed: boolean) {
    setShowDistributeForm(true)
    setDistributeDate(dateOnly(new Date()))
    setDistributeAmount("")
    setDistributeNotes("")
    setCloseOnDistribute(startClosed)
    setDistributeMessage("")
    await refreshSuggestedAmount(dateOnly(new Date()))
  }

  async function refreshSuggestedAmount(asOfDate: string) {
    try {
      const suggestion = await getUndistributedInvestmentGain(investmentId, asOfDate)
      setSuggestedAmount(suggestion)
    } catch (err) {
      setSuggestedAmount(null)
      setDistributeMessage(err instanceof Error ? err.message : "Couldn't compute a suggested amount.")
    }
  }

  function closeDistribute() {
    setShowDistributeForm(false)
    setDistributeMessage("")
  }

  async function runDistribute() {
    const amountNum = distributeAmount.trim() ? Number(distributeAmount) : 0
    if (Number.isNaN(amountNum)) {
      setDistributeMessage("Enter a valid amount (positive for a gain, negative for a loss).")
      return
    }
    // A regular distribution with nothing to distribute makes no sense to
    // submit, but closing with a zero remainder is a legitimate "nothing
    // left to settle, just mark it done" case -- same as a loan that
    // closes with no gain or loss.
    if (!closeOnDistribute && amountNum === 0) {
      setDistributeMessage("Enter a nonzero amount (positive for a gain, negative for a loss).")
      return
    }
    if (!distributeDate) {
      setDistributeMessage("Pick a date.")
      return
    }

    const label = amountNum < 0 ? "loss" : "gain"
    const confirmMsg = closeOnDistribute
      ? amountNum !== 0
        ? `Close this investment and record a final ₱${fmt(Math.abs(amountNum))} ${label}, split across eligible members based on their current value as of ${distributeDate}? You can reopen it later from this same page if needed.`
        : `Close this investment now with nothing left to distribute? You can reopen it later from this same page if needed.`
      : `Distribute a ₱${Math.abs(amountNum).toFixed(2)} ${label} across eligible members, based on their current value as of ${distributeDate}? This can't be undone from the app.`
    if (!confirm(confirmMsg)) return

    setDistributing(true)
    setDistributeMessage("")

    try {
      if (closeOnDistribute) {
        await closeInvestmentAndDistributeGain({
          investmentId,
          closingDate: distributeDate,
          amount: amountNum,
          notes: distributeNotes || undefined,
          investmentName: investment?.investment
        })
      } else {
        await distributeInvestmentGain({
          investmentId,
          allocationDate: distributeDate,
          amount: amountNum,
          notes: distributeNotes || undefined
        })
      }
      closeDistribute()
      const [nextShares, nextInvestment] = await Promise.all([loadShares(), loadInvestment()])
      writeCache<InvestmentDetailSnapshot>(cacheKey, {
        investment: nextInvestment,
        shares: nextShares,
        recentTransactions
      })
    } catch (err) {
      setDistributeMessage(err instanceof Error ? err.message : "Something went wrong.")
    } finally {
      setDistributing(false)
    }
  }

  async function reopenInvestment() {
    setReopening(true)
    setReopenError("")

    // Deleting the closing distribution's allocations/transactions and
    // flipping the investment back to open used to be three separate
    // client calls with no rollback between them -- a failure partway
    // through could leave the investment stuck "closed" with its gain
    // rows already gone, or vice versa. One atomic RPC now does all three;
    // it only touches rows flagged is_closing_distribution, so an
    // investment's earlier ad hoc distributions (made before it closed)
    // are untouched -- unlike a loan, which only ever distributes once, at
    // close.
    const { data: orphanedReceipts, error } = await supabase.rpc("reopen_investment", {
      p_investment_id: investmentId
    })

    if (error) {
      setReopenError(error.message)
      setReopening(false)
      return
    }

    // Gain Allocation rows are system-generated and never carry a receipt
    // today, but clean up defensively in case that ever changes -- the DB
    // state already committed by this point, so a failure here shouldn't
    // block the reopen, just leave an orphaned file to clean up later.
    if (orphanedReceipts && orphanedReceipts.length > 0) {
      await supabase.storage.from("Receipts").remove(orphanedReceipts)
    }

    setReopening(false)
    const [nextShares, nextInvestment] = await Promise.all([loadShares(), loadInvestment()])
    writeCache<InvestmentDetailSnapshot>(cacheKey, {
      investment: nextInvestment,
      shares: nextShares,
      recentTransactions
    })
  }

  const fmt = (n: number) =>
    Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })

  if (dataLoading) {
    return <SkeletonPanel />
  }

  if (notFound || !investment) {
    return (
      <div>
        <p className="text-sm text-ink-soft">This investment couldn't be found.</p>
        <button onClick={onBack} className="mt-4 text-sm font-medium text-gold">
          ← Back to Investment
        </button>
      </div>
    )
  }

  const isGain = investment.gain_loss > 0
  const isFlat = investment.gain_loss === 0

  const signedShares = shares.map((s) => ({
    ...s,
    signed: s.allocation_type === "Investment Loss" ? -s.amount : s.amount
  }))

  const totalShared = signedShares.reduce((sum, s) => sum + s.signed, 0)
  const unallocated = Number((investment.gain_loss - totalShared).toFixed(2))

  // An investment can be distributed multiple times over its life (yearly,
  // ad hoc, a final one on closing), so the same member can end up with
  // more than one allocation row here -- rolled up into one total per
  // member rather than shown as separate line items, since two distinct
  // distributions can otherwise look like an accidental duplicate (e.g.
  // splitting the same total twice against unchanged member proportions
  // produces identical per-member amounts both times). The per-event
  // breakdown -- what was distributed and when -- lives on /transactions
  // instead, via each distribution's own "Gain Allocation" entries.
  const memberTotals = new Map<string, { member_id: string; member: string; signed: number }>()
  for (const s of signedShares) {
    const existing = memberTotals.get(s.member_id)
    if (existing) existing.signed += s.signed
    else memberTotals.set(s.member_id, { member_id: s.member_id, member: s.member, signed: s.signed })
  }
  const memberShares = Array.from(memberTotals.values()).sort((a, b) =>
    isGain ? b.signed - a.signed : a.signed - b.signed
  )

  return (
    <div>
      <button onClick={onBack} className="text-[13px] text-ink-soft mb-4 hover:text-ink transition-colors">
        ← Investment
      </button>

      <div className="flex items-center gap-2 mb-1">
        <span className={`w-1.5 h-1.5 rounded-full ${isGain ? "bg-sage" : isFlat ? "bg-ink-soft" : "bg-rust"}`} />
        <span
          className={`text-[11px] font-mono uppercase tracking-wide ${
            isGain ? "text-sage" : isFlat ? "text-ink-soft" : "text-rust"
          }`}
        >
          {isGain ? "Gain" : isFlat ? "Flat" : "Loss"}
        </span>
        {investment.status === "closed" && (
          <span className="text-[11px] font-mono font-bold uppercase tracking-wide text-gold border border-gold rounded-full px-2 py-0.5">
            Closed
          </span>
        )}
      </div>
      <h1 className="font-display text-3xl sm:text-4xl font-semibold text-ink mb-1">
        {investment.investment}
      </h1>
      <p className="text-[13px] text-ink-soft mb-6">
        {investment.affects_cash ? "Funded through the tracked bank accounts" : "Funded outside the tracked cash trail"}
      </p>

      {/* Gain/loss overview */}
      <div className="bg-paper-2 border border-hairline rounded-md px-5 pt-4 pb-3.5">
        <p className="text-[11px] uppercase tracking-wide text-ink-soft font-mono mb-1.5">
          Net Gain / Loss
        </p>
        <p
          className={`font-mono [font-variant-numeric:tabular-nums] text-3xl font-bold ${
            isGain ? "text-sage" : isFlat ? "text-ink" : "text-rust"
          }`}
        >
          {investment.gain_loss < 0 ? "-" : "+"}₱{fmt(Math.abs(investment.gain_loss))}
        </p>
      </div>

      {/* Invested / Returned */}
      <div className="bg-paper-2 border border-hairline rounded-md p-5 mt-4">
        <InfoBox label="Cash Flow">
          <InfoRow label="Invested" value={`₱${fmt(investment.invested)}`} />
          <InfoRow label="Returned" value={`₱${fmt(investment.returned)}`} />
          <InfoRow
            label="Net"
            value={`${investment.gain_loss < 0 ? "-" : "+"}₱${fmt(Math.abs(investment.gain_loss))}`}
            valueClass={isGain ? "text-sage" : isFlat ? "text-ink" : "text-rust"}
            bold
          />
          {investment.status === "closed" && investment.closed_date && (
            <InfoRow
              label="Closed"
              value={new Date(`${investment.closed_date}T00:00:00`).toLocaleDateString(undefined, {
                month: "long",
                day: "numeric",
                year: "numeric"
              })}
            />
          )}
        </InfoBox>
      </div>

      {/* Gain/loss share per member */}
      <section className="mt-8">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h2 className="font-display text-lg font-medium text-ink mb-1">Distributed Share per Member</h2>
            <p className="text-[13px] text-ink-soft mb-3">
              How this investment's {isGain ? "gain" : "loss"} is split across members.
            </p>
          </div>

          {isAdmin && investment.status === "open" && (
            <div className="flex items-center gap-2 flex-wrap mb-3">
              <button
                className="shrink-0 bg-gold-soft text-ink px-4 py-2 rounded-sm text-sm font-semibold shadow-sm hover:opacity-90 transition-opacity flex items-center gap-1.5"
                onClick={() => openDistribute(false)}
              >
                <span className="text-lg leading-none">+</span>
                Distribute Gain/Loss
              </button>
              <button
                className="shrink-0 border border-hairline text-ink-soft px-4 py-2 rounded-sm text-sm font-medium"
                onClick={() => openDistribute(true)}
              >
                Close Investment
              </button>
            </div>
          )}

          {isAdmin && investment.status === "closed" && (
            <div className="flex flex-col items-end gap-1.5 mb-3">
              <button
                className="shrink-0 text-xs text-ink-soft border border-hairline rounded-sm px-3 py-2 disabled:opacity-50"
                onClick={() => {
                  const confirmMsg =
                    "Reopen this investment? This sets it back to open and removes the final gain/loss distribution recorded when it was closed -- any earlier distributions stay as they are."
                  if (confirm(confirmMsg)) {
                    reopenInvestment()
                  }
                }}
                disabled={reopening}
              >
                {reopening ? "Reopening..." : "Reopen Investment"}
              </button>
              {reopenError && <p className="text-xs text-rust">{reopenError}</p>}
            </div>
          )}
        </div>

        {isAdmin && unallocated !== 0 && (
          <p className="text-[12px] text-gold mb-3">
            ₱{fmt(Math.abs(unallocated))} {unallocated > 0 ? "gain" : "loss"} still unallocated.
          </p>
        )}

        {showDistributeForm && (
          <DistributeForm
            date={distributeDate}
            setDate={async (d) => {
              setDistributeDate(d)
              await refreshSuggestedAmount(d)
            }}
            amount={distributeAmount}
            setAmount={setDistributeAmount}
            notes={distributeNotes}
            setNotes={setDistributeNotes}
            closeOnDistribute={closeOnDistribute}
            suggestedAmount={suggestedAmount}
            distributing={distributing}
            message={distributeMessage}
            onSave={runDistribute}
            onCancel={closeDistribute}
            className="mb-4"
          />
        )}

        {loadError && <p className="text-sm text-rust mb-3">{loadError}</p>}

        {memberShares.length > 0 && (
          <div className="bg-paper-2 border border-hairline rounded-md px-5 mb-3">
            {memberShares.map((s, i) => (
              <div
                key={s.member_id}
                className={`py-3 flex justify-between items-center gap-3 ${
                  i !== memberShares.length - 1 ? "border-b border-dashed border-hairline" : ""
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
                <p
                  className={`shrink-0 font-mono [font-variant-numeric:tabular-nums] text-sm font-semibold ${
                    s.signed < 0 ? "text-rust" : "text-sage"
                  }`}
                >
                  {s.signed < 0 ? "-" : "+"}₱{fmt(Math.abs(s.signed))}
                </p>
              </div>
            ))}
          </div>
        )}

        {memberShares.length > 0 && (
          <div className="bg-paper-2 border border-hairline rounded-md px-5 py-3 flex justify-between items-center">
            <p className="text-[11px] uppercase tracking-wide text-ink-soft font-mono">
              Split among {memberShares.length} member{memberShares.length === 1 ? "" : "s"} total
            </p>
            <p
              className={`font-mono [font-variant-numeric:tabular-nums] text-[13px] font-semibold ${
                totalShared < 0 ? "text-rust" : "text-sage"
              }`}
            >
              {totalShared < 0 ? "-" : "+"}₱{fmt(Math.abs(totalShared))}
            </p>
          </div>
        )}

        {memberShares.length === 0 && !loadError && !showDistributeForm && (
          <p className="text-sm text-ink-soft text-center py-8 bg-paper-2 border border-hairline rounded-md">
            No allocation on record for this investment.
          </p>
        )}
      </section>

      {/* Recent transactions */}
      <section className="mt-8">
        <div className="flex items-baseline justify-between gap-3 mb-3">
          <h2 className="font-display text-lg font-medium text-ink">Recent Transactions</h2>
          <button
            onClick={() => router.push(`/transactions?investment=${investmentId}`)}
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
                    {new Date(t.date.length === 10 ? `${t.date}T00:00:00` : t.date).toLocaleDateString(
                      undefined,
                      { day: "numeric", month: "short", year: "numeric" }
                    )}
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
            No transactions recorded for this investment yet.
          </p>
        )}
      </section>
    </div>
  )
}

function DistributeForm({
  date,
  setDate,
  amount,
  setAmount,
  notes,
  setNotes,
  closeOnDistribute,
  suggestedAmount,
  distributing,
  message,
  onSave,
  onCancel,
  className = ""
}: {
  date: string
  setDate: (v: string) => void
  amount: string
  setAmount: (v: string) => void
  notes: string
  setNotes: (v: string) => void
  closeOnDistribute: boolean
  suggestedAmount: number | null
  distributing: boolean
  message: string
  onSave: () => void
  onCancel: () => void
  className?: string
}) {
  const fmt = (n: number) =>
    Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })

  return (
    <div className={`bg-paper-2 border border-hairline rounded-md relative overflow-hidden ${className}`}>
      <div className="absolute left-0 top-0 bottom-0 w-[3px] bg-gold" />
      <div className="pl-6 pr-5 py-6 space-y-4">
        <p className="font-display text-lg font-medium">
          {closeOnDistribute ? "Close Investment" : "Distribute Gain/Loss"}
        </p>
        <p className="text-[13px] text-ink-soft">
          {closeOnDistribute
            ? "Distributes whatever's left to settle, proportional to each member's current value as of the date below, and marks this investment closed. A zero amount is fine if there's nothing left to distribute."
            : "Splits a realized amount across eligible members, proportional to each member's current value as of the date below. Positive for a gain, negative for a loss."}
        </p>

        <div>
          <label className="block mb-2 text-xs uppercase tracking-wide text-ink-soft font-mono">Date</label>
          <input
            className="border border-hairline bg-paper text-ink text-sm rounded-sm px-3 py-3 w-full font-mono"
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </div>

        <div>
          <label className="block mb-2 text-xs uppercase tracking-wide text-ink-soft font-mono">Amount</label>
          <input
            className="border border-hairline bg-paper text-ink text-sm rounded-sm px-3 py-3 w-full font-mono [font-variant-numeric:tabular-nums]"
            type="number"
            step="0.01"
            placeholder="0.00"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
          {suggestedAmount !== null && suggestedAmount !== 0 && (
            <button
              type="button"
              className="mt-1.5 text-[11px] text-gold"
              onClick={() => setAmount(String(suggestedAmount))}
            >
              Use undistributed amount as of this date: {suggestedAmount < 0 ? "-" : "+"}₱{fmt(Math.abs(suggestedAmount))}
            </button>
          )}
        </div>

        <div>
          <label className="block mb-2 text-xs uppercase tracking-wide text-ink-soft font-mono">
            Notes (optional)
          </label>
          <input
            className="border border-hairline bg-paper text-ink text-sm rounded-sm px-3 py-3 w-full"
            placeholder="Additional notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </div>

        <div className="flex gap-3">
          <button
            className="bg-ink text-paper px-4 py-3 rounded-sm text-sm font-medium flex-1 disabled:opacity-50"
            onClick={onSave}
            disabled={distributing}
          >
            {distributing
              ? closeOnDistribute
                ? "Closing & distributing..."
                : "Distributing..."
              : closeOnDistribute
              ? "Close & Distribute"
              : "Distribute"}
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
