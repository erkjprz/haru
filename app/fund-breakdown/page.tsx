"use client"

import { useEffect, useState } from "react"
import Navbar from "@/app/components/Navbar"
import { supabase } from "@/lib/supabase"


export default function FundBreakdownPage(){


  const [data,setData] = useState<any[]>([])



  async function load(){


    const { data: members } =
      await supabase
      .from("members")
      .select("id,name")



    const { data: transactions } =
      await supabase
      .from("transactions")
      .select("member_id,type,amount")
      .neq("status","rejected")




    const result =
      (members ?? []).map(member=>{


        const memberTransactions =
          (transactions ?? [])
          .filter(
            t => t.member_id === member.id
          )



        const contributed =
          memberTransactions
          .filter(t=>t.type==="contribution")
          .reduce(
            (s,t)=>s+Number(t.amount),
            0
          )



        const gains =
          memberTransactions
          .filter(t=>t.type==="gain")
          .reduce(
            (s,t)=>s+Number(t.amount),
            0
          )



        const losses =
          memberTransactions
          .filter(t=>t.type==="loss")
          .reduce(
            (s,t)=>s+Number(t.amount),
            0
          )



        return {

          name: member.name,

          contributed,

          gains,

          losses,

          value:
            contributed + gains - losses

        }


      })



    setData(result)

  }




  useEffect(()=>{

    load()

  },[])






  return (

    <>

    <Navbar />

    <main className="p-6">


      <h1 className="text-3xl font-bold">
        Fund Breakdown
      </h1>



      <div className="mt-6 space-y-4">


      {data.map(member=>(


        <div
          key={member.name}
          className="border rounded p-4"
        >


          <h2 className="font-bold text-xl">
            {member.name}
          </h2>



          <p>
            Contributed:
            {" "}
            ${member.contributed.toFixed(2)}
          </p>


          <p>
            Gains:
            {" "}
            ${member.gains.toFixed(2)}
          </p>


          <p>
            Losses:
            {" "}
            ${member.losses.toFixed(2)}
          </p>


          <p className="font-bold mt-2">
            Current Value:
            {" "}
            ${member.value.toFixed(2)}
          </p>


        </div>


      ))}


      </div>


    </main>

    </>

  )

}