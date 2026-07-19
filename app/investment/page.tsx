"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { supabase } from "@/lib/supabase"
import Navbar from "@/app/components/Navbar"
import { useAuth } from "@/app/auth-context"
import { SkeletonCardList } from "@/app/components/Skeleton"

type Investment = {
  investment_id: string
  investment: string
  affects_cash: number
  invested: number
  returned: number
  gain_loss: number
}

export default function InvestmentsPage() {
  const router = useRouter()
  const { loading: authLoading, member } = useAuth()
  const isAdmin = member?.role === "admin"
  const [dataLoading, setDataLoading] = useState(true)
  const checkingAccess = authLoading || dataLoading
  const [investments, setInvestments] = useState<Investment[]>([])
  const [loadError, setLoadError] = useState("")

  const [manageMode, setManageMode] = useState(false)
  const [showAddForm, setShowAddForm] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [name, setName] = useState("")
  const [affectsCash, setAffectsCash] = useState(true)
  const [saving, setSaving] = useState(false)
  const [formMessage, setFormMessage] = useState("")

  async function load() {
    // v_investment_summary: invested/returned per Section 8's sign
    // convention, gain_loss = returned - invested. Works the same for
    // Perfume Biz's real cash round-trip and Farmon's realized-loss
    // lines (which always return 0) without special-casing either.
    const { data, error } = await supabase
      .from("v_investment_summary")
      .select("*")
      .order("investment")

    if (error) {
      setLoadError(error.message)
    } else {
      setInvestments((data as Investment[]) ?? [])
    }

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

    load()
  }, [authLoading, member, router])

  function clearForm() {
    setShowAddForm(false)
    setEditingId(null)
    setName("")
    setAffectsCash(true)
    setFormMessage("")
  }

  function startAdd() {
    clearForm()
    setShowAddForm(true)
  }

  function startEdit(inv: Investment) {
    clearForm()
    setEditingId(inv.investment_id)
    setName(inv.investment ?? "")
    setAffectsCash(!!inv.affects_cash)
  }

  async function saveInvestment() {
    if (!name.trim()) {
      setFormMessage("Enter an investment name.")
      return
    }

    setSaving(true)

    if (editingId) {
      const { error } = await supabase
        .from("investments")
        .update({ name, affects_cash: affectsCash ? 1 : 0 })
        .eq("investment_id", editingId)

      setSaving(false)
      if (error) {
        setFormMessage(error.message)
        return
      }
    } else {
      const { error } = await supabase.from("investments").insert({
        name,
        affects_cash: affectsCash ? 1 : 0
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
            <SkeletonCardList rows={4} />
          </div>
        </main>
      </>
    )
  }

  const gains = investments.filter((i) => i.gain_loss > 0).sort((a, b) => b.gain_loss - a.gain_loss)
  const losses = investments.filter((i) => i.gain_loss <= 0).sort((a, b) => a.gain_loss - b.gain_loss)
  const netTotal = investments.reduce((sum, i) => sum + i.gain_loss, 0)

  function renderInvestmentGroup(inv: Investment) {
    const isEditingThis = isAdmin && manageMode && editingId === inv.investment_id

    return (
      <div key={inv.investment_id}>
        <InvestmentCard
          inv={inv}
          fmt={fmt}
          onClick={() => router.push(`/investment/${inv.investment_id}`)}
          showEdit={isAdmin && manageMode}
          fused={isEditingThis}
          onEdit={() => startEdit(inv)}
        />
        {isEditingThis && (
          <InvestmentForm
            title="Edit Investment"
            name={name}
            setName={setName}
            affectsCash={affectsCash}
            setAffectsCash={setAffectsCash}
            saving={saving}
            message={formMessage}
            onSave={saveInvestment}
            onCancel={() => setEditingId(null)}
            saveLabel="Save Changes"
            fused
          />
        )}
      </div>
    )
  }

  return (
    <>
      <Navbar />
      <main className="min-h-screen bg-paper text-ink font-sans overflow-x-hidden">
        <div className="max-w-3xl mx-auto px-4 sm:px-5 pt-8 pb-[calc(3rem+env(safe-area-inset-bottom))]">
          <div className="text-[11px] tracking-[0.18em] uppercase text-gold font-mono mb-2">
            Fund investments
          </div>

          <h1 className="font-display text-3xl sm:text-4xl font-semibold text-ink mb-1">Investments</h1>
          <p className="text-[13px] text-ink-soft mb-4">
            Every venture the fund has put money into, and how it turned out.
          </p>

          {isAdmin && (
            <div className="flex items-center gap-2 flex-wrap mb-5">
              {manageMode ? (
                <button
                  className="bg-ink text-paper px-4 py-2.5 rounded-sm text-sm font-medium shrink-0"
                  onClick={() => {
                    setManageMode(false)
                    setEditingId(null)
                  }}
                >
                  Done
                </button>
              ) : (
                <button
                  className="border border-hairline text-ink-soft px-4 py-2.5 rounded-sm text-sm font-medium shrink-0"
                  onClick={() => setManageMode(true)}
                >
                  Manage
                </button>
              )}
              <button
                className="shrink-0 bg-gold text-ink px-4 py-2.5 rounded-sm text-sm font-semibold shadow-sm hover:opacity-90 transition-opacity flex items-center gap-1.5"
                onClick={startAdd}
              >
                <span className="text-lg leading-none">+</span>
                Add Investment
              </button>
            </div>
          )}

          {showAddForm && (
            <InvestmentForm
              title="Add Investment"
              name={name}
              setName={setName}
              affectsCash={affectsCash}
              setAffectsCash={setAffectsCash}
              saving={saving}
              message={formMessage}
              onSave={saveInvestment}
              onCancel={clearForm}
              saveLabel="Add Investment"
              className="mb-6"
            />
          )}

          {!loadError && investments.length > 0 && (
            <div className="bg-paper-2 border border-hairline rounded-md px-5 pt-4 pb-3.5 mb-6">
              <p className="text-[11px] uppercase tracking-wide text-ink-soft font-mono mb-1.5">
                Net Position
              </p>
              <p
                className={`font-mono [font-variant-numeric:tabular-nums] text-3xl font-bold ${
                  netTotal > 0 ? "text-sage" : netTotal < 0 ? "text-rust" : "text-ink"
                }`}
              >
                {netTotal < 0 ? "-" : "+"}₱{fmt(Math.abs(netTotal))}
              </p>
              <p className="text-[11px] text-ink-soft mt-1">
                across {investments.length} investment{investments.length === 1 ? "" : "s"}
              </p>
            </div>
          )}

          {loadError && <p className="mb-4 text-sm text-rust">Couldn't load investments: {loadError}</p>}

          {!loadError && investments.length === 0 && (
            <p className="text-sm text-ink-soft text-center py-12">No investments on record yet.</p>
          )}

          {gains.length > 0 && (
            <section className="mb-7">
              <h2 className="text-[11px] uppercase tracking-[0.1em] text-ink-soft font-mono mb-3">
                Gains
              </h2>
              <div className="flex flex-col gap-3">{gains.map(renderInvestmentGroup)}</div>
            </section>
          )}

          {losses.length > 0 && (
            <section>
              <h2 className="text-[11px] uppercase tracking-[0.1em] text-ink-soft font-mono mb-3">
                Losses
              </h2>
              <div className="flex flex-col gap-3">{losses.map(renderInvestmentGroup)}</div>
            </section>
          )}
        </div>
      </main>
    </>
  )
}

function InvestmentCard({
  inv,
  fmt,
  onClick,
  showEdit,
  fused,
  onEdit
}: {
  inv: Investment
  fmt: (n: number) => string
  onClick: () => void
  showEdit: boolean
  fused: boolean
  onEdit: () => void
}) {
  const isGain = inv.gain_loss > 0
  const isFlat = inv.gain_loss === 0
  const magnitudePct = inv.invested > 0 ? Math.min(100, (Math.abs(inv.gain_loss) / inv.invested) * 100) : 0

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
          <p className="font-display text-[17px] font-semibold text-ink truncate">{inv.investment}</p>
          <p className="text-[12px] text-ink-soft">₱{fmt(inv.invested)} invested</p>
        </div>
        <div className="shrink-0 flex items-center gap-2">
          <div className="flex items-center gap-1.5">
            <span className={`w-1.5 h-1.5 rounded-full ${isGain ? "bg-sage" : isFlat ? "bg-ink-soft" : "bg-rust"}`} />
            <span
              className={`text-[11px] font-mono uppercase tracking-wide ${
                isGain ? "text-sage" : isFlat ? "text-ink-soft" : "text-rust"
              }`}
            >
              {isGain ? "Gain" : isFlat ? "Flat" : "Loss"}
            </span>
          </div>
          {showEdit ? (
            <button
              onClick={(e) => {
                e.stopPropagation()
                onEdit()
              }}
              className="text-[11px] text-ink-soft border border-hairline rounded-sm px-2.5 py-1.5"
            >
              Edit
            </button>
          ) : (
            <span className="text-ink-soft">→</span>
          )}
        </div>
      </div>

      <div className="flex items-baseline justify-between mt-3.5">
        <div>
          <p className="text-[10px] uppercase tracking-wide text-ink-soft font-mono">Returned</p>
          <p className="font-mono [font-variant-numeric:tabular-nums] text-sm font-semibold text-ink">
            ₱{fmt(inv.returned)}
          </p>
        </div>
        <div className="text-right">
          <p className="text-[10px] uppercase tracking-wide text-ink-soft font-mono">Gain / Loss</p>
          <p
            className={`font-mono [font-variant-numeric:tabular-nums] text-sm font-semibold ${
              isGain ? "text-sage" : isFlat ? "text-ink" : "text-rust"
            }`}
          >
            {inv.gain_loss < 0 ? "-" : "+"}₱{fmt(Math.abs(inv.gain_loss))}
          </p>
        </div>
      </div>

      <div className="h-1.5 rounded-full bg-hairline overflow-hidden mt-2.5">
        <div className={`h-full ${isGain ? "bg-sage" : "bg-rust"}`} style={{ width: `${magnitudePct}%` }} />
      </div>
    </div>
  )
}

function InvestmentForm({
  title,
  name,
  setName,
  affectsCash,
  setAffectsCash,
  saving,
  message,
  onSave,
  onCancel,
  saveLabel,
  fused = false,
  className = ""
}: {
  title: string
  name: string
  setName: (v: string) => void
  affectsCash: boolean
  setAffectsCash: (v: boolean) => void
  saving: boolean
  message: string
  onSave: () => void
  onCancel: () => void
  saveLabel: string
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
            Investment name
          </label>
          <input
            className="border border-hairline bg-paper text-ink text-sm rounded-sm px-3 py-3 w-full"
            placeholder="e.g. Farmon - Rice (2026-Q3)"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>

        <button
          type="button"
          onClick={() => setAffectsCash(!affectsCash)}
          className="w-full flex items-center justify-between gap-3 border border-hairline bg-paper rounded-sm px-3.5 py-3 text-left"
        >
          <span>
            <span className="block text-sm font-medium text-ink">Affects cash</span>
            <span className="block text-xs text-ink-soft mt-0.5">
              {affectsCash ? "Funded through the tracked bank accounts" : "Funded outside the tracked cash trail"}
            </span>
          </span>
          <span
            className={`shrink-0 relative w-[38px] h-[22px] rounded-full transition-colors ${
              affectsCash ? "bg-sage" : "bg-hairline"
            }`}
          >
            <span
              className={`absolute top-[2px] w-[18px] h-[18px] rounded-full bg-paper shadow transition-transform ${
                affectsCash ? "translate-x-[18px]" : "translate-x-[2px]"
              }`}
            />
          </span>
        </button>

        <p className="text-xs text-ink-soft">
          Invested, returned, and gain/loss aren't set here — they're totalled automatically from approved
          transactions tagged to this investment.
        </p>

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
