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

// ============================================================
// "Grouped rows" primitives (Wise/Revolut-style settings list),
// used by both /transactions/new and /transactions/[id]/edit.
// ============================================================

// One bordered card holding a set of divided rows -- the visual unit the
// rest of these components assume they're rendered inside of.
export function RowGroup({ children }: { children: React.ReactNode }) {
  return <div className="bg-paper-2 border border-hairline rounded-md overflow-hidden">{children}</div>
}

// Label-left, value-right, with a chevron -- the value shown is purely
// cosmetic. A transparent native <select> is layered over the whole row so
// tapping anywhere still opens the real picker (same trick DateField uses
// on the Transactions filter sheet): full native behavior and
// accessibility, just a fully custom visible label instead of fighting
// cross-browser <select> text styling (which doesn't reliably support
// right-aligned text, especially on iOS Safari).
export function SelectRow({
  label,
  value,
  onChange,
  options,
  placeholder = "Select",
  includeEmptyOption = true
}: {
  label: string
  value: string
  onChange: (v: string) => void
  options: { value: string; label: string }[]
  placeholder?: string
  // Off for fields that always hold one of `options`' real values (e.g. a
  // repayment mode that defaults to "monthly") -- an empty option there
  // would be a selectable dead end the rest of the form doesn't expect.
  includeEmptyOption?: boolean
}) {
  const selected = options.find((o) => o.value === value)
  return (
    <div className="relative flex items-center justify-between gap-3 px-4 py-3.5 border-b border-hairline last:border-b-0">
      <span className="text-sm text-ink-soft shrink-0">{label}</span>
      <span className="flex items-center gap-1.5 text-sm text-ink font-medium min-w-0">
        <span className="truncate">{selected ? selected.label : placeholder}</span>
        <span className="text-ink-soft shrink-0">&rsaquo;</span>
      </span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label={label}
        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
      >
        {includeEmptyOption && <option value="">{placeholder}</option>}
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  )
}

// Same row shape as SelectRow, for free text -- a real input works fine
// right-aligned (unlike <select>), no overlay trick needed.
export function TextRow({
  label,
  value,
  onChange,
  placeholder
}: {
  label: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
}) {
  return (
    <div className="flex items-center justify-between gap-3 px-4 py-3.5 border-b border-hairline last:border-b-0">
      <span className="text-sm text-ink-soft shrink-0">{label}</span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="flex-1 min-w-0 text-sm text-ink text-right bg-transparent focus:outline-none placeholder:text-ink-soft"
      />
    </div>
  )
}

// Same row shape, for a small numeric value with an optional unit suffix
// (e.g. "6 months") -- used for loan term rather than amount, which gets
// its own AmountHero treatment instead.
export function NumberRow({
  label,
  value,
  onChange,
  placeholder,
  suffix
}: {
  label: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
  suffix?: string
}) {
  return (
    <div className="flex items-center justify-between gap-3 px-4 py-3.5 border-b border-hairline last:border-b-0">
      <span className="text-sm text-ink-soft shrink-0">{label}</span>
      <span className="flex items-center gap-1.5 shrink-0">
        <input
          type="number"
          min="0"
          step="1"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className="w-16 text-sm text-ink text-right bg-transparent focus:outline-none placeholder:text-ink-soft font-mono [font-variant-numeric:tabular-nums]"
        />
        {suffix && <span className="text-sm text-ink-soft">{suffix}</span>}
      </span>
    </div>
  )
}

// A row that's just a red destructive action -- "Cancel this entry" lives
// as its own row in its own single-row RowGroup, same idiom as the rest of
// this list rather than a separately-styled button floating below it.
export function DangerRow({
  label,
  onClick,
  disabled
}: {
  label: string
  onClick: () => void
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="w-full flex items-center justify-between gap-3 px-4 py-3.5 text-sm font-semibold text-rust disabled:opacity-50"
    >
      {label}
      <span>&rsaquo;</span>
    </button>
  )
}

// Big centered number entry -- the one thing on the page that isn't a row
// in a list, since it's the figure everything else on the form exists to
// describe.
export function AmountHero({
  label,
  value,
  onChange,
  helper
}: {
  label: string
  value: string
  onChange: (v: string) => void
  helper?: string
}) {
  return (
    <div className="text-center py-6 border-b border-hairline mb-5">
      <p className="text-xs font-bold uppercase tracking-wide text-ink-soft font-mono mb-3">{label}</p>
      <div className="flex items-baseline justify-center gap-2">
        <span className="font-mono text-3xl font-bold text-ink-soft">&#8369;</span>
        <input
          type="number"
          min="0.01"
          step="0.01"
          placeholder="0.00"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="font-mono [font-variant-numeric:tabular-nums] text-6xl font-bold text-ink bg-transparent text-center focus:outline-none w-full max-w-[280px] placeholder:text-hairline"
        />
      </div>
      {helper && <p className="text-[13px] text-ink-soft mt-3 px-2">{helper}</p>}
    </div>
  )
}

// New-entry type picker: a segmented row for the (short) member-facing
// list, since equal-width tabs read cleanly at 4 options.
export function TypeTabs({
  options,
  value,
  onChange
}: {
  options: { key: string; label: string }[]
  value: string
  onChange: (key: string) => void
}) {
  return (
    <div className="flex border border-hairline rounded-md overflow-hidden mb-5">
      {options.map((o) => (
        <button
          key={o.key}
          type="button"
          onClick={() => onChange(o.key)}
          className={`flex-1 text-[12.5px] font-semibold py-2.5 px-1 transition-colors ${
            o.key === value ? "bg-gold text-ink" : "bg-paper-2 text-ink-soft"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

// Admin's type picker: 9 options don't fit as equal-width tabs, so a
// horizontally scrollable chip row instead -- same idiom as the
// Transactions filter chips, with an "Admin" tag on the 5 admin-only ones.
export function TypeChipRow({
  options,
  value,
  onChange
}: {
  options: { key: string; label: string; adminOnly: boolean }[]
  value: string
  onChange: (key: string) => void
}) {
  return (
    <div className="flex gap-2 overflow-x-auto mb-5 -mx-4 sm:-mx-5 px-4 sm:px-5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      {options.map((o) => (
        <button
          key={o.key}
          type="button"
          onClick={() => onChange(o.key)}
          className={`shrink-0 flex items-center gap-1.5 border rounded-full px-3.5 py-2 text-[13px] font-semibold whitespace-nowrap transition-colors ${
            o.key === value ? "border-gold bg-gold/10 text-ink" : "border-hairline bg-paper-2 text-ink-soft"
          }`}
        >
          {o.label}
          {o.adminOnly && (
            <span className="text-[9px] font-bold uppercase tracking-wide text-gold border border-gold/40 rounded-full px-1.5 py-0.5">
              Admin
            </span>
          )}
        </button>
      ))}
    </div>
  )
}

// Edit mode's type "picker" -- not a picker at all, since a transaction's
// type can never be changed once it exists (see needsReceipt's neighbor
// comment on the edit page for the same rule applied to receipts). Reads
// as a fact, not a control.
export function TypeReadOnlyBadge({
  arrow,
  tone,
  label
}: {
  arrow: string
  tone: "in" | "out" | "neutral"
  label: string
}) {
  return (
    <div className="flex items-center gap-2.5 border border-hairline bg-paper-2 rounded-md px-3.5 py-3 mb-5">
      <FlowBadge arrow={arrow} tone={tone} />
      <span className="text-sm font-semibold text-ink flex-1">{label}</span>
      <span className="text-xs text-ink-soft shrink-0 whitespace-nowrap">Can&apos;t be changed</span>
    </div>
  )
}
