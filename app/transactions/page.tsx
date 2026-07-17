"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { supabase } from "@/lib/supabase"
import Navbar from "@/app/components/Navbar"
import ReceiptModal from "@/app/components/ReceiptModal"

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

// A transaction's real-world date is txn_date. created_at is a row-insert
// audit timestamp and only happens to match txn_date for migrated rows
// because the migration script set it that way -- it's not guaranteed to
// stay in sync (e.g. manual edits, backfills). Always prefer txn_date,
// falling back to created_at only for rows that genuinely have no txn_date.
function effectiveDate(transaction: any): Date {
  return new Date(transaction.txn_date ?? transaction.created_at)
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

type MemberAllocations = {
  bankInterest: number
  investmentGainLoss: number
  loanGain: number
  bankWriteoff: number
}

export default function TransactionsPage() {
  const router = useRouter()
  const [transactions, setTransactions] = useState<any[]>([])
  const [totalCount, setTotalCount] = useState(0)
  const [members, setMembers] = useState<any[]>([])
  const [selectedMemberId, setSelectedMemberId] = useState("")
  const [selectedType, setSelectedType] = useState("")
  const [selectedYear, setSelectedYear] = useState("")
  const [searchQuery, setSearchQuery] = useState("")
  const [showFilters, setShowFilters] = useState(false)
  const [loadError, setLoadError] = useState("")
  const [openReceiptUrl, setOpenReceiptUrl] = useState<string | null>(null)
  const [memberAllocations, setMemberAllocations] = useState<MemberAllocations | null>(null)

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

  // Investment/bank-interest/loan-gain figures live in v_member_performance
  // -- the same view Dashboard and Fund Breakdown already read from -- so
  // pulling from it here instead of re-aggregating investment_allocations /
  // bank_interest_allocations / loan_gain_allocations by hand means this
  // panel can never drift from what those two pages show for the same
  // member.
  useEffect(() => {
    async function loadMemberAllocations() {
      if (!selectedMemberId) {
        setMemberAllocations(null)
        return
      }

      const { data, error } = await supabase
        .from("v_member_performance")
        .select("bank_interest, investment_gain_loss, loan_gain, bank_writeoff")
        .eq("member_id", selectedMemberId)
        .single()

      if (error || !data) {
        setMemberAllocations(null)
        return
      }

      setMemberAllocations({
        bankInterest: Number(data.bank_interest),
        investmentGainLoss: Number(data.investment_gain_loss),
        loanGain: Number(data.loan_gain),
        bankWriteoff: Number(data.bank_writeoff)
      })
    }

    loadMemberAllocations()
  }, [selectedMemberId])

  function closeFilters() {
    setShowFilters(false)
  }

  function clearFilters() {
    setSelectedYear("")
    setSelectedMemberId("")
    setSelectedType("")
  }

  // Built from what's actually in the loaded data rather than the full
  // static typeLabels list -- classifications with zero current rows (e.g.
  // Expense, Gain Allocation before any distribution has run) simply don't
  // appear as filter options until a real row exists.
  const typeOptions = Array.from(new Set(transactions.map((t) => t.classification))).sort(
    (a, b) => (typeLabels[a] || a).localeCompare(typeLabels[b] || b)
  )

  const yearOptions = Array.from(
    new Set(
      transactions.map((t) =>
        effectiveDate(t)
          .getFullYear()
          .toString()
      )
    )
  )
    .sort((a,b)=>Number(b)-Number(a))

  const selectedMember =
    members.find(
      (m)=>m.member_id === selectedMemberId
    )

  const filteredTransactions =
    transactions.filter((t)=>{
      const memberMatch =
        selectedMemberId
          ? t.member_id === selectedMemberId
          : true

      const typeMatch =
        selectedType
          ? t.classification === selectedType
          : true

      const yearMatch =
        selectedYear
          ? effectiveDate(t)
              .getFullYear()
              .toString() === selectedYear
          : true

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

      return (
        memberMatch &&
        typeMatch &&
        yearMatch &&
        searchMatch
      )
    })

  const fmt = (n:number)=>
    Number(n).toLocaleString(undefined,{
      minimumFractionDigits:2,
      maximumFractionDigits:2
    })

  // Same helpers Dashboard and Fund Breakdown use for every signed figure --
  // reused here instead of the panel hand-rolling its own "+"/sage-or-rust
  // logic (which previously always rendered "+" for Bank Interest/Loan Gain
  // regardless of actual sign).
  const signed = (n: number) => `${n < 0 ? "-" : "+"}₱${fmt(Math.abs(n))}`
  const tone = (n: number) => (n > 0 ? "text-sage" : n < 0 ? "text-rust" : "text-ink-soft")

  return (
    <>
      <Navbar />
      <main className="min-h-screen bg-paper text-ink font-sans overflow-x-hidden">
        <div className="max-w-3xl mx-auto px-4 sm:px-5 pt-8 pb-24">
          <div className="text-[11px] tracking-[0.18em] uppercase text-gold font-mono mb-2">
            Full History
          </div>

          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
            <h1 className="font-display text-3xl sm:text-4xl font-semibold text-ink">
              Transactions
            </h1>
            <button
              className="w-full sm:w-auto sm:shrink-0 bg-gold text-ink px-5 py-3 rounded-md text-sm font-semibold shadow-sm hover:opacity-90 transition-opacity flex items-center justify-center gap-1.5"
              onClick={() => router.push("/transactions/new")}
            >
              <span className="text-lg leading-none">+</span>
              New Transaction
            </button>
          </div>

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

          <button
            className="mt-6 md:hidden w-full border border-hairline bg-paper-2 rounded-md px-4 py-3 text-sm text-left"
            onClick={() =>
              setShowFilters(!showFilters)
            }
          >
            Filters
            <span className="float-right">
              {showFilters ? "−" : "+"}
            </span>
          </button>

          <div
            className={`
              mt-3
              gap-3
              ${
                showFilters
                  ? "flex flex-col"
                  : "hidden"
              }
              md:flex
              md:flex-row
              md:flex-wrap
            `}
          >
            <select
              className="border border-hairline bg-paper-2 text-ink text-sm rounded-md px-3 py-3 w-full md:w-auto"
              value={selectedYear}
              onChange={(e)=>{
                setSelectedYear(e.target.value)
                closeFilters()
              }}
            >
              <option value="">
                All years
              </option>
              {yearOptions.map((year)=>(
                <option
                  key={year}
                  value={year}
                >
                  {year}
                </option>
              ))}
            </select>

            <select
              className="border border-hairline bg-paper-2 text-ink text-sm rounded-md px-3 py-3 w-full md:w-auto"
              value={selectedMemberId}
              onChange={(e)=>{
                setSelectedMemberId(e.target.value)
                closeFilters()
              }}
            >
              <option value="">
                All members
              </option>
              {members.map((member)=>(
                <option
                  key={member.member_id}
                  value={member.member_id}
                >
                  {member.name}
                </option>
              ))}
            </select>

            <select
              className="border border-hairline bg-paper-2 text-ink text-sm rounded-md px-3 py-3 w-full md:w-auto"
              value={selectedType}
              onChange={(e)=>{
                setSelectedType(e.target.value)
                closeFilters()
              }}
            >
              <option value="">
                All types
              </option>
              {typeOptions.map((type)=>(
                <option
                  key={type}
                  value={type}
                >
                  {typeLabels[type] || type}
                </option>
              ))}
            </select>

            <button
              className="border border-hairline rounded-md px-3 py-3 text-sm w-full md:w-auto"
              onClick={clearFilters}
            >
              Clear Filters
            </button>
          </div>

          {(selectedYear ||
            selectedMemberId ||
            selectedType) && (
            <div className="mt-4 flex flex-wrap gap-2">
              {selectedYear && (
                <button
                  className="border border-hairline bg-paper-2 rounded-full px-3 py-1 text-xs font-mono"
                  onClick={()=>{
                    setSelectedYear("")
                  }}
                >
                  Year: {selectedYear} ×
                </button>
              )}
              {selectedMemberId && (
                <button
                  className="border border-hairline bg-paper-2 rounded-full px-3 py-1 text-xs font-mono"
                  onClick={()=>{
                    setSelectedMemberId("")
                  }}
                >
                  Member: {selectedMember?.name} ×
                </button>
              )}
              {selectedType && (
                <button
                  className="border border-hairline bg-paper-2 rounded-full px-3 py-1 text-xs font-mono"
                  onClick={()=>{
                    setSelectedType("")
                  }}
                >
                  Type: {typeLabels[selectedType] || selectedType} ×
                </button>
              )}
            </div>
          )}

          {/* Member Allocations -- InfoBox pattern matching Dashboard/Fund
              Breakdown, sourced from v_member_performance. */}
          {selectedMemberId && memberAllocations && (
            <div className="mt-4 bg-paper-2 border border-hairline rounded-md p-1">
              <div className="bg-paper rounded-lg px-4 py-3.5">
                <p className="text-[10px] uppercase tracking-[0.1em] text-ink-soft font-mono mb-2">
                  {selectedMember?.name} — Allocations
                </p>
                <div className="space-y-1.5">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="text-[12.5px] text-ink-soft">Bank Interest</span>
                    <span className={`font-mono [font-variant-numeric:tabular-nums] text-[12.5px] font-medium whitespace-nowrap ${tone(memberAllocations.bankInterest)}`}>
                      {signed(memberAllocations.bankInterest)}
                    </span>
                  </div>
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="text-[12.5px] text-ink-soft">Investment Gain/Loss</span>
                    <span className={`font-mono [font-variant-numeric:tabular-nums] text-[12.5px] font-medium whitespace-nowrap ${tone(memberAllocations.investmentGainLoss)}`}>
                      {signed(memberAllocations.investmentGainLoss)}
                    </span>
                  </div>
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="text-[12.5px] text-ink-soft">Loan Gain Share</span>
                    <span className={`font-mono [font-variant-numeric:tabular-nums] text-[12.5px] font-medium whitespace-nowrap ${tone(memberAllocations.loanGain)}`}>
                      {signed(memberAllocations.loanGain)}
                    </span>
                  </div>
                  {memberAllocations.bankWriteoff !== 0 && (
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="text-[12.5px] text-ink-soft">Bank Write-off Share</span>
                      <span className={`font-mono [font-variant-numeric:tabular-nums] text-[12.5px] font-medium whitespace-nowrap ${tone(memberAllocations.bankWriteoff)}`}>
                        {signed(memberAllocations.bankWriteoff)}
                      </span>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          <div className="mt-4 text-xs text-ink-soft font-mono [font-variant-numeric:tabular-nums]">
            Showing {filteredTransactions.length} of {totalCount}
            {searchQuery && ` matching "${searchQuery}"`}
          </div>

          <div className="mt-6 space-y-3">
            {filteredTransactions.map((transaction)=>{
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

              return (
                <div
                  key={transaction.transaction_id}
                  className="bg-paper-2 border border-hairline rounded-md p-4"
                >
                  <div className="flex justify-between items-start gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span
                          className={`text-[9px] uppercase tracking-widest font-mono border rounded-full px-2 py-0.5 ${
                            typeColor[transaction.classification] ?? "text-ink-soft border-hairline"
                          }`}
                        >
                          {
                            typeLabels[transaction.classification]
                            ||
                            transaction.classification
                          }
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
                        <span className="text-xs text-ink-soft font-mono">
                          {
                            effectiveDate(transaction)
                              .toLocaleDateString()
                          }
                        </span>
                      </div>
                      <div className="font-display text-lg font-medium mt-2">
                        {displayName}
                      </div>
                      {transaction.submitted_by_member && (
                        <p className="text-[11px] text-gold font-mono mt-0.5">
                          Recorded by {transaction.submitted_by_member.name}
                        </p>
                      )}
                      {isLoanTxn && loanName && (
                        <p className="text-xs text-ink-soft mt-1 font-mono">
                          {loanName}
                        </p>
                      )}
                      {showDescription && (
                        <p className="text-xs text-ink-soft mt-1 break-words">
                          {transaction.description}
                        </p>
                      )}
                    </div>

                    <div className="text-right shrink-0">
                      <div className="font-mono [font-variant-numeric:tabular-nums] text-xl font-semibold">
                        ₱{fmt(Math.abs(transaction.amount))}
                      </div>
                      <div className="text-[10px] uppercase text-ink-soft font-mono mt-1">
                        {transaction.status}
                      </div>
                    </div>
                  </div>

                  {transaction.receipt_url && (
                    <button
                      type="button"
                      onClick={() => setOpenReceiptUrl(transaction.receipt_url)}
                      className="mt-3 inline-flex items-center gap-1.5 text-xs font-mono text-gold border border-gold rounded-full px-3 py-1.5 hover:bg-gold/10 transition-colors"
                    >
                      🧾 View Receipt
                    </button>
                  )}
                </div>
              )
            })}

            {filteredTransactions.length === 0 && !loadError && (
              <p className="py-8 text-sm text-ink-soft text-center">
                No transactions found.
              </p>
            )}
          </div>
        </div>
      </main>

      {openReceiptUrl && (
        <ReceiptModal
          url={openReceiptUrl}
          onClose={() => setOpenReceiptUrl(null)}
        />
      )}
    </>
  )
}
