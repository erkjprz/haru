import { useEffect, useState } from "react"
import { supabase } from "@/lib/supabase"
import { totalRepayable, type InterestType } from "@/lib/loanMath"

export type Repayment = {
  transaction_id: string
  amount: number
  status: "pending" | "approved" | "rejected" | "cancelled"
  date: string
  rejection_reason: string | null
  receipt_url: string | null
}

export type Loan = {
  loan_id: string
  name: string | null
  status: "requested" | "active" | "closed"
  start_date: string
  principal: number
  interest_type: InterestType
  interest_rate: number
  interest_amount: number
  term_months: number | null
  repaid: number
  totalRepayable: number
  outstanding: number
  repayments: Repayment[]
}

// Shared between /borrower (the borrower's own view) and the admin "view
// as" preview -- same loans-plus-repayments query for either, parameterized
// by whose member_id/borrower_id to fetch.
export function useLoansSummary(memberId: string | undefined) {
  const [loading, setLoading] = useState(true)
  const [loans, setLoans] = useState<Loan[]>([])
  const [loadError, setLoadError] = useState("")

  useEffect(() => {
    if (!memberId) return

    let cancelled = false

    async function load() {
      setLoading(true)
      setLoadError("")

      const { data: borrowerRow } = await supabase
        .from("borrowers")
        .select("borrower_id")
        .eq("member_id", memberId)
        .maybeSingle()

      const filter = borrowerRow?.borrower_id
        ? `member_id.eq.${memberId},borrower_id.eq.${borrowerRow.borrower_id}`
        : `member_id.eq.${memberId}`

      const { data: myLoans, error } = await supabase
        .from("loans")
        .select("*")
        .or(filter)
        .order("start_date", { ascending: false })

      if (error) {
        if (!cancelled) {
          setLoadError(error.message)
          setLoading(false)
        }
        return
      }

      const loanIds = (myLoans ?? []).map((l) => l.loan_id)
      const { data: allTxns, error: txnsError } = loanIds.length
        ? await supabase
            .from("transactions")
            .select(
              "transaction_id, loan_id, classification, amount, status, txn_date, created_at, rejection_reason, receipt_url"
            )
            .in("loan_id", loanIds)
            .neq("status", "cancelled")
            .order("txn_date", { ascending: false })
        : { data: [], error: null }

      if (txnsError) {
        if (!cancelled) {
          setLoadError(txnsError.message)
          setLoading(false)
        }
        return
      }

      const withProgress: Loan[] = (myLoans ?? []).map((loan) => {
        const related = (allTxns ?? []).filter((t) => t.loan_id === loan.loan_id)
        const repayments = related.filter((t) => t.classification === "Loan Repayment")

        const repaid = repayments
          .filter((t) => t.status === "approved")
          .reduce((sum, t) => sum + Number(t.amount), 0)

        const interestType: InterestType = loan.interest_type === "amount" ? "amount" : "rate"
        const totalRepayableVal = totalRepayable(
          Number(loan.principal),
          interestType,
          Number(loan.interest_rate ?? 0),
          Number(loan.interest_amount ?? 0)
        )

        return {
          loan_id: loan.loan_id,
          name: loan.name,
          status: loan.status,
          start_date: loan.start_date,
          principal: Number(loan.principal),
          interest_type: interestType,
          interest_rate: Number(loan.interest_rate ?? 0),
          interest_amount: Number(loan.interest_amount ?? 0),
          term_months: loan.term_months,
          repaid,
          totalRepayable: totalRepayableVal,
          outstanding: loan.status === "closed" ? 0 : Math.max(0, totalRepayableVal - repaid),
          repayments: repayments.map((t) => ({
            transaction_id: t.transaction_id,
            amount: Number(t.amount),
            status: t.status,
            date: t.txn_date ?? t.created_at,
            rejection_reason: t.rejection_reason ?? null,
            receipt_url: t.receipt_url ?? null
          }))
        }
      })

      if (!cancelled) {
        setLoans(withProgress)
        setLoading(false)
      }
    }

    load()
    return () => {
      cancelled = true
    }
  }, [memberId])

  return { loading, loans, loadError }
}
