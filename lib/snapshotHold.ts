import { supabase } from "@/lib/supabase"
import { computeCurrentValueByMember } from "@/lib/currentValue"

async function poolShares(excludeMemberId: string | null, asOfDate: string) {
  const currentValueByMember = await computeCurrentValueByMember(asOfDate, excludeMemberId)
  const totalValue = Array.from(currentValueByMember.values()).reduce((sum, v) => sum + v, 0)
  if (totalValue <= 0) return []

  return Array.from(currentValueByMember.entries()).map(([member_id, currentValue]) => ({
    member_id,
    share: currentValue / totalValue
  }))
}

/**
 * Snapshots each eligible member's fractional share of the pool at the
 * moment a loan is released, replacing any existing snapshot for this loan.
 * v_member_loan_hold multiplies this share by the loan's live outstanding
 * balance to get each member's current dollar hold -- the share itself is
 * frozen at release since a loan only has one principal.
 */
export async function snapshotLoanHold(loanId: string, borrowerMemberId: string | null, releaseDate: string) {
  await supabase.from("loan_hold_allocations").delete().eq("loan_id", loanId)

  const shares = await poolShares(borrowerMemberId, releaseDate)
  if (shares.length === 0) return

  const rows = shares.map((s) => ({
    loan_id: loanId,
    member_id: s.member_id,
    share: s.share,
    snapshot_date: releaseDate,
    notes: `Frozen at loan release (${releaseDate})`
  }))

  await supabase.from("loan_hold_allocations").insert(rows)
}

/**
 * Re-snapshots each eligible member's fractional share of the pool for an
 * investment, replacing any existing snapshot. Unlike a loan, an investment
 * can take capital in multiple tranches over time, so this re-snapshots
 * (rather than snapshotting once) every time a new "Investment" transaction
 * is recorded -- the latest snapshot represents who effectively owns the
 * investment's outstanding capital right now.
 */
export async function snapshotInvestmentHold(investmentId: string, asOfDate: string) {
  await supabase.from("investment_hold_allocations").delete().eq("investment_id", investmentId)

  const shares = await poolShares(null, asOfDate)
  if (shares.length === 0) return

  const rows = shares.map((s) => ({
    investment_id: investmentId,
    member_id: s.member_id,
    share: s.share,
    snapshot_date: asOfDate,
    notes: `Re-snapshotted after new capital added (${asOfDate})`
  }))

  await supabase.from("investment_hold_allocations").insert(rows)
}
