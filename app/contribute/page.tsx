"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { supabase } from "@/lib/supabase"

export default function ContributePage() {

  const router = useRouter()

  const [amount, setAmount] = useState("")
  const [description, setDescription] = useState("")
  const [message, setMessage] = useState("")


  async function submitContribution() {

    setMessage("")


    const {
      data: { user }
    } = await supabase.auth.getUser()


    if (!user) {
      router.push("/login")
      return
    }


    const { data: member, error: memberError } = await supabase
      .from("members")
      .select("id")
      .eq("email", user.email)
      .single()


    if (memberError || !member) {
      setMessage("Member record not found")
      return
    }


    const { error } = await supabase
      .from("transactions")
      .insert({
        member_id: member.id,
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


      <div className="mt-6 space-y-4 max-w-md">

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