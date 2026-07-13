"use client"

import { useEffect, useState } from "react"
import { supabase } from "@/lib/supabase"

export default function DashboardPage() {
  const [email, setEmail] = useState("")
  const [members, setMembers] = useState(0)
  const [transactions, setTransactions] = useState(0)
  const [fundTotal, setFundTotal] = useState(0)

  useEffect(() => {
    async function loadDashboard() {

      const { data: userData } = await supabase.auth.getUser()

      if (userData.user) {
        setEmail(userData.user.email ?? "")
      }

      const { data: memberData, error: memberError } = await supabase
        .from("members")
        .select("*")

        console.log("Members:", memberData)
        console.log("Member error:", memberError)

      setMembers(memberData?.length ?? 0)


      const { data: transactionData } = await supabase
        .from("transactions")
        .select("amount")
        .eq("status", "approved")


      const total = transactionData?.reduce(
        (sum, item) => sum + Number(item.amount),
        0
      ) ?? 0

      setFundTotal(total)


      setTransactions(transactionData?.length ?? 0)
    }

    loadDashboard()

  }, [])


  return (
    <main className="min-h-screen p-6">

      <h1 className="text-3xl font-bold">
        Shared Fund Tracker
      </h1>

      <p className="mt-2">
        Welcome, {email}
      </p>


      <div className="mt-8 grid gap-4">

        <div className="rounded border p-4">
          <h2 className="font-bold">
            Total Fund
          </h2>
          <p>${fundTotal}</p>
        </div>


        <div className="rounded border p-4">
          <h2 className="font-bold">
            Members
          </h2>
          <p>{members}</p>
        </div>


        <div className="rounded border p-4">
          <h2 className="font-bold">
            Transactions
          </h2>
          <p>{transactions}</p>
        </div>

      </div>

    </main>
  )
}