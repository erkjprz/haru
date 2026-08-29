import { supabase } from "@/lib/supabase"
import { writeCache } from "@/lib/cache"

export type TrendPoint = { value: number; date: string }

export type MemberRow = {
  member_id: string
  name: string
  total_contribution: number
  total_withdrawal: number
  net_contribution: number
  bank_interest: number
  investment_gain_loss: number
  loan_gain: number
  bank_writeoff: number
  total_value: number
  money_on_hold: number
  withdrawable_now: number
  totalGainLoss: number
  roi: number | null
  shareOfFund: number
}

export type FundTotals = {
  total_cash: number
  total_contribution: number
  total_withdrawal: number
  net_contribution: number
  total_bank_interest: number
  net_investment_gain_loss: number
  total_loan_gain_distributed: number
  total_bank_writeoff: number
  open_loans_count: number
  open_loans_outstanding: number
}

export type GroupSnapshot = {
  members: MemberRow[]
  fund: FundTotals | null
  fundTrend: TrendPoint[]
}

// Fund-wide data shared by every viewer, not scoped to a member -- a single
// fixed key rather than one keyed by member id.
export const GROUP_CACHE_KEY = "fund-breakdown:group"

export type GroupFields = {
  // Present only when the three core queries (members, performance, fund)
  // all succeeded -- GroupPanel treats those as all-or-nothing, same as the
  // fetch below: a failure in any one of them means the whole update is
  // skipped and the caller keeps whatever it already had, rather than
  // painting a fund total next to a stale member list or vice versa.
  // fundTrend degrades independently -- undefined here means "keep
  // whatever fundTrend the caller already has", not "there is none".
  data?: { members: MemberRow[]; fund: FundTotals; fundTrend?: TrendPoint[] }
  error: string | null
}

