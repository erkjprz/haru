"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import Navbar from "@/app/components/Navbar"
import { supabase } from "@/lib/supabase"
import { useAuth } from "@/app/auth-context"
import { SkeletonCardList } from "@/app/components/Skeleton"
import { readCache, writeCache } from "@/lib/cache"
import { Sheet } from "@/app/components/Sheet"
import { FieldRow, PersonIcon, MailIcon, StatusIcon, rowSelectClass, rowInputClass } from "@/app/components/TransactionFormUI"

// Two independent loaders (loadMembers/loadUnclaimed) get two independent
// cache keys -- same global admin data for any admin, no per-user scoping
// needed.
const MEMBERS_CACHE_KEY = "admin:members-list"
const UNCLAIMED_MEMBERS_CACHE_KEY = "admin:unclaimed-members"

export default function AdminMembersPage() {
  const router = useRouter()
  const { loading: authLoading, member: authMember } = useAuth()
  const cachedMembers = readCache<any[]>(MEMBERS_CACHE_KEY)
  const cachedUnclaimedMembers = readCache<any[]>(UNCLAIMED_MEMBERS_CACHE_KEY)

  const [members, setMembers] = useState<any[]>(cachedMembers ?? [])
  const [showAddForm, setShowAddForm] = useState(false)
  const [name, setName] = useState("")
  const [email, setEmail] = useState("")
  const [role, setRole] = useState("member")
  const [message, setMessage] = useState("")

  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName] = useState("")
  const [editEmail, setEditEmail] = useState("")
  const [editRole, setEditRole] = useState("member")
  const [editStatus, setEditStatus] = useState("approved")
  const [editGainSharingEligible, setEditGainSharingEligible] = useState(true)

  const [search, setSearch] = useState("")

  const [unclaimedMembers, setUnclaimedMembers] = useState<any[]>(cachedUnclaimedMembers ?? [])
  const [linkChoice, setLinkChoice] = useState<Record<string, string>>({})
  const [linkingId, setLinkingId] = useState<string | null>(null)

  async function loadMembers() {
    const { data } = await supabase
      .from("members")
      .select("*")
      .order("created_at", { ascending: false })

    const next = data ?? []
    setMembers(next)
    writeCache(MEMBERS_CACHE_KEY, next)
  }

  async function loadUnclaimed() {
    const { data } = await supabase.rpc("list_unclaimed_members")
    const next = data ?? []
    setUnclaimedMembers(next)
    writeCache(UNCLAIMED_MEMBERS_CACHE_KEY, next)
  }

  useEffect(() => {
    if (authLoading) return

    if (!authMember) {
      router.push("/login")
      return
    }

    if (authMember.role !== "admin") {
      router.push("/dashboard")
      return
    }

    loadMembers()
    loadUnclaimed()
  }, [authLoading, authMember, router])

  async function linkMember(pendingId: string) {
    const targetId = linkChoice[pendingId]
    if (!targetId) return

    setLinkingId(pendingId)

    const { error } = await supabase.rpc("admin_link_member", {
      p_pending_member_id: pendingId,
      p_target_member_id: targetId
    })

    setLinkingId(null)

    if (error) {
      setMessage(error.message)
      return
    }

    setMessage("Linked")
    loadMembers()
    loadUnclaimed()
  }

  async function addMember() {
    if (!name) {
      setMessage("Enter a name.")
      return
    }

    // A borrower-role member is never gain-sharing eligible (see signup and
    // reactivateMember) -- without this, adding one here directly would
    // default to the DB's true and incorrectly grant them a share of future
    // distributions.
    const { error } = await supabase
      .from("members")
      .insert({
        name,
        email: email || null,
        role,
        status: "approved",
        gain_sharing_eligible: role !== "borrower"
      })

    if (error) {
      setMessage(error.message)
      return
    }

    setName("")
    setEmail("")
    setRole("member")
    setMessage("Member added")
    setShowAddForm(false)
    loadMembers()
  }

  function startEditing(member: any) {
    setEditingId(member.member_id)
    setEditName(member.name ?? "")
    setEditEmail(member.email ?? "")
    setEditRole(member.role ?? "member")
    setEditStatus(member.status ?? "approved")
    setEditGainSharingEligible(member.gain_sharing_eligible !== false)
    setMessage("")
  }

  function cancelEditing() {
    setEditingId(null)
  }

  async function saveEdit(id: string) {
    // An inactive member should never be gain-sharing eligible, regardless
    // of the checkbox -- mirrors the invariant deactivateMember's dedicated
    // button already enforces, so using this generic form to deactivate
    // someone can't silently skip it.
    const gainSharingEligible = editStatus === "inactive" ? false : editGainSharingEligible

    const { error } = await supabase
      .from("members")
      .update({
        name: editName,
        email: editEmail || null,
        role: editRole,
        status: editStatus,
        gain_sharing_eligible: gainSharingEligible
      })
      .eq("member_id", id)

    if (error) {
      setMessage(error.message)
      return
    }

    setEditingId(null)
    setMessage("Member updated")
    loadMembers()
  }

  async function deactivateMember(id: string) {
    setMessage("")

    // Deactivating locks the member out of the app (every page gates on
    // status === "approved"), but computeCurrentValueByMember only checks
    // gain_sharing_eligible, not status -- without this, a deactivated
    // member with capital still in the fund would keep sharing in every
    // future loan/bank-interest/investment distribution indefinitely.
    const { error } = await supabase
      .from("members")
      .update({ status: "inactive", gain_sharing_eligible: false })
      .eq("member_id", id)

    if (error) {
      setMessage(error.message)
      return
    }

    loadMembers()
  }

  async function reactivateMember(id: string, isBorrower: boolean) {
    setMessage("")

    // Restores eligibility based on role rather than unconditionally
    // setting it true -- a borrower-role member is never eligible (see
    // signup), so reactivating one shouldn't grant them gain sharing they
    // never had in the first place.
    const { error } = await supabase
      .from("members")
      .update({ status: "approved", gain_sharing_eligible: !isBorrower })
      .eq("member_id", id)

    if (error) {
      setMessage(error.message)
      return
    }

    loadMembers()
  }

  const filteredMembers = members.filter((m) => {
    const q = search.toLowerCase()
    return (
      m.name?.toLowerCase().includes(q) ||
      m.email?.toLowerCase().includes(q)
    )
  })

  const statusColor: Record<string, string> = {
    approved: "text-sage border-sage",
    pending: "text-gold border-gold",
    inactive: "text-rust border-rust"
  }

  if (authLoading || !authMember || authMember.role !== "admin") {
    return (
      <>
        <Navbar />
        <main className="min-h-screen bg-paper text-ink font-sans overflow-x-hidden">
          <div className="max-w-3xl mx-auto px-5 pt-10 pb-[calc(6rem+var(--dock-h)+env(safe-area-inset-bottom))]">
            <SkeletonCardList rows={3} />
          </div>
        </main>
      </>
    )
  }

  return (
    <>
      <Navbar />
      <main className="min-h-screen bg-paper text-ink font-sans overflow-x-hidden">
        <div className="max-w-3xl mx-auto px-5 pt-10 pb-[calc(6rem+var(--dock-h)+env(safe-area-inset-bottom))]">
          <div className="flex items-start justify-between gap-4">
            <div>
              <button
                onClick={() => router.push("/admin")}
                className="text-[13px] text-ink-soft mb-4 hover:text-ink transition-colors"
              >
                ← Admin
              </button>
              <div className="text-[11px] tracking-[0.18em] uppercase text-gold font-mono mb-2">
                Administration
              </div>
              <h1 className="font-display text-4xl font-semibold">
                Members
              </h1>
            </div>
            <button
              className="shrink-0 bg-gold-soft text-ink px-4 py-2.5 rounded-sm text-sm font-semibold"
              onClick={() => setShowAddForm(true)}
            >
              + Add Member
            </button>
          </div>

          <p className="text-sm text-ink-soft mt-2 max-w-md">
            To record a contribution, withdrawal, or other transaction on a member's behalf, use{" "}
            <button
              className="text-gold underline"
              onClick={() => router.push("/admin/members?newTransaction=1", { scroll: false })}
            >
              New Transaction
            </button>{" "}
            instead.
          </p>

          {showAddForm && (
            <Sheet
              title="Add Member"
              onClose={() => setShowAddForm(false)}
              footer={
                <button
                  type="button"
                  className="w-full bg-ink text-paper px-6 py-3.5 rounded-full text-base font-bold shadow-lg shadow-gold/30 ring-1 ring-gold/40 motion-safe:transition-transform motion-safe:active:scale-[0.97]"
                  onClick={addMember}
                >
                  Add Member
                </button>
              }
            >
              <div className="bg-paper-2 border border-hairline rounded-md divide-y divide-hairline overflow-hidden">
                <FieldRow icon={<PersonIcon />}>
                  <input
                    className={rowInputClass}
                    placeholder="Name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                  />
                </FieldRow>

                <FieldRow icon={<MailIcon />}>
                  <input
                    className={rowInputClass}
                    placeholder="Email (optional)"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                </FieldRow>

                <FieldRow icon={<PersonIcon />}>
                  <select className={rowSelectClass} value={role} onChange={(e) => setRole(e.target.value)}>
                    <option value="member">Member</option>
                    <option value="admin">Admin</option>
                    <option value="borrower">Borrower</option>
                  </select>
                  <span className="text-ink-soft text-xs shrink-0 pointer-events-none">▾</span>
                </FieldRow>
              </div>
            </Sheet>
          )}

          {message && (
            <p className="mt-4 text-sm text-ink-soft">
              {message}
            </p>
          )}

          <div className="mt-8 flex items-baseline justify-between">
            <h2 className="font-display text-xl font-semibold">
              All Members
            </h2>
            <span className="text-xs text-ink-soft font-mono">
              {filteredMembers.length} of {members.length}
            </span>
          </div>

          <input
            className="mt-4 border border-hairline bg-paper-2 text-ink text-sm rounded-sm px-3 py-2 w-full"
            placeholder="Search by name or email"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />

          <div className="mt-4 space-y-3">
            {filteredMembers.map((member) => (
              <div key={member.member_id} className="bg-paper-2 border border-hairline rounded-md p-5">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="font-display text-lg truncate">
                      {member.name}
                    </div>
                    <div className="text-sm text-ink-soft truncate">
                      {member.email || "No email"}
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-1 shrink-0">
                    <span className="text-[10px] uppercase font-mono border border-hairline rounded-full px-2 py-0.5 text-ink-soft">
                      {member.role}
                    </span>
                    <span
                      className={`text-[10px] uppercase font-mono border rounded-full px-2 py-0.5 ${
                        statusColor[member.status] ?? "text-ink-soft border-hairline"
                      }`}
                    >
                      {member.status}
                    </span>
                    {member.gain_sharing_eligible === false && (
                      <span className="text-[10px] uppercase font-mono border border-hairline rounded-full px-2 py-0.5 text-ink-soft">
                        Not gain-sharing eligible
                      </span>
                    )}
                  </div>
                </div>

                <div className="mt-4 flex gap-2 flex-wrap">
                  <button
                    className="border border-hairline px-4 py-2 rounded-md text-sm"
                    onClick={() => startEditing(member)}
                  >
                    Edit
                  </button>
                  {member.role === "borrower" && (
                    <button
                      className="border border-hairline px-4 py-2 rounded-md text-sm"
                      onClick={() => router.push(`/admin/view-as/${member.member_id}`)}
                    >
                      View as
                    </button>
                  )}
                  {member.status === "inactive" ? (
                    <button
                      className="border border-sage text-sage px-4 py-2 rounded-md text-sm"
                      onClick={() => reactivateMember(member.member_id, member.role === "borrower")}
                    >
                      Reactivate
                    </button>
                  ) : (
                    <button
                      className="border border-rust text-rust px-4 py-2 rounded-md text-sm"
                      onClick={() => deactivateMember(member.member_id)}
                    >
                      Deactivate
                    </button>
                  )}
                </div>

                {member.status === "pending" && member.role === "member" && unclaimedMembers.length > 0 && (
                  <div className="mt-4 pt-4 border-t border-hairline space-y-2">
                    <label className="block text-xs uppercase tracking-wide text-ink-soft font-mono">
                      Link to existing member
                    </label>
                    <p className="text-xs text-ink-soft">
                      If this signup is actually one of the fund&apos;s existing members, link it to their record so their contributions, loans and investments carry over.
                    </p>
                    <div className="flex gap-2">
                      <select
                        className="border border-hairline bg-paper text-ink text-sm rounded-sm px-3 py-2 flex-1"
                        value={linkChoice[member.member_id] || ""}
                        onChange={(e) =>
                          setLinkChoice((prev) => ({ ...prev, [member.member_id]: e.target.value }))
                        }
                      >
                        <option value="">Select a member</option>
                        {unclaimedMembers.map((m) => (
                          <option key={m.member_id} value={m.member_id}>
                            {m.name}
                          </option>
                        ))}
                      </select>
                      <button
                        className="bg-ink text-paper px-4 py-2 rounded-md text-sm disabled:opacity-50 shrink-0"
                        onClick={() => linkMember(member.member_id)}
                        disabled={!linkChoice[member.member_id] || linkingId === member.member_id}
                      >
                        {linkingId === member.member_id ? "Linking..." : "Link"}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ))}

            {members.length > 0 && filteredMembers.length === 0 && (
              <p className="text-sm text-ink-soft">
                No matches for "{search}"
              </p>
            )}
          </div>
        </div>
      </main>

      {editingId && (
        <Sheet
          title="Edit Member"
          onClose={cancelEditing}
          footer={
            <div className="flex items-center gap-3">
              <button
                type="button"
                className="shrink-0 border border-hairline text-ink-soft px-5 py-3.5 rounded-full text-base font-semibold"
                onClick={cancelEditing}
              >
                Cancel
              </button>
              <button
                type="button"
                className="flex-1 bg-ink text-paper px-6 py-3.5 rounded-full text-base font-bold shadow-lg shadow-gold/30 ring-1 ring-gold/40 motion-safe:transition-transform motion-safe:active:scale-[0.97]"
                onClick={() => saveEdit(editingId)}
              >
                Save
              </button>
            </div>
          }
        >
          <div className="bg-paper-2 border border-hairline rounded-md divide-y divide-hairline overflow-hidden">
            <FieldRow icon={<PersonIcon />}>
              <input
                className={rowInputClass}
                placeholder="Name"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
              />
            </FieldRow>

            <FieldRow icon={<MailIcon />}>
              <input
                className={rowInputClass}
                placeholder="Email"
                value={editEmail}
                onChange={(e) => setEditEmail(e.target.value)}
              />
            </FieldRow>

            <FieldRow icon={<PersonIcon />}>
              <select className={rowSelectClass} value={editRole} onChange={(e) => setEditRole(e.target.value)}>
                <option value="member">Member</option>
                <option value="admin">Admin</option>
              </select>
              <span className="text-ink-soft text-xs shrink-0 pointer-events-none">▾</span>
            </FieldRow>

            <FieldRow icon={<StatusIcon />}>
              <select className={rowSelectClass} value={editStatus} onChange={(e) => setEditStatus(e.target.value)}>
                <option value="approved">Approved</option>
                <option value="pending">Pending</option>
                <option value="inactive">Inactive</option>
              </select>
              <span className="text-ink-soft text-xs shrink-0 pointer-events-none">▾</span>
            </FieldRow>
          </div>

          <label className="flex items-start gap-2.5 text-sm text-ink-soft px-1 pt-4">
            <input
              type="checkbox"
              checked={editStatus === "inactive" ? false : editGainSharingEligible}
              onChange={(e) => setEditGainSharingEligible(e.target.checked)}
              disabled={editStatus === "inactive"}
              className="w-4 h-4 mt-0.5 shrink-0 disabled:opacity-50"
            />
            Eligible for gain sharing
            {editStatus === "inactive" && " (always off while inactive)"}
          </label>
        </Sheet>
      )}
    </>
  )
}
