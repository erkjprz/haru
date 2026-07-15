import { supabase } from "@/lib/supabase"

// Closes a loan and distributes its gain/loss across gain-sharing-eligible
// members (excludes the borrower, and excludes anyone with
// gain_sharing_eligible = false, e.g. Yabie). `repaidApproved` must already
// be computed by the caller from approved-only loan_repayment transactions —
// this function does not re-derive it, so it can be reused by both the
// manual close/write-off buttons (which already have this on hand) and the
// auto-close trigger (which computes it fresh).
export async function closeLoanAndDistributeGain(loan: {
  id: string
  member_id: string
  principal: number | string
  repaidApproved: number
  borrowerName?: string
}) {
  const gain = loan.repaidApproved - Number(loan.principal)

  const { data: allMembers } = await supabase
    .from("members")
    .select("id, name, gain_sharing_eligible")

  const eligibleMembers = (allMembers ?? []).filter(
    (m) => m.id !== loan.member_id && m.gain_sharing_eligible !== false
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

    // "Current Value" — same basis as /fund-breakdown — so this loan's
    // gain or loss is split by what each member actually has in the fund
    // today (including past gains/losses), not just raw contributions.
    return {
      member,
      balance: contributed - withdrawn + priorNet
    }
  })

  const totalBalance = balances.reduce((sum, b) => sum + b.balance, 0)

  if (gain !== 0 && totalBalance > 0) {
    const currentYear = new Date().getFullYear()
    const category = gain > 0 ? "loan_interest" : "loan_writeoff"
    const label = gain > 0 ? "gain" : "loss"

    const allocationRows = balances.map((b) => ({
      member_id: b.member.id,
      loan_id: loan.id,
      year: currentYear,
      category,
      amount: Number(((b.balance / totalBalance) * gain).toFixed(2)),
      notes: `${b.member.name} balance ₱${b.balance.toFixed(2)} / total ₱${totalBalance.toFixed(2)} of ₱${Math.abs(gain).toFixed(2)} ${label} from loan closed ${new Date().toISOString().slice(0, 10)}`
    }))

    await supabase.from("investment_allocations").insert(allocationRows)

    const transactionRows = allocationRows.map((row) => ({
      member_id: row.member_id,
      bank_account_id: null,
      loan_id: loan.id,
      type: "investment_allocation",
      amount: row.amount,
      description: `Share of ${currentYear} loan ${label} (from ${loan.borrowerName || "a member"}'s loan)`,
      status: "approved"
    }))

    await supabase.from("transactions").insert(transactionRows)
  }

  await supabase.from("loans").update({ status: "closed" }).eq("id", loan.id)
}

// Call this right after approving a loan_repayment transaction. Fetches the
// loan fresh, checks whether it's now fully repaid (approved-only), and if
// so closes it and distributes gain automatically. No-ops silently if the
// loan isn't active or isn't fully repaid yet — safe to call after every
// repayment approval without checking first.
export async function autoCloseLoanIfFullyRepaid(loanId: string) {
  const { data: loan } = await supabase
    .from("loans")
    .select(`*, members ( name )`)
    .eq("id", loanId)
    .single()

  if (!loan || loan.status !== "active") return

  const { data: repayments } = await supabase
    .from("transactions")
    .select("amount")
    .eq("loan_id", loanId)
    .eq("type", "loan_repayment")
    .eq("status", "approved")

  const repaidApproved = (repayments ?? []).reduce(
    (sum, t) => sum + Number(t.amount),
    0
  )

  const totalRepayable =
    Number(loan.principal) + Number(loan.principal) * (Number(loan.interest_rate) / 100)

  if (repaidApproved < totalRepayable) return

  await closeLoanAndDistributeGain({
    id: loan.id,
    member_id: loan.member_id,
    principal: loan.principal,
    repaidApproved,
    borrowerName: loan.members?.name
  })
}
