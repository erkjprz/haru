"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import Navbar from "@/app/components/Navbar"
import { supabase } from "@/lib/supabase"

export default function AdminMembersPage() {
  const router = useRouter()

  const [members, setMembers] = useState<any[]>([])
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

  const [search, setSearch] = useState("")

  async function loadMembers() {
    const { data } = await supabase
      .from("members")
      .select("*")
      .order("created_at", { ascending: false })

    setMembers(data ?? [])
  }

  useEffect(() => {
    loadMembers()
  }, [])

  async function addMember() {
    if (!name) {
      setMessage("Enter a name.")
      return
    }

    const { error } = await supabase
      .from("members")
      .insert({
        name,
        email: email || null,
        role,
        status: "approved"
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
    setMessage("")
  }

  function cancelEditing() {
    setEditingId(null)
  }

  async function saveEdit(id: string) {
    const { error } = await supabase
      .from("members")
      .update({
        name: editName,
        email: editEmail || null,
        role: editRole,
        status: editStatus
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
    await supabase
      .from("members")
      .update({ status: "inactive" })
      .eq("member_id", id)

    loadMembers()
  }

  async function reactivateMember(id: string) {
    await supabase
      .from("members")
      .update({ status: "approved" })
      .eq("member_id", id)

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

  return (
    <>
      <Navbar />
      <main className="min-h-screen bg-paper text-ink font-sans">
        <div className="max-w-3xl mx-auto px-5 pt-10 pb-24">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="text-[11px] tracking-[0.18em] uppercase text-gold font-mono mb-2">
                Administration
              </div>
              <h1 className="font-display text-4xl font-semibold">
                Members
              </h1>
            </div>
            <button
              className="shrink-0 bg-gold text-ink px-4 py-2.5 rounded-sm text-sm font-semibold"
              onClick={() => setShowAddForm(!showAddForm)}
            >
              {showAddForm ? "Cancel" : "+ Add Member"}
            </button>
          </div>

          <p className="text-sm text-ink-soft mt-2 max-w-md">
            To record a contribution, withdrawal, or other transaction on a member's behalf, use{" "}
            <button
              className="text-gold underline"
              onClick={() => router.push("/transactions/new")}
            >
              New Transaction
            </button>{" "}
            instead.
          </p>

          {showAddForm && (
            <div className="mt-6 bg-paper-2 border border-hairline rounded-md p-5 space-y-3">
              <h2 className="font-display text-xl">
                Add Member
              </h2>

              <input
                className="border border-hairline bg-paper px-3 py-2 rounded-md w-full"
                placeholder="Name"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />

              <input
                className="border border-hairline bg-paper px-3 py-2 rounded-md w-full"
                placeholder="Email (optional)"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />

              <select
                className="border border-hairline bg-paper px-3 py-2 rounded-md w-full"
                value={role}
                onChange={(e) => setRole(e.target.value)}
              >
                <option value="member">Member</option>
                <option value="admin">Admin</option>
              </select>

              <button
                className="bg-ink text-paper px-4 py-2 rounded-md w-full"
                onClick={addMember}
              >
                Add Member
              </button>
            </div>
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
              <div
                key={member.member_id}
                className="bg-paper-2 border border-hairline rounded-md p-5"
              >
                {editingId === member.member_id ? (
                  <div className="space-y-3">
                    <input
                      className="border border-hairline bg-paper px-3 py-2 rounded-md w-full"
                      placeholder="Name"
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                    />
                    <input
                      className="border border-hairline bg-paper px-3 py-2 rounded-md w-full"
                      placeholder="Email"
                      value={editEmail}
                      onChange={(e) => setEditEmail(e.target.value)}
                    />
                    <select
                      className="border border-hairline bg-paper px-3 py-2 rounded-md w-full"
                      value={editRole}
                      onChange={(e) => setEditRole(e.target.value)}
                    >
                      <option value="member">Member</option>
                      <option value="admin">Admin</option>
                    </select>
                    <select
                      className="border border-hairline bg-paper px-3 py-2 rounded-md w-full"
                      value={editStatus}
                      onChange={(e) => setEditStatus(e.target.value)}
                    >
                      <option value="approved">Approved</option>
                      <option value="pending">Pending</option>
                      <option value="inactive">Inactive</option>
                    </select>
                    <div className="flex gap-2">
                      <button
                        className="bg-ink text-paper px-4 py-2 rounded-md text-sm flex-1"
                        onClick={() => saveEdit(member.member_id)}
                      >
                        Save
                      </button>
                      <button
                        className="border border-hairline px-4 py-2 rounded-md text-sm flex-1"
                        onClick={cancelEditing}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="font-display text-lg">
                          {member.name}
                        </div>
                        <div className="text-sm text-ink-soft">
                          {member.email || "No email"}
                        </div>
                      </div>
                      <div className="flex flex-col items-end gap-1">
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
                      </div>
                    </div>

                    <div className="mt-4 flex gap-2 flex-wrap">
                      <button
                        className="border border-hairline px-4 py-2 rounded-md text-sm"
                        onClick={() => startEditing(member)}
                      >
                        Edit
                      </button>
                      {member.status === "inactive" ? (
                        <button
                          className="border border-sage text-sage px-4 py-2 rounded-md text-sm"
                          onClick={() => reactivateMember(member.member_id)}
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
                  </>
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
    </>
  )
}
