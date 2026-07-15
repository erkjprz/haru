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
  investment_allocation: "Investment Allocation",
  bank_interest: "Bank Interest"
}

const typeColor: Record<string, string> = {
  contribution: "text-sage border-sage",
  withdrawal: "text-rust border-rust",
  expense: "text-rust border-rust",
  loan_disbursement: "text-gold border-gold",
  loan_repayment: "text-gold border-gold",
  investment_allocation: "text-ink-soft border-ink-soft",
  bank_interest: "text-sage border-sage"
}

export default function DashboardPage() {
  const router = useRouter()

  const [cashInBanks, setCashInBanks] = useState(0)
  const [totalContributions, setTotalContributions] = useState(0)
  const [totalWithdrawals, setTotalWithdrawals] = useState(0)
  const [bankInterestTotal, setBankInterestTotal] = useState(0)
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
        ascending:false
      })

    const allTransactions = transactions ?? []
    const nonRejected = allTransactions.filter(t => t.status !== "rejected")

    const cashTotal =
      nonRejected.reduce((sum,t)=>{
        if(t.type==="contribution"){
          return sum + Number(t.amount)
        }
        if(
          t.type==="expense" ||
          t.type==="withdrawal"
        ){
          return sum - Number(t.amount)
        }
        if(t.type==="loan_disbursement"){
          return sum - Number(t.amount)
        }
        if(t.type==="loan_repayment"){
          return sum + Number(t.amount)
        }
        if(t.type==="bank_interest"){
          return sum + Number(t.amount)
        }
        return sum
      },0)

    setCashInBanks(cashTotal)

    const contributionTotal =
      nonRejected
        .filter(t => t.type === "contribution")
        .reduce(
          (sum,t) => sum + Number(t.amount),
          0
        )

    setTotalContributions(contributionTotal)

    const withdrawalTotal =
      nonRejected
        .filter(t => t.type === "withdrawal")
        .reduce(
          (sum,t) => sum + Number(t.amount),
          0
        )

    setTotalWithdrawals(withdrawalTotal)

    const bankInterest =
      nonRejected
        .filter(t => t.type === "bank_interest")
        .reduce(
          (sum,t) => sum + Number(t.amount),
          0
        )

    setBankInterestTotal(bankInterest)

    const { data: allocations } = await supabase
      .from("investment_allocations")
      .select("category, amount")

    setLoanInterestTotal(
      allocations
        ?.filter(a => a.category === "loan_interest")
        .reduce(
          (sum,a) => sum + Number(a.amount),
          0
        ) ?? 0
    )

    setPerfumeBizTotal(
      allocations
        ?.filter(a => a.category === "perfume_biz")
        .reduce(
          (sum,a) => sum + Number(a.amount),
          0
        ) ?? 0
    )

    setFarmOnTotal(
      allocations
        ?.filter(a => a.category === "farmon_writeoff")
        .reduce(
          (sum,a) => sum + Number(a.amount),
          0
        ) ?? 0
    )

    const { count } = await supabase
      .from("members")
      .select("*", {
        count:"exact",
        head:true
      })

    setMembers(count ?? 0)

    setRecentTransactions(
      allTransactions.slice(0,5)
    )
  }

  useEffect(()=>{
    async function checkAccess(){
      const {
        data:{
          user
        }
      } = await supabase.auth.getUser()

      if(!user){
        router.push("/login")
        return
      }

      const { data: member } = await supabase
        .from("members")
        .select("status")
        .eq("email",user.email)
        .single()

      if(!member || member.status !== "approved"){
        router.push("/waiting")
        return
      }

      await loadDashboard()
      setCheckingAccess(false)
    }

    checkAccess()
  },[])

  const fmt = (n:number) =>
    n.toLocaleString(undefined,{
      minimumFractionDigits:2,
      maximumFractionDigits:2
    })

  if(checkingAccess){
    return(
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

          <div className="flex items-start justify-between gap-4">
            <h1 className="font-display text-4xl font-semibold">
              Dashboard
            </h1>
            <button
              className="
                shrink-0
                bg-gold
                text-ink
                px-5
                py-3
                rounded-sm
                text-sm
                font-semibold
                shadow-sm
                hover:opacity-90
                transition-opacity
                flex
                items-center
                gap-1.5
              "
              onClick={() => router.push("/transactions/new")}
            >
              <span className="text-lg leading-none">+</span>
              New Transaction
            </button>
          </div>

          <div className="mt-8 bg-paper-2 border border-hairline rounded-md p-5">
            <div className="space-y-3">
              <div className="flex justify-between text-sm font-mono">
                <span className="text-ink-soft">
                  Total Contributions
                </span>
                <span>
                  ₱{fmt(totalContributions)}
                </span>
              </div>

              <div className="flex justify-between text-sm font-mono">
                <span className="text-ink-soft">
                  Total Withdrawals
                </span>
                <span className="text-rust">
                  -₱{fmt(totalWithdrawals)}
                </span>
              </div>

              <div className="pt-3 border-t border-hairline">
                <div className="flex justify-between text-sm font-mono">
                  <span className="text-ink-soft">
                    Cash in Banks
                  </span>
                  <span className="font-semibold">
                    ₱{fmt(cashInBanks)}
                  </span>
                </div>
                {bankInterestTotal > 0 && (
                  <div className="flex justify-between text-xs font-mono text-ink-soft mt-1">
                    <span>
                      Includes bank interest earned
                    </span>
                    <span>
                      +₱{fmt(bankInterestTotal)}
                    </span>
                  </div>
                )}
              </div>

              <div className="pt-3 border-t border-hairline">
                <div className="text-sm text-ink-soft mb-2">
                  Investment Results
                </div>
                <div className="space-y-2 text-xs font-mono">
                  <div className="flex justify-between">
                    <span>
                      Loan Interest
                    </span>
                    <span>
                      +₱{fmt(loanInterestTotal)}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span>
                      Perfume Biz
                    </span>
                    <span>
                      +₱{fmt(perfumeBizTotal)}
                    </span>
                  </div>
                  <div className="flex justify-between text-rust">
                    <span>
                      FarmOn
                    </span>
                    <span>
                      -₱{fmt(Math.abs(farmOnTotal))}
                    </span>
                  </div>
                </div>
              </div>

              <div className="pt-3 border-t border-hairline flex justify-between text-sm font-mono">
                <span className="text-ink-soft">
                  Members
                </span>
                <span>
                  {members}
                </span>
              </div>
            </div>
          </div>

          <div className="mt-12 flex justify-between items-baselines">
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

          <div className="mt-4 bg-paper-2 border border-hairline rounded-md p-5">
            {recentTransactions.map((transaction,i)=>(
              <div
                key={transaction.id}
                className={`
                  py-4
                  ${
                    i !== recentTransactions.length - 1
                      ? "border-b border-dashed border-hairline"
                      : ""
                  }
                `}
              >
                <div className="flex justify-between gap-3">
                  <div>
                    <div className="flex gap-2 items-center flex-wrap">
                      <span
                        className={`
                          text-[10px]
                          uppercase
                          border
                          rounded-full
                          px-2
                          py-0.5
                          font-mono
                          ${
                            typeColor[transaction.type]
                            ??
                            "text-ink-soft border-hairline"
                          }
                        `}
                      >
                        {
                          typeLabels[transaction.type]
                          ||
                          transaction.type
                        }
                      </span>
                      <span className="text-[10px] text-ink-soft font-mono">
                        {transaction.status}
                      </span>
                    </div>
                    <div className="font-display mt-2">
                      {
                        transaction.members?.name
                        ||
                        "Fund"
                      }
                    </div>
                    <div className="text-xs text-ink-soft font-mono">
                      {
                        new Date(
                          transaction.created_at
                        ).toLocaleDateString()
                      }
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
      </main>
    </>
  )
}