// The seven queries GroupPanel needs, factored out so the splash at / can
// run the exact same fetch to warm GROUP_CACHE_KEY before ever navigating
// to /fund-breakdown.
export async function fetchGroupBreakdownFields(): Promise<GroupFields> {
  const memberPromise = supabase.from("members").select("member_id, name").eq("status", "approved").neq("role", "borrower")

  const performancePromise = supabase
    .from("v_member_performance")
    .select(
      "member_id, total_contribution, total_withdrawal, net_contribution, bank_interest, investment_gain_loss, loan_gain, bank_writeoff, total_value, money_on_hold, withdrawable_now"
    )

  const fundPromise = supabase
    .from("v_fund_summary")
    .select(
      "total_cash, total_contribution, total_withdrawal, net_contribution, total_bank_interest, net_investment_gain_loss, total_loan_gain_distributed, open_loans_count, open_loans_outstanding"
    )
    .single()

  const fundTrendPromise = supabase.from("v_fund_cash_timeline").select("month, running_balance").order("month", { ascending: true })

  // v_fund_summary's total_bank_interest is gross, before withholding tax --
  // netted here against Tax so this matches the Banks tab's Interest Earned
  // (same fix, same reasoning: tax is stored as a negative amount).
  const taxPromise = supabase.from("transactions").select("amount").eq("classification", "Tax").eq("status", "approved")

  // v_fund_summary's open_loans_outstanding is total_repayable minus
  // repaid, i.e. principal plus interest still owed -- fetched separately
  // here to show just the principal still out instead.
  const activeLoansPromise = supabase.from("loans").select("loan_id, principal").eq("status", "active")

  const loanRepaymentsPromise = supabase
    .from("transactions")
    .select("loan_id, amount")
    .eq("classification", "Loan Repayment")
    .eq("status", "approved")

  const [memberResult, performanceResult, fundResult, fundTrendResult, taxResult, activeLoansResult, loanRepaymentsResult] =
    await Promise.all([
      memberPromise,
      performancePromise,
      fundPromise,
      fundTrendPromise,
      taxPromise,
      activeLoansPromise,
      loanRepaymentsPromise
    ])

  if (memberResult.error || performanceResult.error || fundResult.error) {
    return { error: (memberResult.error || performanceResult.error || fundResult.error)?.message ?? "Failed to load" }
  }

  const totalTax = (taxResult.data ?? []).reduce((sum: number, row: any) => sum + Number(row.amount), 0)

  const repaidByLoan: Record<string, number> = {}
  for (const row of loanRepaymentsResult.data ?? []) {
    repaidByLoan[row.loan_id] = (repaidByLoan[row.loan_id] ?? 0) + Number(row.amount)
  }
  const open_loans_principal_outstanding = (activeLoansResult.data ?? []).reduce(
    (sum: number, loan: any) => sum + Math.max(0, Number(loan.principal) - (repaidByLoan[loan.loan_id] ?? 0)),
    0
  )

  // v_fund_summary has no write-off total of its own -- sum each approved
  // member's Bank Write-off Share instead, same population the member
  // breakdown below is built from.
  const approvedMemberIds = new Set((memberResult.data ?? []).map((m: any) => m.member_id))
  const total_bank_writeoff = (performanceResult.data ?? []).reduce(
    (sum: number, row: any) => (approvedMemberIds.has(row.member_id) ? sum + Number(row.bank_writeoff ?? 0) : sum),
    0
  )

  const fund: FundTotals = {
    total_cash: Number(fundResult.data.total_cash),
    total_contribution: Number(fundResult.data.total_contribution),
    total_withdrawal: Number(fundResult.data.total_withdrawal),
    net_contribution: Number(fundResult.data.net_contribution),
    total_bank_interest: Number(fundResult.data.total_bank_interest) + totalTax,
    net_investment_gain_loss: Number(fundResult.data.net_investment_gain_loss),
    total_loan_gain_distributed: Number(fundResult.data.total_loan_gain_distributed),
    total_bank_writeoff,
    open_loans_count: Number(fundResult.data.open_loans_count),
    open_loans_outstanding: open_loans_principal_outstanding
  }

  const fundTrend: TrendPoint[] | undefined =
    !fundTrendResult.error && fundTrendResult.data
      ? fundTrendResult.data.map((r: any) => ({ value: Number(r.running_balance), date: r.month }))
      : undefined

  const performanceByMember: Record<string, any> = {}
  performanceResult.data?.forEach((row: any) => {
    performanceByMember[row.member_id] = row
  })

  const breakdown: MemberRow[] = (memberResult.data ?? []).map((member: any) => {
    const p = performanceByMember[member.member_id]
    const total_contribution = Number(p?.total_contribution ?? 0)
    const total_withdrawal = Number(p?.total_withdrawal ?? 0)
    const net_contribution = Number(p?.net_contribution ?? 0)
    const bank_interest = Number(p?.bank_interest ?? 0)
    const investment_gain_loss = Number(p?.investment_gain_loss ?? 0)
    const loan_gain = Number(p?.loan_gain ?? 0)
    const bank_writeoff = Number(p?.bank_writeoff ?? 0)
    const total_value = Number(p?.total_value ?? 0)
    const money_on_hold = Number(p?.money_on_hold ?? 0)
    const withdrawable_now = Number(p?.withdrawable_now ?? 0)
    const totalGainLoss = bank_interest + investment_gain_loss + loan_gain + bank_writeoff
    const roi = net_contribution > 0 ? (totalGainLoss / net_contribution) * 100 : null

    return {
      member_id: member.member_id,
      name: member.name,
      total_contribution,
      total_withdrawal,
      net_contribution,
      bank_interest,
      investment_gain_loss,
      loan_gain,
      bank_writeoff,
      total_value,
      money_on_hold,
      withdrawable_now,
      totalGainLoss,
      roi,
      shareOfFund: 0
    }
  })

  const totalEquity = breakdown.reduce((sum, m) => sum + m.total_value, 0)

  const members = breakdown
    .map((m) => ({
      ...m,
      shareOfFund: totalEquity > 0 ? (m.total_value / totalEquity) * 100 : 0
    }))
    .sort((a, b) => b.total_value - a.total_value)

  return { data: { members, fund, fundTrend }, error: null }
}

// Called from the splash at / -- best-effort, same as warmDashboardCache:
// on a core-query error, just don't warm the cache and let /fund-breakdown's
// own fetch on mount cover it.
export async function warmGroupBreakdownCache(): Promise<void> {
  const fields = await fetchGroupBreakdownFields()
  if (!fields.data) return
  writeCache<GroupSnapshot>(GROUP_CACHE_KEY, {
    members: fields.data.members,
    fund: fields.data.fund,
    fundTrend: fields.data.fundTrend ?? []
  })
}
