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
      label: "Contribute",
      path: "/contribute"
    },
    {
      label: "Admin",
      path: "/admin"
    }
  ]

  return (
    <nav
      className="
        border-b border-gray-300 dark:border-gray-700
        p-4
        bg-white
        dark:bg-gray-900
      "
    >

      <div className="
        flex
        items-center
        gap-3
      ">

        <div
          className="
            flex
            gap-3
            overflow-x-auto
            flex-1
          "
        >

          {links.map((link) => {

            const active =
              pathname === link.path ||
              pathname.startsWith(link.path + "/")

            return (
              <button
                key={link.path}
                className={`
                  whitespace-nowrap
                  px-3
                  py-2
                  rounded
                  text-sm
                  border

                  ${
                    active
                      ? `
                        bg-black
                        text-white
                        border-black
                        dark:bg-white
                        dark:text-black
                        dark:border-white
                      `
                      : `
                        border-gray-300
                        dark:border-gray-600
                        text-gray-900
                        dark:text-gray-100
                      `
                  }
                `}
                onClick={() => router.push(link.path)}
              >
                {link.label}
              </button>
            )

          })}

        </div>


        <div className="
          flex
          gap-2
          shrink-0
        ">

          <button
            className="
              border
              border-gray-300
              dark:border-gray-600
              px-3
              py-2
              rounded
              text-sm
              text-gray-900
              dark:text-gray-100
            "
            onClick={toggleTheme}
          >
            {theme === "light" ? "🌙" : "☀️"}
          </button>


          <button
            className="
              bg-black
              dark:bg-white
              text-white
              dark:text-black
              px-3
              py-2
              rounded
              text-sm
            "
            onClick={logout}
          >
            Logout
          </button>

        </div>

      </div>

    </nav>
  )
}