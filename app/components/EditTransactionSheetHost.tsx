"use client"

import { useEffect, useState } from "react"
import { usePathname, useRouter } from "next/navigation"
import { EditTransactionSheet } from "@/app/components/EditTransactionSheet"

// Mounted once at the root layout so any page can open the edit sheet --
// LoanCards (used on /borrower, which has no Navbar/FAB) and the
// Transactions list both need this, and the FAB's own NewTransactionSheet
// only lives in Navbar, which borrowers never see. Same query-param
// convention Navbar uses for ?newTransaction=1: a plain window.location
// read in an effect, not useSearchParams(), so nothing that triggers this
// has to wrap itself in its own Suspense boundary just for that.
export function EditTransactionSheetHost() {
  const router = useRouter()
  const pathname = usePathname()
  const [transactionId, setTransactionId] = useState<string | null>(null)

  useEffect(() => {
    if (typeof window === "undefined") return
    const id = new URLSearchParams(window.location.search).get("editTransaction")
    if (!id) return
    setTransactionId(id)
    router.replace(pathname, { scroll: false })
  }, [pathname, router])

  if (!transactionId) return null

  return <EditTransactionSheet transactionId={transactionId} onClose={() => setTransactionId(null)} />
}
