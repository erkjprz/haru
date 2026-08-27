"use client"

import { Sheet } from "@/app/components/Sheet"

type Investment = {
  investment_id: string
  name: string
  affects_cash?: boolean
}

export function InvestmentRowIcon() {
  return (
    <span className="w-9 h-9 rounded-full bg-ink-soft flex items-center justify-center flex-shrink-0">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} className="w-4.5 h-4.5 text-paper">
        <path d="M4 19V9M9.5 19V5M15 19v-7" strokeLinecap="round" />
        <path d="M4 19h16" strokeLinecap="round" />
      </svg>
    </span>
  )
}

// Same picker-sheet pattern as LoanPickerSheet -- Investment Return used
// to be a plain <select> since there was little per-option detail to show
// beyond a name, but that made it look and behave differently from Loan
// Payment's own picker for no real reason once both are just "pick one of
// a short list." Promoted to match.
export function InvestmentPickerSheet({
  investments,
  onSelect,
  onClose
}: {
  investments: Investment[]
  onSelect: (investment: Investment) => void
  onClose: () => void
}) {
  return (
    <Sheet title="Which investment" onClose={onClose}>
      {investments.length === 0 ? (
        <p className="text-center text-sm text-ink-soft py-6">No open investments to select.</p>
      ) : (
        <div className="bg-paper-2 border border-hairline rounded-md divide-y divide-hairline overflow-hidden">
          {investments.map((inv) => (
            <button
              key={inv.investment_id}
              onClick={() => onSelect(inv)}
              className="w-full flex items-center gap-3 px-4 py-3.5 text-left"
            >
              <InvestmentRowIcon />
              <span className="flex-1 min-w-0 text-sm font-semibold text-ink">{inv.name}</span>
            </button>
          ))}
        </div>
      )}
    </Sheet>
  )
}
