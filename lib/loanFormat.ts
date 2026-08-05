import type { InterestType } from "@/lib/loanMath"

// The one place that turns a loan's interest terms into display text --
// used on both the loans list and the loan detail page so the wording
// ("flat" vs "%") never drifts between them.
export function formatInterestLabel(
  interestType: InterestType | null | undefined,
  interestRate: number | null | undefined,
  interestAmount: number | null | undefined,
  fmt: (n: number) => string
): string {
  if (interestType === "amount") {
    return interestAmount != null ? `₱${fmt(interestAmount)} flat` : "—"
  }
  return interestRate != null ? `${interestRate}%` : "—"
}

// How long a closed loan took to pay off, from release to its closing date
// (v_loan_summary.closed_date -- the last gain allocation, or for a
// zero-gain loan with no allocation row, its last approved repayment).
// Returns null while the loan is still open.
export function durationLabel(startDate: string, closedDate: string | null): string | null {
  if (!closedDate) return null

  const days = Math.max(0, Math.round((new Date(closedDate).getTime() - new Date(startDate).getTime()) / 86400000))
  if (days === 0) return "same day"
  if (days < 30) return `${days} day${days === 1 ? "" : "s"}`

  const months = days / 30.44
  if (months < 24) return `${Math.round(months)} mo`

  const years = Math.floor(months / 12)
  const remMonths = Math.round(months % 12)
  return remMonths > 0 ? `${years} yr ${remMonths} mo` : `${years} yr`
}
