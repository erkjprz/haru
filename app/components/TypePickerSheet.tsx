"use client"

import { Sheet } from "@/app/components/Sheet"
import { FlowBadge } from "@/app/components/TransactionFormUI"

type TypeOption = { key: string; label: string; arrow: string; tone: "in" | "out" | "neutral" }

// Same picker-sheet pattern as LoanPickerSheet, for the same reason
// budget-tracker opens one for Category rather than an inline dropdown --
// this is the row people tap first and most often, so it earns a real
// picker instead of a cramped expanding list.
export function TypePickerSheet({
  options,
  onSelect,
  onClose
}: {
  options: TypeOption[]
  onSelect: (key: string) => void
  onClose: () => void
}) {
  return (
    <Sheet title="Transaction type" onClose={onClose}>
      <div className="bg-paper border border-hairline rounded-md divide-y divide-hairline overflow-hidden">
        {options.map((o) => (
          <button key={o.key} onClick={() => onSelect(o.key)} className="w-full flex items-center gap-3 px-4 py-3.5 text-left">
            <FlowBadge arrow={o.arrow} tone={o.tone} />
            <span className="flex-1 text-sm font-semibold text-ink">{o.label}</span>
          </button>
        ))}
      </div>
    </Sheet>
  )
}
