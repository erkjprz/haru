import { supabase } from "@/lib/supabase"
import { computeCurrentValueByMember, splitProportionally } from "@/lib/currentValue"

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
 *
 * Also nets in not-yet-distributed Tax transactions for the same (year,
 * bank) so their (negative) amount reduces the interest before it's split
 * -- the bank withholds tax before the interest ever reaches the account,
 * so distributing the gross amount would credit members for money that was
 * never actually there. Tax rows ride along in transactionIds purely so
 * distributeBankInterestGroup marks them interest_distributed too, once
 * consumed -- interest_distributed has no meaning of its own for Tax, it's
 * just reused as "already netted into a distribution."
 *
 * A (year, bank) only becomes a real group if it has at least one pending
 * Bank Interest transaction. Every historical Tax row has
 * interest_distributed = false -- the old distribution flow never touched
 * Tax rows at all, so years whose interest was already fully distributed
 * still have untouched, orphaned Tax rows sitting around. Surfacing those
 * as a fresh "Distribute" target would silently perform an un-reviewed
 * retroactive correction one year at a time; that needs a deliberate,
 * reviewed fix instead, so orphaned tax-only years are left alone here.
 */
export async function getPendingBankInterestGroups(): Promise<PendingBankInterestGroup[]> {
  const { data: pendingTxns, error } = await supabase
    .from("transactions")
    .select(
      `
      transaction_id, amount, txn_date, created_at, bank, bank_account_id, classification,
      bank_accounts!transactions_bank_account_id_fkey ( bank_name )
    `
    )
    .in("classification", ["Bank Interest", "Tax"])
    .eq("interest_distributed", false)

  if (error) throw new Error(error.message)

  type RawGroup = {
    year: number
    bank: string
    interestIds: string[]
    interestTotal: number
    taxIds: string[]
    taxTotal: number
  }

  const raw = new Map<string, RawGroup>()

  for (const t of pendingTxns ?? []) {
    const bank = t.bank || (t as any).bank_accounts?.bank_name || "Unknown"
    const year = effectiveDate(t).getFullYear()
    const key = `${year}-${bank}`

    const existing: RawGroup = raw.get(key) ?? {
      year,
      bank,
      interestIds: [],
      interestTotal: 0,
      taxIds: [],
      taxTotal: 0
    }
    if (t.classification === "Bank Interest") {
      existing.interestIds.push(t.transaction_id)
      existing.interestTotal = Number((existing.interestTotal + Number(t.amount)).toFixed(2))
    } else {
      existing.taxIds.push(t.transaction_id)
      existing.taxTotal = Number((existing.taxTotal + Number(t.amount)).toFixed(2))
    }
    raw.set(key, existing)
  }

  return Array.from(raw.values())
    .filter((g) => g.interestIds.length > 0)
    .map(
      (g): PendingBankInterestGroup => ({
        year: g.year,
        bank: g.bank,
        transactionIds: [...g.interestIds, ...g.taxIds],
        totalAmount: Number((g.interestTotal + g.taxTotal).toFixed(2)),
        transactionCount: g.interestIds.length + g.taxIds.length
      })
    )
    .sort((a, b) => b.year - a.year || a.bank.localeCompare(b.bank))
}

/**
 * Distributes one (year, bank) group's combined Bank Interest total across
 * all eligible members in a single lump sum, then marks every transaction
 * in that group as distributed.
 *
 * Uses the same "current value" pool as loan gain sharing --
 * computeCurrentValueByMember and splitProportionally from currentValue.ts
 * -- rather than a narrower net-contribution-only balance: net contribution
 * + bank interest already received + prior loan gains + investment
 * gains/losses, all dated on or before the distribution date. A member
 * failing eligibility (not gain-sharing-eligible, or a current value <= 0
 * as of that date) is excluded entirely, same as loan gain -- not given a
 * ₱0 row.
 *
 * Rounding residual is absorbed by the largest-share member so the
 * allocated total ties to the group's exact combined amount, to the peso.
 *
 * The historical rows are dated at that year's actual year-end crediting
 * (Dec 30); a manually-triggered distribution instead uses the date it's
 * actually run, since there's no fixed crediting date to anchor to until
 * the fund owner decides to close out the year.
 */
export async function distributeBankInterestGroup(group: PendingBankInterestGroup) {
  const distributionDate = dateOnly(new Date())
  const interestAmount = group.totalAmount

  const currentValueByMember = await computeCurrentValueByMember(distributionDate)
  const shares = splitProportionally(currentValueByMember, interestAmount)

  // splitProportionally returns [] both when interestAmount is exactly 0
  // (fine, nothing to distribute) and when it's nonzero but no member has a
  // positive current value to share it against. The RPC only writes
  // bank_interest_allocations/the Gain Allocation transaction when shares
  // is non-empty, so silently letting a nonzero amount through here would
  // mark the source transactions distributed with that interest never
  // recorded anywhere, and interest_distributed has no reset path to retry
  // it. Matches the guard closeLoanAndDistributeGain/distributeInvestmentGain
  // already have for the same "nowhere to distribute this to" scenario.
  if (interestAmount !== 0 && shares.length === 0) {
    throw new Error(
      "No member has a positive current value as of this date -- nothing to distribute this interest against."
    )
  }

  const rpcShares = shares.map((s) => ({
    member_id: s.member_id,
    amount: s.amount,
    current_value: s.currentValue,
    pct_share: s.pctShare,
    notes: `Share of ₱${interestAmount.toFixed(2)} ${group.bank} interest for ${group.year} distributed ${distributionDate}`,
    description: `Share of ${group.year} ${group.bank} bank interest`
  }))

  // The allocation rows, the crediting transactions, and marking the
  // source transactions as distributed were previously three separate
  // client-side calls with no rollback between them -- a failure partway
  // through could leave a distribution half-done, and since
  // interest_distributed has no retry path, a failed allocation insert
  // specifically would be permanently invisible with no way to redo it.
  // One atomic RPC call now does all three.
  const { error } = await supabase.rpc("distribute_bank_interest_group", {
    p_bank: group.bank,
    p_distribution_date: distributionDate,
    p_transaction_ids: group.transactionIds,
    p_shares: rpcShares
  })

  if (error) throw new Error(error.message)
}
