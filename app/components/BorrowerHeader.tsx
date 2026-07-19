"use client"

import { useRouter } from "next/navigation"
import { supabase } from "@/lib/supabase"

// Borrower accounts get this instead of the full Navbar -- no dashboard,
// loans list, or "+ New" transaction button, since none of those apply to
// a restricted borrower account.
export default function BorrowerHeader() {
  const router = useRouter()

  async function logout() {
    await supabase.auth.signOut()
    router.push("/login")
  }

  return (
    <nav className="border-b border-hairline bg-paper sticky top-0 z-40">
      <div className="flex items-center justify-between px-5 py-4 max-w-3xl mx-auto">
        <span className="text-[11px] tracking-[0.18em] uppercase text-gold font-mono">
          Haru
        </span>
        <button onClick={logout} className="text-sm font-mono text-ink-soft hover:text-ink">
          Sign Out
        </button>
      </div>
    </nav>
  )
}
