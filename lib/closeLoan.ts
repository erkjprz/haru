import { supabase } from "@/lib/supabase"

// Closes a loan and distributes its gain/loss across gain-sharing-eligible
// members (excludes the borrower, and excludes anyone with
// gain_sharing_eligible = false). `repaidApproved` must already be computed
// by the caller from approved-only Loan Repayment transactions — this
// function does not re-derive it, so it can be reused by both the manual
// close/write-off buttons (which already have this on hand) and the
// auto-close trigger (which computes it fresh).
export async function closeLoanAndDistributeGain(loan: {
  id: string
  member_id: string | null
  principal: number | string
  repaidApproved: number
  borrowerName?: string
}) {
  const gain = loan.repaidApproved - Number(loan.principal)

  const { data: allMembers } = await supabase
    .from("members")
    .select("member_id, name, gain_sharing_eligible")

  const eligibleMembers = (allMembers ?? []).filter(
    (m) => m.member_id !== loan.member_id && m.gain_sharing_eligible !== false
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

    // "Current Value" — same basis as /fund-breakdown — so this loan's
    // gain or loss is split by what each member actually has in the fund
    // today (including past gains/losses), not just raw contributions.
    return {
      member,
      balance: net + priorNet
    }
  })

  const totalBalance = balances.reduce((sum, b) => sum + b.balance, 0)

  if (gain !== 0 && totalBalance > 0) {
    const currentYear = new Date().getFullYear()
    const category = gain > 0 ? "loan_interest" : "loan_writeoff"
    const label = gain > 0 ? "gain" : "loss"

    const allocationRows = balances.map((b) => ({
      member_id: b.member.member_id,
      loan_id: loan.id,
      year: currentYear,
      category,
      amount: Number(((b.balance / totalBalance) * gain).toFixed(2)),
      notes: `${b.member.name} balance ₱${b.balance.toFixed(2)} / total ₱${totalBalance.toFixed(2)} of ₱${Math.abs(gain).toFixed(2)} ${label} from loan closed ${new Date().toISOString().slice(0, 10)}`
    }))

    await supabase.from("investment_allocations").insert(allocationRows)

    // Gain allocations are bookkeeping, not cash movement: affects_cash 0
    // keeps them out of the cash ledger.
    const transactionRows = allocationRows.map((row) => ({
      member_id: row.member_id,
      bank_account_id: null,
      loan_id: loan.id,
      classification: "Gain Allocation",
      affects_cash: 0,
      amount: row.amount,
      description: `Share of ${currentYear} loan ${label} (from ${loan.borrowerName || "a member"}'s loan)`,
      status: "approved"
    }))

    await supabase.from("transactions").insert(transactionRows)
  }

  await supabase.from("loans").update({ status: "closed" }).eq("loan_id", loan.id)
}

// Call this right after approving a Loan Repayment transaction. Fetches the
// loan fresh, checks whether it's now fully repaid (approved-only), and if
// so closes it and distributes gain automatically. No-ops silently if the
// loan isn't active or isn't fully repaid yet — safe to call after every
// repayment approval without checking first.
export async function autoCloseLoanIfFullyRepaid(loanId: string) {
  const { data: loan } = await supabase
    .from("loans")
    .select(`*, members ( name ), borrowers ( name )`)
    .eq("loan_id", loanId)
    .single()

  if (!loan || loan.status !== "active") return

  const { data: repayments } = await supabase
    .from("transactions")
    .select("amount")
    .eq("loan_id", loanId)
    .eq("classification", "Loan Repayment")
    .eq("status", "approved")

  const repaidApproved = (repayments ?? []).reduce(
    (sum, t) => sum + Number(t.amount),
    0
  )

  const totalRepayable =
    Number(loan.principal) + Number(loan.principal) * (Number(loan.interest_rate ?? 0) / 100)

  if (repaidApproved < totalRepayable) return

  await closeLoanAndDistributeGain({
    id: loan.loan_id,
    member_id: loan.member_id,
    principal: loan.principal,
    repaidApproved,
    borrowerName: loan.members?.name || loan.borrowers?.name
  })
}
