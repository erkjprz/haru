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
  "Tax": "text-rust border-rust"
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
// the member's name is the card title). Only show description when it
// carries information beyond "this belongs to that member" -- e.g. Fund-level
// rows (Tax, Bank Interest, Internal Transfer, Investment) where it's the
// only content, or the rare genuine note.
function isRedundantDescription(description: string | null, memberName: string | null): boolean {
  if (!description || !memberName) return false
  return description.trim().toLowerCase() === memberName.trim().toLowerCase()
}

// Tax and Bank Interest rows have no member -- their description ("tax",
// "interest", "maya interest") was the only way to tell them apart from
// each other and to see which bank they belonged to. Now that the type
// badge already says TAX / BANK INTEREST and the bank pill already shows
// BDO / Maya, that description adds nothing, so hide it for these two
// classifications specifically.
const CLASSIFICATIONS_WITH_REDUNDANT_DESCRIPTION = new Set([
  "Tax",
  "Bank Interest"
])

export default function TransactionsPage() {
  const router = useRouter()
  const [transactions, setTransactions] = useState<any[]>([])
  const [totalCount, setTotalCount] = useState(0)
  const [members, setMembers] = useState<any[]>([])
  const [selectedMemberId, setSelectedMemberId] = useState("")
  const [selectedType, setSelectedType] = useState("")
  const [selectedYear, setSelectedYear] = useState("")
  const [showFilters, setShowFilters] = useState(false)
  const [loadError, setLoadError] = useState("")
  const [openReceiptUrl, setOpenReceiptUrl] = useState<string | null>(null)

  async function loadTransactions() {
    // members needs an explicit FK hint: transactions has two FKs into
    // members (member_id, submitted_by), so a bare `members(...)` embed is
    // ambiguous and PostgREST errors on it.
    //
    // bank_accounts is intentionally NOT joined here anymore -- the
    // bank_accounts table has zero rows (bank_account_id is never populated
    // on any transaction), so that embed always resolved to null. The real
    // bank info (BDO / Maya) lives in transactions.bank, a plain text
    // column that's populated on every logs-sourced row. We select it
    // directly via `*` below instead of joining a table that holds no data.
    //
    // .range() is required: without an explicit range, PostgREST applies its
    // own default row cap (1000), which silently truncates the result and
    // makes "Showing X of Y" lie about the real total. 4999 comfortably
    // covers current volume; if the table keeps growing, switch this to
    // real server-side pagination ("Load more" / page tokens) instead of
    // raising the number again.
    const { data, error, count } = await supabase
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
        )
      `,
        { count: "exact" }
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
    setTransactions(data ?? [])
    setTotalCount(count ?? (data?.length ?? 0))
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

  function closeFilters() {
    setShowFilters(false)
  }

  function clearFilters() {
    setSelectedYear("")
    setSelectedMemberId("")
    setSelectedType("")
  }

  const typeOptions = Object.keys(typeLabels)

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

      return (
        memberMatch &&
        typeMatch &&
        yearMatch
      )
    })

  const fmt = (n:number)=>
    Number(n).toLocaleString(undefined,{
      minimumFractionDigits:2,
      maximumFractionDigits:2
    })

  return (
    <>
      <Navbar />
      <main className="min-h-screen bg-paper text-ink font-sans overflow-x-hidden">
        <div className="max-w-3xl mx-auto px-5 pt-10 pb-24">
          <div className="text-[11px] tracking-[0.18em] uppercase text-gold font-mono mb-2">
            Full History
          </div>

          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
            <h1 className="font-display text-3xl sm:text-4xl font-semibold text-ink">
              Transactions
            </h1>
            <button
              className="
                w-full
                sm:w-auto
                sm:shrink-0
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
                justify-center
                gap-1.5
              "
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

          <button
            className="
              mt-6
              md:hidden
              w-full
              border
              border-hairline
              bg-paper-2
              rounded-sm
              px-4
              py-3
              text-sm
              text-left
            "
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
              className="
                border border-hairline
                bg-paper-2
                text-ink
                text-sm
                rounded-sm
                px-3 py-3
                w-full
                md:w-auto
              "
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
              className="
                border border-hairline
                bg-paper-2
                text-ink
                text-sm
                rounded-sm
                px-3 py-3
                w-full
                md:w-auto
              "
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
              className="
                border border-hairline
                bg-paper-2
                text-ink
                text-sm
                rounded-sm
                px-3 py-3
                w-full
                md:w-auto
              "
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
                  {typeLabels[type]}
                </option>
              ))}
            </select>

            <button
              className="
                border border-hairline
                rounded-sm
                px-3 py-3
                text-sm
                w-full
                md:w-auto
              "
              onClick={clearFilters}
            >
              Clear Filters
            </button>
          </div>

          {(selectedYear ||
            selectedMemberId ||
            selectedType) && (
            <div className="
              mt-4
              flex
              flex-wrap
              gap-2
            ">
              {selectedYear && (
                <button
                  className="
                    border
                    border-hairline
                    bg-paper-2
                    rounded-full
                    px-3 py-1
                    text-xs
                    font-mono
                  "
                  onClick={()=>{
                    setSelectedYear("")
                  }}
                >
                  Year: {selectedYear} ×
                </button>
              )}
              {selectedMemberId && (
                <button
                  className="
                    border
                    border-hairline
                    bg-paper-2
                    rounded-full
                    px-3 py-1
                    text-xs
                    font-mono
                  "
                  onClick={()=>{
                    setSelectedMemberId("")
                  }}
                >
                  Member: {selectedMember?.name} ×
                </button>
              )}
              {selectedType && (
                <button
                  className="
                    border
                    border-hairline
                    bg-paper-2
                    rounded-full
                    px-3 py-1
                    text-xs
                    font-mono
                  "
                  onClick={()=>{
                    setSelectedType("")
                  }}
                >
                  Type: {typeLabels[selectedType]} ×
                </button>
              )}
            </div>
          )}

          <div className="
            mt-4
            text-xs
            text-ink-soft
            font-mono
          ">
            Showing {filteredTransactions.length} of {totalCount}
          </div>

          <div className="mt-6 space-y-3">
            {filteredTransactions.map((transaction)=>{
              const memberName = transaction.members?.name || null
              const showDescription =
                transaction.description &&
                !isRedundantDescription(transaction.description, memberName) &&
                !CLASSIFICATIONS_WITH_REDUNDANT_DESCRIPTION.has(transaction.classification)

              return (
                <div
                  key={transaction.transaction_id}
                  className="
                    bg-paper-2
                    border border-hairline
                    rounded-md
                    p-4
                  "
                >
                  <div className="
                    flex
                    justify-between
                    items-start
                    gap-3
                  ">
                    <div className="min-w-0">
                      <div className="
                        flex
                        items-center
                        gap-2
                        flex-wrap
                      ">
                        <span
                          className={`
                            text-[9px]
                            uppercase
                            tracking-widest
                            font-mono
                            border
                            rounded-full
                            px-2 py-0.5
                            ${
                              typeColor[transaction.classification]
                              ??
                              "text-ink-soft border-hairline"
                            }
                          `}
                        >
                          {
                            typeLabels[transaction.classification]
                            ||
                            transaction.classification
                          }
                        </span>
                        {transaction.bank && (
                          <span className="
                            text-[9px]
                            uppercase
                            tracking-widest
                            font-mono
                            border
                            border-hairline
                            text-ink-soft
                            rounded-full
                            px-2 py-0.5
                          ">
                            {transaction.bank}
                          </span>
                        )}
                        <span className="
                          text-xs
                          text-ink-soft
                          font-mono
                        ">
                          {
                            effectiveDate(transaction)
                              .toLocaleDateString()
                          }
                        </span>
                      </div>
                      <div className="
                        font-display
                        text-lg
                        font-medium
                        mt-2
                      ">
                        {memberName || "Fund"}
                      </div>
                      {transaction.submitted_by_member && (
                        <p className="text-[11px] text-gold font-mono mt-0.5">
                          Recorded by {transaction.submitted_by_member.name}
                        </p>
                      )}
                      {showDescription && (
                        <p className="
                          text-xs
                          text-ink-soft
                          mt-1
                          break-words
                        ">
                          {transaction.description}
                        </p>
                      )}
                    </div>

                    <div className="
                      text-right
                      shrink-0
                    ">
                      <div className="
                        font-mono
                        text-xl
                        font-semibold
                      ">
                        ₱{fmt(Math.abs(transaction.amount))}
                      </div>
                      <div className="
                        text-[10px]
                        uppercase
                        text-ink-soft
                        font-mono
                        mt-1
                      ">
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
              <p className="
                py-8
                text-sm
                text-ink-soft
                text-center
              ">
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
