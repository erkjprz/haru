"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { supabase } from "@/lib/supabase"
import Navbar from "@/app/components/Navbar"

const typeLabels: Record<string, string> = {
  contribution: "Contribution",
  withdrawal: "Withdrawal",
  expense: "Expense",
  loan_disbursement: "Loan Disbursement",
  loan_repayment: "Loan Repayment",
  investment_allocation: "Investment Allocation"
}

const typeColor: Record<string, string> = {
  contribution: "text-sage border-sage",
  withdrawal: "text-rust border-rust",
  expense: "text-rust border-rust",
  loan_disbursement: "text-gold border-gold",
  loan_repayment: "text-gold border-gold",
  investment_allocation: "text-ink-soft border-ink-soft"
}

export default function DashboardPage() {
  const router = useRouter()

  const [cashInBanks, setCashInBanks] = useState(0)
  const [totalContributions, setTotalContributions] = useState(0)
  const [loanInterestTotal, setLoanInterestTotal] = useState(0)
  const [perfumeBizTotal, setPerfumeBizTotal] = useState(0)
  const [farmOnTotal, setFarmOnTotal] = useState(0)

  const [members, setMembers] = useState(0)
  const [recentTransactions, setRecentTransactions] = useState<any[]>([])

  const [checkingAccess, setCheckingAccess] = useState(true)

  async function loadDashboard() {

    const { data: transactions } = await supabase
      .from("transactions")
      .select(`
        *,
        members (
          name
        )
      `)
      .order("created_at", {
        ascending: false
      })


    const allTransactions = transactions ?? []


    const cashTotal =
      allTransactions.reduce((sum, t) => {

        if (t.status === "rejected") {
          return sum
        }

        if (t.type === "contribution") {
          return sum + Number(t.amount)
        }

        if (
          t.type === "expense" ||
          t.type === "withdrawal"
        ) {
          return sum - Number(t.amount)
        }

        return sum

      }, 0)


    setCashInBanks(cashTotal)



    const contributionTotal =
      allTransactions
        .filter(t => t.type === "contribution")
        .reduce(
          (sum, t) => sum + Number(t.amount),
          0
        )


    setTotalContributions(contributionTotal)



    const { data: allocations } = await supabase
      .from("investment_allocations")
      .select("category, amount")



    setLoanInterestTotal(
      allocations
        ?.filter(a => a.category === "loan_interest")
        .reduce(
          (sum, a) => sum + Number(a.amount),
          0
        ) ?? 0
    )


    setPerfumeBizTotal(
      allocations
        ?.filter(a => a.category === "perfume_biz")
        .reduce(
          (sum, a) => sum + Number(a.amount),
          0
        ) ?? 0
    )


    setFarmOnTotal(
      allocations
        ?.filter(a => a.category === "farmon_writeoff")
        .reduce(
          (sum, a) => sum + Number(a.amount),
          0
        ) ?? 0
    )



    const { count } = await supabase
      .from("members")
      .select("*", {
        count: "exact",
        head: true
      })


    setMembers(count ?? 0)



    setRecentTransactions(
      allTransactions.slice(0, 5)
    )

  }



  useEffect(() => {

    async function checkAccess() {

      const {
        data: {
          user
        }
      } = await supabase.auth.getUser()


      if (!user) {
        router.push("/login")
        return
      }


      const { data: member } = await supabase
        .from("members")
        .select("status")
        .eq("email", user.email)
        .single()



      if (!member || member.status !== "approved") {
        router.push("/waiting")
        return
      }


      await loadDashboard()

      setCheckingAccess(false)

    }


    checkAccess()

  }, [])



  const fmt = (n:number) =>
    n.toLocaleString(undefined, {
      minimumFractionDigits:2,
      maximumFractionDigits:2
    })



  if (checkingAccess) {

    return (
      <main className="p-6 bg-paper min-h-screen text-ink">
        Loading...
      </main>
    )

  }



  return (

    <>
      <Navbar />

      <main className="min-h-screen bg-paper text-ink font-sans">

        <div className="max-w-3xl mx-auto px-5 pt-10 pb-24">


          <div className="text-[11px] tracking-[0.18em] uppercase text-gold font-mono mb-2">
            Fund Overview
          </div>


          <h1 className="font-display text-4xl font-semibold">
            Dashboard
          </h1>



          <div className="mt-8 bg-paper-2 border border-hairline rounded-sm relative overflow-hidden">

            <div className="absolute left-0 top-0 bottom-0 w-[3px] bg-gold" />


            <div className="pl-6 pr-5">


              <div className="py-4 border-b border-dashed border-hairline flex justify-between">
                <span className="text-sm text-ink-soft">
                  Cash in Banks
                </span>

                <span className="font-mono text-lg">
                  ₱{fmt(cashInBanks)}
                </span>
              </div>



              <div className="py-4 border-b border-dashed border-hairline flex justify-between">

                <span className="text-sm text-ink-soft">
                  Total Contributions
                </span>

                <span className="font-mono text-lg">
                  ₱{fmt(totalContributions)}
                </span>

              </div>



              <div className="py-4 border-b border-dashed border-hairline">

                <div className="text-sm text-ink-soft mb-2">
                  Investment Results
                </div>


                <div className="text-xs font-mono space-y-1">

                  <div>
                    Loan Interest +₱{fmt(loanInterestTotal)}
                  </div>

                  <div>
                    Perfume Biz +₱{fmt(perfumeBizTotal)}
                  </div>

                  <div className="text-rust">
                    FarmOn -₱{fmt(Math.abs(farmOnTotal))}
                  </div>

                </div>

              </div>



              <div className="py-4 flex justify-between">

                <span className="text-sm text-ink-soft">
                  Members
                </span>

                <span className="font-mono">
                  {members}
                </span>

              </div>


            </div>

          </div>





          <div className="mt-12 flex justify-between items-baseline">

            <h2 className="font-display text-2xl font-semibold">
              Recent Activity
            </h2>

            <button
              className="text-xs text-gold font-mono"
              onClick={() => router.push("/transactions")}
            >
              View all
            </button>

          </div>




          <div className="mt-4 bg-paper-2 border border-hairline rounded-sm relative overflow-hidden">

            <div className="absolute left-0 top-0 bottom-0 w-[3px] bg-gold" />


            <div className="pl-6 pr-5">

              {recentTransactions.map((transaction, i) => (

                <div
                  key={transaction.id}
                  className={`py-4 ${
                    i !== recentTransactions.length - 1
                    ? "border-b border-dashed border-hairline"
                    : ""
                  }`}
                >

                  <div className="flex justify-between gap-3">

                    <div>

                      <div className="flex gap-2 items-center flex-wrap">

                        <span
                          className={`text-[10px] uppercase border rounded-full px-2 py-0.5 font-mono ${
                            typeColor[transaction.type] ??
                            "text-ink-soft border-hairline"
                          }`}
                        >
                          {typeLabels[transaction.type] || transaction.type}
                        </span>


                        <span className="text-[10px] text-ink-soft font-mono">
                          {transaction.status}
                        </span>

                      </div>


                      <div className="font-display mt-1">
                        {transaction.members?.name || "Unknown"}
                      </div>


                      <div className="text-xs text-ink-soft font-mono">
                        {new Date(transaction.created_at).toLocaleDateString()}
                      </div>


                    </div>



                    <div className="font-mono font-semibold">
                      ₱{fmt(transaction.amount)}
                    </div>


                  </div>


                </div>

              ))}


            </div>


          </div>


        </div>

      </main>

    </>

  )
}