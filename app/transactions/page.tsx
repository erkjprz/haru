"use client"

import { Suspense, useEffect, useMemo, useRef, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { supabase } from "@/lib/supabase"
import Navbar from "@/app/components/Navbar"
import ReceiptModal from "@/app/components/ReceiptModal"
import { useAuth } from "@/app/auth-context"
import { dateOnly } from "@/lib/currentValue"

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

// Same as formatShort but with the year -- used in the filter sheet's date
// fields themselves, where there's room and the year matters (unlike the
// compact chip label above the list, which already has less space).
function formatFull(isoDate: string): string {
  return new Date(`${isoDate}T00:00:00`).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric"
  })
}

type DatePreset = { key: string; label: string; from: string; to: string }

// Computed fresh each render off the current date rather than memoized --
// cheap enough (a handful of Date() constructions) that it's not worth
// tracking "today" as its own piece of state just to memoize this.
function buildDatePresets(): DatePreset[] {
  const now = new Date()
  const year = now.getFullYear()
  const month = now.getMonth()

  return [
    {
      key: "this_month",
      label: "This Month",
      from: dateOnly(new Date(year, month, 1)),
      to: dateOnly(new Date(year, month + 1, 0))
    },
    {
      key: "last_month",
      label: "Last Month",
      from: dateOnly(new Date(year, month - 1, 1)),
      to: dateOnly(new Date(year, month, 0))
    },
    {
      key: "this_year",
      label: "This Year",
      from: dateOnly(new Date(year, 0, 1)),
      to: dateOnly(new Date(year, 11, 31))
    },
    { key: "all_time", label: "All Time", from: "", to: "" }
  ]
}

// Transparent native date input layered over a styled div -- the native
// input still handles the actual tap-to-open-picker interaction (including
// iOS's wheel picker) and stays reachable everywhere in the box, but the
// visible text is entirely ours: a real calendar icon, a formatted date
// once one's picked, and an actual visible placeholder when empty (an
// empty native date input's own placeholder rendered invisible against
// this dark theme).
function DateField({
  value,
  onChange,
  placeholder
}: {
  value: string
  onChange: (v: string) => void
  placeholder: string
}) {
  return (
    <div className="relative h-11">
      <input
        type="date"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label={placeholder}
        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer [color-scheme:dark]"
      />
      <div
        className={`pointer-events-none h-full flex items-center gap-2 border rounded-md px-3 text-sm font-mono ${
          value ? "border-gold text-ink" : "border-hairline text-ink-soft"
        }`}
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.8}
          className="w-[15px] h-[15px] shrink-0 text-ink-soft"
        >
          <rect x="3.5" y="5" width="17" height="16" rx="2" />
          <path d="M8 3v4M16 3v4M3.5 10h17" strokeLinecap="round" />
        </svg>
        <span className="truncate">{value ? formatFull(value) : placeholder}</span>
      </div>
    </div>
  )
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

