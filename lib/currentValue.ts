import { supabase } from "@/lib/supabase"

// A row's real-world date is txn_date (transactions) or allocation_date
// (bank_interest_allocations / loan_gain_allocations / investment_allocations),
// falling back to created_at only when neither is present -- same convention
// used throughout the app (see the transactions list page).
export function effectiveDate(row: {
  txn_date?: string | null
  allocation_date?: string | null
  created_at?: string | null
}): Date {
  return new Date(row.txn_date ?? row.allocation_date ?? row.created_at ?? Date.now())
}

export function dateOnly(d: Date): string {
  return d.toISOString().slice(0, 10)
}

// Farm On's loss and Perfume Est 2020's gain are the fund's only two
// investment events that predate investment_allocations.allocation_date --
// they're dated 2019-07-15 and 2020-08-24 respectively via this hardcoded
// fallback instead. Any investment_allocations row with allocation_date set
// (i.e. everything going forward) uses that column directly.
function legacyInvestmentDate(investmentName: string | undefined): string | null {
  if (investmentName === "Farm On") return "2019-07-15"
  if (investmentName === "Perfume Est 2020") return "2020-08-24"
  return null
}

/**
 * Computes each eligible member's "current value" in the fund as of a given
 * date: net contribution + bank interest + prior loan gains + investment
 * gains/losses (all signed), all dated on or before asOfDate.
 *
 * Eligibility requires gain_sharing_eligible, net contribution > 0, and a
 * resulting current value > 0 as of that date -- members failing either
 * check are simply absent from the returned map, not floored to 0. This is
 * the shared pool definition behind loan gain splits, investment gain/loss
 * distributions, and capital-hold shares -- keep all three in sync by
 * calling this instead of re-deriving the formula.
 */
export async function computeCurrentValueByMember(
  asOfDate: string,
  excludeMemberId?: string | null
): Promise<Map<string, number>> {
  const isOnOrBefore = (row: Parameters<typeof effectiveDate>[0]) => dateOnly(effectiveDate(row)) <= asOfDate

  const { data: allMembers } = await supabase.from("members").select("member_id, gain_sharing_eligible")

  const eligibleMembers = (allMembers ?? []).filter(
    (m) => m.member_id !== excludeMemberId && m.gain_sharing_eligible !== false
  )

  const { data: contributionTxns } = await supabase
    .from("transactions")
    .select("member_id, amount, txn_date, created_at")
    .in("classification", ["Member Contribution", "Member Withdrawal"])
    .eq("status", "approved")

  const { data: bankInterestRows } = await supabase
    .from("bank_interest_allocations")
    .select("member_id, amount, allocation_date")

  const { data: loanGainRows } = await supabase
    .from("loan_gain_allocations")
    .select("member_id, amount, allocation_date")

  const { data: investmentRows } = await supabase
    .from("investment_allocations")
    .select("member_id, amount, allocation_type, allocation_date, investments(name)")

  const currentValueByMember = new Map<string, number>()

  for (const member of eligibleMembers) {
    const netContribution = (contributionTxns ?? [])
      .filter((t) => t.member_id === member.member_id && isOnOrBefore(t))
      .reduce((sum, t) => sum + Number(t.amount), 0)

    if (netContribution <= 0) continue

    const bankInterest = (bankInterestRows ?? [])
      .filter((r) => r.member_id === member.member_id && isOnOrBefore(r))
      .reduce((sum, r) => sum + Number(r.amount), 0)

    const priorLoanGains = (loanGainRows ?? [])
      .filter((r) => r.member_id === member.member_id && isOnOrBefore(r))
      .reduce((sum, r) => sum + Number(r.amount), 0)

    const investmentGains = (investmentRows ?? [])
      .filter((r) => {
        if (r.member_id !== member.member_id) return false
        const name = (r.investments as unknown as { name?: string } | null)?.name
        const eventDate = r.allocation_date ?? legacyInvestmentDate(name)
        return eventDate !== null && eventDate <= asOfDate
      })
      .reduce((sum, r) => sum + (r.allocation_type === "Investment Loss" ? -Number(r.amount) : Number(r.amount)), 0)

    const currentValue = netContribution + bankInterest + priorLoanGains + investmentGains
    if (currentValue > 0) currentValueByMember.set(member.member_id, currentValue)
  }

  return currentValueByMember
}

export interface ProportionalShare {
  member_id: string
  currentValue: number
  amount: number
  pctShare: number
}

/**
 * Splits a signed total amount across members proportional to their current
 * value, rounded to the peso with the rounding residual absorbed by the
 * largest-magnitude share so the allocated total always ties to totalAmount
 * exactly. Shared by loan gain splits, investment gain/loss distributions,
 * and bank interest distribution.
 */
export function splitProportionally(
  currentValueByMember: Map<string, number>,
  totalAmount: number
): ProportionalShare[] {
  if (totalAmount === 0) return []

  const totalValue = Array.from(currentValueByMember.values()).reduce((sum, v) => sum + v, 0)
  if (totalValue <= 0) return []

  const shares: ProportionalShare[] = Array.from(currentValueByMember.entries()).map(([member_id, currentValue]) => ({
    member_id,
    currentValue,
    amount: Number(((currentValue / totalValue) * totalAmount).toFixed(2)),
    pctShare: Number(((currentValue / totalValue) * 100).toFixed(2))
  }))

  const allocatedTotal = shares.reduce((sum, s) => sum + s.amount, 0)
  const residual = Number((totalAmount - allocatedTotal).toFixed(2))
  if (residual !== 0) {
    const largest = shares.reduce((a, b) => (Math.abs(b.amount) > Math.abs(a.amount) ? b : a))
    largest.amount = Number((largest.amount + residual).toFixed(2))
  }

  return shares
}
