"use client"

import { Sheet } from "@/app/components/Sheet"

type Tone = "in" | "out" | "neutral"
type TypeOption = { key: string; label: string; arrow: string; tone: Tone }

// Bold solid-fill badge, local to the type picker and its trigger row --
// distinct from the shared FlowBadge (a faint /10 tint tuned for the dense
// transactions list) because a picker sheet is a much emptier canvas and
// needs real color to not read as dead against the near-black dark theme.
export function TypeBadge({ arrow, tone, selected }: { arrow: string; tone: Tone; selected?: boolean }) {
  const toneClass = tone === "in" ? "bg-sage" : tone === "out" ? "bg-rust" : "bg-gold"
  return (
    <span
      className={`w-9 h-9 rounded-full flex items-center justify-center font-bold text-sm text-paper shrink-0 ${toneClass} ${
        selected ? "ring-2 ring-offset-2 ring-offset-paper-2 ring-ink/30" : ""
      }`}
    >
      {arrow}
    </span>
  )
}

// Same picker-sheet pattern as LoanPickerSheet, for the same reason
// budget-tracker opens one for Category rather than an inline dropdown --
// this is the row people tap first and most often, so it earns a real
// picker instead of a cramped expanding list.
export function TypePickerSheet({
  options,
  value,
  onSelect,
  onClose
}: {
  options: TypeOption[]
  value?: string
  onSelect: (key: string) => void
  onClose: () => void
}) {
  return (
    <Sheet title="Transaction type" onClose={onClose}>
      <div className="bg-paper-2 border border-hairline rounded-md divide-y divide-hairline overflow-hidden">
        {options.map((o) => (
          <button
            key={o.key}
            onClick={() => onSelect(o.key)}
            className={`w-full flex items-center gap-3 px-4 py-3.5 text-left transition-colors ${
              o.key === value ? "bg-gold/10" : ""
            }`}
          >
            <TypeBadge arrow={o.arrow} tone={o.tone} selected={o.key === value} />
            <span className="flex-1 text-sm font-semibold text-ink">{o.label}</span>
          </button>
        ))}
      </div>
    </Sheet>
  )
}
