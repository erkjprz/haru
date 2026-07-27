"use client"

import { usePathname, useRouter } from "next/navigation"
import { supabase } from "@/lib/supabase"
import { NotificationBell } from "@/app/components/NotificationBell"

// Borrower accounts get this instead of the full Navbar -- no dashboard,
// loans list, or "+ New" transaction button, since none of those apply to
// a restricted borrower account. The wordmark goes home (/borrower) --
// previously there was no way back from a page like Help short of the
// browser's own back button. No separate "Your Loan" link: it did the same
// thing as tapping the wordmark, and having both crowded this row on
// narrow screens once the notification bell was added.
export default function BorrowerHeader() {
  const router = useRouter()
  const pathname = usePathname()
  const onAccount = pathname === "/account"

  async function logout() {
    await supabase.auth.signOut()
    router.push("/login")
  }

  return (
    // Installed on iOS with statusBarStyle "black-translucent" (see
    // layout.tsx), the status bar overlays web content instead of
    // reserving its own space -- without this top safe-area padding, the
    // clock/signal/battery icons render on top of this bar's own content
    // instead of above it.
    <nav className="border-b border-hairline bg-paper sticky top-0 z-40" style={{ paddingTop: "env(safe-area-inset-top)" }}>
      <div className="flex items-center justify-between px-5 py-4 max-w-3xl mx-auto">
        <button
          onClick={() => router.push("/borrower")}
          className="text-[11px] tracking-[0.18em] uppercase text-gold font-mono"
        >
          Haru
        </button>
        <div className="flex items-center gap-4">
          <NotificationBell />
          {!onAccount && (
            <button onClick={() => router.push("/account")} className="text-sm font-mono text-ink-soft hover:text-ink">
              Account
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
