"use client"

import { useEffect, useState } from "react"
import { supabase } from "@/lib/supabase"
import Navbar from "@/app/components/Navbar"


export default function TransactionsPage() {


  const [transactions, setTransactions] = useState<any[]>([])





  async function loadTransactions(){


    const { data } = await supabase
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
      .order("created_at", {
        ascending:false
      })



    setTransactions(data ?? [])

  }






  useEffect(()=>{

    loadTransactions()

  },[])








  return (

    <>

    <Navbar />


    <main className="p-6">


      <h1 className="text-3xl font-bold">
        Transactions
      </h1>





      <div className="mt-6 space-y-4">


      {transactions.map((transaction)=>(


        <div
          key={transaction.id}
          className="border rounded p-4"
        >


          <h2 className="font-bold text-lg">
            {transaction.type}
          </h2>




          <p>
            Member:
            {" "}
            {transaction.members?.name || "Unknown"}
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
              "None"
            }
          </p>




          <p>
            Status:
            {" "}
            {transaction.status}
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





        </div>


      ))}


      </div>


    </main>


    </>

  )

}