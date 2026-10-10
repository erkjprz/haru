"use client"

// Admin-only bottom sheets for the Banks tab. Every per-bank admin action
// (edit details, scan-to-pay QR, distributing interest) opens from the
// bank's own detail page now, and Add Bank opens from the bank list --
// each one in its own sheet instead of inline forms that shoved the page
// around. The writes themselves are unchanged from the old inline forms.

import { useEffect, useRef, useState } from "react"
import { supabase } from "@/lib/supabase"
import { Sheet } from "@/app/components/Sheet"
import { getBankQrPublicUrl } from "@/lib/bankQrUrl"
import {
  bankInterestDistributionDate,
  distributeBankInterestGroup,
  previewBankInterestGroup,
  type BankInterestSharePreview,
  type PendingBankInterestGroup
} from "@/lib/bankInterest"

export type BankAccountRow = {
  id: string
  bank_name: string
  account_name: string | null
  qr_code_url: string | null
}

const fmt = (n: number) =>
  Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })

const inputClass = "border border-hairline bg-paper text-ink text-sm rounded-sm px-3 py-3 w-full"
const labelClass = "block mb-2 text-xs uppercase tracking-wide text-ink-soft font-mono"
const primaryButtonClass = "w-full bg-ink text-paper px-4 py-3 rounded-sm text-sm font-medium disabled:opacity-50"

// Add (account = null) or edit an account's bank name / account name.
export function BankAccountSheet({
  account,
  onClose,
  onSaved
}: {
  account: BankAccountRow | null
  onClose: () => void
  onSaved: (bankName: string) => void
}) {
  const [bankName, setBankName] = useState(account?.bank_name ?? "")
  const [accountName, setAccountName] = useState(account?.account_name ?? "")
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState("")

  async function save() {
    if (!bankName.trim()) {
      setMessage("Enter a bank name.")
      return
    }

    setSaving(true)
    setMessage("")

    // v_cash_ledger/v_bank_balances group by this resolved (bank_name,
    // account_name) pair, not by id -- two accounts that resolve to the
    // same pair would silently merge their balances together with no
    // error. Checked here for a friendly message; the DB's own unique
    // index is the real backstop.
    const trimmedBankName = bankName.trim()
    const trimmedAccountName = accountName.trim() || null

    const { data: existing, error: existingError } = await supabase
      .from("bank_accounts")
      .select("id, bank_name, account_name")
    if (existingError) {
      setSaving(false)
      setMessage(existingError.message)
      return
    }
    const isDuplicate = (existing ?? []).some(
      (acct) =>
        acct.id !== account?.id &&
        acct.bank_name === trimmedBankName &&
        (acct.account_name?.trim() || null) === trimmedAccountName
    )
    if (isDuplicate) {
      setSaving(false)
      setMessage("An account with this bank name and account name already exists.")
      return
    }

    const { error } = account
      ? await supabase
          .from("bank_accounts")
          .update({ bank_name: trimmedBankName, account_name: trimmedAccountName })
          .eq("id", account.id)
      : await supabase.from("bank_accounts").insert({ bank_name: trimmedBankName, account_name: trimmedAccountName })

    setSaving(false)
    if (error) {
      setMessage(error.message)
      return
    }

    onSaved(trimmedBankName)
    onClose()
  }

  return (
    <Sheet
      title={account ? "Edit Bank Details" : "Add Bank Account"}
      onClose={onClose}
      footer={
        <button className={primaryButtonClass} onClick={save} disabled={saving}>
          {saving ? "Saving..." : account ? "Save Changes" : "Add Bank"}
        </button>
      }
    >
      <div className="space-y-4">
        <div>
          <label className={labelClass}>Bank name</label>
          <input
            className={inputClass}
            placeholder="e.g. BDO"
            value={bankName}
            onChange={(e) => setBankName(e.target.value)}
          />
        </div>
        <div>
          <label className={labelClass}>Account name</label>
          <input
            className={inputClass}
            placeholder="e.g. Est. 2017 Fund Savings"
            value={accountName}
            onChange={(e) => setAccountName(e.target.value)}
          />
        </div>
        {!account && (
          <p className="text-[12px] text-ink-soft">
            You can add a scan-to-pay QR code from the bank&apos;s page once it&apos;s created.
          </p>
        )}
        {message && <p className="text-sm text-rust">{message}</p>}
      </div>
    </Sheet>
  )
}

