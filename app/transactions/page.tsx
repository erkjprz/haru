"use client"

import { useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { supabase } from "@/lib/supabase"
import Navbar from "@/app/components/Navbar"
import ReceiptModal from "@/app/components/ReceiptModal"
import { useAuth } from "@/app/auth-context"

const typeLabels: Record<string, string> = {
  "Member Contribution": "Contribution",
  "Member Withdrawal": "Withdrawal",
  "Expense": "Expense",
  "Loan Release": "Loan Disbursement",
  "Loan Repayment": "Loan Repayment",
  "Gain Allocation": "Investment Allocation",
  "Bank Interest": "Bank Interest",
  "Internal Transfer": "Bank Transfer",
  "Investment": "Investment",
  "Investment Return": "Investment Return",
  "Tax": "Tax",
  "Bank Write-off": "Bank Write-off",
  "Opening Balance": "Opening Balance"
}

const typeColor: Record<string, string> = {
  "Member Contribution": "text-sage border-sage",
  "Member Withdrawal": "text-rust border-rust",
  "Expense": "text-rust border-rust",
  "Loan Release": "text-gold border-gold",
  "Loan Repayment": "text-gold border-gold",
  "Gain Allocation": "text-ink-soft border-ink-soft",
  "Bank Interest": "text-sage border-sage",
  "Investment Return": "text-sage border-sage",
  "Investment": "text-gold border-gold",
  "Tax": "text-rust border-rust",
  "Bank Write-off": "text-rust border-rust"
}

const statusColor: Record<string, string> = {
  pending: "text-gold",
  rejected: "text-rust"
}

// A transaction's real-world date is txn_date. created_at is a row-insert
// audit timestamp and only happens to match txn_date for migrated rows
// because the migration script set it that way -- it's not guaranteed to
// stay in sync (e.g. manual edits, backfills). Always prefer txn_date,
// falling back to created_at only for rows that genuinely have no txn_date.
function effectiveDate(transaction: any): Date {
  return new Date(transaction.txn_date ?? transaction.created_at)
}

function monthLabel(transaction: any): string {
  return effectiveDate(transaction).toLocaleDateString(undefined, {
    month: "long",
    year: "numeric"
  })
}

// Fixed "05 Jan" shape regardless of locale, instead of a raw
// toLocaleDateString() that silently flips between D/M/Y and M/D/Y
// depending on the device's region settings. The month header above each
// group already carries the year, so day + short month is enough here.
function cardDate(transaction: any): string {
  return effectiveDate(transaction).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short"
  })
}

// yyyy-mm-dd (as stored in the date-input state) -> "18 Jul" for the pill
// label. Parsed with an explicit time to avoid the UTC-midnight-rolls-back-
// a-day issue plain `new Date("2026-07-18")` has in some timezones.
function formatShort(isoDate: string): string {
  return new Date(`${isoDate}T00:00:00`).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short"
  })
}

// ~75% of rows have a description that's just the member's name typed back
// (sometimes via an old alias like "Ekai"/"Ketty"/"Bors" -- member_id is
// already resolved correctly for those, so the raw text adds nothing once
// the member's name is the card title). Kept as a fallback safety net even
// though the four classifications below are hidden unconditionally.
function isRedundantDescription(description: string | null, memberName: string | null): boolean {
  if (!description || !memberName) return false
  return description.trim().toLowerCase() === memberName.trim().toLowerCase()
}

// Tax and Bank Interest rows have no member -- their description ("tax",
// "interest", "maya interest") was the only way to tell them apart and see
// which bank they belonged to. Now that the type badge already says
// TAX / BANK INTEREST and the bank pill already shows BDO / Maya, that
// description adds nothing. Member Contribution and Member Withdrawal
// descriptions are, in practice, always just the member's name -- hidden
// unconditionally too. Loan Release/Repayment and Internal Transfer get
// their own richer displays below instead of the raw description.
const CLASSIFICATIONS_WITH_HIDDEN_DESCRIPTION = new Set([
  "Member Contribution",
  "Member Withdrawal",
  "Bank Interest",
  "Tax"
])

