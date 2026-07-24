// Small presentational pieces shared by /transactions/new and
// /transactions/[id]/edit, which mirror each other's layout closely.
// Each page keeps its own classification/type -> { arrow, tone } mapping,
// since the two pages key off different vocabularies (type keys vs
// classification strings) -- only the rendering is shared here.

export function FlowBadge({
  arrow,
  tone,
  small
}: {
  arrow: string
  tone: "in" | "out" | "neutral"
  small?: boolean
}) {
  const toneClass =
    tone === "in" ? "text-sage bg-sage/10" : tone === "out" ? "text-rust bg-rust/10" : "text-gold bg-gold/10"

  return (
    <span
      className={`rounded-full flex items-center justify-center font-bold shrink-0 ${toneClass} ${
        small ? "w-5 h-5 text-[11px]" : "w-7 h-7 rounded text-sm"
      }`}
    >
      {arrow}
    </span>
  )
}

// Amount-first entry point -- the hero of the redesigned form. A real
// number input (not a display-only readout) so typing, pasting, and the
// mobile numeric keypad all work exactly like the old plain field did;
// only the styling makes it the first, biggest thing on the screen.
export function AmountHero({
  value,
  onChange,
  label = "Amount",
  helper
}: {
  value: string
  onChange: (v: string) => void
  label?: string
  helper?: string
}) {
  return (
    <div className="text-center pt-2 pb-5">
      <p className="text-[11px] uppercase tracking-wide text-ink-soft font-mono mb-2">{label}</p>
      <div className="flex items-center justify-center gap-1.5">
        <span className="font-mono text-3xl font-bold text-ink-soft">₱</span>
        <input
          type="number"
          inputMode="decimal"
          min="0.01"
          step="0.01"
          placeholder="0.00"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="text-size-intentional font-mono [font-variant-numeric:tabular-nums] [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none text-4xl font-bold text-ink bg-transparent text-center w-full max-w-[220px] focus:outline-none placeholder:text-ink-soft/30"
        />
      </div>
      {helper && <p className="text-sm text-ink-soft mt-2.5 max-w-xs mx-auto">{helper}</p>}
    </div>
  )
}

