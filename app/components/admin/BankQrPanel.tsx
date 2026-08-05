"use client"

import { useEffect, useRef, useState } from "react"
import { supabase } from "@/lib/supabase"
import { getBankQrPublicUrl } from "@/lib/bankQrUrl"

type Bank = {
  id: string
  bank_name: string
  account_name: string | null
  qr_code_url: string | null
}

// Lets an admin upload/replace the "scan to pay" QR shown on Dashboard and
// the Borrower hub for each bank account. Uploads straight away on file
// select (no separate save step) -- this is a two-row admin setting, not a
// form worth a submit/cancel flow.
export function BankQrPanel() {
  const [banks, setBanks] = useState<Bank[]>([])
  const [loading, setLoading] = useState(true)
  const [uploadingId, setUploadingId] = useState<string | null>(null)
  const [error, setError] = useState("")
  const fileInputs = useRef<Record<string, HTMLInputElement | null>>({})

  useEffect(() => {
    async function load() {
      const { data, error } = await supabase
        .from("bank_accounts")
        .select("id, bank_name, account_name, qr_code_url")
        .order("bank_name")

      if (error) setError(error.message)
      else setBanks((data as Bank[]) ?? [])

      setLoading(false)
    }

    load()
  }, [])

  async function handleFile(bank: Bank, file: File) {
    setError("")
    setUploadingId(bank.id)

    const path = `${bank.id}-${Date.now()}-${file.name}`

    const { error: uploadError } = await supabase.storage
      .from("BankQR")
      .upload(path, file, { contentType: file.type })

    if (uploadError) {
      setError(uploadError.message)
      setUploadingId(null)
      return
    }

    const previousPath = bank.qr_code_url
    const { error: updateError } = await supabase
      .from("bank_accounts")
      .update({ qr_code_url: path })
      .eq("id", bank.id)

    if (updateError) {
      // The new file already uploaded -- if pointing the bank row at it
      // failed, clean it up rather than leaving an orphaned object behind.
      await supabase.storage.from("BankQR").remove([path])
      setError(updateError.message)
      setUploadingId(null)
      return
    }

    if (previousPath) await supabase.storage.from("BankQR").remove([previousPath])

    setBanks((prev) => prev.map((b) => (b.id === bank.id ? { ...b, qr_code_url: path } : b)))
    setUploadingId(null)
  }

  function handleInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const bankId = e.target.dataset.bankId
    const bank = banks.find((b) => b.id === bankId)
    const file = e.target.files?.[0]
    e.target.value = ""
    if (bank && file) handleFile(bank, file)
  }

  if (loading) return null

  return (
    <div className="mt-8 pt-6 border-t border-hairline">
      <p className="text-[11px] uppercase tracking-wide text-ink-soft font-mono mb-1.5">Bank QR Codes</p>
      <p className="text-sm text-ink-soft mb-4">
        Shown to members and borrowers on Dashboard and the Borrower hub as a &ldquo;scan to pay&rdquo; shortcut.
      </p>

      {error && <p className="text-sm text-rust mb-3">{error}</p>}

      <div className="flex flex-col gap-3">
        {banks.map((bank) => (
          <div
            key={bank.id}
            className="bg-paper-2 border border-hairline rounded-md p-4 flex items-center gap-3"
          >
            {bank.qr_code_url ? (
              <img
                src={getBankQrPublicUrl(bank.qr_code_url)}
                alt={`${bank.bank_name} QR code`}
                className="w-14 h-14 object-contain rounded-sm border border-hairline bg-paper shrink-0"
              />
            ) : (
              <div className="w-14 h-14 rounded-sm border border-dashed border-hairline shrink-0 flex items-center justify-center text-ink-soft text-xs">
                None
              </div>
            )}

            <div className="min-w-0 flex-1">
              <p className="font-display font-medium text-ink truncate">{bank.account_name || bank.bank_name}</p>
              <p className="text-xs text-ink-soft">{bank.bank_name}</p>
            </div>

            <input
              ref={(el) => {
                fileInputs.current[bank.id] = el
              }}
              type="file"
              accept="image/*"
              data-bank-id={bank.id}
              className="hidden"
              onChange={handleInputChange}
            />
            <button
              type="button"
              onClick={() => fileInputs.current[bank.id]?.click()}
              disabled={uploadingId === bank.id}
              className="shrink-0 text-xs font-medium text-ink-soft border border-hairline rounded-md px-3 py-2 hover:bg-paper hover:text-ink transition-colors disabled:opacity-60"
            >
              {uploadingId === bank.id ? "Uploading..." : bank.qr_code_url ? "Replace" : "Upload"}
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}
