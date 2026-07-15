"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { supabase } from "@/lib/supabase"
import Navbar from "@/app/components/Navbar"
import ReceiptModal from "@/app/components/ReceiptModal"

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

export default function TransactionsPage() {
  const router = useRouter()
  const [transactions, setTransactions] = useState<any[]>([])
  const [members, setMembers] = useState<any[]>([])
  const [selectedMemberId, setSelectedMemberId] = useState("")
  const [selectedType, setSelectedType] = useState("")
  const [selectedYear, setSelectedYear] = useState("")
  const [showFilters, setShowFilters] = useState(false)
  const [loadError, setLoadError] = useState("")
  const [openReceiptUrl, setOpenReceiptUrl] = useState<string | null>(null)

  async function loadTransactions() {
    // Both members and bank_accounts need explicit FK hints:
    // - transactions has two FKs into members (member_id, submitted_by)
    // - transactions has two FKs into bank_accounts (bank_account_id, to_bank_account_id)
    // A bare `members(...)` or `bank_accounts(...)` embed is ambiguous and
    // PostgREST errors on it.
    const { data, error } = await supabase
      .from("transactions")
      .select(`
        *,
        members!transactions_member_id_fkey (
          name,
          email
        ),
        submitted_by_member:members!transactions_submitted_by_fkey (
          name
        ),
        bank_accounts!transactions_bank_account_id_fkey (
          bank_name,
          account_name
        )
      `)
      .order("created_at", { ascending: false })

    if (error) {
      setLoadError(error.message)
      setTransactions([])
      return
    }

    setLoadError("")
    setTransactions(data ?? [])
  }

  async function loadMembers() {
    const { data } = await supabase
      .from("members")
      .select("id, name")
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
        new Date(t.created_at)
          .getFullYear()
          .toString()
      )
    )
  )
    .sort((a,b)=>Number(b)-Number(a))

  const selectedMember =
    members.find(
      (m)=>m.id === selectedMemberId
    )

  const filteredTransactions =
    transactions.filter((t)=>{
      const memberMatch =
        selectedMemberId
          ? t.member_id === selectedMemberId
          : true

      const typeMatch =
        selectedType
          ? t.type === selectedType
          : true

      const yearMatch =
        selectedYear
          ? new Date(t.created_at)
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
      <main className="min-h-screen bg-paper text-ink font-sans">
        <div className="max-w-3xl mx-auto px-5 pt-10 pb-24">
          <div className="text-[11px] tracking-[0.18em] uppercase text-gold font-mono mb-2">
            Full History
          </div>

          <div className="flex items-start justify-between gap-4">
            <h1 className="font-display text-4xl font-semibold text-ink">
              Transactions
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
                  key={member.id}
                  value={member.id}
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
            Showing {filteredTransactions.length} of {transactions.length}
          </div>

          <div className="mt-6 space-y-3">
            {filteredTransactions.map((transaction)=>(
              <div
                key={transaction.id}
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
                      <span className="
                        text-xs
                        text-ink-soft
                        font-mono
                      ">
                        {
                          new Date(
                            transaction.created_at
                          )
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
                      {
                        transaction.members?.name
                        ||
                        "Fund"
                      }
                    </div>
                    {transaction.submitted_by_member && (
                      <p className="text-[11px] text-gold font-mono mt-0.5">
                        Recorded by {transaction.submitted_by_member.name}
                      </p>
                    )}
                    {transaction.description && (
                      <p className="
                        text-xs
                        text-ink-soft
                        mt-1
                      ">
                        {transaction.description}
                      </p>
                    )}
                    {transaction.bank_accounts && (
                      <p className="
                        text-xs
                        text-ink-soft
                        mt-1
                        font-mono
                      ">
                        {
                          transaction.bank_accounts.account_name
                          ||
                          transaction.bank_accounts.bank_name
                        }
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
                      ₱{fmt(transaction.amount)}
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
            ))}

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
