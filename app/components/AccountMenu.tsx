"use client"

import { useEffect, useRef, useState } from "react"
import { usePathname, useRouter } from "next/navigation"
import { supabase } from "@/lib/supabase"
import { useAuth } from "@/app/auth-context"
import { useTheme } from "@/app/components/ThemeProvider"

function MenuIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" className="w-[21px] h-[21px]">
      <path d="M4 7h16M4 12h16M4 17h16" strokeLinecap="round" />
    </svg>
  )
}

// Shared by Navbar (members/admins) and BorrowerHeader (borrowers) -- one
// dropdown instead of a dedicated "Menu" tab + full page for one role and
// a bare 3-item dropdown for the other. Preferences is skipped for
// borrowers -- it's entirely about defaults for Contribution/Loan Payment
// transactions made through New Transaction, a flow borrowers don't have;
// their own repayment form doesn't read those defaults.
export function AccountMenu() {
  const router = useRouter()
  const pathname = usePathname()
  const { member } = useAuth()
  const { theme, toggleTheme } = useTheme()
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function handlePointerDown(e: MouseEvent | TouchEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener("mousedown", handlePointerDown)
    document.addEventListener("touchstart", handlePointerDown)
    return () => {
      document.removeEventListener("mousedown", handlePointerDown)
      document.removeEventListener("touchstart", handlePointerDown)
    }
  }, [open])

  const isBorrower = member?.role === "borrower"

  async function logout() {
    await supabase.auth.signOut()
    router.push("/login")
  }

  function go(path: string) {
    setOpen(false)
    router.push(path)
  }

  const itemClass =
    "w-full text-left px-4 py-2.5 text-sm text-ink-soft hover:text-ink hover:bg-paper-2 transition-colors border-b border-hairline"

  return (
    <div className="relative" ref={containerRef}>
      <button
        onClick={() => setOpen((v) => !v)}
        aria-label="Menu"
        className="w-9 h-9 flex items-center justify-center text-ink-soft hover:text-ink transition-colors"
      >
        <MenuIcon />
      </button>

      {open && (
        <div className="absolute z-50 right-0 mt-1.5 w-44 border border-hairline rounded-sm bg-paper shadow-lg overflow-hidden">
          {pathname !== "/account" && (
            <button onClick={() => go("/account")} className={itemClass}>
              Account
            </button>
          )}
          {!isBorrower && pathname !== "/account/preferences" && (
            <button onClick={() => go("/account/preferences")} className={itemClass}>
              Preferences
            </button>
          )}
          {pathname !== "/help" && (
            <button onClick={() => go("/help")} className={itemClass}>
              Help
            </button>
          )}
          <button onClick={toggleTheme} className={`${itemClass} flex items-center justify-between`}>
            <span>Appearance</span>
            <span>{theme === "light" ? "🌙 Dark" : "☀️ Light"}</span>
          </button>
          <button onClick={logout} className="w-full text-left px-4 py-2.5 text-sm text-ink-soft hover:text-ink hover:bg-paper-2 transition-colors">
            Sign Out
          </button>
        </div>
      )}
    </div>
  )
}
