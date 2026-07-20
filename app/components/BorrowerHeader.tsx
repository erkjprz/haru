"use client"

import { usePathname, useRouter } from "next/navigation"
import { supabase } from "@/lib/supabase"

// Borrower accounts get this instead of the full Navbar -- no dashboard,
// loans list, or "+ New" transaction button, since none of those apply to
// a restricted borrower account. The wordmark and "Your Loan" both go home
// (/borrower) -- previously there was no way back from a page like Help
// short of the browser's own back button.
export default function BorrowerHeader() {
  const router = useRouter()
  const pathname = usePathname()
  const onHome = pathname === "/borrower"

  async function logout() {
    await supabase.auth.signOut()
    router.push("/login")
  }

  return (
    <nav className="border-b border-hairline bg-paper sticky top-0 z-40">
      <div className="flex items-center justify-between px-5 py-4 max-w-3xl mx-auto">
        <button
          onClick={() => router.push("/borrower")}
          className="text-[11px] tracking-[0.18em] uppercase text-gold font-mono"
        >
          Haru
        </button>
        <div className="flex items-center gap-4">
          {!onHome && (
            <button onClick={() => router.push("/borrower")} className="text-sm font-mono text-ink-soft hover:text-ink">
              Your Loan
            </button>
          )}
          <button onClick={() => router.push("/help")} className="text-sm font-mono text-ink-soft hover:text-ink">
            Help
          </button>
          <button onClick={logout} className="text-sm font-mono text-ink-soft hover:text-ink">
            Sign Out
          </button>
        </div>
      </div>
    </nav>
  )
}
