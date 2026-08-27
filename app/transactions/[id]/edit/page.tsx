"use client"

import { useEffect, useState } from "react"
import { useRouter, useParams } from "next/navigation"
import { supabase } from "@/lib/supabase"
import Navbar from "@/app/components/Navbar"
import BorrowerHeader from "@/app/components/BorrowerHeader"
import { useAuth } from "@/app/auth-context"
import { SkeletonPanel } from "@/app/components/Skeleton"
import {
  AmountHero,
  FlowBadge,
  StepTrack,
  ReviewRow,
  ReceiptField,
  RequiredMark,
  FieldGroup
} from "@/app/components/TransactionFormUI"
import { totalRepayable, type InterestType } from "@/lib/loanMath"
import { getReceiptSignedUrl } from "@/lib/receiptUrl"

// Member-submitted types: editable by the member who owns the row, only
// while it's still pending. Investment Return is also member-submittable
// now (see /transactions/new), but only when this particular row actually
// has a member_id -- an admin's own Investment Return has none, so that
// shape is handled by the isAdminSimpleType check below instead. See
// isMemberOwnedInvestmentReturn/isAdminOwnedInvestmentReturn in load().
const MEMBER_EDITABLE = ["Member Contribution", "Member Withdrawal", "Loan Repayment"]

// Admin-entered types: always inserted already-approved with no owning
// member, so "pending" never applies -- editable by an admin at any time
// (short of already being cancelled). Investment is always admin-only, so
// it's safe to list statically -- Investment Return isn't, for the reason
// above.
const ADMIN_EDITABLE = ["Bank Interest", "Expense", "Internal Transfer", "Investment"]

// Loan Release is handled separately (see load()): it's paired with a
// "loans" row, so it's only editable by an admin, and only while that loan
// is still "requested" -- once approved/active, changes belong on the
// loan's own page instead.

const TYPE_LABEL: Record<string, string> = {
  "Member Contribution": "Contribution",
  "Member Withdrawal": "Withdrawal",
  "Loan Repayment": "Loan Payment",
  "Loan Release": "Loan Release",
  "Bank Interest": "Bank Interest",
  "Expense": "Expense",
  "Internal Transfer": "Bank Transfer",
  "Investment": "Investment",
  "Investment Return": "Investment Return"
}

const HELPER_TEXT: Record<string, string> = {
  "Member Contribution": "You've already sent this money. Attach proof of deposit.",
  "Member Withdrawal": "You're requesting money to be sent to you. No receipt needed yet.",
  "Loan Repayment": "You've already sent this repayment. Attach proof of deposit.",
  "Loan Release": "This member is requesting to borrow from the fund. No bank is assigned until you approve it from the loan's own page.",
  "Bank Interest": "Recording interest earned by a bank account. Attach the bank statement or screenshot showing it credited. Goes in as approved -- splitting it across members is a separate manual step from Admin.",
  "Expense": "Recording money spent out of the fund. Attach a receipt or proof of payment. Goes straight in as approved.",
  "Internal Transfer": "Moving money between two of the fund's own banks. Attach a screenshot of the transfer confirmation. Doesn't affect total contributions or cash — it's just internal.",
  "Investment": "Moving fund cash into a venture. Attach proof it went out (wire confirmation, receipt, etc).",
  "Investment Return": "Cash coming back from a venture -- a payout, sale, or exit. Attach proof of deposit."
}

const FLOW: Record<string, { arrow: string; tone: "in" | "out" | "neutral" }> = {
  "Member Contribution": { arrow: "↑", tone: "in" },
  "Member Withdrawal": { arrow: "↓", tone: "out" },
  "Loan Repayment": { arrow: "↑", tone: "in" },
  "Loan Release": { arrow: "↓", tone: "out" },
  "Bank Interest": { arrow: "↑", tone: "in" },
  "Expense": { arrow: "↓", tone: "out" },
  "Internal Transfer": { arrow: "⇄", tone: "neutral" },
  "Investment": { arrow: "↓", tone: "out" },
  "Investment Return": { arrow: "↑", tone: "in" }
}

const STATUS_TONE: Record<string, string> = {
  pending: "text-gold border-gold/40",
  approved: "text-sage border-sage/40",
  rejected: "text-rust border-rust/40"
}

// allowZero: interest rate may legitimately be 0.
function isValidPositiveNumber(value: string, allowZero = false): boolean {
  if (!value.trim()) return false
  const n = Number(value)
  if (Number.isNaN(n)) return false
  return allowZero ? n >= 0 : n > 0
}

