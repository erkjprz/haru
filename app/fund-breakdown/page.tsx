"use client"

import { useEffect, useState } from "react"
import { supabase } from "@/lib/supabase"
import Navbar from "@/app/components/Navbar"

export default function FundBreakdownPage() {
  const [members, setMembers] = useState<any[]>([])
  const [loading, setLoading] = useState(true)

  async function load() {

    const { data: memberList, error: memberError } = await supabase
      .from("members")
      .select("member_id, name")
      .eq("status", "approved")


    const { data: ledger, error: ledgerError } = await supabase
      .from("v_member_ledger")
      .select("*")


    const { data: allocations, error: allocationError } = await supabase
      .from("investment_allocations")
      .select("member_id, amount, allocation_type")


    if (memberError || ledgerError || allocationError) {
      console.error(memberError || ledgerError || allocationError)
    }


    const investmentByMember: Record<string, number> = {}


    allocations?.forEach((item: any) => {

      let value = 0


      if (item.allocation_type === "Investment Gain") {
        value = Number(item.amount)
      }


      if (item.allocation_type === "Investment Loss") {
        value = -Number(item.amount)
      }


      investmentByMember[item.member_id] =
        (investmentByMember[item.member_id] ?? 0) + value

    })



    const breakdown =
      (memberList ?? []).map((member: any) => {

        const memberLedger =
          ledger?.find(
            (item: any) =>
              item.member === member.name
          )

        const contribution =
          Number(memberLedger?.contribution ?? 0)


        const withdrawal =
          Number(memberLedger?.withdrawal ?? 0)


        const netContribution =
          Number(memberLedger?.net ?? 0)


        const investmentGainLoss =
          investmentByMember[member.member_id] ?? 0


        const currentValue =
          netContribution + investmentGainLoss



        return {

          name: member.name,

          contribution,

          withdrawal,

          netContribution,

          investmentGainLoss,

          currentValue

        }

      })



    const totalFundValue =
      breakdown.reduce(
        (sum, member) =>
          sum + member.currentValue,
        0
      )



    const final =
      breakdown
        .map(member => ({

          ...member,

          shareOfFund:
            totalFundValue > 0
              ? (member.currentValue / totalFundValue) * 100
              : 0

        }))
        .sort(
          (a, b) =>
            b.currentValue - a.currentValue
        )



    setMembers(final)

    setLoading(false)

  }



  useEffect(() => {
    load()
  }, [])



  const fmt = (n:number) =>
    n.toLocaleString(undefined,{
      minimumFractionDigits:2,
      maximumFractionDigits:2
    })



  if (loading) {

    return (
      <>
        <Navbar />

        <main className="p-6 bg-paper min-h-screen text-ink">
          Loading...
        </main>
      </>
    )

  }



  return (

    <>
      <Navbar />

      <main className="min-h-screen bg-paper text-ink font-sans">

        <div className="max-w-3xl mx-auto px-5 pt-10 pb-24">


          <div className="text-[11px] tracking-[0.18em] uppercase text-gold font-mono mb-2">
            Member Ledger
          </div>


          <h1 className="font-display text-4xl font-semibold">
            Fund Breakdown
          </h1>


          <p className="text-sm text-ink-soft mt-2">
            Ownership based on net contribution and investment performance.
          </p>



          <div className="mt-8 space-y-4">


            {members.map((member)=> (

              <div
                key={member.name}
                className="bg-paper-2 border border-hairline rounded-md p-5"
              >


                <div className="flex justify-between items-baseline">

                  <span className="font-display text-xl font-semibold">
                    {member.name}
                  </span>


                  <span className="text-xs text-ink-soft font-mono">
                    {member.shareOfFund.toFixed(2)}% of fund
                  </span>

                </div>



                <div className="mt-4 space-y-2 text-sm font-mono">


                  <div className="flex justify-between">
                    <span className="text-ink-soft">
                      Contribution
                    </span>

                    <span>
                      ₱{fmt(member.contribution)}
                    </span>
                  </div>



                  <div className="flex justify-between">
                    <span className="text-ink-soft">
                      Withdrawal
                    </span>

                    <span className="text-rust">
                      ₱{fmt(member.withdrawal)}
                    </span>
                  </div>



                  <div className="flex justify-between">
                    <span className="text-ink-soft">
                      Net Contribution
                    </span>

                    <span>
                      ₱{fmt(member.netContribution)}
                    </span>
                  </div>



                  <div className="flex justify-between">

                    <span className="text-ink-soft">
                      Investment Gain/Loss
                    </span>


                    <span
                      className={
                        member.investmentGainLoss >= 0
                        ? "text-sage"
                        : "text-rust"
                      }
                    >
                      {member.investmentGainLoss >= 0 ? "+" : "-"}
                      ₱
                      {fmt(
                        Math.abs(member.investmentGainLoss)
                      )}
                    </span>

                  </div>


                </div>



                <div className="mt-5 pt-4 border-t border-hairline flex justify-between items-baseline">

                  <span className="font-semibold">
                    Current Value
                  </span>


                  <span className="font-display text-2xl font-semibold">
                    ₱{fmt(member.currentValue)}
                  </span>

                </div>


              </div>

            ))}


          </div>

        </div>

      </main>

    </>

  )

}
