"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { supabase } from "@/lib/supabase"
import Navbar from "@/app/components/Navbar"

export default function AdminPage() {
  const router = useRouter()

  const [pendingMembers, setPendingMembers] = useState<any[]>([])
  const [pendingTransactions, setPendingTransactions] = useState<any[]>([])
  const [checkingAccess, setCheckingAccess] = useState(true)

  async function loadData() {
    const { data: members } = await supabase
      .from("members")
      .select("*")
      .eq("status", "pending")

    setPendingMembers(members ?? [])

    const { data: transactions } = await supabase
      .from("transactions")
      .select(`
        *,
        members (
          name,
          email
        ),
        bank_accounts (
          bank_name,
          account_name
        )
      `)
      .eq("status", "pending")

    setPendingTransactions(transactions ?? [])
  }

  async function checkAdmin() {
    const {
      data: { user }
    } = await supabase.auth.getUser()

    if (!user) {
      router.push("/login")
      return
    }

    const { data: member } = await supabase
      .from("members")
      .select("role")
      .eq("email", user.email)
      .single()

    if (!member || member.role !== "admin") {
      router.push("/dashboard")
      return
    }

    await loadData()
    setCheckingAccess(false)
  }

  useEffect(() => {
    checkAdmin()
  }, [])

  if (checkingAccess) {
    return (
      <>
        <Navbar />
        <main className="min-h-screen bg-paper text-ink p-6">
          Checking admin access...
        </main>
      </>
    )
  }

  const menu = [
    {
      title: "Members",
      description: "Manage contributors and member balances",
      path: "/admin/members"
    },
    {
      title: "Banks",
      description: "Manage bank accounts and balances",
      path: "/admin/banks"
    },
    {
      title: "Assets",
      description: "Manage investments and fund assets",
      path: "/admin/assets"
    },
    {
      title: "Loans",
      description: "Approve requests and track repayment progress",
      path: "/admin/loans"
    }
  ]

  return (
    <>
      <Navbar />
      <main className="min-h-screen bg-paper text-ink font-sans">
        <div className="max-w-3xl mx-auto px-5 pt-10 pb-24">
          <div className="text-[11px] tracking-[0.18em] uppercase text-gold font-mono mb-2">
            Administration
          </div>
          <h1 className="font-display text-4xl font-semibold">
            Admin Panel
          </h1>
          <p className="text-sm text-ink-soft mt-2">
            Manage fund settings and approvals.
          </p>

          <div className="mt-8 space-y-3">
            {menu.map((item) => (
              <button
                key={item.title}
                onClick={() => router.push(item.path)}
                className="
                  w-full
                  text-left
                  bg-paper-2
                  border
                  border-hairline
                  rounded-md
                  p-5
                  hover:border-gold
                  transition
                "
              >
                <div className="font-display text-xl font-medium">
                  {item.title}
                </div>
                <div className="text-sm text-ink-soft mt-1">
                  {item.description}
                </div>
              </button>
            ))}
          </div>

          <section className="mt-10">
            <h2 className="font-display text-2xl font-semibold">
              Pending Approvals
            </h2>

            <div className="mt-3 space-y-2">
              <div className="bg-paper-2 border border-hairline rounded-md p-4 flex justify-between">
                <span className="text-sm">
                  Pending Members
                </span>
                <span className="font-mono">
                  {pendingMembers.length}
                </span>
              </div>
              <div className="bg-paper-2 border border-hairline rounded-md p-4 flex justify-between">
                <span className="text-sm">
                  Pending Transactions
                </span>
                <span className="font-mono">
                  {pendingTransactions.length}
                </span>
              </div>
            </div>
          </section>
        </div>
      </main>
    </>
  )
}
