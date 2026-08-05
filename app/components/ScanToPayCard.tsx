"use client"

import { useEffect, useState } from "react"
import { supabase } from "@/lib/supabase"
import { getBankQrPublicUrl } from "@/lib/bankQrUrl"
import BankQrModal from "@/app/components/BankQrModal"

type Bank = {
  id: string
  bank_name: string
  account_name: string | null
  qr_code_url: string | null
}

// Shared by Dashboard (contributions) and the Borrower hub (repayments) --
// same "in case they lose or forget it" purpose in both places, so it's one
// component rather than two copies of the same fetch/render/modal logic.
// Renders nothing once loaded if no bank has a QR uploaded yet.
export default function ScanToPayCard() {
  const [banks, setBanks] = useState<Bank[]>([])
  const [openBank, setOpenBank] = useState<Bank | null>(null)

  useEffect(() => {
    let cancelled = false

    supabase
      .from("bank_accounts")
      .select("id, bank_name, account_name, qr_code_url")
      .not("qr_code_url", "is", null)
      .order("bank_name")
      .then(({ data }) => {
        if (!cancelled) setBanks((data as Bank[]) ?? [])
      })

    return () => {
      cancelled = true
    }
  }, [])

  if (banks.length === 0) return null

  return (
    <div className="bg-paper-2 border border-hairline rounded-md px-5 pt-4 pb-4 mb-6">
      <p className="text-[11px] uppercase tracking-wide text-ink-soft font-mono mb-3">Scan to Pay</p>
      <div className="flex gap-3">
        {banks.map((bank) => (
          <button
            key={bank.id}
            onClick={() => setOpenBank(bank)}
            className="flex-1 flex flex-col items-center gap-1.5 bg-paper border border-hairline rounded-md py-3 hover:bg-paper-2 transition-colors"
          >
            <img
              src={getBankQrPublicUrl(bank.qr_code_url!)}
              alt={`${bank.bank_name} QR code`}
              className="w-14 h-14 object-contain rounded-sm"
            />
            <span className="text-[12px] font-semibold text-ink">{bank.account_name || bank.bank_name}</span>
          </button>
        ))}
      </div>

      {openBank && (
        <BankQrModal
          title={openBank.account_name || openBank.bank_name}
          url={getBankQrPublicUrl(openBank.qr_code_url!)}
          onClose={() => setOpenBank(null)}
        />
      )}
    </div>
  )
}
