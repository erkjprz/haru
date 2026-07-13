"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { supabase } from "@/lib/supabase"
import Navbar from "@/app/components/Navbar"

export default function ContributePage() {

  const router = useRouter()

  const [banks, setBanks] = useState<any[]>([])

  const [bankId, setBankId] = useState("")
  const [amount, setAmount] = useState("")
  const [description, setDescription] = useState("")
  const [message, setMessage] = useState("")




  async function loadBanks() {


    const { data } = await supabase
      .from("bank_accounts")
      .select("*")
      .order("created_at")



    setBanks(data ?? [])

  }




  useEffect(() => {

    loadBanks()

  }, [])





  async function submitContribution() {


    const {
      data: { user }
    } = await supabase.auth.getUser()



    if (!user) {

      router.push("/login")
      return

    }




    const { data: member } = await supabase
      .from("members")
      .select("id, status")
      .eq("email", user.email)
      .single()



    if (!member || member.status !== "approved") {

      setMessage("You are not approved yet.")
      return

    }





    const { error } = await supabase
      .from("transactions")
      .insert({

        member_id: member.id,

        bank_account_id: bankId,

        type: "contribution",

        amount: Number(amount),

        description,

        status: "pending"

      })




    if (error) {

      setMessage(error.message)
      return

    }



    setMessage(
      "Contribution submitted. Waiting for approval."
    )


    setAmount("")
    setDescription("")

  }





  return (

    <>

      <Navbar />


      <main className="p-6">


        <h1 className="text-3xl font-bold">
          Add Contribution
        </h1>



        <div className="mt-6 max-w-md space-y-4">


          <select
            className="border p-3 rounded w-full"
            value={bankId}
            onChange={(e)=>setBankId(e.target.value)}
          >

            <option value="">
              Select Bank
            </option>


            {banks.map((bank)=>(

              <option
                key={bank.id}
                value={bank.id}
              >
                {bank.account_name || bank.bank_name}
              </option>

            ))}


          </select>




          <input
            className="border p-3 rounded w-full"
            placeholder="Amount"
            type="number"
            value={amount}
            onChange={(e)=>setAmount(e.target.value)}
          />




          <input
            className="border p-3 rounded w-full"
            placeholder="Description"
            value={description}
            onChange={(e)=>setDescription(e.target.value)}
          />




          <button
            className="bg-black text-white px-4 py-3 rounded w-full"
            onClick={submitContribution}
          >
            Submit Contribution
          </button>



          <p>
            {message}
          </p>


        </div>


      </main>


    </>

  )

}