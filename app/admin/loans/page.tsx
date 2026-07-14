"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { supabase } from "@/lib/supabase"
import Navbar from "@/app/components/Navbar"

export default function AdminLoansPage() {
  const router = useRouter()
  const [checkingAccess, setCheckingAccess] = useState(true)
  const [loans, setLoans] = useState<any[]>([])
  const [closingId, setClosingId] = useState<string | null>(null)

  async function loadLoans() {
    const { data: loanList } = await supabase
      .from("loans")
      .select(`
        *,
        members ( name )
      `)
      .order("start_date", { ascending: false })

    const { data: allTransactions } = await supabase
      .from("transactions")
      .select("loan_id, type, amount, status")
      .not("loan_id", "is", null)
      .neq("status", "rejected")

    const withProgress = (loanList ?? []).map((loan) => {
      const related = (allTransactions ?? []).filter((t) => t.loan_id === loan.id)

      const disbursed = related
        .filter((t) => t.type === "loan_disbursement")
        .reduce((sum, t) => sum + Number(t.amount), 0)

      const repaid = related
        .filter((t) => t.type === "loan_repayment")
        .reduce((sum, t) => sum + Number(t.amount), 0)

      const totalRepayable =
        Number(loan.principal) + Number(loan.principal) * (Number(loan.interest_rate) / 100)

      const remaining = totalRepayable - repaid

      return {
        ...loan,
        disbursed,
        repaid,
        totalRepayable,
        remaining
      }
    })

    setLoans(withProgress)
  }

  async function approveLoan(id: string) {
    await supabase
      .from("loans")
      .update({ status: "active" })
      .eq("id", id)

    await supabase
      .from("transactions")
      .update({ status: "approved" })
      .eq("loan_id", id)
      .eq("type", "loan_disbursement")

    loadLoans()
  }

  async function closeLoanAndDistributeGain(loan: any) {
    setClosingId(loan.id)

    const gain = loan.repaid - Number(loan.principal)

    const { data: allMembers } = await supabase
      .from("members")
      .select("id, name")

    const eligibleMembers = (allMembers ?? []).filter(
      (m) => m.id !== loan.member_id
    )

    const { data: allTransactions } = await supabase
      .from("transactions")
      .select("member_id, type, amount, status")
      .neq("status", "rejected")

    const balances = eligibleMembers.map((member) => {
      const contributed = (allTransactions ?? [])
        .filter((t) => t.member_id === member.id && t.type === "contribution")
        .reduce((sum, t) => sum + Number(t.amount), 0)

      const withdrawn = (allTransactions ?? [])
        .filter((t) => t.member_id === member.id && t.type === "withdrawal")
        .reduce((sum, t) => sum + Number(t.amount), 0)

      return {
        member,
        balance: contributed - withdrawn
      }
    })

    const totalBalance = balances.reduce((sum, b) => sum + b.balance, 0)

    if (gain > 0 && totalBalance > 0) {
      const currentYear = new Date().getFullYear()

      const allocationRows = balances.map((b) => ({
        member_id: b.member.id,
        year: currentYear,
        category: "loan_interest",
        amount: Number(((b.balance / totalBalance) * gain).toFixed(2)),
        notes: `${b.member.name} balance ₱${b.balance.toFixed(2)} / total ₱${totalBalance.toFixed(2)} of ₱${gain.toFixed(2)} gain from loan closed ${new Date().toISOString().slice(0,10)}`
      }))

      await supabase
        .from("investment_allocations")
        .insert(allocationRows)

      const transactionRows = allocationRows.map((row) => ({
        member_id: row.member_id,
        bank_account_id: null,
        loan_id: loan.id,
        type: "investment_allocation",
        amount: row.amount,
        description: `Share of ${currentYear} loan interest gain (from ${loan.members?.name || "a member"}'s loan)`,
        status: "approved"
      }))

      await supabase
        .from("transactions")
        .insert(transactionRows)
    }

    await supabase
      .from("loans")
      .update({ status: "closed" })
      .eq("id", loan.id)

    setClosingId(null)
    loadLoans()
  }

  useEffect(() => {
    async function checkAdmin() {
      const {
        data: { user }
      } = await supabase.auth.getUser()

      if (!user) {
        router.push("/login")
        return
      }

      const { data: member } = await supabase
        .from("members")
        .select("role")
        .eq("email", user.email)
        .single()

      if (!member || member.role !== "admin") {
        router.push("/dashboard")
        return
      }

      await loadLoans()
      setCheckingAccess(false)
    }

    checkAdmin()
  }, [])

  const fmt = (n: number) =>
    Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })

  if (checkingAccess) {
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
            Admin
          </div>
          <h1 className="font-display text-4xl font-semibold text-ink">
            Loans
          </h1>

          <div className="mt-8 space-y-4">
            {loans.map((loan) => (
              <div
                key={loan.id}
                className="bg-paper-2 border border-hairline rounded-sm relative overflow-hidden"
              >
                <div className="absolute left-0 top-0 bottom-0 w-[3px] bg-gold" />
                <div className="pl-6 pr-5 py-4">
                  <div className="flex justify-between items-start">
                    <div>
                      <p className="font-display text-lg font-medium">
                        {loan.members?.name || "Unknown"}
                      </p>
                      <p className="text-xs text-ink-soft font-mono mt-1">
                        {loan.start_date} · {loan.interest_rate}% · {loan.term_months}mo · {loan.repayment_frequency}
                      </p>
                    </div>
                    <span
                      className={`text-[10px] uppercase tracking-wide font-mono border rounded-full px-2 py-0.5 ${
                        loan.status === "active"
                          ? "text-sage border-sage"
                          : loan.status === "requested"
                          ? "text-gold border-gold"
                          : "text-ink-soft border-hairline"
                      }`}
                    >
                      {loan.status}
                    </span>
                  </div>

                  <div className="mt-3 grid grid-cols-2 gap-2 text-xs font-mono text-ink-soft">
                    <div>Principal: ₱{fmt(loan.principal)}</div>
                    <div>Total repayable: ₱{fmt(loan.totalRepayable)}</div>
                    <div>Repaid: ₱{fmt(loan.repaid)}</div>
                    <div className={loan.remaining <= 0 ? "text-sage" : ""}>
                      {loan.remaining <= 0 ? "Fully repaid" : `Remaining: ₱${fmt(loan.remaining)}`}
                    </div>
                  </div>

                  {loan.status === "requested" && (
                    <button
                      className="mt-4 bg-ink text-paper px-4 py-2 rounded-sm text-sm"
                      onClick={() => approveLoan(loan.id)}
                    >
                      Approve & Activate
                    </button>
                  )}

                  {loan.status === "active" && loan.remaining <= 0 && (
                    <button
                      className="mt-4 bg-gold text-ink px-4 py-2 rounded-sm text-sm font-semibold disabled:opacity-50"
                      onClick={() => closeLoanAndDistributeGain(loan)}
                      disabled={closingId === loan.id}
                    >
                      {closingId === loan.id
                        ? "Closing & distributing..."
                        : `Close Loan & Distribute ₱${fmt(loan.repaid - Number(loan.principal))} Gain`}
                    </button>
                  )}
                </div>
              </div>
            ))}

            {loans.length === 0 && (
              <p className="text-sm text-ink-soft">No loans yet.</p>
            )}
          </div>
        </div>
      </main>
    </>
  )
}
