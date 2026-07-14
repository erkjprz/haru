"use client"

import { useEffect, useState } from "react"
import Navbar from "@/app/components/Navbar"
import { supabase } from "@/lib/supabase"

export default function AdminMembersPage() {

  const [members, setMembers] = useState<any[]>([])

  const [name, setName] = useState("")
  const [email, setEmail] = useState("")

  const [selectedMember, setSelectedMember] = useState<any>(null)

  const [amount, setAmount] = useState("")
  const [adjustmentType, setAdjustmentType] = useState("contribution")

  const [message, setMessage] = useState("")


  async function loadMembers() {

    const { data } = await supabase
      .from("members")
      .select("*")
      .order("created_at", {
        ascending: false
      })

    setMembers(data ?? [])

  }


  useEffect(() => {
    loadMembers()
  }, [])



  async function addMember() {

    const { error } = await supabase
      .from("members")
      .insert({
        name,
        email: email || null,
        role: "member",
        status: "approved"
      })


    if (error) {
      setMessage(error.message)
      return
    }


    setName("")
    setEmail("")
    setMessage("Member added")

    loadMembers()

  }




  async function addAdjustment() {

    if (!selectedMember || !amount) {
      return
    }


    const { error } = await supabase
      .from("transactions")
      .insert({

        member_id: selectedMember.id,

        bank_account_id: null,

        type: adjustmentType,

        amount: Number(amount),

        description:
          `Initial ${adjustmentType}`,

        status: "approved",

        allocation_type: "member"

      })


    if (error) {

      setMessage(error.message)
      return

    }


    setAmount("")
    setSelectedMember(null)

    setMessage(
      `${adjustmentType} added`
    )

  }



  return (
    <>
      <Navbar />

      <main className="min-h-screen bg-paper text-ink font-sans">

        <div className="max-w-3xl mx-auto px-5 pt-10 pb-24">


          <div className="text-[11px] tracking-[0.18em] uppercase text-gold font-mono mb-2">
            Administration
          </div>


          <h1 className="font-display text-4xl font-semibold">
            Members
          </h1>



          <div className="mt-6 bg-paper-2 border border-hairline rounded-md p-5 space-y-3">


            <h2 className="font-display text-xl">
              Add Member
            </h2>


            <input
              className="border border-hairline bg-paper px-3 py-2 rounded-md w-full"
              placeholder="Name"
              value={name}
              onChange={(e)=>setName(e.target.value)}
            />


            <input
              className="border border-hairline bg-paper px-3 py-2 rounded-md w-full"
              placeholder="Email (optional)"
              value={email}
              onChange={(e)=>setEmail(e.target.value)}
            />


            <button
              className="bg-ink text-paper px-4 py-2 rounded-md w-full"
              onClick={addMember}
            >
              Add Member
            </button>


          </div>



          {selectedMember && (

            <div className="mt-6 bg-paper-2 border border-hairline rounded-md p-5 space-y-3">


              <h2 className="font-display text-xl">
                Add Adjustment
              </h2>


              <p>
                {selectedMember.name}
              </p>


              <select
                className="border border-hairline bg-paper px-3 py-2 rounded-md w-full"
                value={adjustmentType}
                onChange={(e)=>setAdjustmentType(e.target.value)}
              >

                <option value="contribution">
                  Contribution
                </option>

                <option value="gain">
                  Gain
                </option>

                <option value="loss">
                  Loss
                </option>

              </select>


              <input
                className="border border-hairline bg-paper px-3 py-2 rounded-md w-full"
                placeholder="Amount"
                type="number"
                value={amount}
                onChange={(e)=>setAmount(e.target.value)}
              />


              <button
                className="bg-ink text-paper px-4 py-2 rounded-md w-full"
                onClick={addAdjustment}
              >
                Save
              </button>


            </div>

          )}



          {message && (
            <p className="mt-4 text-sm text-ink-soft">
              {message}
            </p>
          )}




          <div className="mt-8 space-y-3">


            {members.map((member)=>(

              <div
                key={member.id}
                className="bg-paper-2 border border-hairline rounded-md p-5"
              >

                <div className="font-display text-lg">
                  {member.name}
                </div>


                <div className="text-sm text-ink-soft">
                  {member.email || "No email"}
                </div>


                <button
                  className="mt-4 border border-hairline px-4 py-2 rounded-md text-sm"
                  onClick={() => setSelectedMember(member)}
                >
                  Add Contribution / Gain / Loss
                </button>


              </div>

            ))}


          </div>


        </div>

      </main>
    </>
  )
}