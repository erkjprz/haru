"use client"

import { Sheet } from "@/app/components/Sheet"

// Common fixed rates lenders in this fund actually use -- the default way
// to fill Interest rate, with "Custom" as the escape hatch for anything
// outside this list rather than a separate mode someone has to think to
// reach for.
const PRESET_RATES = [0, 2, 3, 5, 7.5, 10, 15, 20]

export function InterestRatePickerSheet({
  value,
  onSelect,
  onCustom,
  onClose
}: {
  value: string
  onSelect: (rate: number) => void
  onCustom: () => void
  onClose: () => void
}) {
  const selected = value.trim() !== "" ? Number(value) : null

  return (
    <Sheet title="Interest rate" onClose={onClose}>
      <div className="card divide-y divide-hairline overflow-hidden">
        {PRESET_RATES.map((rate) => (
          <button
            key={rate}
            onClick={() => onSelect(rate)}
            className={`w-full px-4 py-3.5 text-left text-sm font-semibold text-ink transition-colors ${
              selected === rate ? "bg-(--selected-bg)" : ""
            }`}
          >
            {rate}%
          </button>
        ))}
      </div>

      <button
        onClick={onCustom}
        className="w-full mt-3 px-4 py-3.5 text-left text-sm font-semibold text-gold card"
      >
        Custom rate…
      </button>
    </Sheet>
  )
}
