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
