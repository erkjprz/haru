"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import ReceiptModal from "@/app/components/ReceiptModal"
import { formatInterestLabel } from "@/lib/loanFormat"
import { TRANSACTION_TYPE_LABELS } from "@/lib/transactionLabels"
import type { Loan } from "@/lib/useLoansSummary"

// A closed loan isn't always a full repayment -- an admin can close one
// early via "Close Early (Write Off)" with less than totalRepayable
// actually repaid. Label off the real repaid amount instead of assuming
// every closed loan was paid off in full (same rule as LoanDetailPanel
// and the Breakdown > Loans list).
function loanStatusMeta(loan: Loan): { label: string; dot: string; text: string } {
  if (loan.status === "active") return { label: "Active", dot: "bg-gold", text: "text-gold" }
  if (loan.status === "requested") return { label: "Requested", dot: "bg-ink-soft", text: "text-ink-soft" }
  return loan.repaid >= loan.totalRepayable
    ? { label: "Repaid", dot: "bg-sage", text: "text-sage" }
    : { label: "Closed early", dot: "bg-rust", text: "text-rust" }
}

const fmt = (n: number) =>
  Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })

// `editable` gates the Edit/Fix & resend actions -- off for the admin
// "view as" preview, which is read-only.
export function LoanCards({ loans, editable }: { loans: Loan[]; editable: boolean }) {
  const router = useRouter()
  const [openReceiptUrl, setOpenReceiptUrl] = useState<string | null>(null)

  if (loans.length === 0) {
    return (
      <p className="text-sm text-ink-soft text-center py-12 bg-paper-2 border border-hairline rounded-md">
        No loans on record yet.
      </p>
    )
  }

  return (
    <>
      <div className="flex flex-col gap-3">
        {loans.map((loan) => {
          const meta = loanStatusMeta(loan)
          const fullyRepaid = loan.repaid >= loan.totalRepayable
          const repaidPct = loan.totalRepayable > 0
            ? Math.min(100, (loan.repaid / loan.totalRepayable) * 100)
            : 0
          const paidMonths = loan.transactions.filter(
            (t) => t.classification === "Loan Repayment" && t.status === "approved"
          ).length

          return (
            <div key={loan.loan_id} className="bg-paper-2 border border-hairline rounded-md px-5 py-4">
              <div className="flex items-start justify-between gap-3">
                <p className="font-display text-[17px] font-semibold text-ink truncate">
                  {loan.name || "Loan"}
                </p>
                <div className="flex items-center gap-1.5 shrink-0">
                  <span className={`w-1.5 h-1.5 rounded-full ${meta.dot}`} />
                  <span className={`text-[11px] font-mono uppercase tracking-wide ${meta.text}`}>
                    {meta.label}
                  </span>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-2 items-baseline mt-3.5">
                <div>
                  <p className="text-[10px] uppercase tracking-wide text-ink-soft font-mono">Principal</p>
                  <p className="font-mono [font-variant-numeric:tabular-nums] text-sm font-semibold text-ink">
                    ₱{fmt(loan.principal)}
                  </p>
                </div>
                <div>
                  <p className="text-[10px] uppercase tracking-wide text-gold font-mono font-bold">Interest</p>
                  <p className="font-mono [font-variant-numeric:tabular-nums] text-sm font-semibold text-gold">
                    {formatInterestLabel(loan.interest_type, loan.interest_rate, loan.interest_amount, fmt)}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-[10px] uppercase tracking-wide text-ink-soft font-mono">
                    {loan.status === "closed" ? "Repaid" : "Outstanding"}
                  </p>
                  <p className="font-mono [font-variant-numeric:tabular-nums] text-sm font-semibold text-ink">
                    ₱{fmt(loan.status === "closed" ? loan.repaid : loan.outstanding)}
                  </p>
                </div>
              </div>

              <div className="h-1.5 rounded-full bg-hairline overflow-hidden mt-2.5">
                <div
                  className={`h-full ${
                    loan.status === "closed" ? (fullyRepaid ? "bg-sage" : "bg-rust") : "bg-gold"
                  }`}
                  style={{ width: `${repaidPct}%` }}
                />
              </div>

              {loan.term_months && (
                <p className="text-[11px] text-ink-soft mt-1.5">
                  {paidMonths} / {loan.term_months} mo term
                </p>
              )}

              {loan.transactions.length > 0 && (
                <div className="mt-4 pt-3 border-t border-hairline">
                  <p className="text-[10px] uppercase tracking-wide text-ink-soft font-mono mb-2">
                    Transactions
                  </p>
                  <div className="space-y-2">
                    {(() => {
                      // First entry that isn't a repayment -- i.e. where the
                      // origin (Loan Release) group starts, chronologically
                      // last since the list is newest-first. Gets extra
                      // breathing room below so it reads as a different kind
                      // of entry from the repayment activity above it, not
                      // just another row in the same flow.
                      const firstOriginIndex = loan.transactions.findIndex(
                        (t) => t.classification !== "Loan Repayment"
                      )

                      return loan.transactions.map((t, idx) => {
                        // Loan Release (the disbursement) and any other
                        // loan-linked entry can't be resubmitted by the
                        // borrower the way a repayment can -- rejecting a
                        // Loan Release already deletes the loan record, so
                        // there's nothing left to fix here. Also used to mute
                        // its row below -- it's background context (how the
                        // loan started), not the ongoing repayment activity
                        // this list exists to surface.
                        const isRepayment = t.classification === "Loan Repayment"

                        // A dot only earns its place when there's something to
                        // flag -- an approved row (the common case once a loan
                        // has any history) needs no marker at all.
                        const statusDot =
                          t.status === "pending" ? "bg-gold" : t.status === "rejected" ? "bg-rust" : null

                        const canEdit = editable && isRepayment && (t.status === "pending" || t.status === "rejected")

                        return (
                          <div key={t.transaction_id} className={idx === firstOriginIndex && idx > 0 ? "!mt-4" : ""}>
                            {/* One line per transaction on most phones: label/date on the left,
                                status dot + actions + amount clustered on the right with the
                                amount last, landing in the same column on every row regardless of
                                which accessories that row has. On the narrowest supported widths
                                the label wraps to its own second line rather than truncating --
                                never hiding the date -- while the right-hand cluster stays put. */}
                            <div className="flex items-start justify-between gap-2 min-h-6">
                              <span className="text-[12px] text-ink-soft min-w-0">
                                {TRANSACTION_TYPE_LABELS[t.classification] ?? t.classification} ·{" "}
                                {new Date(t.date).toLocaleDateString(undefined, {
                                  month: "short",
                                  day: "numeric",
                                  year: "numeric"
                                })}
                              </span>
                              <div className="flex items-center gap-2 shrink-0">
                                {statusDot && (
                                  <span
                                    className={`w-1.5 h-1.5 rounded-full ${statusDot}`}
                                    aria-label={t.status}
                                  />
                                )}
                                {t.receipt_url && (
                                  <button
                                    type="button"
                                    onClick={() => setOpenReceiptUrl(t.receipt_url)}
                                    aria-label="View receipt"
                                    className="shrink-0 w-6 h-6 rounded-full border border-gold text-gold text-[11px] flex items-center justify-center"
                                  >
                                    🧾
                                  </button>
                                )}
                                {canEdit && (
                                  <button
                                    type="button"
                                    onClick={() => router.push(`/transactions/${t.transaction_id}/edit`)}
                                    aria-label={t.status === "rejected" ? "Fix and resend" : "Edit"}
                                    className="shrink-0 w-6 h-6 rounded-full border border-gold text-gold text-[11px] flex items-center justify-center"
                                  >
                                    ✎
                                  </button>
                                )}
                                <span
                                  className={`font-mono [font-variant-numeric:tabular-nums] text-[13px] text-right ${
                                    isRepayment ? "font-semibold text-ink" : "text-ink-soft"
                                  }`}
                                >
                                  ₱{fmt(Math.abs(t.amount))}
                                </span>
                              </div>
                            </div>
                            {t.status === "rejected" && t.rejection_reason && (
                              <p className="mt-0.5 text-[11px] text-rust">{t.rejection_reason}</p>
                            )}
                          </div>
                        )
                      })
                    })()}
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>

      {openReceiptUrl && <ReceiptModal path={openReceiptUrl} onClose={() => setOpenReceiptUrl(null)} />}
    </>
  )
}