export default function EditTransactionPage() {
  const router = useRouter()
  const params = useParams()
  const transactionId = params?.id as string

  const { loading: authLoading, member } = useAuth()
  const isAdmin = member?.role === "admin"
  const isBorrower = member?.role === "borrower"
  const backHref = isBorrower ? "/borrower" : "/transactions"
  const backLabel = isBorrower ? "← Your loan" : "← Transactions"
  const [dataLoading, setDataLoading] = useState(true)
  const checkingAccess = authLoading || dataLoading
  const [notFound, setNotFound] = useState(false)

  const [banks, setBanks] = useState<any[]>([])
  const [myLoans, setMyLoans] = useState<any[]>([])
  const [investmentsList, setInvestmentsList] = useState<any[]>([])

  const [classification, setClassification] = useState("")
  const [status, setStatus] = useState("")
  const [rejectionReason, setRejectionReason] = useState<string | null>(null)
  const [bankId, setBankId] = useState("")
  const [toBankId, setToBankId] = useState("")
  const [loanId, setLoanId] = useState("")
  const [investmentId, setInvestmentId] = useState("")
  // Set once at load from the row's actual member_id -- Investment Return
  // can be either a member's own pending submission or an admin's
  // already-approved one (see /transactions/new), so this can't be derived
  // from classification alone the way it can for every other type.
  const [isMemberOwned, setIsMemberOwned] = useState(false)
  const [amount, setAmount] = useState("")
  const [interestType, setInterestType] = useState<InterestType>("rate")
  const [interestRate, setInterestRate] = useState("")
  const [interestAmount, setInterestAmount] = useState("")
  const [termMonths, setTermMonths] = useState("")
  const [repaymentFrequency, setRepaymentFrequency] = useState("monthly")
  const [description, setDescription] = useState("")
  const [existingReceiptUrl, setExistingReceiptUrl] = useState<string | null>(null)
  const [existingReceiptSignedUrl, setExistingReceiptSignedUrl] = useState<string | null>(null)
  const [interestDistributed, setInterestDistributed] = useState(false)
  // Whether this row's investment has ever had a gain/loss distribution run
  // against it -- Investment/Investment Return have no per-transaction flag
  // the way Bank Interest does, since a distribution pools every approved
  // transaction under the investment rather than crediting off one row.
  const [investmentAlreadyDistributed, setInvestmentAlreadyDistributed] = useState(false)
  const [receipt, setReceipt] = useState<File | null>(null)
  const [receiptPreview, setReceiptPreview] = useState<string | null>(null)
  const [dragActive, setDragActive] = useState(false)

  const [saving, setSaving] = useState(false)
  const [cancelling, setCancelling] = useState(false)
  const [message, setMessage] = useState("")

  // Loan Release is the one editable type with enough conditional fields
  // to earn its own Details -> Review sub-flow, matching /transactions/new.
  const [formStep, setFormStep] = useState<1 | 2>(1)

  useEffect(() => {
    if (!existingReceiptUrl) return

    let cancelled = false
    getReceiptSignedUrl(existingReceiptUrl).then((signedUrl) => {
      if (!cancelled) setExistingReceiptSignedUrl(signedUrl)
    })

    return () => {
      cancelled = true
    }
  }, [existingReceiptUrl])

  useEffect(() => {
    if (authLoading) return

    if (!member) {
      router.push("/login")
      return
    }

    if (member.status !== "approved") {
      router.push("/waiting")
      return
    }

    // Borrowers are otherwise routed away from the admin/member transaction
    // pages, but this edit page also serves their own pending Loan
    // Repayment entries (see MEMBER_EDITABLE below), so they're let through
    // here -- the `editable` check further down still keeps them out of
    // anything that isn't theirs.

    async function load() {
      if (!member) return

      const { data: bankList } = await supabase
        .from("bank_accounts")
        .select("id, bank_name, account_name")
        .order("bank_name")

      setBanks(bankList ?? [])

      // Includes closed investments too -- an existing transaction already
      // linked to one (fixing an old amount/receipt) shouldn't have its
      // investment silently disappear from the picker. The dropdown itself
      // filters closed ones out except for whichever one this row already
      // points to (see the render below).
      const { data: investmentList } = await supabase
        .from("investments")
        .select("investment_id, name, affects_cash, status")
        .order("name")

      setInvestmentsList(investmentList ?? [])

      const { data: txn, error } = await supabase
        .from("transactions")
        .select("*")
        .eq("transaction_id", transactionId)
        .single()

      // Investment Return straddles both buckets depending on who actually
      // submitted this particular row (see the comment on MEMBER_EDITABLE
      // above) -- everything else is a static, unambiguous classification.
      const isMemberOwnedInvestmentReturn = txn ? txn.classification === "Investment Return" && txn.member_id != null : false
      const isAdminOwnedInvestmentReturn = txn ? txn.classification === "Investment Return" && txn.member_id == null : false
      const isMemberType = txn ? MEMBER_EDITABLE.includes(txn.classification) || isMemberOwnedInvestmentReturn : false
      const isAdminSimpleType = txn ? ADMIN_EDITABLE.includes(txn.classification) || isAdminOwnedInvestmentReturn : false
      const isLoanReleaseType = txn ? txn.classification === "Loan Release" : false

      let loanRecord: any = null
      if (isLoanReleaseType && txn?.loan_id) {
        const { data: loan } = await supabase.from("loans").select("*").eq("loan_id", txn.loan_id).single()
        loanRecord = loan
      }

      // Admin-recorded entries (Bank Interest/Expense/Internal Transfer) are
      // restricted to whichever admin actually submitted them -- older
      // entries with no submitted_by on file stay editable by any admin
      // instead of locking everyone out. Mirrors canEdit on the
      // Transactions list.
      const isOwnAdminEntry = txn ? txn.submitted_by == null || txn.submitted_by === member.member_id : false

      // A member-owned row stays editable through a rejection too -- saving
      // it then resubmits it (see handleSave), so a member can fix whatever
      // the reason called out instead of starting a new entry from scratch.
      // Loan Release doesn't get this: rejecting one deletes its loan record
      // entirely (see rejectTransaction in /admin), so a rejected Loan
      // Release has nothing left to resubmit and stays admin-only/pending.
      const editable =
        txn &&
        !error &&
        ((isMemberType &&
          txn.member_id === member.member_id &&
          (txn.status === "pending" || txn.status === "rejected")) ||
          (isAdminSimpleType && isAdmin && txn.status !== "cancelled" && isOwnAdminEntry) ||
          (isLoanReleaseType && isAdmin && txn.status === "pending" && loanRecord?.status === "requested"))

      if (!editable) {
        setNotFound(true)
        setDataLoading(false)
        return
      }

      setClassification(txn.classification)
      setStatus(txn.status)
      setRejectionReason(txn.rejection_reason ?? null)
      setBankId(txn.bank_account_id ?? "")
      setToBankId(txn.to_bank_account_id ?? "")
      setInvestmentId(txn.investment_id ?? "")
      setIsMemberOwned(isMemberType)
      setDescription(txn.description ?? "")
      setExistingReceiptUrl(txn.receipt_url ?? null)
      setInterestDistributed(txn.interest_distributed === true)
      setFormStep(1)

      const isInvestmentEntryType = txn.classification === "Investment" || txn.classification === "Investment Return"
      if (isInvestmentEntryType && txn.investment_id) {
        const { data: existingAllocation } = await supabase
          .from("investment_allocations")
          .select("id")
          .eq("investment_id", txn.investment_id)
          .limit(1)
          .maybeSingle()

        setInvestmentAlreadyDistributed(!!existingAllocation)
      }

      if (isLoanReleaseType && loanRecord) {
        setLoanId(loanRecord.loan_id)
        setAmount(String(Number(loanRecord.principal)))
        setInterestType(loanRecord.interest_type === "amount" ? "amount" : "rate")
        setInterestRate(String(Number(loanRecord.interest_rate ?? 0)))
        setInterestAmount(loanRecord.interest_amount != null ? String(Number(loanRecord.interest_amount)) : "")
        setTermMonths(loanRecord.term_months != null ? String(loanRecord.term_months) : "")
        setRepaymentFrequency(loanRecord.repayment_frequency ?? "monthly")
      } else {
        setLoanId(txn.loan_id ?? "")
        setAmount(String(Math.abs(Number(txn.amount))))
      }

      if (txn.classification === "Loan Repayment") {
        // Borrower-only loans (e.g. Joy, who isn't a fund member) link via
        // borrowers.borrower_id rather than member_id -- mirrors the OR
        // filter borrower/repay uses so a borrower editing their own
        // pending repayment still sees their loan in the dropdown.
        const { data: borrowerRow } = await supabase
          .from("borrowers")
          .select("borrower_id")
          .eq("member_id", member.member_id)
          .maybeSingle()

        const loanFilter = borrowerRow?.borrower_id
          ? `member_id.eq.${member.member_id},borrower_id.eq.${borrowerRow.borrower_id}`
          : `member_id.eq.${member.member_id}`

        const { data: loans } = await supabase
          .from("loans")
          .select("loan_id, principal, interest_rate, term_months, status, start_date")
          .or(loanFilter)
          .in("status", ["active", "requested"])
          .order("start_date", { ascending: false })

        setMyLoans(loans ?? [])
      }

      setDataLoading(false)
    }

    load()
  }, [authLoading, member, router, transactionId])

  const isBankTransfer = classification === "Internal Transfer"
  const isLoanPayment = classification === "Loan Repayment"
  const isLoanRelease = classification === "Loan Release"
  const isInvestmentEntry = classification === "Investment" || classification === "Investment Return"
  const needsBank =
    classification === "Member Contribution" ||
    classification === "Loan Repayment" ||
    classification === "Bank Interest" ||
    classification === "Expense" ||
    isBankTransfer ||
    isInvestmentEntry
  // Every editable type requires a receipt except Member Withdrawal and
  // Loan Release, where nothing has actually moved yet -- mirrors the same
  // rule on /transactions/new (see the comment there for why admin-entered
  // types like Bank Interest/Expense/Internal Transfer are included).
  const needsReceipt = classification !== "Member Withdrawal" && !isLoanRelease

  const previewTotalRepayable =
    isLoanRelease &&
    isValidPositiveNumber(amount) &&
    (interestType === "rate"
      ? isValidPositiveNumber(interestRate, true)
      : isValidPositiveNumber(interestAmount, true))
      ? totalRepayable(Number(amount), interestType, Number(interestRate || 0), Number(interestAmount || 0))
      : 0

  const previewPerInstallment =
    previewTotalRepayable && isValidPositiveNumber(termMonths) && repaymentFrequency === "monthly"
      ? previewTotalRepayable / Number(termMonths)
      : previewTotalRepayable

  function setReceiptFile(file: File | null) {
    setReceipt(file)
    setReceiptPreview(file ? URL.createObjectURL(file) : null)
  }

  const fmt = (n: number) =>
    Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })

  // Gate for Loan Release's Details step "Continue" -- the same checks
  // handleSave itself makes for this type, just run earlier so the Review
  // step never shows something that can't actually be saved.
  function detailsStepError(): string {
    if (!isValidPositiveNumber(amount)) return "Enter a valid amount greater than zero."

    if (isLoanRelease) {
      if (interestType === "rate" && !isValidPositiveNumber(interestRate, true)) {
        return "Enter a valid interest rate (0 or higher)."
      }
      if (interestType === "amount" && !isValidPositiveNumber(interestAmount, true)) {
        return "Enter a valid interest amount (0 or higher)."
      }
      if (!isValidPositiveNumber(termMonths)) return "Enter a valid term, in months greater than zero."
    }

    return ""
  }

  function handleContinueToReview() {
    const error = detailsStepError()
    if (error) {
      setMessage(error)
      return
    }
    setMessage("")
    setFormStep(2)
  }


  async function handleSave() {
    setMessage("")

    if (!isValidPositiveNumber(amount)) {
      setMessage("Enter a valid amount greater than zero.")
      return
    }

    if (isLoanRelease) {
      if (interestType === "rate" && !isValidPositiveNumber(interestRate, true)) {
        setMessage("Enter a valid interest rate (0 or higher).")
        return
      }

      if (interestType === "amount" && !isValidPositiveNumber(interestAmount, true)) {
        setMessage("Enter a valid interest amount (0 or higher).")
        return
      }

      if (!isValidPositiveNumber(termMonths)) {
        setMessage("Enter a valid term, in months greater than zero.")
        return
      }
    } else {
      if (needsBank && !bankId) {
        setMessage(isBankTransfer ? "Select a source bank." : "Select a bank.")
        return
      }

      if (isBankTransfer && !toBankId) {
        setMessage("Select a destination bank.")
        return
      }

      if (isBankTransfer && bankId === toBankId) {
        setMessage("Source and destination banks must be different.")
        return
      }

      if (needsReceipt && !receipt && !existingReceiptUrl) {
        setMessage("Attach a receipt.")
        return
      }

      if (isLoanPayment && !loanId) {
        setMessage("Select which loan you're paying.")
        return
      }

      if (isInvestmentEntry && !investmentId) {
        setMessage("Select which investment this is for.")
        return
      }
    }

    setSaving(true)

    // Loan Release's amount mirrors the linked loan's principal, and its
    // rate/term/repayment mode live on the loan row, not the transaction --
    // both need updating together to stay in sync. The `editable` check on
    // load only confirmed the loan was still "requested" at that moment --
    // re-checking it here too guards against a stale page: if someone else
    // approved this loan while the page sat open, these writes would
    // otherwise silently desync the loan's real terms from what was
    // actually disbursed against.
    if (isLoanRelease) {
      const { data: loanRows, error: loanError } = await supabase
        .from("loans")
        .update({
          principal: Number(amount),
          interest_type: interestType,
          interest_rate: interestType === "rate" ? Number(interestRate) : 0,
          interest_amount: interestType === "amount" ? Number(interestAmount) : null,
          term_months: Number(termMonths),
          repayment_frequency: repaymentFrequency,
          notes: description
        })
        .eq("loan_id", loanId)
        .eq("status", "requested")
        .select("loan_id")

      if (loanError) {
        setMessage(loanError.message)
        setSaving(false)
        return
      }

      if (!loanRows || loanRows.length === 0) {
        setSaving(false)
        setMessage("This loan has already been approved or changed since you opened it, so it can't be edited here anymore.")
        return
      }

      const { data: txnRows, error } = await supabase
        .from("transactions")
        .update({ amount: -Number(amount), description })
        .eq("transaction_id", transactionId)
        .eq("status", "pending")
        .select("transaction_id")

      setSaving(false)

      if (error) {
        setMessage(error.message)
        return
      }

      if (!txnRows || txnRows.length === 0) {
        setMessage("This entry has changed since you opened it and can no longer be edited this way.")
        return
      }

      router.push(backHref)
      return
    }

    let receiptUrl = existingReceiptUrl

    if (receipt) {
      const fileName = `${member?.member_id}-${Date.now()}-${receipt.name}`

      const { error: uploadError } = await supabase.storage
        .from("Receipts")
        .upload(fileName, receipt, { contentType: receipt.type })

      if (uploadError) {
        setMessage(uploadError.message)
        setSaving(false)
        return
      }

      receiptUrl = fileName
    }

    // Withdrawals, expenses, and Investment outflows are cash going out, so
    // the ledger stores them negative -- matches the sign convention
    // handleSubmit uses on /transactions/new.
    const signedAmount =
      classification === "Member Withdrawal" || classification === "Expense" || classification === "Investment"
        ? -Number(amount)
        : Number(amount)

    // affects_cash mirrors the selected investment's own flag, same as
    // /transactions/new -- v_cash_ledger reads the transaction's own flag,
    // not the investment's.
    const selectedInvestment = isInvestmentEntry ? investmentsList.find((inv) => inv.investment_id === investmentId) : null

    // The `editable` check on load only confirmed this row's status at that
    // moment -- re-checking it here too guards against a stale page: a
    // member-owned row must still be pending or rejected (an admin approving
    // it elsewhere shouldn't have this save silently overwrite that), and an
    // admin-entered row must still not be cancelled.
    const isMemberOwnedType = MEMBER_EDITABLE.includes(classification) || isMemberOwned

    let updateQuery = supabase
      .from("transactions")
      .update({
        amount: signedAmount,
        bank_account_id: needsBank ? bankId : null,
        to_bank_account_id: isBankTransfer ? toBankId : null,
        loan_id: isLoanPayment ? loanId : null,
        investment_id: isInvestmentEntry ? investmentId : null,
        description,
        receipt_url: receiptUrl,
        ...(isInvestmentEntry ? { affects_cash: selectedInvestment?.affects_cash ? 1 : 0 } : {}),
        // Saving a rejected row resubmits it -- flip it back to pending and
        // clear the stale reason so it re-enters the review queue clean.
        // A no-op write when it was already pending.
        ...(isMemberOwnedType ? { status: "pending", rejection_reason: null } : {})
      })
      .eq("transaction_id", transactionId)

    updateQuery = isMemberOwnedType
      ? updateQuery.in("status", ["pending", "rejected"])
      : updateQuery.neq("status", "cancelled")

    const { data: txnRows, error } = await updateQuery.select("transaction_id")

    setSaving(false)

    if (error) {
      // The new receipt already uploaded successfully above -- if the
      // update it belongs to failed, clean it up rather than leaving it
      // orphaned in the bucket. The old file at existingReceiptUrl is
      // untouched since the update never committed.
      if (receipt && receiptUrl !== existingReceiptUrl) {
        await supabase.storage.from("Receipts").remove([receiptUrl!])
      }
      setMessage(error.message)
      return
    }

    if (!txnRows || txnRows.length === 0) {
      if (receipt && receiptUrl !== existingReceiptUrl) {
        await supabase.storage.from("Receipts").remove([receiptUrl!])
      }
      setMessage("This entry has changed since you opened it and can no longer be edited this way.")
      return
    }

    // The update above already committed the new receipt_url, so the old
    // file at existingReceiptUrl is now unreferenced -- clean it up rather
    // than leaving it orphaned in the bucket. Best-effort: a failure here
    // doesn't affect the save that already succeeded.
    if (receipt && existingReceiptUrl && existingReceiptUrl !== receiptUrl) {
      await supabase.storage.from("Receipts").remove([existingReceiptUrl])
    }

    router.push(backHref)
  }

  async function handleCancelEntry() {
    const confirmMsg = isLoanRelease
      ? "Cancel this loan request? The pending disbursement and the loan record will both be removed -- this can't be undone from the app."
      : "Cancel this entry? It'll be marked cancelled and removed from the transaction list -- this can't be undone from the app."

    if (!confirm(confirmMsg)) {
      return
    }

    setCancelling(true)

    // Loan Release: the loan row is being deleted, so the reference to it
    // has to go first -- otherwise the foreign key stops the delete.
    const updates: Record<string, any> = { status: "cancelled" }
    if (isLoanRelease) updates.loan_id = null

    // The `editable` check on load only confirmed this row's status at that
    // moment -- re-checking it here too guards against a stale page: a
    // member-owned or Loan Release row must still be pending, and an
    // admin-entered row must still not already be cancelled, or this would
    // silently reverse something that's since moved on (e.g. an admin
    // approving it elsewhere while this page sat open).
    let cancelQuery = supabase.from("transactions").update(updates).eq("transaction_id", transactionId)
    cancelQuery =
      MEMBER_EDITABLE.includes(classification) || isMemberOwned || isLoanRelease
        ? cancelQuery.eq("status", "pending")
        : cancelQuery.neq("status", "cancelled")

    const { data: txnRows, error } = await cancelQuery.select("transaction_id")

    if (!error && (!txnRows || txnRows.length === 0)) {
      setCancelling(false)
      setMessage("This entry has changed since you opened it and can no longer be cancelled this way.")
      return
    }

    if (!error && isLoanRelease && loanId) {
      // Guarded the same way -- the loan should always still be "requested"
      // here since approval flips loan and transaction status together, but
      // this is the difference between a clean message and a confusing
      // foreign-key error if that's somehow no longer true.
      const { data: loanRows, error: loanError } = await supabase
        .from("loans")
        .delete()
        .eq("loan_id", loanId)
        .eq("status", "requested")
        .select("loan_id")

      if (loanError) {
        setCancelling(false)
        setMessage(loanError.message)
        return
      }

      if (!loanRows || loanRows.length === 0) {
        setCancelling(false)
        setMessage("The loan record couldn't be removed -- it may have already been approved. Check its status before retrying.")
        return
      }
    }

    setCancelling(false)

    if (error) {
      setMessage(error.message)
      return
    }

    router.push(backHref)
  }

  if (checkingAccess) {
    return (
      <>
        {isBorrower ? <BorrowerHeader /> : <Navbar />}
        <main className="min-h-screen bg-paper text-ink font-sans overflow-x-hidden">
          <div className="max-w-lg mx-auto px-4 sm:px-5 pt-8 pb-24">
            <SkeletonPanel />
          </div>
        </main>
      </>
    )
  }

  if (notFound) {
    return (
      <>
        {isBorrower ? <BorrowerHeader /> : <Navbar />}
        <main className="min-h-screen bg-paper text-ink font-sans overflow-x-hidden">
          <div className="max-w-lg mx-auto px-4 sm:px-5 pt-8 pb-24">
            <p className="text-sm text-ink-soft">
              This entry isn't editable -- it may have already been reviewed, cancelled, or belongs to someone else.
            </p>
            <button
              type="button"
              onClick={() => router.push(backHref)}
              className="mt-4 text-sm text-gold font-semibold"
            >
              {backLabel}
            </button>
          </div>
        </main>
      </>
    )
  }

  return (
    <>
      {isBorrower ? <BorrowerHeader /> : <Navbar />}
      <main className="min-h-screen bg-paper text-ink font-sans overflow-x-hidden">
        {/* pb-64 instead of the sticky footer's own ~pb-48 worth of space --
            the footer's height varies with wrapped chips or a validation
            message, so extra slack here keeps the bottom of the card from
            ever landing underneath it and becoming unreachable by scroll. */}
        <div className="max-w-lg mx-auto px-4 sm:px-5 pt-8 pb-64">
          <button
            type="button"
            onClick={() => router.push(backHref)}
            className="text-[13px] text-ink-soft mb-4 hover:text-ink transition-colors"
          >
            {backLabel}
          </button>

          <div className="bg-paper-2 border border-hairline rounded-md p-5">
            <AmountHero
              value={amount}
              onChange={setAmount}
              label={isLoanRelease ? "Amount to borrow" : "Amount"}
              helper={HELPER_TEXT[classification]}
            />

            <div className="flex items-center justify-between gap-3 border border-hairline bg-paper rounded-full pl-1.5 pr-3 py-1.5">
              <span className="flex items-center gap-2.5 min-w-0">
                <FlowBadge {...(FLOW[classification] ?? { arrow: "•", tone: "in" })} small />
                <span className="text-sm font-semibold text-ink truncate">
                  {TYPE_LABEL[classification]}
                </span>
              </span>
              <span className="shrink-0 flex items-center gap-2">
                <span
                  className={`text-[10px] font-bold uppercase tracking-wide border rounded-full px-2 py-0.5 font-mono ${
                    STATUS_TONE[status] ?? "text-ink-soft border-hairline"
                  }`}
                >
                  {status}
                </span>
                <span className="text-xs text-ink-soft" title="Type can't be changed">
                  🔒
                </span>
              </span>
            </div>
          </div>

          {status === "rejected" && (
            <p className="text-[11px] text-rust bg-rust/10 border border-rust rounded-md px-3 py-2 mt-4">
              <span className="font-bold uppercase tracking-wide font-mono">Rejected</span>
              {/* The rest of the sentence is built as one string inside the
                  expression, not as adjacent JSX text -- JSX collapses a
                  literal space sitting right after a {expression} on a line
                  break, which silently ate the gap before "Fix" here. */}
              {rejectionReason
                ? `: ${rejectionReason} Fix what's wrong and save to send it back for review.`
                : " -- no reason was given. Fix what's wrong and save to send it back for review."}
            </p>
          )}

          {classification === "Bank Interest" && interestDistributed && (
            <p className="text-[11px] text-gold bg-gold/10 border border-gold rounded-md px-3 py-2 mt-4">
              This interest has already been split across members. Changing the amount or cancelling this entry
              won&apos;t update what members were already credited in bank_interest_allocations.
            </p>
          )}

          {isInvestmentEntry && investmentAlreadyDistributed && (
            <p className="text-[11px] text-gold bg-gold/10 border border-gold rounded-md px-3 py-2 mt-4">
              This investment has already had a gain/loss distribution run against it. Changing this entry&apos;s
              amount or cancelling it won&apos;t update what members were already credited from Distribute Gain/Loss.
            </p>
          )}

          <div className="space-y-4 mt-4">
            {!isLoanRelease && (
              <>
                <FieldGroup label="Details">
                  <div className="space-y-4">
                    {isLoanPayment && (
                      <div>
                        <label className="block mb-2 text-xs uppercase tracking-wide text-ink-soft font-mono">
                          Which loan
                          <RequiredMark />
                        </label>
                        {myLoans.filter((l) => l.status === "active").length === 0 ? (
                          <p className="text-sm text-rust">No active loans to pay against.</p>
                        ) : (
                          <select
                            className="border border-hairline bg-paper text-ink text-sm rounded-sm px-3 py-3 w-full"
                            value={loanId}
                            onChange={(e) => setLoanId(e.target.value)}
                          >
                            <option value="">Select a loan</option>
                            {myLoans
                              .filter((l) => l.status === "active" || l.loan_id === loanId)
                              .map((loan) => (
                                <option key={loan.loan_id} value={loan.loan_id}>
                                  ₱{fmt(loan.principal)} from {loan.start_date}
                                </option>
                              ))}
                          </select>
                        )}
                      </div>
                    )}

                    {isInvestmentEntry && (
                      <div>
                        <label className="block mb-2 text-xs uppercase tracking-wide text-ink-soft font-mono">
                          Investment
                          <RequiredMark />
                        </label>
                        <select
                          className="border border-hairline bg-paper text-ink text-sm rounded-sm px-3 py-3 w-full"
                          value={investmentId}
                          onChange={(e) => setInvestmentId(e.target.value)}
                        >
                          <option value="">Select an investment</option>
                          {investmentsList
                            .filter((inv) => inv.status === "open" || inv.investment_id === investmentId)
                            .map((inv) => (
                              <option key={inv.investment_id} value={inv.investment_id}>
                                {inv.name}
                              </option>
                            ))}
                        </select>
                      </div>
                    )}

                    {needsBank && (
                      <div>
                        <label className="block mb-2 text-xs uppercase tracking-wide text-ink-soft font-mono">
                          {isBankTransfer ? "From bank" : "Bank"}
                          <RequiredMark />
                        </label>
                        <select
                          className="border border-hairline bg-paper text-ink text-sm rounded-sm px-3 py-3 w-full"
                          value={bankId}
                          onChange={(e) => setBankId(e.target.value)}
                        >
                          <option value="">Select a bank</option>
                          {banks.map((bank) => (
                            <option key={bank.id} value={bank.id}>
                              {bank.account_name || bank.bank_name}
                            </option>
                          ))}
                        </select>
                      </div>
                    )}

                    {isBankTransfer && (
                      <div>
                        <label className="block mb-2 text-xs uppercase tracking-wide text-ink-soft font-mono">
                          To bank
                          <RequiredMark />
                        </label>
                        <select
                          className="border border-hairline bg-paper text-ink text-sm rounded-sm px-3 py-3 w-full"
                          value={toBankId}
                          onChange={(e) => setToBankId(e.target.value)}
                        >
                          <option value="">Select a bank</option>
                          {banks.map((bank) => (
                            <option key={bank.id} value={bank.id}>
                              {bank.account_name || bank.bank_name}
                            </option>
                          ))}
                        </select>
                      </div>
                    )}

                    <div>
                      <label className="block mb-2 text-xs uppercase tracking-wide text-ink-soft font-mono">
                        Description
                      </label>
                      <input
                        className="border border-hairline bg-paper text-ink text-sm rounded-sm px-3 py-3 w-full"
                        placeholder="Notes (name & date already saved)"
                        value={description}
                        onChange={(e) => setDescription(e.target.value)}
                      />
                    </div>
                  </div>
                </FieldGroup>

                {needsReceipt && (
                  <FieldGroup label="Proof">
                    <div>
                      <label className="block mb-2 text-xs uppercase tracking-wide text-ink-soft font-mono">
                        Receipt
                        <RequiredMark />
                      </label>
                      <ReceiptField
                        receipt={receipt}
                        receiptPreview={receiptPreview}
                        existingReceiptUrl={existingReceiptUrl}
                        existingReceiptSignedUrl={existingReceiptSignedUrl}
                        dragActive={dragActive}
                        setDragActive={setDragActive}
                        onFileChange={setReceiptFile}
                      />
                    </div>
                  </FieldGroup>
                )}
              </>
            )}

            {isLoanRelease && (
              <>
                <StepTrack step={formStep} labels={["Details", "Review"]} />

                {formStep === 1 && (
                  <FieldGroup>
                    <div className="space-y-4">
                      <div>
                        <label className="block mb-2 text-xs uppercase tracking-wide text-ink-soft font-mono">
                          Interest
                          <RequiredMark />
                        </label>
                        <div className="flex border border-hairline rounded-sm overflow-hidden mb-2">
                          <button
                            type="button"
                            onClick={() => setInterestType("rate")}
                            className={`flex-1 text-sm font-semibold py-2.5 transition-colors ${
                              interestType === "rate" ? "bg-ink text-paper" : "bg-paper text-ink-soft"
                            }`}
                          >
                            Rate (%)
                          </button>
                          <button
                            type="button"
                            onClick={() => setInterestType("amount")}
                            className={`flex-1 text-sm font-semibold py-2.5 transition-colors ${
                              interestType === "amount" ? "bg-ink text-paper" : "bg-paper text-ink-soft"
                            }`}
                          >
                            Fixed amount (₱)
                          </button>
                        </div>
                        {interestType === "rate" ? (
                          <input
                            className="border border-hairline bg-paper text-ink text-sm rounded-sm px-3 py-3 w-full font-mono [font-variant-numeric:tabular-nums]"
                            type="number"
                            min="0"
                            step="0.01"
                            placeholder="e.g. 5"
                            value={interestRate}
                            onChange={(e) => setInterestRate(e.target.value)}
                          />
                        ) : (
                          <input
                            className="border border-hairline bg-paper text-ink text-sm rounded-sm px-3 py-3 w-full font-mono [font-variant-numeric:tabular-nums]"
                            type="number"
                            min="0"
                            step="0.01"
                            placeholder="e.g. 5000"
                            value={interestAmount}
                            onChange={(e) => setInterestAmount(e.target.value)}
                          />
                        )}
                      </div>

                      <div>
                        <label className="block mb-2 text-xs uppercase tracking-wide text-ink-soft font-mono">
                          Term (months)
                          <RequiredMark />
                        </label>
                        <input
                          className="border border-hairline bg-paper text-ink text-sm rounded-sm px-3 py-3 w-full font-mono [font-variant-numeric:tabular-nums]"
                          type="number"
                          min="1"
                          step="1"
                          placeholder="e.g. 6"
                          value={termMonths}
                          onChange={(e) => setTermMonths(e.target.value)}
                        />
                      </div>

                      <div>
                        <label className="block mb-2 text-xs uppercase tracking-wide text-ink-soft font-mono">
                          Repayment mode
                        </label>
                        <select
                          className="border border-hairline bg-paper text-ink text-sm rounded-sm px-3 py-3 w-full"
                          value={repaymentFrequency}
                          onChange={(e) => setRepaymentFrequency(e.target.value)}
                        >
                          <option value="monthly">Monthly installments</option>
                          <option value="lump_sum">One lump sum at end of term</option>
                        </select>
                      </div>

                      {previewTotalRepayable > 0 && isValidPositiveNumber(termMonths) && (
                        <div className="border border-hairline rounded-md p-4 bg-paper">
                          <p className="text-sm text-ink-soft font-mono mb-2">Estimated repayment</p>
                          <div className="flex justify-between text-base font-mono [font-variant-numeric:tabular-nums]">
                            <span className="text-ink-soft">Total repayable</span>
                            <span>₱{fmt(previewTotalRepayable)}</span>
                          </div>
                          <div className="flex justify-between text-base font-mono [font-variant-numeric:tabular-nums] mt-1">
                            <span className="text-ink-soft">
                              {repaymentFrequency === "monthly"
                                ? `Per month × ${termMonths}`
                                : `Due at ${termMonths} months`}
                            </span>
                            <span className="font-semibold">₱{fmt(previewPerInstallment)}</span>
                          </div>
                        </div>
                      )}

                      <div>
                        <label className="block mb-2 text-xs uppercase tracking-wide text-ink-soft font-mono">
                          Description
                        </label>
                        <input
                          className="border border-hairline bg-paper text-ink text-sm rounded-sm px-3 py-3 w-full"
                          placeholder="Notes (name & date already saved)"
                          value={description}
                          onChange={(e) => setDescription(e.target.value)}
                        />
                      </div>
                    </div>
                  </FieldGroup>
                )}

                {formStep === 2 && (
                  <FieldGroup>
                    <ReviewRow label="Type" value={TYPE_LABEL[classification] ?? ""} />
                    <ReviewRow
                      label="Amount to borrow"
                      value={`₱${fmt(isValidPositiveNumber(amount) ? Number(amount) : 0)}`}
                    />
                    <ReviewRow
                      label="Interest"
                      value={
                        interestType === "rate"
                          ? `${interestRate || 0}%`
                          : `₱${fmt(Number(interestAmount) || 0)} fixed`
                      }
                    />
                    <ReviewRow label="Term" value={`${termMonths || 0} months`} />
                    <ReviewRow
                      label="Repayment"
                      value={repaymentFrequency === "monthly" ? "Monthly installments" : "Lump sum at end of term"}
                    />
                    {previewTotalRepayable > 0 && (
                      <ReviewRow label="Est. total repayable" value={`₱${fmt(previewTotalRepayable)}`} />
                    )}
                    {description && <ReviewRow label="Description" value={description} />}
                  </FieldGroup>
                )}
              </>
            )}

            {/* handleCancelEntry's guard still requires status="pending" --
                a rejected row is already out of the review queue, so there's
                nothing left to cancel here; Save either resubmits it or the
                member just navigates away and leaves it rejected. */}
            {status !== "rejected" && (
              <FieldGroup>
                <p className="text-xs text-ink-soft mb-3">
                  {isLoanRelease
                    ? "Changed your mind? This cancels the loan request and removes its pending disbursement entirely -- it can't be undone from the app."
                    : "Changed your mind? This entry will be marked cancelled and removed from the transaction list -- it can't be undone from the app."}
                </p>
                <button
                  type="button"
                  onClick={handleCancelEntry}
                  disabled={cancelling}
                  className="w-full text-sm font-semibold text-rust border border-rust rounded-sm px-4 py-2.5 disabled:opacity-50"
                >
                  {cancelling ? "Cancelling…" : "Cancel this entry"}
                </button>
              </FieldGroup>
            )}
          </div>
        </div>
      </main>

      <div
        className="fixed bottom-0 left-0 right-0 z-30 bg-paper border-t border-hairline"
        style={{ paddingBottom: "calc(1rem + env(safe-area-inset-bottom))" }}
      >
        {message && (
          <div className="max-w-lg mx-auto px-4 sm:px-5 pt-3">
            <p className="text-sm text-rust">{message}</p>
          </div>
        )}
        <div className="max-w-lg mx-auto px-4 sm:px-5 pt-3 flex items-center gap-3">
          {isLoanRelease && formStep === 2 && (
            <button
              className="shrink-0 border border-hairline text-ink-soft px-5 py-3.5 rounded-full text-base font-semibold"
              onClick={() => setFormStep(1)}
            >
              Back
            </button>
          )}
          <button
            className="flex-1 bg-ink text-paper px-6 py-3.5 rounded-full text-base font-bold shadow-lg shadow-gold/30 ring-1 ring-gold/40 motion-safe:transition-transform motion-safe:active:scale-[0.97] disabled:opacity-50 disabled:shadow-none disabled:ring-0"
            onClick={isLoanRelease && formStep === 1 ? handleContinueToReview : handleSave}
            disabled={saving}
          >
            {saving
              ? "Saving…"
              : isLoanRelease && formStep === 1
              ? "Continue"
              : status === "rejected"
              ? "Resubmit"
              : "Save Changes"}
          </button>
        </div>
      </div>
    </>
  )
}