// Lets an admin upload/replace the "scan to pay" QR shown on Dashboard and
// the Borrower hub for this bank account. Uploads straight away on file
// select -- this sheet does just the one thing, so there's no separate save
// step to keep in sync with.
export function BankQrSheet({
  account,
  onClose,
  onUpdated
}: {
  account: BankAccountRow
  onClose: () => void
  onUpdated: (path: string) => void
}) {
  const [qrCodeUrl, setQrCodeUrl] = useState(account.qr_code_url)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState("")
  const [justUpdated, setJustUpdated] = useState(false)
  const fileInput = useRef<HTMLInputElement | null>(null)

  async function handleFile(file: File) {
    setError("")
    setJustUpdated(false)
    setUploading(true)

    const path = `${account.id}-${Date.now()}-${file.name}`

    const { error: uploadError } = await supabase.storage.from("BankQR").upload(path, file, { contentType: file.type })

    if (uploadError) {
      setError(uploadError.message)
      setUploading(false)
      return
    }

    const { error: updateError } = await supabase
      .from("bank_accounts")
      .update({ qr_code_url: path })
      .eq("id", account.id)

    if (updateError) {
      // The new file already uploaded -- if pointing the bank row at it
      // failed, clean it up rather than leaving an orphaned object behind.
      await supabase.storage.from("BankQR").remove([path])
      setError(updateError.message)
      setUploading(false)
      return
    }

    if (qrCodeUrl) await supabase.storage.from("BankQR").remove([qrCodeUrl])

    setQrCodeUrl(path)
    setJustUpdated(true)
    onUpdated(path)
    setUploading(false)
  }

  return (
    <Sheet
      title="Scan-to-Pay QR"
      onClose={onClose}
      footer={
        <button
          type="button"
          className={primaryButtonClass}
          onClick={() => fileInput.current?.click()}
          disabled={uploading}
        >
          {uploading ? "Uploading..." : qrCodeUrl ? "Replace QR Code" : "Upload QR Code"}
        </button>
      }
    >
      <p className="text-[13px] text-ink-soft text-center mb-4">
        Shown to members and borrowers when they pay into{" "}
        <span className="text-ink font-medium">{account.account_name || account.bank_name}</span>.
      </p>
      <div className="flex justify-center">
        {qrCodeUrl ? (
          <img
            src={getBankQrPublicUrl(qrCodeUrl)}
            alt="Bank QR code"
            className="w-48 h-48 object-contain rounded-md border border-hairline bg-white p-2"
          />
        ) : (
          <div className="w-48 h-48 rounded-md border border-dashed border-hairline flex items-center justify-center text-ink-soft text-[13px]">
            No QR code yet
          </div>
        )}
      </div>
      <input
        ref={fileInput}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0]
          e.target.value = ""
          if (file) handleFile(file)
        }}
      />
      {justUpdated && <p className="text-sm text-sage text-center mt-3">QR code updated.</p>}
      {error && <p className="text-sm text-rust text-center mt-3">{error}</p>}
    </Sheet>
  )
}

// Review step before Distribute -- shows how the group would be split per
// member (a read-only preview using the same formula) so the admin sees the
// result of an irreversible write before committing to it. The commit
// itself is the same distributeBankInterestGroup call as before.
export function DistributeInterestSheet({
  group,
  onClose,
  onDistributed
}: {
  group: PendingBankInterestGroup
  onClose: () => void
  onDistributed: () => void
}) {
  const [shares, setShares] = useState<BankInterestSharePreview[] | null>(null)
  const [previewError, setPreviewError] = useState("")
  const [distributing, setDistributing] = useState(false)
  const [error, setError] = useState("")

  useEffect(() => {
    previewBankInterestGroup(group)
      .then(setShares)
      .catch((err) => setPreviewError(err instanceof Error ? err.message : "Couldn't load the preview."))
  }, [group])

  async function distribute() {
    setDistributing(true)
    setError("")
    try {
      await distributeBankInterestGroup(group)
      onDistributed()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.")
      setDistributing(false)
    }
  }

  const noRecipients = shares !== null && shares.length === 0 && group.totalAmount !== 0
  // Dec 31 of the group's year once it's over (see bankInterestDistributionDate).
  const recordedOn = new Date(`${bankInterestDistributionDate(group.year)}T00:00:00`).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric"
  })

  return (
    <Sheet
      title={`Distribute ${group.year} Interest`}
      onClose={onClose}
      footer={
        <div>
          {error && <p className="text-sm text-rust mb-2">{error}</p>}
          <button
            className={primaryButtonClass}
            onClick={distribute}
            disabled={distributing || shares === null || noRecipients || !!previewError}
          >
            {distributing ? "Distributing..." : `Distribute ₱${fmt(group.totalAmount)}`}
          </button>
          <p className="text-[11px] text-ink-soft text-center mt-2">
            Recorded as of {recordedOn}, split by balances on that date. This can&apos;t be undone.
          </p>
        </div>
      }
    >
      <div className="card px-5 pt-4 pb-3.5">
        <p className="text-[11px] uppercase tracking-wide text-ink-soft font-mono mb-1.5">
          {group.bank} · {group.year}
        </p>
        <p className="font-mono [font-variant-numeric:tabular-nums] text-2xl font-bold text-ink">
          ₱{fmt(group.totalAmount)}
        </p>
        <p className="text-[12px] text-ink-soft mt-1">
          net of tax, from {group.transactionCount} transaction{group.transactionCount === 1 ? "" : "s"}
        </p>
      </div>

      <h3 className="text-[11px] uppercase tracking-[0.1em] text-ink-soft font-mono mt-5 mb-2">
        Each member&apos;s share
      </h3>

      {previewError && <p className="text-sm text-rust">{previewError}</p>}
      {!previewError && shares === null && <p className="text-sm text-ink-soft py-6 text-center">Calculating shares…</p>}
      {noRecipients && (
        <p className="text-sm text-rust">
          No member has a positive value in the fund as of {recordedOn}, so there&apos;s no one to split this across.
        </p>
      )}

      {shares && shares.length > 0 && (
        <div className="card">
          <div className="px-5">
            {shares.map((s, i) => (
              <div
                key={s.member_id}
                className={`py-2.5 flex justify-between items-center gap-3 ${
                  i !== shares.length - 1 ? "border-b border-dashed border-hairline" : ""
                }`}
              >
                <p className="text-sm text-ink truncate min-w-0">{s.name}</p>
                <div className="flex flex-col items-end shrink-0">
                  <p className="font-mono [font-variant-numeric:tabular-nums] text-sm font-semibold text-sage">
                    +₱{fmt(s.amount)}
                  </p>
                  <p className="text-[11px] text-ink-soft font-mono">{s.pctShare.toFixed(2)}%</p>
                </div>
              </div>
            ))}
          </div>
          <p className="px-5 py-2.5 border-t border-hairline text-[11px] text-ink-soft">
            Split by each member&apos;s current value in the fund as of today.
          </p>
        </div>
      )}
    </Sheet>
  )
}
