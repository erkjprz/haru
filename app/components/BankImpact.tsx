"use client"

import type { BankDelta, TxnImpact } from "@/lib/bankImpact"

const fmt = (n: number) =>
  Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })

const signed = (n: number) => `${n < 0 ? "-" : "+"}₱${fmt(Math.abs(n))}`
const money = (n: number) => `${n < 0 ? "-" : ""}₱${fmt(Math.abs(n))}`

const NONE_REASON: Record<"no_bank" | "no_cash", string> = {
  no_bank: "Won't change any bank balance: no bank is set on this transaction.",
  no_cash: "Won't change any bank balance: it's marked as not affecting cash."
}

// Before approving: which bank(s) this moves, and each balance before → after.
// balances is null while the current balances are still loading.
export function BankImpactPreview({
  banks,
  unaffected,
  noneReason,
  balances,
  compact = false,
  title = "Bank balance after approving",
  className = ""
}: {
  banks: BankDelta[]
  unaffected: number
  // Set for a single transaction that won't move any bank -- explains why.
  noneReason?: Extract<TxnImpact, { kind: "none" }>["reason"]
  balances: Record<string, number> | null
  // One line per bank, on the dark bulk-approve bar.
  compact?: boolean
  title?: string
  className?: string
}) {
  if (banks.length === 0 && unaffected === 0) return null

  if (compact) {
    return (
      <div className={`space-y-1.5 ${className}`}>
        {banks.map(({ bank, delta }) => {
          const before = balances?.[bank] ?? 0
          const after = Number((before + delta).toFixed(2))
          return (
            // Two short lines rather than one long one, so before → after
            // fits on a phone without running under the search button.
            <div key={bank} className="text-[12px] leading-snug">
              <p className="truncate">
                {bank} <span className="font-mono">{signed(delta)}</span>
              </p>
              <p
                className={`font-mono [font-variant-numeric:tabular-nums] truncate ${
                  balances !== null && after < 0 ? "text-rust" : "opacity-70"
                }`}
              >
                {balances === null ? "Loading balance…" : `${money(before)} → ${money(after)}`}
              </p>
            </div>
          )
        })}
        {unaffected > 0 && (
          <p className="text-[12px] text-gold-soft">{`${unaffected} won't change any bank balance`}</p>
        )}
      </div>
    )
  }

  return (
    <div className={`rounded-md border border-hairline bg-paper px-3.5 py-2.5 space-y-1.5 ${className}`}>
      <p className="text-[10px] uppercase tracking-[0.1em] text-ink-soft font-mono">{title}</p>
      {banks.map(({ bank, delta }) => {
        const before = balances?.[bank] ?? 0
        const after = Number((before + delta).toFixed(2))
        const goesNegative = balances !== null && after < 0
        return (
          <div key={bank}>
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-[13px] text-ink font-medium truncate min-w-0">{bank}</span>
              <span className={`text-[12px] font-mono [font-variant-numeric:tabular-nums] whitespace-nowrap ${delta < 0 ? "text-rust" : "text-sage"}`}>
                {signed(delta)}
              </span>
            </div>
            <p
              className={`text-[12px] font-mono [font-variant-numeric:tabular-nums] text-right ${
                goesNegative ? "text-rust font-semibold" : "text-ink-soft"
              }`}
            >
              {balances === null ? "Loading balance…" : `${money(before)} → ${money(after)}`}
            </p>
            {goesNegative && (
              <p className="text-[11px] text-rust text-right">This would take {bank} below zero.</p>
            )}
          </div>
        )
      })}
      {noneReason && banks.length === 0 && <p className="text-[12px] text-gold">{NONE_REASON[noneReason]}</p>}
      {!noneReason && unaffected > 0 && (
        <p className="text-[12px] text-gold">
          {`${unaffected} of these won't change any bank balance (no bank set, or not affecting cash).`}
        </p>
      )}
    </div>
  )
}

export type ApprovalResult = {
  count: number
  banks: { bank: string; delta: number; after: number | null }[]
  unaffected: number
}

// After approving: what actually happened, with balances re-fetched after
// the write -- a real confirmation, not the prediction shown beforehand.
export function ApprovalResultCard({
  result,
  onViewBank,
  onDismiss
}: {
  result: ApprovalResult
  onViewBank: (bank: string) => void
  onDismiss: () => void
}) {
  return (
    <div className="card px-5 pt-4 pb-3" role="status">
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm text-ink font-semibold">
          <span className="text-sage">✓</span> Approved {result.count} transaction{result.count === 1 ? "" : "s"}
        </p>
        <button onClick={onDismiss} aria-label="Dismiss" className="text-ink-soft text-lg leading-none -mt-0.5">
          ×
        </button>
      </div>
      <div className="mt-1.5">
        {result.banks.map(({ bank, delta, after }) => (
          <button
            key={bank}
            onClick={() => onViewBank(bank)}
            className="w-full py-2 flex items-center justify-between gap-3 text-left border-t border-dashed border-hairline"
          >
            <span className="min-w-0">
              <span className="block text-sm text-ink font-medium truncate">{bank}</span>
              <span className="block text-[11px] text-ink-soft font-mono">
                {after === null ? "Balance unavailable" : `now ${money(after)}`}
              </span>
            </span>
            <span className="flex items-center gap-2 shrink-0">
              <span
                className={`font-mono [font-variant-numeric:tabular-nums] text-sm font-semibold ${
                  delta < 0 ? "text-rust" : "text-sage"
                }`}
              >
                {signed(delta)}
              </span>
              <span className="text-[12px] text-gold">View →</span>
            </span>
          </button>
        ))}
        {result.unaffected > 0 && (
          <p className="py-2 border-t border-dashed border-hairline text-[12px] text-gold">
            {`${result.unaffected} didn't change any bank balance (no bank set, or not affecting cash).`}
          </p>
        )}
      </div>
    </div>
  )
}
