import { supabase } from "@/lib/supabase"

// Splits a bank_interest transaction across all gain-sharing-eligible
// members (same eligibility flag used for loan gains — currently excludes
// Yabie), proportional to each member's current value at the moment the
// interest was recorded. Call this right after inserting an approved
// bank_interest transaction — bank_interest is always admin-entered and
// instantly approved, so there's no pending state to wait on.
export async function distributeBankInterest(transactionId: string) {
  const { data: transaction } = await supabase
    .from("transactions")
    .select("id, amount, created_at")
    .eq("id", transactionId)
    .single()

  if (!transaction) return

  const gain = Number(transaction.amount)
  if (gain === 0) return

  const { data: allMembers } = await supabase
    .from("members")
    .select("id, name, gain_sharing_eligible")

  const eligibleMembers = (allMembers ?? []).filter(
    (m) => m.gain_sharing_eligible !== false
  )

  const { data: allTransactions } = await supabase
    .from("transactions")
    .select("member_id, type, amount, status")
    .eq("status", "approved")

  const { data: priorAllocations } = await supabase
    .from("investment_allocations")
    .select("member_id, amount")

  const balances = eligibleMembers.map((member) => {
    const contributed = (allTransactions ?? [])
      .filter((t) => t.member_id === member.id && t.type === "contribution")
      .reduce((sum, t) => sum + Number(t.amount), 0)

    const withdrawn = (allTransactions ?? [])
      .filter((t) => t.member_id === member.id && t.type === "withdrawal")
      .reduce((sum, t) => sum + Number(t.amount), 0)

    const priorNet = (priorAllocations ?? [])
      .filter((a) => a.member_id === member.id)
      .reduce((sum, a) => sum + Number(a.amount), 0)

    return {
      member,
      balance: contributed - withdrawn + priorNet
    }
  })

  const totalBalance = balances.reduce((sum, b) => sum + b.balance, 0)
  if (totalBalance <= 0) return

  const year = new Date(transaction.created_at).getFullYear()

  const allocationRows = balances.map((b) => ({
    member_id: b.member.id,
    year,
    category: "bank_interest",
    amount: Number(((b.balance / totalBalance) * gain).toFixed(2)),
    notes: `${b.member.name} balance ₱${b.balance.toFixed(2)} / total ₱${totalBalance.toFixed(2)} of ₱${gain.toFixed(2)} bank interest distributed ${new Date().toISOString().slice(0, 10)}`
  }))

  await supabase.from("investment_allocations").insert(allocationRows)

  const transactionRows = allocationRows.map((row) => ({
    member_id: row.member_id,
    bank_account_id: null,
    type: "investment_allocation",
    amount: row.amount,
    description: `Share of ${year} bank interest`,
    status: "approved"
  }))

  await supabase.from("transactions").insert(transactionRows)
}
