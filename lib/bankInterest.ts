import { supabase } from "@/lib/supabase"

// A row's real-world date is txn_date, falling back to created_at only
// when txn_date is null -- same convention used throughout the rest of the
// app (see effectiveDate in the transactions list page / closeLoan.ts).
function effectiveDate(row: { txn_date?: string | null; created_at?: string | null }): Date {
  return new Date(row.txn_date ?? row.created_at ?? Date.now())
}

function dateOnly(d: Date): string {
  return d.toISOString().slice(0, 10)
}

/**
 * Distributes a single Bank Interest transaction's amount across all
 * gain-sharing-eligible members and marks that transaction as distributed.
 *
 * Matches the documented methodology of the original (pre-existing)
 * bank_interest_allocations data:
 * - "Current value" for this purpose is net contribution/withdrawal balance
 *   ONLY, dated on or before the interest transaction's own date --
 *   investment allocations are deliberately excluded (same reasoning as
 *   the loan-gain methodology: a flat investment credit isn't capital that
 *   was actually sitting in the fund earning this interest).
 * - Unlike loan-gain sharing, a member with zero (or negative, floored to
 *   zero) balance still gets a row, just for ₱0 -- they are not excluded
 *   from the list, only from receiving a positive share. This matches the
 *   existing historical rows, which give a member with no contribution
 *   balance a ₱0 entry with an explanatory note rather than omitting them.
 * - Rounding residual is absorbed by the largest-share member, consistent
 *   with the loan-gain allocation convention, so the allocated total ties
 *   to the transaction's exact amount, to the peso.
 *
 * Writes to bank_interest_allocations (member_id, bank, allocation_date,
 * amount, notes) -- NOT investment_allocations, which has no
 * year/category columns and was the source of a bug where every call to
 * this function silently failed to record anything in a structured ledger
 * table (the "Gain Allocation" transactions still got created, which is
 * why it looked like it was working).
 */
export async function distributeBankInterest(transactionId: string) {
  const { data: sourceTxn } = await supabase
    .from("transactions")
    .select("transaction_id, amount, txn_date, created_at, bank, bank_account_id")
    .eq("transaction_id", transactionId)
    .single()

  if (!sourceTxn) return

  const interestAmount = Number(sourceTxn.amount)
  const creditDate = dateOnly(effectiveDate(sourceTxn))

  // Resolve which bank this interest came from: new-model rows carry
  // bank_account_id (FK to bank_accounts), legacy rows carry the plain
  // `bank` text column directly.
  let bankLabel = sourceTxn.bank as string | null
  if (!bankLabel && sourceTxn.bank_account_id) {
    const { data: bankAccount } = await supabase
      .from("bank_accounts")
      .select("bank_name")
      .eq("id", sourceTxn.bank_account_id)
      .single()
    bankLabel = bankAccount?.bank_name ?? null
  }

  if (interestAmount === 0 || !bankLabel) {
    await supabase
      .from("transactions")
      .update({ interest_distributed: true })
      .eq("transaction_id", transactionId)
    return
  }

  const { data: allMembers } = await supabase
    .from("members")
    .select("member_id, name, gain_sharing_eligible")

  const eligibleMembers = (allMembers ?? []).filter((m) => m.gain_sharing_eligible !== false)

  const { data: contributionTxns } = await supabase
    .from("transactions")
    .select("member_id, classification, amount, status, txn_date, created_at")
    .in("classification", ["Member Contribution", "Member Withdrawal"])
    .eq("status", "approved")

  const balances = eligibleMembers.map((member) => {
    const netContribution = (contributionTxns ?? [])
      .filter(
        (t) =>
          t.member_id === member.member_id && dateOnly(effectiveDate(t)) <= creditDate
      )
      .reduce((sum, t) => sum + Number(t.amount), 0)

    // Floored at 0, not excluded -- a member with no (or negative) balance
    // still gets a row, just for ₱0.
    return { member, balance: Math.max(0, netContribution) }
  })

  const totalBalance = balances.reduce((sum, b) => sum + b.balance, 0)

  const shares = balances.map((b) => ({
    member_id: b.member.member_id,
    memberName: b.member.name as string,
    balance: b.balance,
    amount: totalBalance > 0 ? Number(((b.balance / totalBalance) * interestAmount).toFixed(2)) : 0
  }))

  // Rounding residual absorbed by the largest-share member so the
  // allocated total ties to interestAmount exactly, to the peso.
  if (totalBalance > 0) {
    const allocatedTotal = shares.reduce((sum, s) => sum + s.amount, 0)
    const residual = Number((interestAmount - allocatedTotal).toFixed(2))
    if (residual !== 0) {
      const largest = shares.reduce((a, b) => (Math.abs(b.amount) > Math.abs(a.amount) ? b : a))
      largest.amount = Number((largest.amount + residual).toFixed(2))
    }
  }

  const year = effectiveDate(sourceTxn).getFullYear()

  const bankInterestRows = shares.map((s) => ({
    member_id: s.member_id,
    bank: bankLabel,
    allocation_date: creditDate,
    amount: s.amount,
    notes:
      s.balance > 0
        ? `${s.memberName} balance ₱${s.balance.toFixed(2)} / total ₱${totalBalance.toFixed(2)} of ₱${interestAmount.toFixed(2)} ${bankLabel} interest credited ${creditDate}`
        : `No contribution balance in the fund as of ${creditDate}`
  }))

  await supabase.from("bank_interest_allocations").insert(bankInterestRows)

  const gainTransactions = shares
    .filter((s) => s.amount !== 0)
    .map((s) => ({
      member_id: s.member_id,
      bank_account_id: null,
      classification: "Gain Allocation",
      affects_cash: 0,
      amount: s.amount,
      description: `Share of ${year} bank interest`,
      status: "approved"
    }))

  if (gainTransactions.length > 0) {
    await supabase.from("transactions").insert(gainTransactions)
  }

  await supabase
    .from("transactions")
    .update({ interest_distributed: true })
    .eq("transaction_id", transactionId)
}
