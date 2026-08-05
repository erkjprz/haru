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
// A slim collapsed row rather than an always-expanded card: the first
// version pushed Dashboard's Shortcuts below the fold on real device
// heights, so this only takes ~48px until tapped.
// Renders nothing once loaded if no bank has a QR uploaded yet.
export default function ScanToPayCard() {
  const [banks, setBanks] = useState<Bank[]>([])
  const [sheetOpen, setSheetOpen] = useState(false)
  const [zoomedBank, setZoomedBank] = useState<Bank | null>(null)

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
    <>
      <button
        onClick={() => setSheetOpen(true)}
        className="w-full flex items-center justify-between gap-3 bg-paper-2 border border-hairline rounded-md px-5 py-3.5 mb-6 hover:bg-paper transition-colors"
      >
        <div className="flex items-center gap-2.5">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} className="w-[18px] h-[18px] text-gold shrink-0">
            <rect x="3" y="3" width="7" height="7" rx="1" />
            <rect x="14" y="3" width="7" height="7" rx="1" />
            <rect x="3" y="14" width="7" height="7" rx="1" />
            <path d="M14 14h3v3h-3zM19 14v3M14 19h3M19 19h2v2h-2z" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span className="text-sm font-semibold text-ink">Scan to Pay</span>
        </div>
        <span className="text-ink-soft">›</span>
      </button>

      {sheetOpen && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-ink/80 backdrop-blur-sm p-4"
          onClick={() => setSheetOpen(false)}
        >
          <div
            className="w-full sm:max-w-sm bg-paper-2 border border-hairline rounded-t-xl sm:rounded-md p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="text-[11px] uppercase tracking-wide text-ink-soft font-mono mb-3 text-center">
              Scan to Pay
            </p>
            <div className="flex gap-3">
              {banks.map((bank) => (
                <button
                  key={bank.id}
                  onClick={() => setZoomedBank(bank)}
                  className="flex-1 flex flex-col items-center gap-1.5 bg-paper border border-hairline rounded-md py-3 hover:bg-paper-2 transition-colors"
                >
                  <img
                    src={getBankQrPublicUrl(bank.qr_code_url!)}
                    alt={`${bank.bank_name} QR code`}
                    className="w-20 h-20 object-contain rounded-sm"
                  />
                  <span className="text-[12px] font-semibold text-ink">{bank.account_name || bank.bank_name}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {zoomedBank && (
        <BankQrModal
          title={zoomedBank.account_name || zoomedBank.bank_name}
          url={getBankQrPublicUrl(zoomedBank.qr_code_url!)}
          onClose={() => setZoomedBank(null)}
        />
      )}
    </>
  )
}
