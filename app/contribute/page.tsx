"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { supabase } from "@/lib/supabase"

export default function ContributePage() {

  const router = useRouter()

  const [banks, setBanks] = useState<any[]>([])
  const [bankAccountId, setBankAccountId] = useState("")
  const [amount, setAmount] = useState("")
  const [description, setDescription] = useState("")
  const [message, setMessage] = useState("")


  useEffect(() => {

    async function loadBanks() {

      const { data } = await supabase
        .from("bank_accounts")
        .select("*")


      setBanks(data ?? [])

    }


    loadBanks()

  }, [])


  async function submitContribution() {

    setMessage("")


    const {
      data: { user }
    } = await supabase.auth.getUser()


    if (!user) {
      router.push("/login")
      return
    }


    const { data: member } = await supabase
      .from("members")
      .select("id")
      .eq("email", user.email)
      .single()


    if (!member) {
      setMessage("Member not found")
      return
    }


    const { error } = await supabase
      .from("transactions")
      .insert({
        member_id: member.id,
        bank_account_id: bankAccountId,
        type: "contribution",
        amount: Number(amount),
        description,
        status: "pending"
      })


    if (error) {
      setMessage(error.message)
      return
    }


    setMessage("Contribution submitted for approval")


    setTimeout(() => {
      router.push("/dashboard")
    }, 1500)

  }


  return (
    <main className="min-h-screen p-6">

      <h1 className="text-3xl font-bold">
        Add Contribution
      </h1>


      <div className="mt-6 max-w-md space-y-4">


        <select
          className="w-full border p-3 rounded"
          value={bankAccountId}
          onChange={(e) => setBankAccountId(e.target.value)}
        >

          <option value="">
            Select Bank Account
          </option>


          {banks.map((bank) => (

            <option
              key={bank.id}
              value={bank.id}
            >
              {bank.account_name || bank.bank_name}
            </option>

          ))}

        </select>


        <input
          className="w-full border p-3 rounded"
          placeholder="Amount"
          type="number"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
        />


        <input
          className="w-full border p-3 rounded"
          placeholder="Description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />


        <button
          className="bg-black text-white px-4 py-3 rounded"
          onClick={submitContribution}
        >
          Submit Contribution
        </button>


        <p>
          {message}
        </p>

      </div>

    </main>
  )
}