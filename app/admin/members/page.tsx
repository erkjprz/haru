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




  async function loadMembers(){

    const { data } = await supabase
      .from("members")
      .select("*")
      .order("created_at", {
        ascending:false
      })


    setMembers(data ?? [])

  }





  useEffect(()=>{

    loadMembers()

  },[])







  async function addMember(){


    const { error } = await supabase
      .from("members")
      .insert({

        name,

        email: email || null,

        role:"member",

        status:"approved"

      })



    if(error){

      setMessage(error.message)
      return

    }



    setName("")
    setEmail("")

    setMessage("Member added")

    loadMembers()

  }







  async function addAdjustment(){


    if(!selectedMember || !amount){
      return
    }




    const { error } = await supabase
      .from("transactions")
      .insert({

        member_id: selectedMember.id,

        bank_account_id:null,

        type: adjustmentType,

        amount:Number(amount),

        description:
          `Initial ${adjustmentType}`,

        status:"approved",

        allocation_type:"member"

      })




    if(error){

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

    <main className="p-6">


      <h1 className="text-3xl font-bold">
        Members
      </h1>





      <div className="mt-6 border rounded p-4 max-w-md space-y-3">


        <h2 className="font-bold">
          Add Member
        </h2>



        <input
          className="border p-3 rounded w-full"
          placeholder="Name"
          value={name}
          onChange={(e)=>setName(e.target.value)}
        />



        <input
          className="border p-3 rounded w-full"
          placeholder="Email (optional)"
          value={email}
          onChange={(e)=>setEmail(e.target.value)}
        />



        <button
          className="bg-black text-white px-4 py-2 rounded w-full"
          onClick={addMember}
        >
          Add Member
        </button>


      </div>






      {selectedMember && (

        <div className="mt-6 border rounded p-4 max-w-md space-y-3">


          <h2 className="font-bold">
            Add Member Adjustment
          </h2>



          <p>
            {selectedMember.name}
          </p>




          <select
            className="border p-3 rounded w-full"
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
            className="border p-3 rounded w-full"
            placeholder="Amount"
            type="number"
            value={amount}
            onChange={(e)=>setAmount(e.target.value)}
          />




          <button
            className="bg-black text-white px-4 py-2 rounded w-full"
            onClick={addAdjustment}
          >
            Save
          </button>


        </div>

      )}






      <p className="mt-4">
        {message}
      </p>







      <div className="mt-8 space-y-3">


      {members.map((member)=>(


        <div
          key={member.id}
          className="border rounded p-4"
        >


          <p className="font-bold">
            {member.name}
          </p>


          <p>
            {member.email || "No email"}
          </p>



          <button
            className="mt-3 border px-4 py-2 rounded"
            onClick={()=>
              setSelectedMember(member)
            }
          >
            Add Contribution / Gain / Loss
          </button>



        </div>


      ))}


      </div>


    </main>

    </>

  )

}