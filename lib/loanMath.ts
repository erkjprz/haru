export type InterestType = "rate" | "amount"

// A loan's interest is either a percentage of principal or a flat peso
// figure agreed up front -- this is the one place that turns either into
// the total amount due, so every form and the admin close/repay checks
// stay in agreement.
export function totalRepayable(
  principal: number,
  interestType: InterestType,
  interestRate: number,
  interestAmount: number
): number {
  return interestType === "amount"
    ? principal + interestAmount
    : principal + principal * (interestRate / 100)
}