// Replaces the old collapsed dropdown -- every entry type is one tap away
// in a horizontally scrollable row instead of open-select-close. Each
// page still owns its own key/classification -> {arrow, tone} mapping (see
// file comment above); callers merge that in before passing options here.
export function TypePillRow({
  options,
  value,
  onChange
}: {
  options: { key: string; label: string; adminOnly: boolean; arrow: string; tone: "in" | "out" | "neutral" }[]
  value: string
  onChange: (key: string) => void
}) {
  return (
    <div className="flex gap-2 overflow-x-auto pb-1 -mx-4 px-4 sm:-mx-5 sm:px-5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      {options.map((o) => {
        const active = o.key === value
        return (
          <button
            key={o.key}
            type="button"
            onClick={() => onChange(o.key)}
            className={`shrink-0 flex items-center gap-2 rounded-full border pl-1.5 pr-3 py-1.5 text-sm font-semibold whitespace-nowrap transition-colors ${
              active ? "border-gold bg-gold/10 text-ink" : "border-hairline bg-paper-2 text-ink-soft"
            }`}
          >
            <FlowBadge arrow={o.arrow} tone={o.tone} small />
            {o.label}
            {o.adminOnly && (
              <span className="text-[8px] font-bold uppercase tracking-wide text-gold border border-gold/40 rounded-full px-1.5 py-0.5">
                Admin
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}

// Slim progress track for the Details -> Review sub-flow used by the
// entry types with the most conditional fields (Loan Request, Investment,
// and Edit's Loan Release). Everything else stays a single flowing view.
export function StepTrack({ step, labels }: { step: 1 | 2; labels: [string, string] }) {
  return (
    <div className="mb-5">
      <div className="flex gap-1.5">
        {[0, 1].map((i) => (
          <div key={i} className="flex-1 h-[3px] rounded-full bg-hairline overflow-hidden">
            <div
              className="h-full bg-gold transition-all duration-300 ease-out"
              style={{ width: i < step ? "100%" : "0%" }}
            />
          </div>
        ))}
      </div>
      <div className="flex justify-between mt-1.5">
        {labels.map((l, i) => (
          <span
            key={l}
            className={`text-[10px] uppercase tracking-wide font-mono ${
              i === step - 1 ? "text-gold" : "text-ink-soft"
            }`}
          >
            {l}
          </span>
        ))}
      </div>
    </div>
  )
}

// A single read-only line in the Review step's summary -- what the member
// or admin is about to submit, restated plainly before they commit to it.
export function ReviewRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-2.5 border-b border-hairline last:border-b-0">
      <span className="text-sm text-ink-soft">{label}</span>
      <span className="text-sm font-semibold font-mono [font-variant-numeric:tabular-nums] text-ink text-right">
        {value}
      </span>
    </div>
  )
}

// Receipt/proof-of-payment uploader shared by New and Edit -- three
// mutually exclusive states: a newly-picked file's preview, Edit's
// existing receipt (with a Replace affordance), or the empty dropzone.
// The copy is written mobile-first ("Tap to upload a photo") since this
// is used almost entirely from a phone, where "drag a photo here" is
// meaningless -- drag-and-drop still works for anyone on a desktop
// browser, it's just no longer the wording that's advertised.
export function ReceiptField({
  receipt,
  receiptPreview,
  existingReceiptUrl,
  existingReceiptSignedUrl,
  dragActive,
  setDragActive,
  onFileChange
}: {
  receipt: File | null
  receiptPreview: string | null
  existingReceiptUrl?: string | null
  existingReceiptSignedUrl?: string | null
  dragActive: boolean
  setDragActive: (v: boolean) => void
  onFileChange: (file: File | null) => void
}) {
  function handleDrop(e: React.DragEvent) {
    e.preventDefault()
    setDragActive(false)
    const file = e.dataTransfer.files?.[0]
    if (file) onFileChange(file)
  }

  if (receiptPreview) {
    return (
      <div className="relative border border-hairline rounded-md p-3 flex items-center gap-3">
        <img
          src={receiptPreview}
          alt="Receipt preview"
          className="w-16 h-16 object-cover rounded-md border border-hairline"
        />
        <div className="min-w-0 flex-1">
          <p className="text-base text-ink truncate">{receipt?.name}</p>
          <p className="text-sm text-ink-soft">{receipt ? `${(receipt.size / 1024).toFixed(0)} KB` : ""}</p>
        </div>
        <button
          type="button"
          onClick={() => onFileChange(null)}
          className="text-sm text-rust border border-rust rounded-full px-2.5 py-1 shrink-0"
        >
          Remove
        </button>
      </div>
    )
  }

  if (existingReceiptUrl && existingReceiptSignedUrl) {
    return (
      <div className="relative border border-hairline rounded-md p-3 flex items-center gap-3">
        <img
          src={existingReceiptSignedUrl}
          alt="Current receipt"
          className="w-16 h-16 object-cover rounded-md border border-hairline"
        />
        <div className="min-w-0 flex-1">
          <p className="text-base text-ink">Current receipt</p>
          <p className="text-sm text-ink-soft">Tap Replace to upload a different photo</p>
        </div>
        <label className="shrink-0 text-sm font-semibold text-gold border border-gold/40 rounded-full px-3 py-1.5 cursor-pointer">
          Replace
          <input
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => onFileChange(e.target.files?.[0] ?? null)}
          />
        </label>
      </div>
    )
  }

  return (
    <label
      onDragOver={(e) => {
        e.preventDefault()
        setDragActive(true)
      }}
      onDragLeave={() => setDragActive(false)}
      onDrop={handleDrop}
      className={`
        flex flex-col items-center justify-center gap-2
        border-2 border-dashed rounded-md
        py-10 px-4 cursor-pointer text-center transition-colors
        ${dragActive ? "border-gold bg-gold/5" : "border-hairline"}
      `}
    >
      <span className="text-2xl">📎</span>
      <span className="text-base text-ink">Tap to upload a photo</span>
      <span className="text-sm text-ink-soft">Take a photo, or choose one from your library</span>
      <input
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => onFileChange(e.target.files?.[0] ?? null)}
      />
    </label>
  )
}

// Marks a field label as required -- e.g. `Bank <RequiredMark />` -- in
// place of the old sticky-footer "Bank required" chips. Sits right next
// to the field it applies to instead of needing a legend read separately.
export function RequiredMark() {
  return (
    <span className="text-rust" aria-hidden="true">
      {" "}
      *
    </span>
  )
}
