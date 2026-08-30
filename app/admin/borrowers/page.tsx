"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import Navbar from "@/app/components/Navbar"
import { supabase } from "@/lib/supabase"
import { useAuth } from "@/app/auth-context"
import { SkeletonCardList } from "@/app/components/Skeleton"
import { approveBorrowerMember, linkBorrowerRecord } from "@/lib/approveBorrower"
import { readCache, writeCache } from "@/lib/cache"
import { Sheet } from "@/app/components/Sheet"
import { FieldRow, PersonIcon, rowSelectClass } from "@/app/components/TransactionFormUI"

// Same global borrower-approvals queue for any admin -- no per-user
// scoping needed, so a single fixed cache key covers everyone.
const BORROWERS_CACHE_KEY = "admin:borrowers-list"

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

type BorrowerQueueSnapshot = {
  borrowerMembers: BorrowerMember[]
  unclaimedBorrowers: UnclaimedBorrower[]
  linkedNameByMemberId: Record<string, string>
}

export default function AdminBorrowersPage() {
  const router = useRouter()
  const { loading: authLoading, member } = useAuth()
  const cached = readCache<BorrowerQueueSnapshot>(BORROWERS_CACHE_KEY)

  // Paints instantly from the last time this queue loaded, before the
  // browser ever shows a frame -- loadData() below still runs right after
  // and replaces it with a fresh fetch, so a stale queue never lingers
  // past that first moment.
  const [dataLoading, setDataLoading] = useState(!cached)
  const checkingAccess = authLoading || dataLoading

  const [borrowerMembers, setBorrowerMembers] = useState<BorrowerMember[]>(cached?.borrowerMembers ?? [])
  const [unclaimedBorrowers, setUnclaimedBorrowers] = useState<UnclaimedBorrower[]>(cached?.unclaimedBorrowers ?? [])
  const [linkedNameByMemberId, setLinkedNameByMemberId] = useState<Record<string, string>>(
    cached?.linkedNameByMemberId ?? {}
  )
  const [linkChoice, setLinkChoice] = useState<Record<string, string>>({})
  const [busyId, setBusyId] = useState<string | null>(null)
  const [message, setMessage] = useState("")
  const [openId, setOpenId] = useState<string | null>(null)

  async function loadData() {
    // Only show the blocking loader on a true cold start -- if we already
    // rendered cached data, refresh quietly behind it instead of flashing
    // back to a spinner on every navigation or post-mutation reload.
    if (!readCache(BORROWERS_CACHE_KEY)) setDataLoading(true)

    const [{ data: members }, { data: unclaimed }, { data: linked }] = await Promise.all([
      supabase
        .from("members")
        .select("member_id, name, email, status, created_at")
        .eq("role", "borrower")
        .order("created_at", { ascending: false }),
      supabase.from("borrowers").select("borrower_id, name").is("member_id", null).order("name"),
      supabase.from("borrowers").select("name, member_id").not("member_id", "is", null)
    ])

    const nextBorrowerMembers = members ?? []
    const nextUnclaimedBorrowers = unclaimed ?? []
    const nextLinkedNameByMemberId = Object.fromEntries(
      (linked ?? []).map((b) => [b.member_id as string, b.name as string])
    )

    setBorrowerMembers(nextBorrowerMembers)
    setUnclaimedBorrowers(nextUnclaimedBorrowers)
    setLinkedNameByMemberId(nextLinkedNameByMemberId)

    writeCache<BorrowerQueueSnapshot>(BORROWERS_CACHE_KEY, {
      borrowerMembers: nextBorrowerMembers,
      unclaimedBorrowers: nextUnclaimedBorrowers,
      linkedNameByMemberId: nextLinkedNameByMemberId
    })
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

    try {
      await approveBorrowerMember(memberId, linkChoice[memberId])
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Something went wrong.")
      setBusyId(null)
      return
    }

    setBusyId(null)
    setOpenId(null)
    await loadData()
  }

  async function linkOnly(memberId: string) {
    const chosenBorrowerId = linkChoice[memberId]
    if (!chosenBorrowerId) return

    setBusyId(memberId)
    setMessage("")

    try {
      await linkBorrowerRecord(memberId, chosenBorrowerId)
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Something went wrong.")
      setBusyId(null)
      return
    }

    setBusyId(null)
    setOpenId(null)
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
              // Nothing left to do on an approved, already-linked borrower --
              // no sheet to open, just a static row.
              const hasAction = m.status === "pending" || !linkedName

              const row = (
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="font-display text-lg truncate">{m.name}</div>
                    <div className="text-sm text-ink-soft truncate">{m.email || "No email"}</div>
                    {linkedName && <p className="mt-1 text-xs text-sage font-mono">Linked to loan record: {linkedName}</p>}
                  </div>
                  <div className="shrink-0 flex flex-col items-end gap-1">
                    <span
                      className={`text-[10px] uppercase font-mono border rounded-full px-2 py-0.5 ${
                        statusColor[m.status] ?? "text-ink-soft border-hairline"
                      }`}
                    >
                      {m.status}
                    </span>
                    {hasAction && <span className="text-[11px] font-mono text-gold">Review →</span>}
                  </div>
                </div>
              )

              return hasAction ? (
                <button
                  key={m.member_id}
                  type="button"
                  onClick={() => setOpenId(m.member_id)}
                  className="w-full text-left bg-paper-2 border border-hairline rounded-md p-5"
                >
                  {row}
                </button>
              ) : (
                <div key={m.member_id} className="bg-paper-2 border border-hairline rounded-md p-5">
                  {row}
                </div>
              )
            })}

            {borrowerMembers.length === 0 && (
              <p className="text-sm text-ink-soft">No borrower accounts yet.</p>
            )}
          </div>
        </div>
      </main>

      {openId && (() => {
        const m = borrowerMembers.find((row) => row.member_id === openId)
        if (!m) return null
        const linkedName = linkedNameByMemberId[m.member_id]

        const primaryAction =
          m.status === "pending" ? (
            <button
              type="button"
              className="w-full bg-ink text-paper px-6 py-3.5 rounded-full text-base font-bold shadow-lg shadow-gold/30 ring-1 ring-gold/40 motion-safe:transition-transform motion-safe:active:scale-[0.97] disabled:opacity-50 disabled:shadow-none disabled:ring-0"
              onClick={() => approveMember(m.member_id)}
              disabled={busyId === m.member_id}
            >
              {busyId === m.member_id ? "Approving…" : linkChoice[m.member_id] ? "Approve & Link" : "Approve"}
            </button>
          ) : (
            !linkedName &&
            linkChoice[m.member_id] && (
              <button
                type="button"
                className="w-full border border-hairline text-ink-soft px-6 py-3.5 rounded-full text-base font-semibold disabled:opacity-50"
                onClick={() => linkOnly(m.member_id)}
                disabled={busyId === m.member_id}
              >
                {busyId === m.member_id ? "Linking…" : "Link"}
              </button>
            )
          )

        return (
          <Sheet title="Borrower request" onClose={() => setOpenId(null)} footer={primaryAction}>
            <div className="bg-paper-2 border border-hairline rounded-md overflow-hidden">
              <FieldRow icon={<PersonIcon />}>
                <span className="flex-1 min-w-0 text-sm">
                  <span className="font-semibold text-ink">{m.name}</span>
                </span>
              </FieldRow>
            </div>
            <p className="px-1 pt-2 text-xs text-ink-soft">{m.email || "No email"}</p>

            {linkedName ? (
              <p className="mt-4 text-xs text-sage font-mono px-1">Linked to loan record: {linkedName}</p>
            ) : (
              <div className="mt-4">
                <p className="text-[11px] uppercase tracking-wide text-ink-soft font-mono mb-2 px-1">
                  Link to an existing loan record (optional)
                </p>
                <div className="bg-paper-2 border border-hairline rounded-md overflow-hidden">
                  <FieldRow icon={<PersonIcon />}>
                    <select
                      className={rowSelectClass}
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
                    <span className="text-ink-soft text-xs shrink-0 pointer-events-none">▾</span>
                  </FieldRow>
                </div>
              </div>
            )}
          </Sheet>
        )
      })()}
    </>
  )
}
