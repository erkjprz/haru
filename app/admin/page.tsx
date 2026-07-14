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

  async function approveMember(id: string) {
    await supabase
      .from("members")
      .update({
        status: "approved"
      })
      .eq("id", id)

    loadData()
  }

  async function approveTransaction(id: string) {
    await supabase
      .from("transactions")
      .update({
        status: "approved"
      })
      .eq("id", id)

    loadData()
  }

  async function rejectTransaction(id: string) {
    await supabase
      .from("transactions")
      .update({
        status: "rejected"
      })
      .eq("id", id)

    loadData()
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
        <main className="p-6">
          Checking admin access...
        </main>
      </>
    )
  }

  return (
    <>
      <Navbar />
      <main className="p-6">
        <h1 className="text-3xl font-bold">
          Admin Panel
        </h1>

        <button
          className="mt-4 bg-black text-white px-4 py-2 rounded"
          onClick={() => router.push("/admin/banks")}
        >
          Bank Accounts
        </button>

        <section className="mt-10">
          <h2 className="text-xl font-bold">
            Pending Members
          </h2>

          <div className="mt-4 space-y-3">
            {pendingMembers.map((member) => (
              <div
                key={member.id}
                className="border rounded p-4"
              >
                <p className="font-bold">
                  {member.name}
                </p>
                <p>
                  {member.email}
                </p>
                <button
                  className="mt-3 bg-black text-white px-4 py-2 rounded"
                  onClick={() => approveMember(member.id)}
                >
                  Approve
                </button>
              </div>
            ))}
            {pendingMembers.length === 0 && (
              <p>
                No pending members
              </p>
            )}
          </div>
        </section>

        <section className="mt-10">
          <h2 className="text-xl font-bold">
            Pending Transactions
          </h2>

          <div className="mt-4 space-y-3">
            {pendingTransactions.map((transaction) => (
              <div
                key={transaction.id}
                className="border rounded p-4"
              >
                <p className="font-bold">
                  {transaction.members?.name || "Unknown"}
                </p>
                <p>
                  Amount: ₱{transaction.amount}
                </p>
                <p>
                  Type: {transaction.type}
                </p>
                <p>
                  Bank:{" "}
                  {
                    transaction.bank_accounts?.account_name ||
                    transaction.bank_accounts?.bank_name ||
                    "Unknown"
                  }
                </p>
                <p>
                  {transaction.description}
                </p>
                {transaction.receipt_url && (
                  <div className="mt-4">
                    <a
                      href={transaction.receipt_url}
                      target="_blank"
                    >
                      <img
                        src={transaction.receipt_url}
                        alt="Receipt"
                        className="w-32 rounded border cursor-pointer"
                      />
                    </a>
                  </div>
                )}
                <div className="mt-4 flex gap-2">
                  <button
                    className="bg-black text-white px-4 py-2 rounded"
                    onClick={() => approveTransaction(transaction.id)}
                  >
                    Approve
                  </button>
                  <button
                    className="border px-4 py-2 rounded"
                    onClick={() => rejectTransaction(transaction.id)}
                  >
                    Reject
                  </button>
                </div>
              </div>
            ))}
            {pendingTransactions.length === 0 && (
              <p>
                No pending transactions
              </p>
            )}
          </div>
        </section>
      </main>
    </>
  )
}
