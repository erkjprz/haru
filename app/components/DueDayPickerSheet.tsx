"use client"

import { Sheet } from "@/app/components/Sheet"
import { ordinalDay } from "@/lib/loanFormat"

const DAYS = Array.from({ length: 31 }, (_, i) => i + 1)

// Day of the month a monthly installment is due, laid out like a calendar
// month so it reads as "a date" at a glance rather than a list of 31 rows.
export function DueDayPickerSheet({
  value,
  onSelect,
  onClose
}: {
  value: string
  onSelect: (day: number) => void
  onClose: () => void
}) {
  const selected = value.trim() !== "" ? Number(value) : null

  return (
    <Sheet title="Due every month on the…" onClose={onClose}>
      <div className="grid grid-cols-7 gap-1.5">
        {DAYS.map((day) => (
          <button
            key={day}
            type="button"
            onClick={() => onSelect(day)}
            aria-label={`The ${ordinalDay(day)}`}
            className={`aspect-square rounded-md text-sm font-semibold font-mono [font-variant-numeric:tabular-nums] border transition-colors ${
              selected === day ? "bg-ink text-paper border-ink" : "bg-paper-2 border-hairline text-ink"
            }`}
          >
            {day}
          </button>
        ))}
      </div>
      <p className="text-xs text-ink-soft mt-3 px-1">
        Picking the 29th–31st? In shorter months it falls on the last day of the month.
      </p>
    </Sheet>
  )
}
