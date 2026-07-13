"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { supabase } from "@/lib/supabase"

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
      <main className="p-6">
        Checking admin access...
      </main>
    )

  }



  return (

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
                {transaction.members?.name}
              </p>


              <p>
                ${transaction.amount}
              </p>


              <p>
                {transaction.description}
              </p>



              <button
                className="mt-3 bg-black text-white px-4 py-2 rounded"
                onClick={() => approveTransaction(transaction.id)}
              >
                Approve
              </button>


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

  )

}