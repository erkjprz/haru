import { supabase } from "@/lib/supabase"
import { computeCurrentValueByMember, splitProportionally } from "@/lib/currentValue"

interface CloseInvestmentParams {
  investmentId: string
  closingDate: string
  amount: number
  notes?: string
  investmentName?: string
}

/**
 * Closes an investment, distributing whatever gain/loss remains as of the
 * closing date -- the investment equivalent of closeLoanAndDistributeGain.
 *
 * Unlike a loan (which only ever distributes once, at close), an investment
 * can already be distributed against ad hoc via distributeInvestmentGain any
 * number of times before this runs -- amount here is just whatever's left to
 * settle at closing (0 is valid: nothing left to distribute, but still mark
 * it closed). The resulting allocations/transactions are flagged
 * is_closing_distribution so reopening only undoes this final distribution,
 * not the investment's prior distribution history.
 *
 * amount is signed (positive = gain, negative = loss). Throws (and leaves
 * the investment open) if amount is nonzero but no eligible member has a
 * positive current value to distribute it against -- same guard
 * closeLoanAndDistributeGain and distributeInvestmentGain already have.
 */
export async function closeInvestmentAndDistributeGain(params: CloseInvestmentParams) {
  const amount = Number(params.amount)

  const currentValueByMember = await computeCurrentValueByMember(params.closingDate)
  const shares = splitProportionally(currentValueByMember, amount)

  if (amount !== 0 && shares.length === 0) {
    throw new Error(
      "No member has a positive current value as of this date -- nothing to distribute this investment's final gain/loss against. The investment was not closed."
    )
  }

  const label = amount < 0 ? "loss" : "gain"

  const rpcShares = shares.map((s) => ({
    member_id: s.member_id,
    allocation_type: s.amount < 0 ? "Investment Loss" : "Investment Gain",
    amount: Math.abs(s.amount),
    current_value: s.currentValue,
    pct_share: s.pctShare,
    notes: params.notes || `Final distribution of ₱${Math.abs(amount).toFixed(2)} ${label} on closing ${params.closingDate}`,
    description: `Final ${label} on closing ${params.investmentName || "an investment"}`
  }))

  const { error } = await supabase.rpc("close_investment_and_distribute_gain", {
    p_investment_id: params.investmentId,
    p_closing_date: params.closingDate,
    p_shares: rpcShares
  })

  if (error) throw new Error(error.message)
}
