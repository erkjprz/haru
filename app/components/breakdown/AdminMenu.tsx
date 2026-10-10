"use client"

// The ⋯ button next to a Breakdown detail page's title and the rows of the
// admin actions sheet it opens -- shared by the bank and loan pages so
// every per-item admin action lives in the same place on each.

export function AdminMenuButton({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      className="shrink-0 mt-1 w-9 h-9 rounded-full border border-hairline text-ink-soft hover:text-ink hover:bg-paper-2 transition-colors flex items-center justify-center"
    >
      <svg viewBox="0 0 24 24" fill="currentColor" className="w-[18px] h-[18px]">
        <circle cx="5" cy="12" r="1.8" />
        <circle cx="12" cy="12" r="1.8" />
        <circle cx="19" cy="12" r="1.8" />
      </svg>
    </button>
  )
}

export function AdminActionRow({
  label,
  hint,
  onClick,
  last = false,
  danger = false
}: {
  label: string
  hint: string
  onClick: () => void
  last?: boolean
  danger?: boolean
}) {
  return (
    <button
      onClick={onClick}
      className={`w-full py-3.5 flex items-center justify-between gap-3 text-left ${
        last ? "" : "border-b border-dashed border-hairline"
      }`}
    >
      <div className="min-w-0">
        <p className={`text-sm font-medium ${danger ? "text-rust" : "text-ink"}`}>{label}</p>
        <p className="text-[11px] text-ink-soft">{hint}</p>
      </div>
      <span className="text-ink-soft shrink-0">›</span>
    </button>
  )
}
