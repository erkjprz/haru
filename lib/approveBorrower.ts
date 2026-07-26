import { supabase } from "@/lib/supabase"

/**
 * Approves a pending borrower-role signup, optionally linking it to an
 * existing loan record (borrowers.member_id). Shared by the two admin
 * screens that both offer this action -- admin/page.tsx's Borrowers tab
 * and admin/borrowers/page.tsx -- so a future change to this flow only
 * needs to happen in one place instead of drifting between two
 * near-identical implementations.
 */
export async function approveBorrowerMember(memberId: string, linkToBorrowerId?: string) {
  const { error: memberError } = await supabase.from("members").update({ status: "approved" }).eq("member_id", memberId)
  if (memberError) throw new Error(memberError.message)

  if (linkToBorrowerId) {
    const { error: borrowerError } = await supabase
      .from("borrowers")
      .update({ member_id: memberId })
      .eq("borrower_id", linkToBorrowerId)
    if (borrowerError) throw new Error(borrowerError.message)
  }
}
