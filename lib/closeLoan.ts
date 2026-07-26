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
 *
 * The share computation stays here in TypeScript, but the actual writes
 * (allocation rows, crediting transactions, closing the loan) go through
 * close_loan_and_distribute_gain in one atomic call -- these were
 * previously three separate client-side calls with no rollback between
 * them, so a failure partway through could leave gain rows recorded with
 * no crediting transaction, or a loan stuck "active" after its gain was
 * already distributed (risking a double distribution if closed again).
 */
export async function closeLoanAndDistributeGain(params: CloseLoanParams) {
  const gainOrLoss = params.repaidApproved - Number(params.principal)
  const closingDate = dateOnly(new Date())

  const currentValueByMember = await computeCurrentValueByMember(closingDate, params.member_id)
  const shares = splitProportionally(currentValueByMember, gainOrLoss)

  // splitProportionally returns [] both when gainOrLoss is exactly 0 (fine,
  // there's nothing to distribute) and when it's nonzero but no member has a
  // positive current value to share it against. The RPC only writes
  // loan_gain_allocations/the Gain Allocation transaction when shares is
  // non-empty, so silently letting a nonzero gain/loss through here would
  // close the loan with that money never recorded anywhere -- missing from
  // closed_date, Dashboard's Total Gain/Loss, and every per-member ledger.
  // Matches the same guard distributeInvestmentGain already has.
  if (gainOrLoss !== 0 && shares.length === 0) {
    throw new Error(
      "No member has a positive current value as of this date -- nothing to distribute this loan's gain/loss against. The loan was not closed."
    )
  }

  const gainOrLossLabel = gainOrLoss > 0 ? "gain" : "loss"

  const rpcShares = shares.map((s) => ({
    member_id: s.member_id,
    amount: s.amount,
    current_value: s.currentValue,
    pct_share: s.pctShare,
    notes: `Share of ₱${Math.abs(gainOrLoss).toFixed(2)} ${gainOrLossLabel} from loan closed ${closingDate}`,
    description: `Share of ${new Date().getFullYear()} loan ${gainOrLossLabel} (from ${params.borrowerName || "a member"}'s loan)`
  }))

  const { error } = await supabase.rpc("close_loan_and_distribute_gain", {
    p_loan_id: params.id,
    p_closing_date: closingDate,
    p_shares: rpcShares
  })

  if (error) throw new Error(error.message)
}