// Each legacy (migrated) bank transfer is stored as two rows (a
// negative-amount leg on the source bank, a positive-amount leg on the
// destination bank, same date, same absolute amount, identified via the
// plain `bank` text column) rather than one row with a from/to pair. New
// transfers created through the app are a single row instead, with both
// ends on bank_account_id / to_bank_account_id.
function findTransferPair(transaction: any, allTransactions: any[]): any | null {
  return (
    allTransactions.find(
      (other) =>
        other.transaction_id !== transaction.transaction_id &&
        other.classification === "Internal Transfer" &&
        other.txn_date === transaction.txn_date &&
        Number(other.amount) === -Number(transaction.amount)
    ) ?? null
  )
}

function bankAccountLabel(account: any): string | null {
  if (!account) return null
  return account.account_name || account.bank_name || null
}

function transferDirectionLabel(transaction: any, allTransactions: any[]): string | null {
  const fromAccount = bankAccountLabel(transaction.from_bank_account)
  const toAccount = bankAccountLabel(transaction.to_bank_account)
  if (fromAccount && toAccount) {
    return `${fromAccount} → ${toAccount}`
  }

  const pair = findTransferPair(transaction, allTransactions)
  if (!pair || !transaction.bank || !pair.bank) return null

  const fromLeg = Number(transaction.amount) < 0 ? transaction : pair
  const toLeg = Number(transaction.amount) < 0 ? pair : transaction

  return `${fromLeg.bank} → ${toLeg.bank}`
}

// Legacy transfers are two separate DB rows -- correct as source-of-truth
// data, but showing both as separate cards duplicates the same real-world
// event. Collapse each pair down to one card: keep the negative ("from")
// leg since Math.abs() at render time already turns it into a plain
// magnitude, drop its paired positive ("to") leg. New single-row transfers
// never match this and pass through untouched. Nothing in the database
// changes -- both original rows still exist exactly as migrated.
function dedupeLegacyTransferPairs(rows: any[]): any[] {
  const skipIds = new Set<string>()

  for (const row of rows) {
    if (row.classification !== "Internal Transfer") continue
    if (row.bank_account_id || row.to_bank_account_id) continue
    if (Number(row.amount) <= 0) continue

    const pair = findTransferPair(row, rows)
    if (pair) skipIds.add(row.transaction_id)
  }

  return rows.filter((row) => !skipIds.has(row.transaction_id))
}

// A filter pill with its own separate × alongside it (not layered on top
// of it). An earlier version overlapped the × on the pill's corner, but
// iOS Safari silently enlarges a native <select>'s tap target to meet the
// 44pt accessibility minimum, so the select kept swallowing taps meant for
// the × sitting right above it. Giving the × real physical distance -- its
// own circle, its own gap -- means their tap regions never overlap.
function FilterPill({
  active,
  onClear,
  children
}: {
  active: boolean
  onClear: () => void
  children: React.ReactNode
}) {
  return (
    <div className="flex items-center gap-1.5 shrink-0">
      {children}
      {active && (
        <button
          type="button"
          onClick={onClear}
          aria-label="Clear filter"
          className="shrink-0 w-6 h-6 flex items-center justify-center rounded-full bg-paper-2 border border-hairline text-ink-soft text-sm"
        >
          ×
        </button>
      )}
    </div>
  )
}

