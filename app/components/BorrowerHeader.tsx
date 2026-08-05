"use client"

import { useRouter } from "next/navigation"
import { NotificationBell } from "@/app/components/NotificationBell"
import { AccountMenu } from "@/app/components/AccountMenu"

// Borrower accounts get this instead of the full Navbar -- no dashboard,
// loans list, or "+ New" transaction button, since none of those apply to
// a restricted borrower account. The wordmark goes home (/borrower) --
// previously there was no way back from a page like Help short of the
// browser's own back button.
export default function BorrowerHeader() {
  const router = useRouter()

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
          Est. 2017
        </button>
        <div className="flex items-center gap-2">
          <NotificationBell />
          <AccountMenu />
        </div>
      </div>
    </nav>
  )
}
