"use client"

import { useEffect, useState } from "react"
import { supabase } from "@/lib/supabase"
import Navbar from "@/app/components/Navbar"

export default function FundBreakdownPage() {
  const [totalContributions, setTotalContributions] = useState(0)
  const [cashInBanks, setCashInBanks] = useState(0)

  const [loanInterestTotal, setLoanInterestTotal] = useState(0)
  const [perfumeBizTotal, setPerfumeBizTotal] = useState(0)
  const [farmOnTotal, setFarmOnTotal] = useState(0)

  const [members, setMembers] = useState<any[]>([])
  const [loading, setLoading] = useState(true)

  async function load() {

    const { data: transactions } = await supabase
      .from("transactions")
      .select("member_id, type, amount, status")
      .neq("status", "rejected")


    const cashTotal =
      transactions?.reduce((sum, t) => {

        if (t.type === "contribution")
          return sum + Number(t.amount)

        if (t.type === "expense")
          return sum - Number(t.amount)

        if (t.type === "withdrawal")
          return sum - Number(t.amount)

        return sum

      }, 0) ?? 0


    setCashInBanks(cashTotal)



    const contributionTotal =
      transactions
        ?.filter((t) => t.type === "contribution")
        .reduce(
          (sum, t) => sum + Number(t.amount),
          0
        ) ?? 0


    setTotalContributions(contributionTotal)



    const netContributionTotal =
      transactions?.reduce((sum, t) => {

        if (t.type === "contribution")
          return sum + Number(t.amount)

        if (t.type === "withdrawal")
          return sum - Number(t.amount)

        return sum

      }, 0) ?? 0





    const { data: allocations } = await supabase
      .from("investment_allocations")
      .select("member_id, category, amount")




    setLoanInterestTotal(
      allocations
        ?.filter((a) => a.category === "loan_interest")
        .reduce(
          (sum, a) => sum + Number(a.amount),
          0
        ) ?? 0
    )



    setPerfumeBizTotal(
      allocations
        ?.filter((a) => a.category === "perfume_biz")
        .reduce(
          (sum, a) => sum + Number(a.amount),
          0
        ) ?? 0
    )



    setFarmOnTotal(
      allocations
        ?.filter((a) => a.category === "farmon_writeoff")
        .reduce(
          (sum, a) => sum + Number(a.amount),
          0
        ) ?? 0
    )




    const { data: memberList } = await supabase
      .from("members")
      .select("id, name")



    const breakdown =
      (memberList ?? [])
        .map((member) => {

          const memberContributed =
            transactions
              ?.filter(
                (t) =>
                  t.member_id === member.id &&
                  t.type === "contribution"
              )
              .reduce(
                (sum, t) => sum + Number(t.amount),
                0
              ) ?? 0



          const memberWithdrawn =
            transactions
              ?.filter(
                (t) =>
                  t.member_id === member.id &&
                  t.type === "withdrawal"
              )
              .reduce(
                (sum, t) => sum + Number(t.amount),
                0
              ) ?? 0



          const netContributed =
            memberContributed - memberWithdrawn



          const memberInvestmentResult =
            allocations
              ?.filter((a) => a.member_id === member.id)
              .reduce(
                (sum, a) => sum + Number(a.amount),
                0
              ) ?? 0



          const ownershipPercent =
            netContributionTotal > 0
              ? (netContributed / netContributionTotal) * 100
              : 0



          const ownershipValue =
            netContributed + memberInvestmentResult



          return {
            name: member.name,
            contributed: memberContributed,
            netContributed,
            investmentResult: memberInvestmentResult,
            ownershipPercent,
            ownershipValue
          }

        })
        .sort(
          (a, b) =>
            b.ownershipValue - a.ownershipValue
        )



    setMembers(breakdown)

    setLoading(false)
  }



  useEffect(() => {
    load()
  }, [])



  const fmt = (n: number) =>
    n.toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    })



  if (loading) {
    return (
      <>
        <Navbar />

        <main className="p-6 bg-paper min-h-screen text-ink font-sans">
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
            Ledger Summary
          </div>


          <h1 className="font-display text-4xl font-semibold text-ink">
            Fund Breakdown
          </h1>




          <div className="mt-8 bg-paper-2 border border-hairline rounded-md p-5">


            <div className="flex justify-between items-center py-3 border-b border-hairline">

              <span className="text-sm text-ink-soft">
                Total Contributions
              </span>


              <span className="font-mono text-lg">
                ₱{fmt(totalContributions)}
              </span>

            </div>




            <div className="flex justify-between items-center py-3 border-b border-hairline">


              <span className="text-sm text-ink-soft">
                Cash in Banks
              </span>


              <span className="font-mono text-lg">
                ₱{fmt(cashInBanks)}
              </span>


            </div>





            <div className="py-3">


              <div className="text-sm text-ink-soft mb-3">
                Investment Results
              </div>




              <div className="flex justify-between items-center text-xs font-mono">

                <span className="text-ink-soft">
                  Loan Interest
                </span>

                <span className="text-sage">
                  +₱{fmt(loanInterestTotal)}
                </span>

              </div>




              <div className="flex justify-between items-center text-xs font-mono mt-2">

                <span className="text-ink-soft">
                  Perfume Business
                </span>

                <span className="text-sage">
                  +₱{fmt(perfumeBizTotal)}
                </span>

              </div>




              <div className="flex justify-between items-center text-xs font-mono mt-2">

                <span className="text-ink-soft">
                  FarmOn
                </span>

                <span className="text-rust">
                  -₱{fmt(Math.abs(farmOnTotal))}
                </span>

              </div>


            </div>


          </div>






          <div className="mt-12 flex justify-between items-baseline">


            <h2 className="font-display text-2xl font-semibold text-ink">
              Member Ownership
            </h2>


            <span className="text-xs text-ink-soft font-mono">
              {members.length} members
            </span>


          </div>





          <div className="mt-4 space-y-3">


            {members.map((member) => (


              <div
                key={member.name}
                className="bg-paper-2 border border-hairline rounded-md p-4"
              >


                <div className="flex justify-between items-baseline">


                  <span className="font-display text-lg font-medium text-ink">
                    {member.name}
                  </span>


                  <span className="text-xs text-ink-soft font-mono">
                    {member.ownershipPercent.toFixed(1)}%
                  </span>


                </div>





                <div className="mt-3 space-y-2">



                  <div className="flex justify-between text-xs font-mono">

                    <span className="text-ink-soft">
                      Contributed
                    </span>


                    <span>
                      ₱{fmt(member.contributed)}
                    </span>


                  </div>





                  <div className="flex justify-between text-xs font-mono">


                    <span className="text-ink-soft">
                      Investment Result
                    </span>


                    <span
                      className={
                        member.investmentResult >= 0
                          ? "text-sage"
                          : "text-rust"
                      }
                    >

                      {member.investmentResult >= 0 ? "+" : "-"}

                      ₱{fmt(Math.abs(member.investmentResult))}

                    </span>


                  </div>





                  <div className="flex justify-between items-center pt-2 border-t border-hairline">


                    <span className="text-sm font-semibold text-ink">
                      Value
                    </span>


                    <span className="font-mono text-lg font-semibold text-ink">
                      ₱{fmt(member.ownershipValue)}
                    </span>


                  </div>


                </div>


              </div>


            ))}


          </div>


        </div>

      </main>

    </>
  )
}