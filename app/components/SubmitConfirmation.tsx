"use client"

import { useEffect } from "react"

const fmt = (n: number) =>
  Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })

type Props = {
  amount: number
  label: string
  pending: boolean
  continueLabel: string
  onContinue: () => void
}

// Shown in place of a money-moving form right after a successful submit --
// a brief summary of what was recorded and whether it still needs approval,
// so submitting doesn't feel like it vanished into the void before the
// list page loads. This swap happens in place (no route change), so the
// app's route-level ScrollToTop never fires for it -- if the form was
// scrolled down when submitted (its most common state, since submit
// buttons sit at the bottom), the much-shorter confirmation would render
// mostly off-screen without this.
export default function SubmitConfirmation({ amount, label, pending, continueLabel, onContinue }: Props) {
  useEffect(() => {
    window.scrollTo(0, 0)
  }, [])

  return (
    <div className="bg-paper-2 border border-hairline rounded-md p-6 text-center">
      <p className="font-mono [font-variant-numeric:tabular-nums] text-3xl font-bold text-ink">
        ₱{fmt(amount)}
      </p>
      <p className="text-sm text-ink-soft mt-1">{label}</p>
      <span
        className={`inline-block mt-3 text-[11px] uppercase font-mono border rounded-full px-2.5 py-1 ${
          pending ? "text-gold border-gold" : "text-sage border-sage"
        }`}
      >
        {pending ? "Pending approval" : "Approved"}
      </span>
      <div>
        <button
          onClick={onContinue}
          className="mt-6 bg-ink text-paper px-6 py-2.5 rounded-md text-sm font-medium"
        >
          {continueLabel}
        </button>
      </div>
    </div>
  )
}