export default function TransactionsPage() {
  const router = useRouter()
  const { member } = useAuth()
  const [transactions, setTransactions] = useState<any[]>([])
  const [totalCount, setTotalCount] = useState(0)
  const [members, setMembers] = useState<any[]>([])
  const [selectedMemberId, setSelectedMemberId] = useState("")
  const [selectedType, setSelectedType] = useState("")
  const [dateFrom, setDateFrom] = useState("")
  const [dateTo, setDateTo] = useState("")
  const [dateFilterOpen, setDateFilterOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState("")
  const [loadError, setLoadError] = useState("")
  const [openReceiptUrl, setOpenReceiptUrl] = useState<string | null>(null)

  // Default the member filter to whoever's logged in, once, the first time
  // their member record becomes available. After that we leave the filter
  // alone so switching to "All members" (or anyone else) sticks.
  const defaultMemberAppliedRef = useRef(false)

  async function loadTransactions() {
    // members needs an explicit FK hint: transactions has two FKs into
    // members (member_id, submitted_by), so a bare `members(...)` embed is
    // ambiguous and PostgREST errors on it.
    //
    // bank_accounts is joined twice (aliased from_bank_account /
    // to_bank_account) for the new single-row Internal Transfer shape --
    // legacy migrated transfers instead used two separate rows with the
    // plain `bank` text column and null bank_account_id/to_bank_account_id.
    //
    // .range() is required: without an explicit range, PostgREST applies its
    // own default row cap (1000), which silently truncates the result. 4999
    // comfortably covers current volume; if the table keeps growing, switch
    // this to real server-side pagination instead of raising the number
    // again. totalCount is derived from the deduped row count below rather
    // than a separate exact-count query, since we already fetch every row
    // within that range.
    const { data, error } = await supabase
      .from("transactions")
      .select(
        `
        *,
        members!transactions_member_id_fkey (
          name,
          email
        ),
        submitted_by_member:members!transactions_submitted_by_fkey (
          name
        ),
        loans!transactions_loan_id_fkey (
          name,
          borrowers!loans_borrower_id_fkey (
            name
          )
        ),
        from_bank_account:bank_accounts!transactions_bank_account_id_fkey (
          bank_name,
          account_name
        ),
        to_bank_account:bank_accounts!transactions_to_bank_account_id_fkey (
          bank_name,
          account_name
        )
      `
      )
      .order("txn_date", { ascending: false, nullsFirst: false })
      .order("created_at", { ascending: false })
      .range(0, 4999)

    if (error) {
      setLoadError(error.message)
      setTransactions([])
      setTotalCount(0)
      return
    }

    setLoadError("")

    const rawRows = data ?? []

    // Compute each transfer's from->to label while both legacy legs are
    // still present (dedupeLegacyTransferPairs below removes one of them,
    // and findTransferPair can't locate a partner that's already gone).
    const withTransferLabels = rawRows.map((row) =>
      row.classification === "Internal Transfer"
        ? { ...row, _transferLabel: transferDirectionLabel(row, rawRows) }
        : row
    )

    const deduped = dedupeLegacyTransferPairs(withTransferLabels)

    setTransactions(deduped)
    setTotalCount(deduped.length)
  }

  async function loadMembers() {
    const { data } = await supabase
      .from("members")
      .select("member_id, name")
      .order("name")

    setMembers(data ?? [])
  }

  useEffect(() => {
    loadTransactions()
    loadMembers()
  }, [])

  useEffect(() => {
    if (member && !defaultMemberAppliedRef.current) {
      setSelectedMemberId(member.member_id)
      defaultMemberAppliedRef.current = true
    }
  }, [member])

  function clearFilters() {
    setSelectedMemberId("")
    setSelectedType("")
    setDateFrom("")
    setDateTo("")
  }

  // Built from what's actually in the loaded data rather than the full
  // static typeLabels list -- classifications with zero current rows (e.g.
  // Expense, Gain Allocation before any distribution has run) simply don't
  // appear as filter options until a real row exists.
  const typeOptions = Array.from(new Set(transactions.map((t) => t.classification))).sort(
    (a, b) => (typeLabels[a] || a).localeCompare(typeLabels[b] || b)
  )

  const filteredTransactions = transactions.filter((t) => {
    const memberMatch = selectedMemberId ? t.member_id === selectedMemberId : true
    const typeMatch = selectedType ? t.classification === selectedType : true

    const ts = effectiveDate(t).getTime()
    const fromMatch = dateFrom ? ts >= new Date(`${dateFrom}T00:00:00`).getTime() : true
    const toMatch = dateTo ? ts <= new Date(`${dateTo}T23:59:59`).getTime() : true

    const searchMatch =
      searchQuery.trim() === "" ||
      [
        t.members?.name,
        t.description,
        t.bank,
        t.classification,
        typeLabels[t.classification],
        t.loans?.name,
        t.loans?.borrowers?.name,
        t._transferLabel,
        t.txn_date,
        effectiveDate(t).toLocaleDateString()
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(searchQuery.toLowerCase())

    return memberMatch && typeMatch && fromMatch && toMatch && searchMatch
  })

  const fmt = (n: number) =>
    Number(n).toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    })

  const hasDateFilter = Boolean(dateFrom || dateTo)
  const hasActiveFilters = Boolean(selectedMemberId || selectedType || hasDateFilter)
  const pillBase = "shrink-0 border text-sm rounded-full px-4 py-2 focus:outline-none"
  const pillTone = (active: boolean) =>
    active ? "border-gold bg-gold/10 text-ink" : "border-hairline bg-paper-2 text-ink-soft"

  const dateRangeLabel = !hasDateFilter
    ? "Date range"
    : dateFrom && dateTo
    ? `${formatShort(dateFrom)} – ${formatShort(dateTo)}`
    : dateFrom
    ? `From ${formatShort(dateFrom)}`
    : `Until ${formatShort(dateTo)}`

  return (
    <>
      <Navbar />

      {/* Option C: top-right icon button, opposite the hamburger.
          NOTE: positioned with a fixed guess (env(safe-area-inset-top) +
          20px) since Navbar's own height/padding isn't in this file -- if
          it doesn't line up exactly with the hamburger row once you drop
          this in, nudge that offset (or better, move this button inside
          Navbar itself so it shares the exact same row by construction). */}
      <button
        onClick={() => router.push("/transactions/new")}
        aria-label="New Transaction"
        className="fixed top-[calc(env(safe-area-inset-top)+20px)] right-5 z-40 w-9 h-9 rounded-full bg-gold text-ink flex items-center justify-center text-lg font-semibold shadow-sm hover:opacity-90 transition-opacity"
      >
        +
      </button>

      <main className="min-h-screen bg-paper text-ink font-sans overflow-x-hidden">
        <div className="max-w-3xl mx-auto px-4 sm:px-5 pt-8 pb-10">
          <div className="text-[11px] tracking-[0.18em] uppercase text-gold font-mono mb-2">
            Full History
          </div>
          <h1 className="font-display text-3xl sm:text-4xl font-semibold text-ink">
            Transactions
          </h1>

          {loadError && (
            <p className="mt-4 text-sm text-rust">
              Couldn't load transactions: {loadError}
            </p>
          )}

          <div className="mt-6">
            <input
              type="text"
              placeholder="Search transactions..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full border border-hairline bg-paper-2 text-ink rounded-md px-4 py-3 text-sm placeholder:text-ink-soft focus:outline-none"
            />
          </div>

          {/* Each pill turns gold once it holds a real value, with its own
              separate × alongside (never on top of) it -- see FilterPill. */}
          <div className="mt-4 flex items-center gap-3 overflow-x-auto pb-1 pr-4 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            <FilterPill active={Boolean(selectedMemberId)} onClear={() => setSelectedMemberId("")}>
              <select
                className={`${pillBase} max-w-[10rem] ${pillTone(Boolean(selectedMemberId))}`}
                value={selectedMemberId}
                onChange={(e) => setSelectedMemberId(e.target.value)}
              >
                <option value="">All members</option>
                {members.map((m) => (
                  <option key={m.member_id} value={m.member_id}>
                    {m.member_id === member?.member_id ? "You" : m.name}
                  </option>
                ))}
              </select>
            </FilterPill>

            <FilterPill active={Boolean(selectedType)} onClear={() => setSelectedType("")}>
              <select
                className={`${pillBase} ${pillTone(Boolean(selectedType))}`}
                value={selectedType}
                onChange={(e) => setSelectedType(e.target.value)}
              >
                <option value="">All types</option>
                {typeOptions.map((type) => (
                  <option key={type} value={type}>
                    {typeLabels[type] || type}
                  </option>
                ))}
              </select>
            </FilterPill>

            <FilterPill active={hasDateFilter} onClear={() => { setDateFrom(""); setDateTo("") }}>
              <button
                type="button"
                onClick={() => setDateFilterOpen(true)}
                className={`${pillBase} ${pillTone(hasDateFilter)}`}
              >
                {dateRangeLabel}
              </button>
            </FilterPill>

            {hasActiveFilters && (
              <button
                className="shrink-0 border border-hairline rounded-full px-4 py-2 text-sm text-ink-soft"
                onClick={clearFilters}
              >
                Clear all
              </button>
            )}
          </div>

          <div className="mt-4 text-xs text-ink-soft font-mono [font-variant-numeric:tabular-nums]">
            Showing {filteredTransactions.length} of {totalCount}
            {searchQuery && ` matching "${searchQuery}"`}
          </div>

          <div className="mt-4">
            {filteredTransactions.map((transaction, idx) => {
              const memberName = transaction.members?.name || null
              const isLoanTxn =
                transaction.classification === "Loan Release" ||
                transaction.classification === "Loan Repayment"
              const isTransferTxn = transaction.classification === "Internal Transfer"

              const loanName = transaction.loans?.name || null
              const borrowerName = transaction.loans?.borrowers?.name || null
              const transferLabel = isTransferTxn ? transaction._transferLabel ?? null : null

              // Borrower-only loans (e.g. Joy, who isn't a fund member) have
              // no member_id, so fall back to the borrower's name as the
              // card title instead of leaving it as generic "Fund".
              const displayName = memberName || (isLoanTxn ? borrowerName : null) || "Fund"

              const showDescription =
                transaction.description &&
                !isRedundantDescription(transaction.description, memberName) &&
                !CLASSIFICATIONS_WITH_HIDDEN_DESCRIPTION.has(transaction.classification) &&
                !isLoanTxn &&
                !isTransferTxn

              const showStatus = transaction.status !== "approved"

              const label = monthLabel(transaction)
              const showMonthHeader = idx === 0 || label !== monthLabel(filteredTransactions[idx - 1])

              return (
                <div key={transaction.transaction_id}>
                  {showMonthHeader && (
                    <p
                      className={`text-[11px] uppercase tracking-wide text-ink-soft font-mono mb-2 ${
                        idx === 0 ? "mt-0" : "mt-6"
                      }`}
                    >
                      {label}
                    </p>
                  )}

                  {/* Two-column grid: left column is "what it is" (type +
                      bank badges together, name, loan/description detail),
                      right column is "the facts" (date, amount, receipt).
                      Bank sits next to the type tag on the same line, not
                      demoted to its own row -- they're both short labels
                      describing the transaction and read naturally as a
                      pair. */}
                  <div
                    className={`grid grid-cols-[1fr_auto] gap-x-3 gap-y-1.5 items-center bg-paper-2 border border-hairline rounded-md px-4 py-3.5 ${
                      showMonthHeader ? "" : "mt-3"
                    }`}
                  >
                    <div className="flex items-center gap-1.5 flex-wrap min-w-0">
                      <span
                        className={`text-[9px] uppercase tracking-widest font-mono border rounded-full px-2 py-0.5 ${
                          typeColor[transaction.classification] ?? "text-ink-soft border-hairline"
                        }`}
                      >
                        {typeLabels[transaction.classification] || transaction.classification}
                      </span>
                      {transaction.bank && !isTransferTxn && (
                        <span className="text-[9px] uppercase tracking-widest font-mono border border-hairline text-ink-soft rounded-full px-2 py-0.5">
                          {transaction.bank}
                        </span>
                      )}
                      {isTransferTxn && transferLabel && (
                        <span className="text-[9px] uppercase tracking-widest font-mono border border-hairline text-ink-soft rounded-full px-2 py-0.5">
                          {transferLabel}
                        </span>
                      )}
                    </div>
                    <div className="justify-self-end text-xs text-ink-soft font-mono whitespace-nowrap">
                      {cardDate(transaction)}
                    </div>

                    <div className="font-display text-lg font-medium truncate">{displayName}</div>
                    <div className="justify-self-end flex items-center gap-2">
                      <span className="font-mono [font-variant-numeric:tabular-nums] text-lg font-semibold whitespace-nowrap">
                        ₱{fmt(Math.abs(transaction.amount))}
                      </span>
                      {transaction.receipt_url && (
                        <button
                          type="button"
                          onClick={() => setOpenReceiptUrl(transaction.receipt_url)}
                          aria-label="View receipt"
                          className="shrink-0 w-7 h-7 rounded-full border border-gold text-gold text-xs flex items-center justify-center"
                        >
                          🧾
                        </button>
                      )}
                    </div>

                    {transaction.submitted_by_member && (
                      <p className="col-span-2 text-[11px] text-gold font-mono">
                        Recorded by {transaction.submitted_by_member.name}
                      </p>
                    )}
                    {isLoanTxn && loanName && (
                      <p className="col-span-2 text-xs text-ink-soft font-mono">{loanName}</p>
                    )}
                    {showDescription && (
                      <p className="col-span-2 text-xs text-ink-soft break-words">
                        {transaction.description}
                      </p>
                    )}
                    {showStatus && (
                      <div
                        className={`col-span-2 justify-self-end text-[10px] uppercase font-mono ${
                          statusColor[transaction.status] ?? "text-ink-soft"
                        }`}
                      >
                        {transaction.status}
                      </div>
                    )}
                  </div>
                </div>
              )
            })}

            {filteredTransactions.length === 0 && !loadError && (
              <p className="py-8 text-sm text-ink-soft text-center">No transactions found.</p>
            )}
          </div>
        </div>

        {/* Fixed viewport modal, capped at 85% of the viewport height and
            scrollable internally. iOS's native date-wheel picker expands
            inline underneath whichever input is focused, which can make
            this sheet's natural content height taller than the screen --
            without a cap the Clear/Done row could get pushed out of reach
            entirely instead of just requiring a scroll to see it. */}
        {dateFilterOpen && (
          <div
            className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50"
            onClick={() => setDateFilterOpen(false)}
          >
            <div
              className="w-full sm:w-80 max-h-[85vh] overflow-y-auto bg-paper-2 border border-hairline rounded-t-xl sm:rounded-xl p-5 pb-[calc(env(safe-area-inset-bottom)+1.5rem)] sm:pb-5"
              onClick={(e) => e.stopPropagation()}
            >
              <p className="text-sm font-semibold text-ink mb-4">Date range</p>

              <label className="block text-[11px] uppercase tracking-wide text-ink-soft mb-1">
                From
              </label>
              <input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                className="w-full h-11 appearance-none bg-paper border border-hairline rounded-md px-3 text-sm text-ink focus:outline-none focus:border-gold [color-scheme:dark]"
              />

              <label className="block text-[11px] uppercase tracking-wide text-ink-soft mb-1 mt-4">
                To
              </label>
              <input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                className="w-full h-11 appearance-none bg-paper border border-hairline rounded-md px-3 text-sm text-ink focus:outline-none focus:border-gold [color-scheme:dark]"
              />

              <div className="flex justify-between items-center pt-5">
                <button
                  type="button"
                  onClick={() => { setDateFrom(""); setDateTo("") }}
                  className="text-sm text-ink-soft"
                >
                  Clear
                </button>
                <button
                  type="button"
                  onClick={() => setDateFilterOpen(false)}
                  className="bg-gold text-ink px-5 py-2 rounded-md text-sm font-semibold"
                >
                  Done
                </button>
              </div>
            </div>
          </div>
        )}
      </main>

      {openReceiptUrl && <ReceiptModal url={openReceiptUrl} onClose={() => setOpenReceiptUrl(null)} />}
    </>
  )
}
