"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import Navbar from "@/app/components/Navbar"
import { supabase } from "@/lib/supabase"
import { useAuth } from "@/app/auth-context"
import { SkeletonCardList } from "@/app/components/Skeleton"

type BorrowerMember = {
  member_id: string
  name: string
  email: string | null
  status: "pending" | "approved" | "inactive"
  created_at: string
}

type UnclaimedBorrower = {
  borrower_id: string
  name: string
}

export default function AdminBorrowersPage() {
  const router = useRouter()
  const { loading: authLoading, member } = useAuth()
  const [dataLoading, setDataLoading] = useState(true)
  const checkingAccess = authLoading || dataLoading

  const [borrowerMembers, setBorrowerMembers] = useState<BorrowerMember[]>([])
  const [unclaimedBorrowers, setUnclaimedBorrowers] = useState<UnclaimedBorrower[]>([])
  const [linkedNameByMemberId, setLinkedNameByMemberId] = useState<Record<string, string>>({})
  const [linkChoice, setLinkChoice] = useState<Record<string, string>>({})
  const [busyId, setBusyId] = useState<string | null>(null)
  const [message, setMessage] = useState("")

  async function loadData() {
    const [{ data: members }, { data: unclaimed }, { data: linked }] = await Promise.all([
      supabase
        .from("members")
        .select("member_id, name, email, status, created_at")
        .eq("role", "borrower")
        .order("created_at", { ascending: false }),
      supabase.from("borrowers").select("borrower_id, name").is("member_id", null).order("name"),
      supabase.from("borrowers").select("name, member_id").not("member_id", "is", null)
    ])

    setBorrowerMembers(members ?? [])
    setUnclaimedBorrowers(unclaimed ?? [])
    setLinkedNameByMemberId(
      Object.fromEntries((linked ?? []).map((b) => [b.member_id as string, b.name as string]))
    )
  }

  useEffect(() => {
    if (authLoading) return

    if (!member) {
      router.push("/login")
      return
    }

    if (member.role !== "admin") {
      router.push("/dashboard")
      return
    }

    loadData().then(() => setDataLoading(false))
  }, [authLoading, member, router])

  async function approveMember(memberId: string) {
    setBusyId(memberId)
    setMessage("")

    await supabase.from("members").update({ status: "approved" }).eq("member_id", memberId)

    const chosenBorrowerId = linkChoice[memberId]
    if (chosenBorrowerId) {
      const { error } = await supabase
        .from("borrowers")
        .update({ member_id: memberId })
        .eq("borrower_id", chosenBorrowerId)

      if (error) {
        setMessage(error.message)
      }
    }

    setBusyId(null)
    await loadData()
  }

  async function linkOnly(memberId: string) {
    const chosenBorrowerId = linkChoice[memberId]
    if (!chosenBorrowerId) return

    setBusyId(memberId)
    setMessage("")

    const { error } = await supabase
      .from("borrowers")
      .update({ member_id: memberId })
      .eq("borrower_id", chosenBorrowerId)

    if (error) {
      setMessage(error.message)
    }

    setBusyId(null)
    await loadData()
  }

  const statusColor: Record<string, string> = {
    approved: "text-sage border-sage",
    pending: "text-gold border-gold",
    inactive: "text-rust border-rust"
  }

  if (checkingAccess) {
    return (
      <>
        <Navbar />
        <main className="min-h-screen bg-paper text-ink font-sans">
          <div className="max-w-3xl mx-auto px-5 pt-10 pb-24">
            <SkeletonCardList rows={3} />
          </div>
        </main>
      </>
    )
  }

  return (
    <>
      <Navbar />
      <main className="min-h-screen bg-paper text-ink font-sans">
        <div className="max-w-3xl mx-auto px-5 pt-10 pb-24">
          <button
            onClick={() => router.push("/admin")}
            className="text-[13px] text-ink-soft mb-4 hover:text-ink transition-colors"
          >
            ← Admin
          </button>
          <div className="text-[11px] tracking-[0.18em] uppercase text-gold font-mono mb-2">
            Administration
          </div>
          <h1 className="font-display text-4xl font-semibold">Borrowers</h1>
          <p className="text-sm text-ink-soft mt-2 max-w-md">
            Borrower accounts can only see and manage their own loan. Approve a new signup, and if
            they already have a loan on record from before they had an account, link it here so
            they can see it.
          </p>

          {message && <p className="mt-4 text-sm text-rust">{message}</p>}

          <div className="mt-8 space-y-3">
            {borrowerMembers.map((m) => {
              const linkedName = linkedNameByMemberId[m.member_id]

              return (
                <div key={m.member_id} className="bg-paper-2 border border-hairline rounded-md p-5">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="font-display text-lg">{m.name}</div>
                      <div className="text-sm text-ink-soft">{m.email || "No email"}</div>
                    </div>
                    <span
                      className={`text-[10px] uppercase font-mono border rounded-full px-2 py-0.5 shrink-0 ${
                        statusColor[m.status] ?? "text-ink-soft border-hairline"
                      }`}
                    >
                      {m.status}
                    </span>
                  </div>

                  {linkedName ? (
                    <p className="mt-3 text-xs text-sage font-mono">Linked to loan record: {linkedName}</p>
                  ) : (
                    <div className="mt-4 space-y-2">
                      <label className="block text-xs uppercase tracking-wide text-ink-soft font-mono">
                        Link to an existing loan record (optional)
                      </label>
                      <select
                        className="border border-hairline bg-paper text-ink text-sm rounded-sm px-3 py-2 w-full"
                        value={linkChoice[m.member_id] ?? ""}
                        onChange={(e) =>
                          setLinkChoice((prev) => ({ ...prev, [m.member_id]: e.target.value }))
                        }
                      >
                        <option value="">No existing loan record</option>
                        {unclaimedBorrowers.map((b) => (
                          <option key={b.borrower_id} value={b.borrower_id}>
                            {b.name}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}

                  <div className="mt-4 flex gap-2 flex-wrap">
                    {m.status === "pending" ? (
                      <button
                        className="bg-ink text-paper px-4 py-2 rounded-md text-sm disabled:opacity-50"
                        onClick={() => approveMember(m.member_id)}
                        disabled={busyId === m.member_id}
                      >
                        {busyId === m.member_id
                          ? "Approving..."
                          : linkChoice[m.member_id]
                          ? "Approve & Link"
                          : "Approve"}
                      </button>
                    ) : (
                      !linkedName &&
                      linkChoice[m.member_id] && (
                        <button
                          className="border border-hairline px-4 py-2 rounded-md text-sm disabled:opacity-50"
                          onClick={() => linkOnly(m.member_id)}
                          disabled={busyId === m.member_id}
                        >
                          {busyId === m.member_id ? "Linking..." : "Link"}
                        </button>
                      )
                    )}
                  </div>
                </div>
              )
            })}

            {borrowerMembers.length === 0 && (
              <p className="text-sm text-ink-soft">No borrower accounts yet.</p>
            )}
          </div>
        </div>
      </main>
    </>
  )
}
