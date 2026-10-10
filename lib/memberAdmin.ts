import { supabase } from "@/lib/supabase"

// The admin writes behind the Members and Borrowers pages, shared so both
// pages (and their one person sheet) make exactly the same calls. Each
// throws with the database's message on failure.

export type Person = {
  member_id: string
  name: string
  email: string | null
  role: "member" | "admin" | "borrower" | string
  status: "approved" | "pending" | "inactive" | string
  gain_sharing_eligible?: boolean | null
  created_at?: string
}

function check(error: { message: string } | null) {
  if (error) throw new Error(error.message)
}

// A borrower-role member is never gain-sharing eligible (see signup and
// reactivatePerson) -- without this, adding one directly would default to
// the DB's true and incorrectly grant them a share of future distributions.
export async function addPerson(name: string, email: string, role: string) {
  const { error } = await supabase.from("members").insert({
    name,
    email: email || null,
    role,
    status: "approved",
    gain_sharing_eligible: role !== "borrower"
  })
  check(error)
}

export async function updatePerson(
  id: string,
  fields: { name: string; email: string; role: string; status: string; gainSharingEligible: boolean }
) {
  // An inactive member should never be gain-sharing eligible, regardless
  // of the checkbox -- mirrors the invariant deactivatePerson enforces, so
  // using the edit form to deactivate someone can't silently skip it.
  const gainSharingEligible = fields.status === "inactive" ? false : fields.gainSharingEligible

  const { error } = await supabase
    .from("members")
    .update({
      name: fields.name,
      email: fields.email || null,
      role: fields.role,
      status: fields.status,
      gain_sharing_eligible: gainSharingEligible
    })
    .eq("member_id", id)
  check(error)
}

// Deactivating locks the member out of the app (every page gates on
// status === "approved"), but computeCurrentValueByMember only checks
// gain_sharing_eligible, not status -- without clearing it, a deactivated
// member with capital still in the fund would keep sharing in every future
// loan/bank-interest/investment distribution indefinitely.
export async function deactivatePerson(id: string) {
  const { error } = await supabase
    .from("members")
    .update({ status: "inactive", gain_sharing_eligible: false })
    .eq("member_id", id)
  check(error)
}

// Restores eligibility based on role rather than unconditionally setting it
// true -- a borrower-role member is never eligible (see signup), so
// reactivating one shouldn't grant them gain sharing they never had.
export async function reactivatePerson(id: string, isBorrower: boolean) {
  const { error } = await supabase
    .from("members")
    .update({ status: "approved", gain_sharing_eligible: !isBorrower })
    .eq("member_id", id)
  check(error)
}

// Links a pending signup to one of the fund's existing (never-claimed)
// member records, so their contributions, loans and investments carry over.
export async function linkSignupToMember(pendingId: string, targetId: string) {
  const { error } = await supabase.rpc("admin_link_member", {
    p_pending_member_id: pendingId,
    p_target_member_id: targetId
  })
  check(error)
}
