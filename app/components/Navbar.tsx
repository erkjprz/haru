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
      mobileLabel: "Home",
      path: "/dashboard"
    },
    {
      label: "Fund Breakdown",
      mobileLabel: "Funds",
      path: "/fund-breakdown"
    },
    {
      label: "Transactions",
      mobileLabel: "Txns",
      path: "/transactions"
    },
    {
      label: "Contribute",
      mobileLabel: "Add",
      path: "/contribute"
    },
    {
      label: "Admin",
      mobileLabel: "Admin",
      path: "/admin"
    }
  ]

  const active = (path: string) =>
    pathname === path ||
    pathname.startsWith(path + "/")

  return (
    <>

      {/* iPad / Desktop */}
      <nav
        className="
          hidden
          md:block
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

          {links.map((link) => (
            <button
              key={link.path}
              onClick={() => router.push(link.path)}
              className={`
                px-3
                py-2
                rounded
                text-sm
                border

                ${
                  active(link.path)
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


          <div className="ml-auto flex gap-2">

            <button
              onClick={toggleTheme}
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
            >
              {theme === "light" ? "Dark" : "Light"}
            </button>


            <button
              onClick={logout}
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
            >
              Logout
            </button>

          </div>

        </div>
      </nav>



      {/* iPhone Bottom Navigation */}
      <nav
        className="
          fixed
          bottom-0
          left-0
          right-0
          z-50
          md:hidden
          border-t
          border-gray-300
          dark:border-gray-700
          bg-white
          dark:bg-gray-900
        "
      >

        <div
          className="
            flex
            justify-around
            py-3
          "
        >

          {links.map((link) => (
            <button
              key={link.path}
              onClick={() => router.push(link.path)}
              className={`
                flex-1
                text-xs
                font-medium

                ${
                  active(link.path)
                    ? "text-black dark:text-white"
                    : "text-gray-500 dark:text-gray-400"
                }
              `}
            >
              {link.mobileLabel}
            </button>
          ))}

        </div>

      </nav>

    </>
  )
}