"use client"

import { useEffect, useState } from "react"
import { supabase } from "@/lib/supabase"
import Navbar from "@/app/components/Navbar"

export default function BanksPage() {

  const [banks, setBanks] = useState<any[]>([])
  const [loading, setLoading] = useState(true)



  async function loadBanks() {


    const { data: bankData } = await supabase
      .from("bank_accounts")
      .select("*")
      .order("created_at", { ascending: false })



    const { data: transactions } = await supabase
      .from("transactions")
      .select("*")
      .neq("status", "rejected")



    const updatedBanks = (bankData ?? []).map((bank) => {


      const bankTransactions =
        transactions?.filter(
          (transaction) =>
            transaction.bank_account_id === bank.id
        ) ?? []



      const transactionTotal =
        bankTransactions.reduce(
          (total, transaction) => {


            if (transaction.type === "contribution") {
              return total + Number(transaction.amount)
            }


            if (transaction.type === "expense") {
              return total - Number(transaction.amount)
            }


            return total

          },
          0
        )



      return {

        ...bank,

        current_balance:
          Number(bank.opening_balance) + transactionTotal

      }


    })



    setBanks(updatedBanks)

    setLoading(false)

  }




  useEffect(() => {

    loadBanks()

  }, [])




  if (loading) {

    return (
      <>
        <Navbar />

        <main className="p-6">
          Loading banks...
        </main>
      </>
    )

  }




  return (

    <>

      <Navbar />


      <main className="min-h-screen p-6">


        <h1 className="text-3xl font-bold">
          Bank Accounts
        </h1>




        <div className="mt-6 space-y-4">


          {banks.map((bank) => (


            <div
              key={bank.id}
              className="border rounded p-4"
            >


              <h2 className="text-xl font-bold">
                {bank.account_name || bank.bank_name}
              </h2>



              <p>
                Bank: {bank.bank_name}
              </p>



              <p>
                Opening Balance:
                {" "}
                ${Number(bank.opening_balance).toFixed(2)}
              </p>



              <p className="font-bold mt-2">
                Current Balance:
                {" "}
                ${Number(bank.current_balance).toFixed(2)}
              </p>



              <p>
                Interest Rate:
                {" "}
                {bank.interest_rate}%
              </p>


            </div>


          ))}




          {banks.length === 0 && (

            <p>
              No bank accounts found.
            </p>

          )}



        </div>


      </main>


    </>

  )

}