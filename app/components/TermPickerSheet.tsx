"use client"

import { Sheet } from "@/app/components/Sheet"

// Common repayment terms this fund actually uses -- the default way to
// fill Payment term, with "Custom" as the escape hatch for anything
// outside this list rather than a separate mode someone has to think to
// reach for.
const PRESET_TERMS = [1, 3, 6, 12, 18, 24, 36]

export function TermPickerSheet({
  value,
  onSelect,
  onCustom,
  onClose
}: {
  value: string
  onSelect: (months: number) => void
  onCustom: () => void
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

      <button
        onClick={onCustom}
        className="w-full mt-3 px-4 py-3.5 text-left text-sm font-semibold text-gold bg-paper-2 border border-hairline rounded-md"
      >
        Custom term…
      </button>
    </Sheet>
  )
}