// Owns the raw keystroke-by-keystroke input state itself and only reports
// upward once typing pauses -- debouncing the *value* passed up wasn't
// enough on its own, since the parent still re-rendered (and re-diffed its
// full, possibly ~1000-row, transaction list) on every keystroke just to
// reflect the input's own updated text. Isolating that state here means a
// keystroke only re-renders this small subtree; the parent, and the list,
// re-render solely when onDebouncedChange actually fires.
function SearchBox({ onDebouncedChange }: { onDebouncedChange: (value: string) => void }) {
  const [value, setValue] = useState("")
  const [showHint, setShowHint] = useState(false)

  useEffect(() => {
    const timeout = setTimeout(() => onDebouncedChange(value), 300)
    return () => clearTimeout(timeout)
  }, [value, onDebouncedChange])

  return (
    <div className="flex-1 min-w-0">
      <div className="relative">
        <input
          type="text"
          placeholder="Search transactions..."
          value={value}
          onChange={(e) => setValue(e.target.value)}
          className={`w-full border border-hairline bg-paper-2 text-ink rounded-md pl-4 py-3 text-sm placeholder:text-ink-soft focus:outline-none ${
            value ? "pr-16" : "pr-10"
          }`}
        />
        {value && (
          <button
            type="button"
            onClick={() => {
              setValue("")
              onDebouncedChange("")
            }}
            aria-label="Clear search"
            className="absolute right-9 top-1/2 -translate-y-1/2 w-5 h-5 rounded-full border border-hairline text-ink-soft text-[11px] font-semibold flex items-center justify-center shrink-0"
          >
            ×
          </button>
        )}
        <button
          type="button"
          onClick={() => setShowHint((v) => !v)}
          aria-label="What does search look at?"
          aria-expanded={showHint}
          className="absolute right-3 top-1/2 -translate-y-1/2 w-5 h-5 rounded-full border border-hairline text-ink-soft text-[11px] font-semibold flex items-center justify-center shrink-0"
        >
          ?
        </button>
      </div>
      {showHint && (
        <p className="mt-2 text-xs text-ink-soft">
          Matches member names, banks, descriptions, loan/investment names, transaction types, and dates.
          Multiple words narrow the results -- e.g. "Vhan BDO" finds Vhan's transactions on BDO, even
          though the two words aren't next to each other on the card.
        </p>
      )}
    </div>
  )
}

export default function TransactionsPage() {
  return (
    <Suspense fallback={null}>
      <TransactionsPageInner />
    </Suspense>
  )
}

