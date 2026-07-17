import { supabase } from "@/lib/supabase"

interface CloseLoanParams {
  id: string
  member_id: string | null
  principal: number
  repaidApproved: number
  borrowerName?: string
}

// A row's real-world date is txn_date (transactions) or allocation_date
// (bank_interest_allocations / loan_gain_allocations), falling back to
// created_at only when neither is present -- same convention used
// throughout the rest of the app (see effectiveDate in the transactions
// list page).
function effectiveDate(row: {
  txn_date?: string | null
  allocation_date?: string | null
  created_at?: string | null
}): Date {
  return new Date(row.txn_date ?? row.allocation_date ?? row.created_at ?? Date.now())
}

function dateOnly(d: Date): string {
  return d.toISOString().slice(0, 10)
}

/**
 * Distributes a closed loan's gain (or loss) across eligible members and
 * marks the loan closed.
 *
 * Follows the project's documented Section 14 methodology:
 * 1. The borrower never shares in their own loan's gain.
 * 2. Gain is distributed once, at the moment the loan closes --
 *    allocation_date is set to the closing date.
 * 3. The split is proportional to each eligible member's "current value"
 *    at that exact closing date: net contribution + bank interest + prior
 *    loan gains, all dated on or before the closing date. Investment
 *    gain/loss is deliberately EXCLUDED -- a flat, contribution-independent
 *    investment credit (e.g. the equal-split Perfume Biz allocation) isn't
 *    capital that was actually "working" during this loan's life, so it
 *    shouldn't unlock a share of this loan's interest.
 * 4. Members with current value <= 0 at the closing date get no row at all
 *    -- excluded from both the numerator and denominator of the split, not
 *    floored to 0.
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
  const isOnOrBeforeClosing = (row: Parameters<typeof effectiveDate>[0]) =>
    dateOnly(effectiveDate(row)) <= closingDate

  const { data: allMembers } = await supabase
    .from("members")
    .select("member_id, name, gain_sharing_eligible")

  const eligibleMembers = (allMembers ?? []).filter(
    (m) => m.member_id !== params.member_id && m.gain_sharing_eligible !== false
  )

  // Net contribution: Member Contribution / Member Withdrawal transactions,
  // dated on or before the closing date.
  const { data: contributionTxns } = await supabase
    .from("transactions")
    .select("member_id, classification, amount, status, txn_date, created_at")
    .in("classification", ["Member Contribution", "Member Withdrawal"])
    .eq("status", "approved")

  // Bank interest already credited, dated on or before the closing date.
  const { data: bankInterestRows } = await supabase
    .from("bank_interest_allocations")
    .select("member_id, amount, allocation_date")

  // Prior loan gains from other, already-closed loans -- these compound
  // into current value per Section 14 rule 5. (This loan hasn't written
  // any rows yet, so no risk of double-counting itself here.)
  const { data: priorLoanGainRows } = await supabase
    .from("loan_gain_allocations")
    .select("member_id, amount, allocation_date")

  const currentValueByMember = new Map<string, number>()

  for (const member of eligibleMembers) {
    const netContribution = (contributionTxns ?? [])
      .filter((t) => t.member_id === member.member_id && isOnOrBeforeClosing(t))
      .reduce((sum, t) => sum + Number(t.amount), 0)

    const bankInterest = (bankInterestRows ?? [])
      .filter((r) => r.member_id === member.member_id && isOnOrBeforeClosing(r))
      .reduce((sum, r) => sum + Number(r.amount), 0)

    const priorLoanGains = (priorLoanGainRows ?? [])
      .filter((r) => r.member_id === member.member_id && isOnOrBeforeClosing(r))
      .reduce((sum, r) => sum + Number(r.amount), 0)

    currentValueByMember.set(member.member_id, netContribution + bankInterest + priorLoanGains)
  }

  // Rule 4: current value <= 0 -> no row at all, excluded from the pool.
  const eligibleWithPositiveValue = eligibleMembers
    .map((member) => ({ member, currentValue: currentValueByMember.get(member.member_id) ?? 0 }))
    .filter((entry) => entry.currentValue > 0)

  const totalValue = eligibleWithPositiveValue.reduce((sum, entry) => sum + entry.currentValue, 0)

  if (gainOrLoss !== 0 && totalValue > 0 && eligibleWithPositiveValue.length > 0) {
    const gainOrLossLabel = gainOrLoss > 0 ? "gain" : "loss"

    const shares = eligibleWithPositiveValue.map((entry) => ({
      member_id: entry.member.member_id,
      memberName: entry.member.name as string,
      currentValue: entry.currentValue,
      amount: Number(((entry.currentValue / totalValue) * gainOrLoss).toFixed(2))
    }))

    // Rule 5: rounding residual absorbed by the largest-share member so the
    // allocated total ties to gainOrLoss exactly, to the peso.
    const allocatedTotal = shares.reduce((sum, s) => sum + s.amount, 0)
    const residual = Number((gainOrLoss - allocatedTotal).toFixed(2))
    if (residual !== 0) {
      const largest = shares.reduce((a, b) => (Math.abs(b.amount) > Math.abs(a.amount) ? b : a))
      largest.amount = Number((largest.amount + residual).toFixed(2))
    }

    const loanGainRows = shares.map((s) => ({
      loan_id: params.id,
      member_id: s.member_id,
      amount: s.amount,
      allocation_date: closingDate,
      notes: `${s.memberName} current value ₱${s.currentValue.toFixed(2)} / total ₱${totalValue.toFixed(2)} of ₱${Math.abs(gainOrLoss).toFixed(2)} ${gainOrLossLabel} from loan closed ${closingDate}`
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

export async function autoCloseLoanIfFullyRepaid(loanId: string) {
  const { data: loan } = await supabase
    .from("loans")
    .select("*, members ( name ), borrowers ( name )")
    .eq("loan_id", loanId)
    .single()

  if (!loan || loan.status !== "active") return

  const { data: repayments } = await supabase
    .from("transactions")
    .select("amount")
    .eq("loan_id", loanId)
    .eq("classification", "Loan Repayment")
    .eq("status", "approved")

  const totalRepaid = (repayments ?? []).reduce((sum, t) => sum + Number(t.amount), 0)

  const fullAmountDue =
    Number(loan.principal) + Number(loan.principal) * (Number(loan.interest_rate ?? 0) / 100)

  if (totalRepaid >= fullAmountDue) {
    await closeLoanAndDistributeGain({
      id: loan.loan_id,
      member_id: loan.member_id,
      principal: loan.principal,
      repaidApproved: totalRepaid,
      borrowerName: loan.members?.name || loan.borrowers?.name
    })
  }
}
