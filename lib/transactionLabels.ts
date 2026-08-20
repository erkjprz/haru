// Every classification ever seen in the transactions table gets the same
// display label everywhere it's shown -- previously four separate copies
// of this dictionary (admin/page.tsx, dashboard/page.tsx,
// transactions/page.tsx, SupportPanel.tsx) had already drifted: admin's
// CSV export was missing five real classifications (falling back to the
// raw, un-relabeled string), and SupportPanel carried a phantom "Loan
// Request" entry that's never an actual classification (loan requests are
// stored as "Loan Release" transactions).
export const TRANSACTION_TYPE_LABELS: Record<string, string> = {
  "Member Contribution": "Contribution",
  "Member Withdrawal": "Withdrawal",
  "Expense": "Expense",
  "Loan Release": "Loan Release",
  "Loan Repayment": "Loan Repayment",
  "Gain Allocation": "Distributed Share",
  "Bank Interest": "Bank Interest",
  "Internal Transfer": "Bank Transfer",
  "Investment": "Investment",
  "Investment Return": "Investment Return",
  "Tax": "Tax",
  "Bank Write-off": "Bank Write-off",
  "Opening Balance": "Opening Balance"
}
