"use client"

import { useCallback, useEffect, useState } from "react"
import { useRouter, useParams } from "next/navigation"
import { supabase } from "@/lib/supabase"
import Navbar from "@/app/components/Navbar"
import { useAuth } from "@/app/auth-context"
import { SkeletonPanel } from "@/app/components/Skeleton"
import { distributeInvestmentGain, getUndistributedInvestmentGain } from "@/lib/distributeInvestment"
import { dateOnly } from "@/lib/currentValue"

type Investment = {
  investment_id: string
  investment: string
  affects_cash: number
  invested: number
  returned: number
  gain_loss: number
}

type Share = {
  id: string
  member_id: string
  member: string
  amount: number
  allocation_type: string
  notes: string | null
  allocation_date: string | null
}

type RecentTransaction = {
  transaction_id: string
  date: string
  classification: string
  amount: number
  status: string
}

const ALLOCATION_TYPES = ["Investment Gain", "Investment Loss"]

const TXN_TYPE_LABELS: Record<string, string> = {
  Investment: "Investment",
  "Investment Return": "Investment Return",
  "Gain Allocation": "Investment Allocation"
}

export default function InvestmentDetailPage() {
  const router = useRouter()
  const params = useParams()
  const investmentId = params?.id as string

  const { loading: authLoading, member } = useAuth()
  const isAdmin = member?.role === "admin"
  const [dataLoading, setDataLoading] = useState(true)
  const checkingAccess = authLoading || dataLoading
  const [investment, setInvestment] = useState<Investment | null>(null)
  const [shares, setShares] = useState<Share[]>([])
  const [recentTransactions, setRecentTransactions] = useState<RecentTransaction[]>([])
  const [allMembers, setAllMembers] = useState<any[]>([])
  const myMemberId = member?.member_id ?? null
  const [notFound, setNotFound] = useState(false)
  const [loadError, setLoadError] = useState("")

  const [manageMode, setManageMode] = useState(false)
  const [showAddForm, setShowAddForm] = useState(false)
  const [editingShareId, setEditingShareId] = useState<string | null>(null)
  const [formMemberId, setFormMemberId] = useState("")
  const [formAllocationType, setFormAllocationType] = useState("Investment Gain")
  const [formAmount, setFormAmount] = useState("")
  const [formNotes, setFormNotes] = useState("")
  const [saving, setSaving] = useState(false)
  const [formMessage, setFormMessage] = useState("")
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const [showDistributeForm, setShowDistributeForm] = useState(false)
  const [distributeDate, setDistributeDate] = useState(dateOnly(new Date()))
  const [distributeAmount, setDistributeAmount] = useState("")
  const [distributeNotes, setDistributeNotes] = useState("")
  const [distributing, setDistributing] = useState(false)
  const [distributeMessage, setDistributeMessage] = useState("")
  const [suggestedAmount, setSuggestedAmount] = useState<number | null>(null)

  const loadShares = useCallback(async () => {
    // Per-member split, per Section 8: Perfume Biz is a flat equal
    // split across all 10 members; Farmon's realized loss is spread
    // across 9 (Yabie isn't allocated a share, a pre-existing artifact
    // of this table's history, not something decided in this pass).
    // allocation_type tells us whether the row is a gain or a loss so
    // the sign can be applied for display.
    const { data, error } = await supabase
      .from("investment_allocations")
      .select("id, amount, allocation_type, member_id, notes, allocation_date, members(name)")
      .eq("investment_id", investmentId)

    if (!error && data) {
      setShares(
        data.map((r: any) => ({
          id: r.id,
          member_id: r.member_id,
          member: r.members?.name ?? "Unknown",
          amount: Number(r.amount),
          allocation_type: r.allocation_type,
          notes: r.notes ?? null,
          allocation_date: r.allocation_date ?? null
        }))
      )
      setLoadError("")
    } else if (error) {
      setLoadError(error.message)
    }
  }, [investmentId])

  const loadRecentTransactions = useCallback(async () => {
    // Most recent 5 transactions tied to this investment (Investment,
    // Investment Return, and any Gain Allocation distributed against it),
    // newest first -- a quick "what's happened lately" glance, with a link
    // to the full ledger (pre-filtered to this investment) for the rest.
    const { data } = await supabase
      .from("transactions")
      .select("transaction_id, txn_date, created_at, classification, amount, status")
      .eq("investment_id", investmentId)
      .neq("status", "cancelled")
      .order("txn_date", { ascending: false, nullsFirst: false })
      .order("created_at", { ascending: false })
      .limit(5)

    setRecentTransactions(
      (data ?? []).map((r) => ({
        transaction_id: r.transaction_id,
        date: r.txn_date ?? r.created_at,
        classification: r.classification,
        amount: Number(r.amount),
        status: r.status
      }))
    )
  }, [investmentId])

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
      const investmentPromise = supabase
        .from("v_investment_summary")
        .select("*")
        .eq("investment_id", investmentId)
        .single()

      const membersPromise =
        member?.role === "admin"
          ? supabase
              .from("members")
              .select("member_id, name")
              .order("name")
              .then(({ data }) => setAllMembers(data ?? []))
          : Promise.resolve()

      const [investmentResult] = await Promise.all([
        investmentPromise,
        loadShares(),
        loadRecentTransactions(),
        membersPromise
      ])

      if (investmentResult.error || !investmentResult.data) {
        setNotFound(true)
      } else {
        setInvestment(investmentResult.data as Investment)
      }

      setDataLoading(false)
    }

    if (investmentId) load()
  }, [investmentId, authLoading, member, router, loadShares, loadRecentTransactions])

  function clearForm() {
    setShowAddForm(false)
    setEditingShareId(null)
    setFormMemberId("")
    setFormAllocationType("Investment Gain")
    setFormAmount("")
    setFormNotes("")
    setFormMessage("")
  }

  function startAdd() {
    clearForm()
    setShowAddForm(true)
  }

  async function openDistribute() {
    clearForm()
    setShowAddForm(false)
    setShowDistributeForm(true)
    setDistributeDate(dateOnly(new Date()))
    setDistributeAmount("")
    setDistributeNotes("")
    setDistributeMessage("")
    await refreshSuggestedAmount(dateOnly(new Date()))
  }

  async function refreshSuggestedAmount(asOfDate: string) {
    const suggestion = await getUndistributedInvestmentGain(investmentId, asOfDate)
    setSuggestedAmount(suggestion)
  }

  function closeDistribute() {
    setShowDistributeForm(false)
    setDistributeMessage("")
  }

  async function runDistribute() {
    const amountNum = Number(distributeAmount)
    if (!distributeAmount.trim() || Number.isNaN(amountNum) || amountNum === 0) {
      setDistributeMessage("Enter a nonzero amount (positive for a gain, negative for a loss).")
      return
    }
    if (!distributeDate) {
      setDistributeMessage("Pick a date.")
      return
    }

    const label = amountNum < 0 ? "loss" : "gain"
    const confirmMsg = `Distribute a ₱${Math.abs(amountNum).toFixed(2)} ${label} across eligible members, based on their current value as of ${distributeDate}? This can't be undone from the app.`
    if (!confirm(confirmMsg)) return

    setDistributing(true)
    setDistributeMessage("")

    try {
      await distributeInvestmentGain({
        investmentId,
        allocationDate: distributeDate,
        amount: amountNum,
        notes: distributeNotes || undefined
      })
      closeDistribute()
      await loadShares()
    } catch (err) {
      setDistributeMessage(err instanceof Error ? err.message : "Something went wrong.")
    } finally {
      setDistributing(false)
    }
  }

  function startEdit(share: Share) {
    clearForm()
    setEditingShareId(share.id)
    setFormMemberId(share.member_id)
    setFormAllocationType(share.allocation_type)
    setFormAmount(String(share.amount))
    setFormNotes(share.notes ?? "")
  }

  async function saveShare() {
    if (!formMemberId) {
      setFormMessage("Select a member.")
      return
    }

    const amountNum = Number(formAmount)
    if (!formAmount.trim() || Number.isNaN(amountNum) || amountNum <= 0) {
      setFormMessage("Enter a valid amount greater than zero.")
      return
    }

    setSaving(true)

    const payload = {
      investment_id: investmentId,
      member_id: formMemberId,
      allocation_type: formAllocationType,
      amount: amountNum,
      notes: formNotes || null
    }

    const { error } = editingShareId
      ? await supabase.from("investment_allocations").update(payload).eq("id", editingShareId)
      : await supabase.from("investment_allocations").insert(payload)

    setSaving(false)

    if (error) {
      setFormMessage(error.message)
      return
    }

    clearForm()
    await loadShares()
  }

  async function deleteShare(id: string) {
    if (!confirm("Remove this member's share? This can't be undone.")) return

    setDeletingId(id)
    const { error } = await supabase.from("investment_allocations").delete().eq("id", id)
    setDeletingId(null)

    if (error) {
      setLoadError(error.message)
      return
    }

    if (editingShareId === id) clearForm()
    await loadShares()
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

  if (notFound || !investment) {
    return (
      <>
        <Navbar />
        <main className="min-h-screen bg-paper text-ink font-sans overflow-x-hidden">
          <div className="max-w-3xl mx-auto px-4 sm:px-5 pt-8">
            <p className="text-sm text-ink-soft">This investment couldn't be found.</p>
            <button
              onClick={() => router.push("/investment")}
              className="mt-4 text-sm font-medium text-gold"
            >
              ← Back to Investment
            </button>
          </div>
        </main>
      </>
    )
  }

  const isGain = investment.gain_loss > 0
  const isFlat = investment.gain_loss === 0

  const signedShares = shares
    .map((s) => ({ ...s, signed: s.allocation_type === "Investment Loss" ? -s.amount : s.amount }))
    .sort((a, b) => (isGain ? b.signed - a.signed : a.signed - b.signed))

  const totalShared = signedShares.reduce((sum, s) => sum + s.signed, 0)
  const unallocated = Number((investment.gain_loss - totalShared).toFixed(2))

  // Group per-member rows by distribution event (allocation_date) -- a
  // still-open investment can be distributed multiple times over its life
  // (yearly, ad hoc, etc.), so the flat member list is broken into one
  // section per event, newest first. Legacy rows predating allocation_date
  // tracking have no event to group under.
  const dateGroups = new Map<string, typeof signedShares>()
  for (const s of signedShares) {
    const key = s.allocation_date ?? "legacy"
    const bucket = dateGroups.get(key)
    if (bucket) bucket.push(s)
    else dateGroups.set(key, [s])
  }
  const groupKeys = Array.from(dateGroups.keys()).sort((a, b) => {
    if (a === "legacy") return 1
    if (b === "legacy") return -1
    return b.localeCompare(a)
  })
  const shareGroups = groupKeys.map((key) => {
    const groupShares = dateGroups.get(key)!
    return {
      key,
      label:
        key === "legacy"
          ? "Undated (legacy)"
          : new Date(`${key}T00:00:00`).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }),
      shares: groupShares,
      subtotal: groupShares.reduce((sum, s) => sum + s.signed, 0)
    }
  })

  return (
    <>
      <Navbar />
      <main className="min-h-screen bg-paper text-ink font-sans overflow-x-hidden">
        <div className="max-w-3xl mx-auto px-4 sm:px-5 pt-8 pb-[calc(3rem+env(safe-area-inset-bottom))]">
          <button
            onClick={() => router.push("/investment")}
            className="text-[13px] text-ink-soft mb-4 hover:text-ink transition-colors"
          >
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
          </div>
          <h1 className="font-display text-3xl sm:text-4xl font-semibold text-ink mb-1">
            {investment.investment}
          </h1>
          <p className="text-[13px] text-ink-soft mb-6">
            {investment.affects_cash ? "Funded through the tracked bank accounts" : "Funded outside the tracked bank trail"}
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
            </InfoBox>
          </div>

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

          {/* Gain/loss share per member */}
          <section className="mt-8">
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div>
                <h2 className="font-display text-lg font-medium text-ink mb-1">
                  {isGain ? "Gain" : "Loss"} Share per Member
                </h2>
                <p className="text-[13px] text-ink-soft mb-3">
                  How this investment's {isGain ? "gain" : "loss"} is split across members.
                </p>
              </div>

              {isAdmin && (
                <div className="flex items-center gap-2 flex-wrap mb-3">
                  {manageMode ? (
                    <button
                      className="bg-ink text-paper px-4 py-2 rounded-sm text-sm font-medium shrink-0"
                      onClick={() => {
                        setManageMode(false)
                        clearForm()
                      }}
                    >
                      Done
                    </button>
                  ) : (
                    <button
                      className="border border-hairline text-ink-soft px-4 py-2 rounded-sm text-sm font-medium shrink-0"
                      onClick={() => {
                        setManageMode(true)
                        clearForm()
                      }}
                    >
                      Manage
                    </button>
                  )}
                  <button
                    className="shrink-0 bg-gold text-ink px-4 py-2 rounded-sm text-sm font-semibold shadow-sm hover:opacity-90 transition-opacity flex items-center gap-1.5"
                    onClick={openDistribute}
                  >
                    <span className="text-lg leading-none">+</span>
                    Distribute Gain/Loss
                  </button>
                  <button
                    className="shrink-0 border border-hairline text-ink-soft px-4 py-2 rounded-sm text-sm font-medium"
                    onClick={startAdd}
                  >
                    Add Share
                  </button>
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
                suggestedAmount={suggestedAmount}
                distributing={distributing}
                message={distributeMessage}
                onSave={runDistribute}
                onCancel={closeDistribute}
                className="mb-4"
              />
            )}

            {showAddForm && (
              <ShareForm
                title="Add Share"
                members={allMembers}
                memberId={formMemberId}
                setMemberId={setFormMemberId}
                allocationType={formAllocationType}
                setAllocationType={setFormAllocationType}
                amount={formAmount}
                setAmount={setFormAmount}
                notes={formNotes}
                setNotes={setFormNotes}
                saving={saving}
                message={formMessage}
                onSave={saveShare}
                onCancel={clearForm}
                saveLabel="Add Share"
                className="mb-4"
              />
            )}

            {loadError && <p className="text-sm text-rust mb-3">{loadError}</p>}

            {shareGroups.map((group) => (
              <div key={group.key} className="bg-paper-2 border border-hairline rounded-md mb-3">
                <div className="px-5 py-2.5 border-b border-hairline flex justify-between items-center">
                  <p className="text-[11px] uppercase tracking-wide text-ink-soft font-mono">{group.label}</p>
                  <p
                    className={`font-mono [font-variant-numeric:tabular-nums] text-[12px] font-semibold ${
                      group.subtotal < 0 ? "text-rust" : "text-sage"
                    }`}
                  >
                    {group.subtotal < 0 ? "-" : "+"}₱{fmt(Math.abs(group.subtotal))}
                  </p>
                </div>
                <div className="px-5">
                  {group.shares.map((s, i) => (
                    <div key={s.id}>
                      <div
                        className={`py-3 flex justify-between items-center gap-3 ${
                          i !== group.shares.length - 1 || (isAdmin && manageMode) ? "border-b border-dashed border-hairline" : ""
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
                        <div className="flex items-center gap-2 shrink-0">
                          <p
                            className={`font-mono [font-variant-numeric:tabular-nums] text-sm font-semibold ${
                              s.signed < 0 ? "text-rust" : "text-sage"
                            }`}
                          >
                            {s.signed < 0 ? "-" : "+"}₱{fmt(Math.abs(s.signed))}
                          </p>
                          {isAdmin && manageMode && (
                            <div className="flex items-center gap-1.5">
                              <button
                                onClick={() => startEdit(s)}
                                className="text-[11px] text-ink-soft border border-hairline rounded-sm px-2 py-1"
                              >
                                Edit
                              </button>
                              <button
                                onClick={() => deleteShare(s.id)}
                                disabled={deletingId === s.id}
                                className="text-[11px] text-rust border border-rust/40 rounded-sm px-2 py-1 disabled:opacity-50"
                              >
                                {deletingId === s.id ? "…" : "Remove"}
                              </button>
                            </div>
                          )}
                        </div>
                      </div>

                      {editingShareId === s.id && (
                        <div className="pb-4">
                          <ShareForm
                            title="Edit Share"
                            members={allMembers}
                            memberId={formMemberId}
                            setMemberId={setFormMemberId}
                            allocationType={formAllocationType}
                            setAllocationType={setFormAllocationType}
                            amount={formAmount}
                            setAmount={setFormAmount}
                            notes={formNotes}
                            setNotes={setFormNotes}
                            saving={saving}
                            message={formMessage}
                            onSave={saveShare}
                            onCancel={clearForm}
                            saveLabel="Save Changes"
                          />
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ))}

            {signedShares.length > 0 && (
              <div className="bg-paper-2 border border-hairline rounded-md px-5 py-3 flex justify-between items-center">
                <p className="text-[11px] uppercase tracking-wide text-ink-soft font-mono">
                  Split among {signedShares.length} member{signedShares.length === 1 ? "" : "s"} total
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

            {signedShares.length === 0 && !loadError && !showAddForm && !showDistributeForm && (
              <p className="text-sm text-ink-soft text-center py-8 bg-paper-2 border border-hairline rounded-md">
                No allocation on record for this investment.
              </p>
            )}
          </section>
        </div>
      </main>
    </>
  )
}

function DistributeForm({
  date,
  setDate,
  amount,
  setAmount,
  notes,
  setNotes,
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
        <p className="font-display text-lg font-medium">Distribute Gain/Loss</p>
        <p className="text-[13px] text-ink-soft">
          Splits a realized amount across eligible members, proportional to each member&apos;s current value as of
          the date below. Positive for a gain, negative for a loss.
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
            placeholder="Add a note"
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
            {distributing ? "Distributing..." : "Distribute"}
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

function ShareForm({
  title,
  members,
  memberId,
  setMemberId,
  allocationType,
  setAllocationType,
  amount,
  setAmount,
  notes,
  setNotes,
  saving,
  message,
  onSave,
  onCancel,
  saveLabel,
  className = ""
}: {
  title: string
  members: any[]
  memberId: string
  setMemberId: (v: string) => void
  allocationType: string
  setAllocationType: (v: string) => void
  amount: string
  setAmount: (v: string) => void
  notes: string
  setNotes: (v: string) => void
  saving: boolean
  message: string
  onSave: () => void
  onCancel: () => void
  saveLabel: string
  className?: string
}) {
  return (
    <div className={`bg-paper-2 border border-hairline rounded-md relative overflow-hidden ${className}`}>
      <div className="absolute left-0 top-0 bottom-0 w-[3px] bg-gold" />
      <div className="pl-6 pr-5 py-6 space-y-4">
        <p className="font-display text-lg font-medium">{title}</p>

        <div>
          <label className="block mb-2 text-xs uppercase tracking-wide text-ink-soft font-mono">
            Member
          </label>
          <select
            className="border border-hairline bg-paper text-ink text-sm rounded-sm px-3 py-3 w-full"
            value={memberId}
            onChange={(e) => setMemberId(e.target.value)}
          >
            <option value="">Select a member</option>
            {members.map((m) => (
              <option key={m.member_id} value={m.member_id}>
                {m.name}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block mb-2 text-xs uppercase tracking-wide text-ink-soft font-mono">
            Type
          </label>
          <div className="flex border border-hairline rounded-sm overflow-hidden">
            {ALLOCATION_TYPES.map((type) => (
              <button
                key={type}
                type="button"
                onClick={() => setAllocationType(type)}
                className={`flex-1 text-sm font-semibold py-2.5 transition-colors ${
                  allocationType === type ? "bg-ink text-paper" : "bg-paper text-ink-soft"
                }`}
              >
                {type === "Investment Gain" ? "Gain" : "Loss"}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="block mb-2 text-xs uppercase tracking-wide text-ink-soft font-mono">
            Amount
          </label>
          <input
            className="border border-hairline bg-paper text-ink text-sm rounded-sm px-3 py-3 w-full font-mono [font-variant-numeric:tabular-nums]"
            type="number"
            min="0.01"
            step="0.01"
            placeholder="0.00"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </div>

        <div>
          <label className="block mb-2 text-xs uppercase tracking-wide text-ink-soft font-mono">
            Notes (optional)
          </label>
          <input
            className="border border-hairline bg-paper text-ink text-sm rounded-sm px-3 py-3 w-full"
            placeholder="Add a note"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
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