function TransactionsPageInner() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { member } = useAuth()
  const isAdmin = member?.role === "admin"
  const [transactions, setTransactions] = useState<any[]>([])
  const [totalCount, setTotalCount] = useState(0)
  const [members, setMembers] = useState<any[]>([])
  const [selectedMemberId, setSelectedMemberId] = useState("")
  const [selectedType, setSelectedType] = useState("")
  const [dateFrom, setDateFrom] = useState("")
  const [dateTo, setDateTo] = useState("")
  const [filterSheetOpen, setFilterSheetOpen] = useState(false)
  // The raw, keystroke-by-keystroke value lives in SearchBox itself (see
  // above) -- this only ever updates once typing pauses, which keeps this
  // component (and the potentially long list it renders) from re-rendering
  // on every keystroke.
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState("")
  const [loadError, setLoadError] = useState("")
  const [openReceiptUrl, setOpenReceiptUrl] = useState<string | null>(null)

  // Set once from the ?loan= / ?investment= query param (e.g. "View all"
  // from a loan's or investment's detail page) -- cleared locally like any
  // other filter, doesn't try to keep syncing back to the URL after that.
  const [loanFilter, setLoanFilter] = useState(() => searchParams.get("loan") || "")
  const [investmentFilter, setInvestmentFilter] = useState(() => searchParams.get("investment") || "")

  // Default the member filter to whoever's logged in, once, the first time
  // their member record becomes available. After that we leave the filter
  // alone so switching to "All members" (or anyone else) sticks. Skipped
  // when arriving pre-filtered to a specific loan/investment -- that view
  // should show every member's activity on it, not just the viewer's own.
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
        investments!transactions_investment_id_fkey (
          name
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
      .neq("status", "cancelled")
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

  // Ref-guarded run-once-on-load initializer, same as the effect above it --
  // loanFilter/investmentFilter are read once here, only at the moment
  // `member` first becomes available, so they're deliberately left out of
  // the dependency array.
  useEffect(() => {
    if (member && !defaultMemberAppliedRef.current) {
      if (!loanFilter && !investmentFilter) {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setSelectedMemberId(member.member_id)
      }
      defaultMemberAppliedRef.current = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [member])

  function clearFilters() {
    setSelectedMemberId("")
    setSelectedType("")
    setDateFrom("")
    setDateTo("")
    setLoanFilter("")
    setInvestmentFilter("")
  }

  // Built from what's actually in the loaded data rather than the full
  // static typeLabels list -- classifications with zero current rows (e.g.
  // Expense, Gain Allocation before any distribution has run) simply don't
  // appear as filter options until a real row exists.
  const typeOptions = Array.from(new Set(transactions.map((t) => t.classification))).sort(
    (a, b) => (typeLabels[a] || a).localeCompare(typeLabels[b] || b)
  )

  // Building each row's searchable text means several toLocaleDateString
  // calls per row -- cheap in bulk, but the *first* time this ever runs
  // (cold Intl formatters, unwarmed JIT) is noticeably slower than every
  // run after it. Precomputed once here, keyed only on `transactions`, so
  // that one-time cost lands when the data loads rather than when the user
  // types their first search word -- every search after that, first word or
  // not, is then just a cheap .includes() over an already-built string.
  const searchableTransactions = useMemo(
    () =>
      transactions.map((t) => ({
        ...t,
        _searchHaystack: [
          t.members?.name,
          t.description,
          t.bank,
          bankAccountLabel(t.from_bank_account),
          bankAccountLabel(t.to_bank_account),
          t.classification,
          typeLabels[t.classification],
          t.loans?.name,
          t.loans?.borrowers?.name,
          t.investments?.name,
          t._transferLabel,
          t.txn_date,
          effectiveDate(t).toLocaleDateString(),
          cardDate(t),
          monthLabel(t)
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase()
      })),
    [transactions]
  )

  // Recomputing this list still means re-scanning every transaction, but
  // now it's just cheap field comparisons plus a .includes() against the
  // already-built haystack above -- fast enough that gating it on the
  // debounced query (rather than the raw one) is enough to keep typing
  // smooth.
  const filteredTransactions = useMemo(() => {
    const searchWords = debouncedSearchQuery.trim().toLowerCase().split(/\s+/).filter(Boolean)

    return searchableTransactions.filter((t) => {
      const memberMatch = selectedMemberId ? t.member_id === selectedMemberId : true
      const typeMatch = selectedType ? t.classification === selectedType : true
      const loanMatch = loanFilter ? t.loan_id === loanFilter : true
      const investmentMatch = investmentFilter ? t.investment_id === investmentFilter : true

      const ts = effectiveDate(t).getTime()
      const fromMatch = dateFrom ? ts >= new Date(`${dateFrom}T00:00:00`).getTime() : true
      const toMatch = dateTo ? ts <= new Date(`${dateTo}T23:59:59`).getTime() : true

      // Every word in the query has to appear somewhere in the haystack,
      // but not necessarily adjacent to (or in the same field as) each
      // other -- e.g. "Vhan BDO" should match a row where the member name
      // and bank badge are two separate fields, not a literal "vhan bdo"
      // substring.
      const searchMatch = searchWords.length === 0 || searchWords.every((word) => t._searchHaystack.includes(word))

      return memberMatch && typeMatch && loanMatch && investmentMatch && fromMatch && toMatch && searchMatch
    })
  }, [
    searchableTransactions,
    selectedMemberId,
    selectedType,
    loanFilter,
    investmentFilter,
    dateFrom,
    dateTo,
    debouncedSearchQuery
  ])

  // For the loan/investment filter pills' labels -- neither name is known
  // until at least one matching transaction has loaded.
  const loanFilterLabel = loanFilter
    ? transactions.find((t) => t.loan_id === loanFilter)?.loans?.borrowers?.name ||
      transactions.find((t) => t.loan_id === loanFilter)?.loans?.name ||
      "Loan"
    : ""
  const investmentFilterLabel = investmentFilter
    ? transactions.find((t) => t.investment_id === investmentFilter)?.investments?.name || "Investment"
    : ""

  const fmt = (n: number) =>
    Number(n).toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    })

  const hasDateFilter = Boolean(dateFrom || dateTo)

  const dateRangeLabel = !hasDateFilter
    ? "Dates"
    : dateFrom && dateTo
    ? `${formatShort(dateFrom)} – ${formatShort(dateTo)}`
    : dateFrom
    ? `From ${formatShort(dateFrom)}`
    : `Until ${formatShort(dateTo)}`

  const selectedMemberLabel = selectedMemberId
    ? selectedMemberId === member?.member_id
      ? "You"
      : members.find((m) => m.member_id === selectedMemberId)?.name ?? "Member"
    : ""

  // Drives both the filter icon's badge count and the removable chip row --
  // one list of "what's currently filtered," each with its own clear
  // action, instead of maintaining the count and the chips separately.
  const activeChips = [
    loanFilter && { key: "loan", label: `Loan: ${loanFilterLabel}`, onClear: () => setLoanFilter("") },
    investmentFilter && {
      key: "investment",
      label: `Investment: ${investmentFilterLabel}`,
      onClear: () => setInvestmentFilter("")
    },
    selectedMemberId && { key: "member", label: selectedMemberLabel, onClear: () => setSelectedMemberId("") },
    selectedType && {
      key: "type",
      label: typeLabels[selectedType] || selectedType,
      onClear: () => setSelectedType("")
    },
    hasDateFilter && {
      key: "dates",
      label: dateRangeLabel,
      onClear: () => {
        setDateFrom("")
        setDateTo("")
      }
    }
  ].filter(Boolean) as { key: string; label: string; onClear: () => void }[]

  return (
    <>
      <Navbar />

      <main className="min-h-screen bg-paper text-ink font-sans overflow-x-hidden">
        <div className="max-w-3xl mx-auto px-4 sm:px-5 pt-8 pb-[calc(2.5rem+var(--dock-h)+env(safe-area-inset-bottom))]">
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

          {/* Search stays a plain text input with its own "?" hint (see
              SearchBox) -- the filter icon next to it is a separate
              affordance for the structured filters (who/type/dates), opened
              in the sheet below rather than as a row of always-visible
              dropdowns. */}
          <div className="mt-6 flex items-start gap-2">
            <SearchBox onDebouncedChange={setDebouncedSearchQuery} />
            <button
              type="button"
              onClick={() => setFilterSheetOpen(true)}
              aria-label="Filters"
              className={`relative shrink-0 w-[46px] h-[46px] flex items-center justify-center rounded-md border bg-paper-2 ${
                activeChips.length > 0 ? "border-gold text-gold" : "border-hairline text-ink-soft"
              }`}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9} className="w-[19px] h-[19px]">
                <path d="M4 6h16M7 12h10M10 18h4" strokeLinecap="round" />
              </svg>
              {activeChips.length > 0 && (
                <span className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-gold text-ink text-[10px] font-bold font-mono flex items-center justify-center">
                  {activeChips.length}
                </span>
              )}
            </button>
          </div>

          {/* Small removable tags for whatever's currently filtered -- a
              plain horizontal scroller rather than a dot-indicator carousel,
              since chips are variable-width and free scroll reads more
              naturally here. With one or two chips there's nothing to
              scroll; it only starts sliding once the row actually overflows. */}
          {activeChips.length > 0 && (
            <div className="mt-3 -mx-4 sm:-mx-5 px-4 sm:px-5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              <div className="flex items-center gap-2 w-max">
                {activeChips.map((chip) => (
                  <span
                    key={chip.key}
                    className="shrink-0 flex items-center gap-1.5 bg-gold text-ink rounded-full pl-3.5 pr-1.5 py-1.5 text-[13px] font-semibold whitespace-nowrap max-w-[12rem]"
                  >
                    <span className="truncate">{chip.label}</span>
                    <button
                      type="button"
                      onClick={chip.onClear}
                      aria-label={`Remove ${chip.label} filter`}
                      className="shrink-0 w-5 h-5 rounded-full bg-black/15 flex items-center justify-center text-[11px] leading-none"
                    >
                      ×
                    </button>
                  </span>
                ))}
                <button
                  type="button"
                  onClick={clearFilters}
                  className="shrink-0 border border-hairline rounded-full px-3.5 py-1.5 text-[13px] text-ink-soft"
                >
                  Clear all
                </button>
              </div>
            </div>
          )}

          <div className="mt-4 text-xs text-ink-soft font-mono [font-variant-numeric:tabular-nums]">
            Showing {filteredTransactions.length} of {totalCount}
            {debouncedSearchQuery && ` matching "${debouncedSearchQuery}"`}
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
              const isInvestmentTxn =
                transaction.classification === "Investment" || transaction.classification === "Investment Return"
              const investmentName = isInvestmentTxn ? transaction.investments?.name || null : null

              // Legacy migrated rows carry the bank as plain text in `bank`.
              // Rows created through the app instead link a real bank
              // account via bank_account_id, so fall back to that embed's
              // name when there's no legacy text -- otherwise every
              // app-submitted Contribution/Loan Payment/Bank
              // Interest/Expense silently loses its bank badge.
              const bankBadge = !isTransferTxn
                ? transaction.bank || bankAccountLabel(transaction.from_bank_account)
                : null

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

              // Member-submitted entries: editable by their owner while
              // still pending. Loan Release is excluded from self-service
              // editing -- it's paired with a loans row a member has no
              // rights to touch -- but an admin can edit/cancel it while
              // it's still pending (the loan itself is still "requested";
              // once approved, transaction.status flips to "approved" too,
              // so this stays a reliable proxy without a separate query).
              // Admin entries (Bank Interest/Expense/Bank Transfer) are
              // always inserted already-approved with no owning member,
              // so they're editable by an admin any time instead.
              const canEdit =
                (transaction.status === "pending" &&
                  transaction.member_id === member?.member_id &&
                  transaction.classification !== "Loan Release") ||
                (isAdmin &&
                  (["Bank Interest", "Expense", "Internal Transfer"].includes(transaction.classification) ||
                    (transaction.classification === "Loan Release" && transaction.status === "pending")))

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
                      {bankBadge && (
                        <span className="text-[9px] uppercase tracking-widest font-mono border border-hairline text-ink-soft rounded-full px-2 py-0.5">
                          {bankBadge}
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
                    {isInvestmentTxn && investmentName && (
                      <p className="col-span-2 text-xs text-ink-soft font-mono">{investmentName}</p>
                    )}
                    {showDescription && (
                      <p className="col-span-2 text-xs text-ink-soft break-words">
                        {transaction.description}
                      </p>
                    )}
                    {(showStatus || canEdit) && (
                      <div
                        className={`col-span-2 flex items-center gap-2 ${
                          canEdit && showStatus ? "justify-between" : "justify-end"
                        }`}
                      >
                        {showStatus && (
                          <span
                            className={`text-[10px] uppercase font-mono ${
                              statusColor[transaction.status] ?? "text-ink-soft"
                            }`}
                          >
                            {transaction.status}
                          </span>
                        )}
                        {canEdit && (
                          <button
                            type="button"
                            onClick={() => router.push(`/transactions/${transaction.transaction_id}/edit`)}
                            className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide text-gold font-mono"
                          >
                            ✎ Edit
                          </button>
                        )}
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

        {/* Fixed viewport sheet, capped at 85% of the viewport height and
            scrollable internally. iOS's native date-wheel picker expands
            inline underneath whichever input is focused, which can make
            this sheet's natural content height taller than the screen --
            without a cap the Apply button could get pushed out of reach
            entirely instead of just requiring a scroll to see it. Every
            control here applies its filter live (same as the old always-
            visible dropdowns did) -- "Apply Filters" just closes the sheet
            rather than batching anything. */}
        {filterSheetOpen && (
          <div
            className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50"
            onClick={() => setFilterSheetOpen(false)}
          >
            <div
              className="w-full sm:w-96 max-h-[85vh] overflow-y-auto bg-paper-2 border border-hairline rounded-t-xl sm:rounded-xl p-5 pb-[calc(env(safe-area-inset-bottom)+1.5rem)] sm:pb-5"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between mb-5">
                <p className="font-display text-lg font-medium text-ink">Filters</p>
                <button type="button" onClick={clearFilters} className="text-sm font-semibold text-gold">
                  Reset
                </button>
              </div>

              <div className="mb-6">
                <p className="text-[11px] uppercase tracking-wide text-ink-soft font-mono mb-2">Who</p>
                <select
                  value={selectedMemberId}
                  onChange={(e) => setSelectedMemberId(e.target.value)}
                  className="w-full h-11 appearance-none bg-paper border border-hairline rounded-md px-3.5 text-sm text-ink focus:outline-none focus:border-gold"
                >
                  <option value="">Everyone</option>
                  {members.map((m) => (
                    <option key={m.member_id} value={m.member_id}>
                      {m.member_id === member?.member_id ? "You" : m.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="mb-6">
                <p className="text-[11px] uppercase tracking-wide text-ink-soft font-mono mb-2">Type</p>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => setSelectedType("")}
                    className={`border rounded-full px-3.5 py-2 text-sm ${
                      !selectedType ? "border-gold bg-gold/10 text-ink" : "border-hairline text-ink-soft"
                    }`}
                  >
                    All Types
                  </button>
                  {typeOptions.map((type) => {
                    const active = selectedType === type
                    return (
                      <button
                        key={type}
                        type="button"
                        onClick={() => setSelectedType(type)}
                        className={`border rounded-full px-3.5 py-2 text-sm ${
                          active ? "border-gold bg-gold/10 text-ink" : "border-hairline text-ink-soft"
                        }`}
                      >
                        {typeLabels[type] || type}
                      </button>
                    )
                  })}
                </div>
              </div>

              <div className="mb-2">
                <p className="text-[11px] uppercase tracking-wide text-ink-soft font-mono mb-2">Date Range</p>

                {/* Fills both dates in one tap for the common cases; picking
                    a custom date below just naturally stops matching any
                    preset's range, so nothing here needs its own "active
                    preset" state to keep in sync. */}
                <div className="flex gap-2 overflow-x-auto mb-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                  {buildDatePresets().map((preset) => {
                    const active = dateFrom === preset.from && dateTo === preset.to
                    return (
                      <button
                        key={preset.key}
                        type="button"
                        onClick={() => {
                          setDateFrom(preset.from)
                          setDateTo(preset.to)
                        }}
                        className={`shrink-0 border rounded-full px-3.5 py-2 text-sm whitespace-nowrap ${
                          active ? "bg-gold border-gold text-ink font-semibold" : "border-hairline text-ink-soft"
                        }`}
                      >
                        {preset.label}
                      </button>
                    )
                  })}
                </div>

                <div className="grid grid-cols-2 gap-2.5">
                  <div>
                    <label className="block text-[11px] uppercase tracking-wide text-ink-soft mb-1">From</label>
                    <DateField
                      value={dateFrom}
                      onChange={(v) => {
                        setDateFrom(v)
                        // Quietly pre-fill "To" to match "From" -- so
                        // whenever the user actually taps "To" themselves,
                        // its picker already starts on that same month/year
                        // instead of today's -- without popping it open on
                        // its own right after "From" is picked. The user
                        // can still change just the day.
                        if (v) setDateTo(v)
                      }}
                      placeholder="Start date"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] uppercase tracking-wide text-ink-soft mb-1">To</label>
                    <DateField value={dateTo} onChange={setDateTo} placeholder="End date" />
                  </div>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setFilterSheetOpen(false)}
                className="w-full mt-5 bg-gold text-ink rounded-md py-3.5 text-sm font-semibold"
              >
                Apply Filters
              </button>
            </div>
          </div>
        )}
      </main>

      {openReceiptUrl && <ReceiptModal path={openReceiptUrl} onClose={() => setOpenReceiptUrl(null)} />}
    </>
  )
}
