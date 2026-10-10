"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import Navbar from "@/app/components/Navbar"
import { supabase } from "@/lib/supabase"
import { useAuth } from "@/app/auth-context"
import { SkeletonCardList } from "@/app/components/Skeleton"
import { approveBorrowerMember } from "@/lib/approveBorrower"
import { deactivatePerson, reactivatePerson, type Person } from "@/lib/memberAdmin"
import { readCache, writeCache } from "@/lib/cache"
import { Toast } from "@/app/components/Toast"
import {
  ConfirmSheet,
  DeactivateBody,
  EditPersonSheet,
  FilterChips,
  PeopleSearch,
  PersonRow,
  PersonSheet,
  matchesSearch,
  usePersonParam,
  type PersonAction
} from "@/app/components/admin/People"

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

type BorrowerQueueSnapshot = {
  borrowerMembers: BorrowerMember[]
}

type Filter = "all" | "pending" | "active" | "inactive"

const asPerson = (m: BorrowerMember): Person => ({ ...m, role: "borrower", gain_sharing_eligible: false })

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
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState("")
  const [toast, setToast] = useState("")
  const [openId, setOpenId] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const [confirmingDeactivate, setConfirmingDeactivate] = useState(false)
  const [search, setSearch] = useState("")
  const [filter, setFilter] = useState<Filter>("all")

  async function loadData() {
    // Only show the blocking loader on a true cold start -- if we already
    // rendered cached data, refresh quietly behind it instead of flashing
    // back to a spinner on every navigation or post-mutation reload.
    if (!readCache(BORROWERS_CACHE_KEY)) setDataLoading(true)

    const { data: members } = await supabase
      .from("members")
      .select("member_id, name, email, status, created_at")
      .eq("role", "borrower")
      .order("created_at", { ascending: false })

    const nextBorrowerMembers = members ?? []
    setBorrowerMembers(nextBorrowerMembers)
    writeCache<BorrowerQueueSnapshot>(BORROWERS_CACHE_KEY, { borrowerMembers: nextBorrowerMembers })
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

  usePersonParam(!checkingAccess, openPerson)

  function openPerson(id: string) {
    setOpenId(id)
    setEditing(false)
    setConfirmingDeactivate(false)
    setError("")
  }

  function closePerson() {
    setOpenId(null)
    setEditing(false)
    setConfirmingDeactivate(false)
  }

  // Runs one write for a borrower, then reports it and refreshes.
  async function run(memberId: string, write: () => Promise<void>, done: string) {
    setBusyId(memberId)
    setError("")
    try {
      await write()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.")
      setBusyId(null)
      return
    }
    setBusyId(null)
    closePerson()
    setToast(done)
    await loadData()
  }

  const counts = {
    all: borrowerMembers.length,
    pending: borrowerMembers.filter((m) => m.status === "pending").length,
    active: borrowerMembers.filter((m) => m.status === "approved").length,
    inactive: borrowerMembers.filter((m) => m.status === "inactive").length
  }
  const chips = [
    { id: "all" as Filter, label: "All", count: counts.all },
    ...(counts.pending > 0 ? [{ id: "pending" as Filter, label: "Pending", count: counts.pending }] : []),
    { id: "active" as Filter, label: "Active", count: counts.active },
    { id: "inactive" as Filter, label: "Inactive", count: counts.inactive }
  ]
  const activeFilter: Filter = filter === "pending" && counts.pending === 0 ? "all" : filter
  const rank = (m: BorrowerMember) => (m.status === "pending" ? 0 : m.status === "inactive" ? 2 : 1)
  const visible = borrowerMembers
    .filter((m) => {
      if (activeFilter === "pending") return m.status === "pending"
      if (activeFilter === "active") return m.status === "approved"
      if (activeFilter === "inactive") return m.status === "inactive"
      return true
    })
    .filter((m) => matchesSearch(asPerson(m), search))
    .sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name))

  const open = borrowerMembers.find((m) => m.member_id === openId) ?? null

  function actionsFor(m: BorrowerMember): PersonAction[] {
    const actions: PersonAction[] = [
      { label: "Edit details", hint: "Name, email, role, status", onClick: () => setEditing(true) }
    ]
    if (m.status === "approved") {
      actions.push({ label: "Message", hint: `Open a chat with ${m.name}`, onClick: () => router.push(`/messages?to=${m.member_id}`) })
    }
    actions.push({ label: "View as", hint: "See the app the way they see it", onClick: () => router.push(`/admin/view-as/${m.member_id}`) })
    if (m.status === "inactive") {
      actions.push({
        label: busyId === m.member_id ? "Reactivating…" : "Reactivate",
        hint: "Let them sign in again",
        onClick: () => {
          if (busyId) return
          run(m.member_id, () => reactivatePerson(m.member_id, true), `${m.name} reactivated`)
        }
      })
    } else if (m.status === "approved") {
      actions.push({ label: "Deactivate", hint: "Lock them out of the app", danger: true, onClick: () => setConfirmingDeactivate(true) })
    }
    return actions
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
          <div className="text-[11px] tracking-[0.18em] uppercase text-gold font-mono mb-2">Administration</div>
          <h1 className="font-display text-4xl font-semibold">Borrowers</h1>
          <p className="text-sm text-ink-soft mt-2 max-w-md">Accounts that can only see and repay their own loan.</p>

          {error && !openId && <p className="mt-4 text-sm text-rust">{error}</p>}

          {borrowerMembers.length > 0 && (
            <>
              <div className="mt-6">
                <PeopleSearch value={search} onChange={setSearch} />
              </div>
              <div className="mt-3">
                <FilterChips chips={chips} active={activeFilter} onChange={setFilter} />
              </div>
            </>
          )}

          <div className="mt-4 space-y-2">
            {visible.map((m) => (
              <PersonRow
                key={m.member_id}
                person={asPerson(m)}
                hideRole
                detail={m.status === "pending" ? `${m.email || "No email"} · waiting for approval` : undefined}
                onClick={() => openPerson(m.member_id)}
              />
            ))}

            {borrowerMembers.length === 0 && <p className="text-sm text-ink-soft">No borrower accounts yet.</p>}
            {borrowerMembers.length > 0 && visible.length === 0 && (
              <p className="text-sm text-ink-soft px-1 py-2">{search ? `No one matches "${search}".` : "No one here."}</p>
            )}
          </div>
        </div>
      </main>

      {open && !editing && !confirmingDeactivate && (
        <PersonSheet
          person={asPerson(open)}
          actions={actionsFor(open)}
          onClose={closePerson}
          footer={
            open.status === "pending" ? (
              <button
                type="button"
                className="w-full bg-ink text-paper px-6 py-3.5 rounded-full text-base font-bold shadow-lg motion-safe:transition-transform motion-safe:active:scale-[0.97] disabled:opacity-50 disabled:shadow-none"
                onClick={() => run(open.member_id, () => approveBorrowerMember(open.member_id), `${open.name} approved`)}
                disabled={busyId === open.member_id}
              >
                {busyId === open.member_id ? "Approving…" : "Approve"}
              </button>
            ) : undefined
          }
        >
          {error && <p className="mt-4 px-1 text-sm text-rust">{error}</p>}
        </PersonSheet>
      )}

      {open && editing && (
        <EditPersonSheet
          person={asPerson(open)}
          onClose={() => setEditing(false)}
          onSaved={() => {
            closePerson()
            setToast("Saved")
            loadData()
          }}
          onError={(msg) => {
            setEditing(false)
            setError(msg)
          }}
        />
      )}

      {open && confirmingDeactivate && (
        <ConfirmSheet
          title={`Deactivate ${open.name}?`}
          confirmLabel="Deactivate"
          busyLabel="Deactivating…"
          danger
          busy={busyId === open.member_id}
          onClose={() => setConfirmingDeactivate(false)}
          onConfirm={() => run(open.member_id, () => deactivatePerson(open.member_id), `${open.name} deactivated`)}
        >
          <DeactivateBody person={asPerson(open)} />
          {error && <p className="text-rust">{error}</p>}
        </ConfirmSheet>
      )}

      {toast && <Toast message={toast} onDone={() => setToast("")} />}
    </>
  )
}
