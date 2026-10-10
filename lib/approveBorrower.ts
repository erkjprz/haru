import { supabase } from "@/lib/supabase"

/**
 * Approves a pending borrower-role signup. Shared by the two admin screens
 * that both offer this action -- admin/page.tsx's Borrower requests and
 * admin/borrowers/page.tsx -- so a future change to this flow only needs to
 * happen in one place.
 *
 * approve_borrower_member can also link an old loan-only borrower record in
 * the same transaction, but every such record has been claimed since the app
 * went live, so the admin screens no longer offer it and always pass null.
 */
export async function approveBorrowerMember(memberId: string) {
  const { error } = await supabase.rpc("approve_borrower_member", {
    p_member_id: memberId,
    p_borrower_id: null
  })

  if (error) throw new Error(error.message)
}
