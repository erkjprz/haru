import { supabase } from "@/lib/supabase"

// Splits a Bank Interest transaction across all gain-sharing-eligible
// members (same eligibility flag used for loan gains), proportional to each
// member's current value at the moment the interest was recorded. Call this
// right after inserting an approved Bank Interest transaction — bank
// interest is always admin-entered and instantly approved, so there's no
// pending state to wait on.
export async function distributeBankInterest(transactionId: string) {
  const { data: transaction } = await supabase
    .from("transactions")
    .select("transaction_id, amount, created_at")
    .eq("transaction_id", transactionId)
    .single()

  if (!transaction) return

  const gain = Number(transaction.amount)
  if (gain === 0) return

  const { data: allMembers } = await supabase
    .from("members")
    .select("member_id, name, gain_sharing_eligible")

  const eligibleMembers = (allMembers ?? []).filter(
    (m) => m.gain_sharing_eligible !== false
  )

  const { data: allTransactions } = await supabase
    .from("transactions")
    .select("member_id, classification, amount, status")
    .eq("status", "approved")

  const { data: priorAllocations } = await supabase
    .from("investment_allocations")
    .select("member_id, amount")

  const balances = eligibleMembers.map((member) => {
    // Ledger amounts are signed (contributions +, withdrawals −), so the
    // member's net position is a straight sum.
    const net = (allTransactions ?? [])
      .filter(
        (t) =>
          t.member_id === member.member_id &&
          (t.classification === "Member Contribution" ||
            t.classification === "Member Withdrawal")
      )
      .reduce((sum, t) => sum + Number(t.amount), 0)

    const priorNet = (priorAllocations ?? [])
      .filter((a) => a.member_id === member.member_id)
      .reduce((sum, a) => sum + Number(a.amount), 0)

    return {
      member,
      balance: net + priorNet
    }
  })

  const totalBalance = balances.reduce((sum, b) => sum + b.balance, 0)
  if (totalBalance <= 0) return

  const year = new Date(transaction.created_at).getFullYear()

  const allocationRows = balances.map((b) => ({
    member_id: b.member.member_id,
    year,
    category: "bank_interest",
    amount: Number(((b.balance / totalBalance) * gain).toFixed(2)),
    notes: `${b.member.name} balance ₱${b.balance.toFixed(2)} / total ₱${totalBalance.toFixed(2)} of ₱${gain.toFixed(2)} bank interest distributed ${new Date().toISOString().slice(0, 10)}`
  }))

  await supabase.from("investment_allocations").insert(allocationRows)

  // Gain allocations are bookkeeping, not cash movement: affects_cash 0
  // keeps them out of the cash ledger.
  const transactionRows = allocationRows.map((row) => ({
    member_id: row.member_id,
    bank_account_id: null,
    classification: "Gain Allocation",
    affects_cash: 0,
    amount: row.amount,
    description: `Share of ${year} bank interest`,
    status: "approved"
  }))

  await supabase.from("transactions").insert(transactionRows)
}
