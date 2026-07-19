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
 *    allocation_date is set to the closing date (when the gain is booked).
 * 3. The split is proportional to each eligible member's "current value"
 *    at the loan's RELEASE date (start_date) -- not the closing date --
 *    since that's when the member's capital was actually put to work
 *    funding this loan: net contribution + bank interest + prior loan
 *    gains + investment gains/losses (all signed), all dated on or before
 *    the release date.
 * 4. Eligibility requires both net contribution > 0 and current value > 0
 *    as of the release date -- excluded from both the numerator and
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

  const { data: loanRow } = await supabase.from("loans").select("start_date").eq("loan_id", params.id).single()
  const releaseDate = dateOnly(new Date(loanRow?.start_date ?? closingDate))
  const isOnOrBeforeRelease = (row: Parameters<typeof effectiveDate>[0]) =>
    dateOnly(effectiveDate(row)) <= releaseDate

  const { data: allMembers } = await supabase
    .from("members")
    .select("member_id, name, gain_sharing_eligible")

  const eligibleMembers = (allMembers ?? []).filter(
    (m) => m.member_id !== params.member_id && m.gain_sharing_eligible !== false
  )

  // Net contribution: Member Contribution / Member Withdrawal transactions,
  // dated on or before the loan's release date.
  const { data: contributionTxns } = await supabase
    .from("transactions")
    .select("member_id, classification, amount, status, txn_date, created_at")
    .in("classification", ["Member Contribution", "Member Withdrawal"])
    .eq("status", "approved")

  // Bank interest already credited, dated on or before the release date.
  const { data: bankInterestRows } = await supabase
    .from("bank_interest_allocations")
    .select("member_id, amount, allocation_date")

  // Prior loan gains from other, already-closed loans -- these compound
  // into current value per Section 14 rule 3. (This loan hasn't written
  // any rows yet, so no risk of double-counting itself here.)
  const { data: priorLoanGainRows } = await supabase
    .from("loan_gain_allocations")
    .select("member_id, amount, allocation_date")

  // Investment gains/losses, signed, dated on or before the release date.
  const { data: investmentRows } = await supabase
    .from("investment_allocations")
    .select("member_id, amount, allocation_type, investments(name)")

  const currentValueByMember = new Map<string, number>()

  for (const member of eligibleMembers) {
    const netContribution = (contributionTxns ?? [])
      .filter((t) => t.member_id === member.member_id && isOnOrBeforeRelease(t))
      .reduce((sum, t) => sum + Number(t.amount), 0)

    const bankInterest = (bankInterestRows ?? [])
      .filter((r) => r.member_id === member.member_id && isOnOrBeforeRelease(r))
      .reduce((sum, r) => sum + Number(r.amount), 0)

    const priorLoanGains = (priorLoanGainRows ?? [])
      .filter((r) => r.member_id === member.member_id && isOnOrBeforeRelease(r))
      .reduce((sum, r) => sum + Number(r.amount), 0)

    // Farm On's loss and Perfume Biz's gain are the fund's only two
    // investment events to date, dated 2019-07-15 and 2020-08-24
    // respectively -- investment_allocations has no date column of its own.
    const investmentGains = (investmentRows ?? [])
      .filter((r) => {
        if (r.member_id !== member.member_id) return false
        const name = (r.investments as unknown as { name?: string } | null)?.name
        if (name === "Farm On") return releaseDate >= "2019-07-15"
        if (name === "Perfume Est 2020") return releaseDate >= "2020-08-24"
        return false
      })
      .reduce((sum, r) => sum + (r.allocation_type === "Investment Loss" ? -Number(r.amount) : Number(r.amount)), 0)

    if (netContribution > 0) {
      currentValueByMember.set(
        member.member_id,
        netContribution + bankInterest + priorLoanGains + investmentGains
      )
    }
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
      current_value: s.currentValue,
      pct_share: Number(((s.currentValue / totalValue) * 100).toFixed(2)),
      notes: `Share of ₱${Math.abs(gainOrLoss).toFixed(2)} ${gainOrLossLabel} from loan closed ${closingDate}, based on current value at release date ${releaseDate}`
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
