"use client"

import { useEffect, useState } from "react"
import { usePathname, useRouter } from "next/navigation"
import { supabase } from "@/lib/supabase"
import { useTheme } from "@/app/components/ThemeProvider"

export default function Navbar() {
  const router = useRouter()
  const pathname = usePathname()
  const { theme, toggleTheme } = useTheme()
  const [isOpen, setIsOpen] = useState(false)
  const [isAdmin, setIsAdmin] = useState(false)

  useEffect(() => {
    async function checkRole() {
      const {
        data: { user }
      } = await supabase.auth.getUser()

      if (!user) return

      const { data: member } = await supabase
        .from("members")
        .select("role")
        .eq("email", user.email)
        .single()

      setIsAdmin(member?.role === "admin")
    }

    checkRole()
  }, [])

  useEffect(() => {
    setIsOpen(false)
  }, [pathname])

  async function logout() {
    await supabase.auth.signOut()
    router.push("/login")
  }

  const links = [
    { label: "Dashboard", path: "/dashboard" },
    { label: "Fund Breakdown", path: "/fund-breakdown" },
    { label: "Transactions", path: "/transactions" },
    ...(isAdmin ? [{ label: "Admin", path: "/admin" }] : [])
  ]

  function isActive(path: string) {
    const matches = links.filter(
      (l) => pathname === l.path || pathname.startsWith(l.path + "/")
    )
    if (matches.length === 0) return false
    const best = matches.reduce((a, b) =>
      a.path.length >= b.path.length ? a : b
    )
    return best.path === path
  }

  return (
    <>
      <nav className="border-b border-hairline bg-paper sticky top-0 z-40">
        <div className="flex items-center justify-between px-5 py-4 max-w-3xl mx-auto">
          <button
            onClick={() => setIsOpen(true)}
            aria-label="Open menu"
            className="flex flex-col justify-center gap-[5px] w-9 h-9 -ml-2"
          >
            <span className="block h-[1.5px] w-6 bg-ink" />
            <span className="block h-[1.5px] w-6 bg-ink" />
            <span className="block h-[1.5px] w-6 bg-ink" />
          </button>

          <span className="text-[11px] tracking-[0.18em] uppercase text-gold font-mono">
            Est. 2017
          </span>

          {/* Spacer to balance the hamburger button so the label stays centered */}
          <div className="w-9 h-9" />
        </div>
      </nav>

      {isOpen && (
        <div
          className="fixed inset-0 z-50 bg-ink/60 backdrop-blur-sm"
          onClick={() => setIsOpen(false)}
        >
          <div
            className="absolute left-0 top-0 bottom-0 w-72 max-w-[85vw] bg-paper border-r border-hairline flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-5 py-5 border-b border-hairline">
              <span className="text-[11px] tracking-[0.18em] uppercase text-gold font-mono">
                Est. 2017
              </span>
              <button
                onClick={() => setIsOpen(false)}
                aria-label="Close menu"
                className="w-8 h-8 flex items-center justify-center text-xl text-ink-soft"
              >
                ×
              </button>
            </div>

            <div className="flex-1 overflow-y-auto py-3">
              {links.map((link) => (
                <button
                  key={link.path}
                  onClick={() => {
                    router.push(link.path)
                    setIsOpen(false)
                  }}
                  className={`
                    w-full text-left px-5 py-3 text-sm font-mono
                    border-l-[3px] transition-colors
                    ${
                      isActive(link.path)
                        ? "border-gold text-ink bg-paper-2"
                        : "border-transparent text-ink-soft"
                    }
                  `}
                >
                  {link.label}
                </button>
              ))}
            </div>

            <button
              onClick={toggleTheme}
              className="border-t border-hairline px-5 py-3 text-sm font-mono text-ink-soft flex items-center justify-between"
            >
              <span>Appearance</span>
              <span>{theme === "light" ? "🌙 Dark mode" : "☀️ Light mode"}</span>
            </button>

            <div className="border-t border-hairline p-5">
              <button
                onClick={logout}
                className="w-full flex items-center justify-center gap-2 bg-ink text-paper rounded-sm py-3 text-sm font-medium"
              >
                <span>⏻</span>
                Sign Out
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
