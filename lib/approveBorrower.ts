import { supabase } from "@/lib/supabase"

/**
 * Links a borrower record (a historical loan-only account with no login of
 * its own) to a member's account -- e.g. someone who took a loan before
 * ever signing up, now claiming their history. Guards against claiming a
 * record that's already linked to someone else: without the
 * .is("member_id", null) filter here, a stale "unclaimed borrowers"
 * dropdown -- loaded once, not refreshed between two separate admin
 * actions -- could silently overwrite an already-linked member's
 * borrower_id with no error and no warning. Every page that looks up a
 * member's loans via borrowers.member_id does so with .maybeSingle(),
 * which errors (rather than throwing) if the id somehow ends up claimed
 * twice -- none of those callers check that error, so they'd silently
 * stop finding that member's loan history instead of failing loudly.
 */
export async function linkBorrowerRecord(memberId: string, borrowerId: string) {
  const { data, error } = await supabase
    .from("borrowers")
    .update({ member_id: memberId })
    .eq("borrower_id", borrowerId)
    .is("member_id", null)
    .select("borrower_id")

  if (error) throw new Error(error.message)

  if (!data || data.length === 0) {
    throw new Error("This loan record has already been linked to another member -- refresh and try again.")
  }
}

/**
 * Approves a pending borrower-role signup, optionally linking it to an
 * existing loan record. Shared by the two admin screens that both offer
 * this action -- admin/page.tsx's Borrowers tab and admin/borrowers/page.tsx
 * -- so a future change to this flow only needs to happen in one place
 * instead of drifting between two near-identical implementations.
 *
 * Both writes go through approve_borrower_member in one DB transaction --
 * previously these were two separate client-side calls with no rollback
 * between them, so a link failure (e.g. the chosen loan record got claimed
 * by someone else in the meantime, which this already guarded against)
 * left the member permanently approved but never linked, with only a
 * one-time error toast and no forced way back to a consistent state.
 */
export async function approveBorrowerMember(memberId: string, linkToBorrowerId?: string) {
  const { error } = await supabase.rpc("approve_borrower_member", {
    p_member_id: memberId,
    p_borrower_id: linkToBorrowerId ?? null
  })

  if (error) throw new Error(error.message)
}
