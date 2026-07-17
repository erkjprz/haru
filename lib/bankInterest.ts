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

export interface PendingBankInterestGroup {
  year: number
  bank: string
  transactionIds: string[]
  totalAmount: number
  transactionCount: number
}

/**
 * Groups all not-yet-distributed Bank Interest transactions by (year, bank)
 * -- this is the exact granularity the historical bank_interest_allocations
 * data uses: one lump-sum distribution per calendar year per bank (e.g.
 * 2025 has two separate events, BDO and Maya, each split across all 10
 * members), not one event per individual transaction.
 */
export async function getPendingBankInterestGroups(): Promise<PendingBankInterestGroup[]> {
  const { data: pendingTxns } = await supabase
    .from("transactions")
    .select(
      `
      transaction_id, amount, txn_date, created_at, bank, bank_account_id,
      bank_accounts!transactions_bank_account_id_fkey ( bank_name )
    `
    )
    .eq("classification", "Bank Interest")
    .eq("interest_distributed", false)

  const groups = new Map<string, PendingBankInterestGroup>()

  for (const t of pendingTxns ?? []) {
    const bank = t.bank || (t as any).bank_accounts?.bank_name || "Unknown"
    const year = effectiveDate(t).getFullYear()
    const key = `${year}-${bank}`

    const existing = groups.get(key)
    if (existing) {
      existing.transactionIds.push(t.transaction_id)
      existing.totalAmount = Number((existing.totalAmount + Number(t.amount)).toFixed(2))
      existing.transactionCount += 1
    } else {
      groups.set(key, {
        year,
        bank,
        transactionIds: [t.transaction_id],
        totalAmount: Number(t.amount),
        transactionCount: 1
      })
    }
  }

  return Array.from(groups.values()).sort((a, b) => b.year - a.year || a.bank.localeCompare(b.bank))
}

/**
 * Distributes one (year, bank) group's combined Bank Interest total across
 * all gain-sharing-eligible members in a single lump sum, then marks every
 * transaction in that group as distributed.
 *
 * Matches the documented methodology of the original (pre-existing)
 * bank_interest_allocations data:
 * - One row per member per (year, bank) -- not per individual transaction.
 * - "Current value" for the split is net contribution/withdrawal balance
 *   ONLY, dated on or before the distribution date -- investment
 *   allocations are deliberately excluded (same reasoning as the loan-gain
 *   methodology: a flat investment credit isn't capital that was actually
 *   sitting in the fund earning this interest).
 * - A member with zero (or negative, floored to zero) balance still gets a
 *   row, just for ₱0 -- not excluded, unlike loan-gain sharing.
 * - Rounding residual is absorbed by the largest-share member so the
 *   allocated total ties to the group's exact combined amount, to the peso.
 *
 * The historical rows are dated at that year's actual year-end crediting
 * (Dec 30); a manually-triggered distribution instead uses the date it's
 * actually run, since there's no fixed crediting date to anchor to until
 * the fund owner decides to close out the year.
 */
export async function distributeBankInterestGroup(group: PendingBankInterestGroup) {
  const distributionDate = dateOnly(new Date())
  const interestAmount = group.totalAmount

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
        (t) => t.member_id === member.member_id && dateOnly(effectiveDate(t)) <= distributionDate
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

  if (totalBalance > 0) {
    const allocatedTotal = shares.reduce((sum, s) => sum + s.amount, 0)
    const residual = Number((interestAmount - allocatedTotal).toFixed(2))
    if (residual !== 0) {
      const largest = shares.reduce((a, b) => (Math.abs(b.amount) > Math.abs(a.amount) ? b : a))
      largest.amount = Number((largest.amount + residual).toFixed(2))
    }
  }

  const bankInterestRows = shares.map((s) => ({
    member_id: s.member_id,
    bank: group.bank,
    allocation_date: distributionDate,
    amount: s.amount,
    notes:
      s.balance > 0
        ? `${s.memberName} balance ₱${s.balance.toFixed(2)} / total ₱${totalBalance.toFixed(2)} of ₱${interestAmount.toFixed(2)} ${group.bank} interest for ${group.year} distributed ${distributionDate}`
        : `No contribution balance in the fund as of ${distributionDate}`
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
      description: `Share of ${group.year} ${group.bank} bank interest`,
      status: "approved"
    }))

  if (gainTransactions.length > 0) {
    await supabase.from("transactions").insert(gainTransactions)
  }

  await supabase
    .from("transactions")
    .update({ interest_distributed: true })
    .in("transaction_id", group.transactionIds)
}
