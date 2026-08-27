"use client"

import { Sheet } from "@/app/components/Sheet"

// Common repayment terms this fund actually uses -- a fast-path shortcut
// layered on top of the plain number input next to it, which stays
// available at all times for anything outside this list. Selecting a
// preset just fills the same input's own value.
const PRESET_TERMS = [1, 3, 6, 12, 18, 24, 36]

export function TermPickerSheet({
  value,
  onSelect,
  onClose
}: {
  value: string
  onSelect: (months: number) => void
  onClose: () => void
}) {
  const selected = value.trim() !== "" ? Number(value) : null

  return (
    <Sheet title="Payment term" onClose={onClose}>
      <div className="bg-paper-2 border border-hairline rounded-md divide-y divide-hairline overflow-hidden">
        {PRESET_TERMS.map((months) => (
          <button
            key={months}
            onClick={() => onSelect(months)}
            className={`w-full px-4 py-3.5 text-left text-sm font-semibold text-ink transition-colors ${
              selected === months ? "bg-gold/10" : ""
            }`}
          >
            {months} {months === 1 ? "month" : "months"}
          </button>
        ))}
      </div>
    </Sheet>
  )
}
