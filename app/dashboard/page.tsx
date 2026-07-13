"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { supabase } from "@/lib/supabase"

export default function DashboardPage() {

  const router = useRouter()

  const [email, setEmail] = useState("")
  const [members, setMembers] = useState(0)
  const [transactions, setTransactions] = useState(0)
  const [fundTotal, setFundTotal] = useState(0)
  const [checkingAccess, setCheckingAccess] = useState(true)
  const [isAdmin, setIsAdmin] = useState(false)


  async function loadDashboard() {

    const {
      data: { user }
    } = await supabase.auth.getUser()

    setEmail(user?.email ?? "")


    const { count: memberCount } = await supabase
      .from("members")
      .select("*", { count: "exact", head: true })

    setMembers(memberCount ?? 0)


    const { count: transactionCount } = await supabase
      .from("transactions")
      .select("*", { count: "exact", head: true })

    setTransactions(transactionCount ?? 0)


    const { data: transactionData } = await supabase
      .from("transactions")
      .select("amount")
      .eq("status", "approved")


    const total =
      transactionData?.reduce(
        (sum, transaction) =>
          sum + Number(transaction.amount),
        0
      ) ?? 0


    setFundTotal(total)
  }


  useEffect(() => {

    async function checkAccess() {

      const {
        data: { user }
      } = await supabase.auth.getUser()


      if (!user) {
        router.push("/login")
        return
      }


      const { data: member } = await supabase
        .from("members")
        .select("status, role")
        .eq("email", user.email)
        .single()


      if (!member) {
        router.push("/login")
        return
      }


      if (member.status !== "approved") {
        router.push("/waiting")
        return
      }


      if (member.role === "admin") {
        setIsAdmin(true)
      }


      await loadDashboard()

      setCheckingAccess(false)

    }


    checkAccess()

  }, [router])


  if (checkingAccess) {
    return (
      <main className="min-h-screen p-6">
        Checking access...
      </main>
    )
  }


  return (
    <main className="min-h-screen p-6">

      <h1 className="text-3xl font-bold">
        Shared Fund Tracker
      </h1>


      <p className="mt-2">
        Welcome, {email}
      </p>


      <div className="mt-4 flex gap-3 flex-wrap">

        <button
          className="bg-black text-white px-4 py-2 rounded"
          onClick={() => router.push("/contribute")}
        >
          Add Contribution
        </button>


        {isAdmin && (
          <button
            className="border px-4 py-2 rounded"
            onClick={() => router.push("/admin")}
          >
            Admin Panel
          </button>
        )}

      </div>


      <div className="mt-8 grid gap-4">

        <div className="rounded border p-4">
          <h2 className="font-bold">
            Total Fund
          </h2>

          <p>
            ${fundTotal}
          </p>
        </div>


        <div className="rounded border p-4">
          <h2 className="font-bold">
            Members
          </h2>

          <p>
            {members}
          </p>
        </div>


        <div className="rounded border p-4">
          <h2 className="font-bold">
            Transactions
          </h2>

          <p>
            {transactions}
          </p>
        </div>

      </div>

    </main>
  )
}