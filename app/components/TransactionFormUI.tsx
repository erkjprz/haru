// Small presentational pieces shared by /transactions/new and
// /transactions/[id]/edit, which mirror each other's layout closely.
// Each page keeps its own classification/type -> { arrow, tone } mapping,
// since the two pages key off different vocabularies (type keys vs
// classification strings) -- only the rendering is shared here.

export function SectionLabel({ children, first }: { children: React.ReactNode; first?: boolean }) {
  return (
    <p
      className={`text-xs font-bold uppercase tracking-wide text-ink font-mono mb-3 ${
        first ? "" : "mt-6 pt-[18px] border-t border-hairline"
      }`}
    >
      {children}
    </p>
  )
}

export function FlowBadge({ arrow, tone }: { arrow: string; tone: "in" | "out" | "neutral" }) {
  const toneClass =
    tone === "in" ? "text-sage bg-sage/10" : tone === "out" ? "text-rust bg-rust/10" : "text-gold bg-gold/10"

  return (
    <span className={`w-7 h-7 rounded flex items-center justify-center text-sm font-bold shrink-0 ${toneClass}`}>
      {arrow}
    </span>
  )
}

export function Chip({ done, children }: { done?: boolean; children: React.ReactNode }) {
  return (
    <span
      className={`inline-flex items-center gap-1 text-xs font-semibold px-2 py-1 rounded-full border whitespace-nowrap ${
        done ? "text-sage border-sage/40" : "text-ink-soft border-hairline"
      }`}
    >
      {children}
    </span>
  )
}
