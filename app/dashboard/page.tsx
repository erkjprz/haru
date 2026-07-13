"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { supabase } from "@/lib/supabase"
import Navbar from "@/app/components/Navbar"

export default function DashboardPage() {

  const router = useRouter()

  const [fundTotal, setFundTotal] = useState(0)
  const [members, setMembers] = useState(0)
  const [transactions, setTransactions] = useState(0)
  const [checkingAccess, setCheckingAccess] = useState(true)



  async function loadDashboard() {


    const { data: banks } = await supabase
      .from("bank_accounts")
      .select("opening_balance")


    const openingTotal =
      banks?.reduce(
        (sum, bank) =>
          sum + Number(bank.opening_balance),
        0
      ) ?? 0



    const { data: transactionData } = await supabase
      .from("transactions")
      .select("type, amount")
      .neq("status", "rejected")



    const transactionTotal =
      transactionData?.reduce(
        (sum, transaction) => {


          if (transaction.type === "contribution") {
            return sum + Number(transaction.amount)
          }


          if (transaction.type === "expense") {
            return sum - Number(transaction.amount)
          }


          return sum

        },
        0
      ) ?? 0



    setFundTotal(openingTotal + transactionTotal)



    const { count: memberCount } = await supabase
      .from("members")
      .select("*", { count: "exact", head: true })


    setMembers(memberCount ?? 0)



    const { count: transactionCount } = await supabase
      .from("transactions")
      .select("*", { count: "exact", head: true })


    setTransactions(transactionCount ?? 0)

  }




  useEffect(() => {


    async function checkAccess() {


      const {
        data:{ user }
      } = await supabase.auth.getUser()



      if (!user) {

        router.push("/login")
        return

      }



      const { data: member } = await supabase
        .from("members")
        .select("status")
        .eq("email", user.email)
        .single()



      if (!member || member.status !== "approved") {

        router.push("/waiting")
        return

      }



      await loadDashboard()

      setCheckingAccess(false)

    }


    checkAccess()


  }, [])



  if (checkingAccess) {

    return (
      <main className="p-6">
        Loading...
      </main>
    )

  }



  return (

    <>

      <Navbar />


      <main className="min-h-screen p-6">


        <h1 className="text-3xl font-bold">
          Dashboard
        </h1>



        <div className="mt-8 grid gap-4">


          <div className="border rounded p-4">

            <h2 className="font-bold">
              Total Fund
            </h2>

            <p>
              ${fundTotal.toFixed(2)}
            </p>

          </div>



          <div className="border rounded p-4">

            <h2 className="font-bold">
              Members
            </h2>

            <p>
              {members}
            </p>

          </div>



          <div className="border rounded p-4">

            <h2 className="font-bold">
              Transactions
            </h2>

            <p>
              {transactions}
            </p>

          </div>


        </div>


      </main>

    </>

  )

}