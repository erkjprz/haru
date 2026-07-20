import { supabase } from "@/lib/supabase"
import { computeCurrentValueByMember, dateOnly, splitProportionally } from "@/lib/currentValue"

interface CloseLoanParams {
  id: string
  member_id: string | null
  principal: number
  repaidApproved: number
  borrowerName?: string
}

/**
 * Distributes a closed loan's gain (or loss) across eligible members and
 * marks the loan closed.
 *
 * Follows the project's documented Section 14 methodology:
 * 1. The borrower never shares in their own loan's gain.
 * 2. Gain is distributed once, at the moment the loan closes --
 *    allocation_date is set to the closing date (when the gain is booked
 *    and realized, per standard financial convention).
 * 3. The split is proportional to each eligible member's "current value"
 *    at that exact closing date: net contribution + bank interest + prior
 *    loan gains + investment gains/losses (all signed), all dated on or
 *    before the closing date.
 * 4. Eligibility requires both net contribution > 0 and current value > 0
 *    as of the closing date -- excluded from both the numerator and
 *    denominator of the split, not floored to 0.
 * 5. Rounding residuals are absorbed by the largest-share member, so the
 *    allocated total always ties to the loan's exact gain, to the peso.
 *
 * Writes to loan_gain_allocations (loan_id, member_id, amount,
 * allocation_date, notes) -- NOT investment_allocations, which has no
 * loan_id/year/category columns and was the source of a bug where every
 * loan closure silently failed to record anything in a structured ledger
 * table.
 */
export async function closeLoanAndDistributeGain(params: CloseLoanParams) {
  const gainOrLoss = params.repaidApproved - Number(params.principal)
  const closingDate = dateOnly(new Date())

  const currentValueByMember = await computeCurrentValueByMember(closingDate, params.member_id)
  const shares = splitProportionally(currentValueByMember, gainOrLoss)

  if (shares.length > 0) {
    const gainOrLossLabel = gainOrLoss > 0 ? "gain" : "loss"

    const loanGainRows = shares.map((s) => ({
      loan_id: params.id,
      member_id: s.member_id,
      amount: s.amount,
      allocation_date: closingDate,
      current_value: s.currentValue,
      pct_share: s.pctShare,
      notes: `Share of ₱${Math.abs(gainOrLoss).toFixed(2)} ${gainOrLossLabel} from loan closed ${closingDate}`
    }))

    await supabase.from("loan_gain_allocations").insert(loanGainRows)

    const gainTransactions = shares.map((s) => ({
      member_id: s.member_id,
      bank_account_id: null,
      loan_id: params.id,
      classification: "Gain Allocation",
      affects_cash: 0,
      amount: s.amount,
      description: `Share of ${new Date().getFullYear()} loan ${gainOrLossLabel} (from ${params.borrowerName || "a member"}'s loan)`,
      status: "approved"
    }))

    await supabase.from("transactions").insert(gainTransactions)
  }

  await supabase.from("loans").update({ status: "closed" }).eq("loan_id", params.id)
}
