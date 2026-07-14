"use client"

import { usePathname, useRouter } from "next/navigation"
import { supabase } from "@/lib/supabase"
import { useTheme } from "@/app/components/ThemeProvider"

export default function Navbar() {
  const router = useRouter()
  const pathname = usePathname()
  const { theme, toggleTheme } = useTheme()

  async function logout() {
    await supabase.auth.signOut()
    router.push("/login")
  }

  const links = [
    {
      label: "Dashboard",
      path: "/dashboard"
    },
    {
      label: "Fund Breakdown",
      path: "/fund-breakdown"
    },
    {
      label: "Transactions",
      path: "/transactions"
    },
    {
      label: "Admin",
      path: "/admin"
    }
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
    <nav
      className="
        border-b
        border-gray-300
        dark:border-gray-700
        bg-white
        dark:bg-gray-900
        p-4
      "
    >
      <div
        className="
          flex
          items-center
          gap-3
        "
      >
        <div
          className="
            flex
            gap-3
            overflow-x-auto
            flex-1
            pb-2
            scrollbar-hide
          "
        >
          {links.map((link) => (
            <button
              key={link.path}
              onClick={() => router.push(link.path)}
              className={`
                shrink-0
                whitespace-nowrap
                px-3
                py-2
                rounded
                text-sm
                border
                ${
                  isActive(link.path)
                    ? `
                      bg-black
                      text-white
                      border-black
                      dark:bg-white
                      dark:text-black
                    `
                    : `
                      border-gray-300
                      dark:border-gray-600
                      text-gray-900
                      dark:text-gray-100
                    `
                }
              `}
            >
              {link.label}
            </button>
          ))}
        </div>

        <div
          className="
            flex
            gap-2
            shrink-0
          "
        >
          <button
            onClick={toggleTheme}
            title="Toggle theme"
            className="
              border
              border-gray-300
              dark:border-gray-600
              w-10
              h-10
              rounded-full
              flex
              items-center
              justify-center
              text-sm
              text-gray-900
              dark:text-gray-100
            "
          >
            {theme === "light" ? "🌙" : "☀️"}
          </button>

          <button
            onClick={logout}
            title="Logout"
            className="
              bg-black
              dark:bg-white
              text-white
              dark:text-black
              w-10
              h-10
              rounded-full
              flex
              items-center
              justify-center
              text-lg
            "
          >
            ⏻
          </button>
        </div>
      </div>
    </nav>
  )
}
