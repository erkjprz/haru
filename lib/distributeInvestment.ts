import { supabase } from "@/lib/supabase"
import { computeCurrentValueByMember, dateOnly, effectiveDate, splitProportionally } from "@/lib/currentValue"

export interface InvestmentDistributionInput {
  investmentId: string
  allocationDate: string
  amount: number
  notes?: string
}

/**
 * Distributes a realized investment gain or loss across eligible members,
 * proportional to each member's current value as of the distribution date --
 * same methodology as closeLoanAndDistributeGain and
 * distributeBankInterestGroup. Unlike a loan, an investment doesn't need to
 * "close" to be settled: this can be called yearly, ad hoc, or whenever a
 * gain/loss is actually realized, any number of times over the investment's
 * life.
 *
 * amount is signed (positive = gain, negative = loss). Throws if there's no
 * eligible member with a positive current value to distribute against.
 */
export async function distributeInvestmentGain(input: InvestmentDistributionInput) {
  const amount = Number(input.amount)
  if (amount === 0) throw new Error("Amount must be nonzero.")

  const currentValueByMember = await computeCurrentValueByMember(input.allocationDate)
  const shares = splitProportionally(currentValueByMember, amount)

  if (shares.length === 0) {
    throw new Error("No member has a positive current value as of this date -- nothing to distribute against.")
  }

  const label = amount < 0 ? "loss" : "gain"

  const rows = shares.map((s) => ({
    investment_id: input.investmentId,
    member_id: s.member_id,
    allocation_type: s.amount < 0 ? "Investment Loss" : "Investment Gain",
    amount: Math.abs(s.amount),
    allocation_date: input.allocationDate,
    current_value: s.currentValue,
    pct_share: s.pctShare,
    notes: input.notes || `Distribution of ₱${Math.abs(amount).toFixed(2)} ${label} dated ${input.allocationDate}`
  }))

  await supabase.from("investment_allocations").insert(rows)

  const gainTransactions = rows
    .filter((r) => r.amount !== 0)
    .map((r) => ({
      member_id: r.member_id,
      bank_account_id: null,
      investment_id: input.investmentId,
      classification: "Gain Allocation",
      affects_cash: 0,
      amount: r.allocation_type === "Investment Loss" ? -r.amount : r.amount,
      description: `Share of investment ${label} distributed ${input.allocationDate}`,
      status: "approved"
    }))

  if (gainTransactions.length > 0) {
    await supabase.from("transactions").insert(gainTransactions)
  }
}

/**
 * The investment's realized gain/loss (returned - invested, from approved
 * Investment / Investment Return transactions dated on or before asOfDate)
 * minus whatever has already been distributed via investment_allocations
 * (all-time, regardless of date -- a distribution already made shouldn't be
 * re-suggested no matter what date a later distribution is run for). Used
 * to prefill the distribution form with a sensible default amount.
 */
export async function getUndistributedInvestmentGain(investmentId: string, asOfDate: string): Promise<number> {
  const isOnOrBefore = (row: Parameters<typeof effectiveDate>[0]) => dateOnly(effectiveDate(row)) <= asOfDate

  const { data: txns } = await supabase
    .from("transactions")
    .select("amount, classification, txn_date, created_at")
    .eq("investment_id", investmentId)
    .eq("status", "approved")
    .in("classification", ["Investment", "Investment Return"])

  const invested = (txns ?? [])
    .filter((t) => t.classification === "Investment" && isOnOrBefore(t))
    .reduce((sum, t) => sum - Number(t.amount), 0)

  const returned = (txns ?? [])
    .filter((t) => t.classification === "Investment Return" && isOnOrBefore(t))
    .reduce((sum, t) => sum + Number(t.amount), 0)

  const { data: allocRows } = await supabase
    .from("investment_allocations")
    .select("amount, allocation_type")
    .eq("investment_id", investmentId)

  const alreadyDistributed = (allocRows ?? []).reduce(
    (sum, r) => sum + (r.allocation_type === "Investment Loss" ? -Number(r.amount) : Number(r.amount)),
    0
  )

  return Number((returned - invested - alreadyDistributed).toFixed(2))
}
