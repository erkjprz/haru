"use client"

import { useEffect, useState } from "react"
import { supabase } from "@/lib/supabase"
import Navbar from "@/app/components/Navbar"

export default function TransactionsPage() {

  const [transactions, setTransactions] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [isAdmin, setIsAdmin] = useState(false)



  async function loadTransactions() {


    const {
      data: { user }
    } = await supabase.auth.getUser()



    if (!user) {
      return
    }




    const { data: member } = await supabase
      .from("members")
      .select("id, role")
      .eq("email", user.email)
      .single()




    if (!member) {
      return
    }



    if (member.role === "admin") {

      setIsAdmin(true)


      const { data } = await supabase
        .from("transactions")
        .select(`
          *,
          members (
            name
          ),
          bank_accounts (
            bank_name,
            account_name
          )
        `)
        .order("created_at", {
          ascending:false
        })


      setTransactions(data ?? [])


    } else {


      const { data } = await supabase
        .from("transactions")
        .select(`
          *,
          bank_accounts (
            bank_name,
            account_name
          )
        `)
        .eq("member_id", member.id)
        .order("created_at", {
          ascending:false
        })


      setTransactions(data ?? [])

    }



    setLoading(false)

  }





  useEffect(()=>{

    loadTransactions()

  },[])






  if(loading){

    return (

      <>
        <Navbar />

        <main className="p-6">
          Loading transactions...
        </main>

      </>

    )

  }






  return (

    <>

      <Navbar />


      <main className="p-6">


        <h1 className="text-3xl font-bold">
          Transactions
        </h1>




        {isAdmin && (

          <p className="mt-2 text-sm">
            Showing all member transactions
          </p>

        )}






        <div className="mt-6 space-y-4">



          {transactions.map((transaction)=>(


            <div
              key={transaction.id}
              className="border rounded p-4"
            >


              {isAdmin && (

                <p className="font-bold">
                  Member:
                  {" "}
                  {transaction.members?.name}
                </p>

              )}




              <p>
                Type:
                {" "}
                {transaction.type}
              </p>




              <p>
                Amount:
                {" "}
                ${Number(transaction.amount).toFixed(2)}
              </p>




              <p>
                Bank:
                {" "}
                {
                  transaction.bank_accounts?.account_name ||
                  transaction.bank_accounts?.bank_name ||
                  "Unknown"
                }
              </p>




              <p>
                Description:
                {" "}
                {transaction.description || "-"}
              </p>




              <p>
                Status:
                {" "}
                <span className="font-bold">
                  {transaction.status}
                </span>
              </p>




              <p className="text-sm mt-2">
                {new Date(
                  transaction.created_at
                ).toLocaleString()}
              </p>



            </div>


          ))}




          {transactions.length === 0 && (

            <p>
              No transactions found.
            </p>

          )}



        </div>


      </main>


    </>

  )

}