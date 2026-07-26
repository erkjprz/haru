import { supabase } from "@/lib/supabase"
import { computeCurrentValueByMember } from "@/lib/currentValue"

interface ApproveLoanReleaseParams {
  loanId: string
  borrowerMemberId: string | null
  bankAccountId: string
  receiptUrl: string
  releaseDate: string
}

/**
 * Approves a loan's disbursement in one atomic step: verifies a pending
 * Loan Release transaction actually exists for this loan (refusing to
 * activate a loan whose request was rejected or otherwise has nothing real
 * to disburse), marks it approved with the disbursing bank/receipt,
 * activates the loan, and freezes each eligible member's pool share for
 * this loan's hold -- all via approve_loan_release in one DB transaction,
 * so a failure partway through can't leave the loan active with its
 * disbursement still pending, or approved with no hold ever snapshotted.
 *
 * Replaces two near-duplicate client-side implementations (the Txns review
 * card in admin/page.tsx and the loan's own "Approve & Activate" in
 * LoanDetailPanel) that each did the same three writes separately with no
 * rollback between them, plus the old snapshotLoanHold helper, which never
 * checked its own delete/insert errors -- a failed hold write looked
 * identical to a successful one.
 */
export async function approveLoanRelease(params: ApproveLoanReleaseParams) {
  const currentValueByMember = await computeCurrentValueByMember(params.releaseDate, params.borrowerMemberId)
  const totalValue = Array.from(currentValueByMember.values()).reduce((sum, v) => sum + v, 0)

  const holds =
    totalValue > 0
      ? Array.from(currentValueByMember.entries()).map(([member_id, currentValue]) => ({
          member_id,
          share: currentValue / totalValue
        }))
      : []

  const { error } = await supabase.rpc("approve_loan_release", {
    p_loan_id: params.loanId,
    p_bank_account_id: params.bankAccountId,
    p_receipt_url: params.receiptUrl,
    p_release_date: params.releaseDate,
    p_holds: holds
  })

  if (error) throw new Error(error.message)
}
