"use client"

import { useRouter } from "next/navigation"
import { supabase } from "@/lib/supabase"
import { useTheme } from "@/app/components/ThemeProvider"

export default function Navbar() {
  const router = useRouter()
  const { theme, toggleTheme } = useTheme()

  async function logout() {
    await supabase.auth.signOut()
    router.push("/login")
  }

  const buttonClass =
    "border border-gray-300 dark:border-gray-600 px-3 py-2 rounded text-gray-900 dark:text-gray-100 text-sm"

  return (
    <nav className="
      border-b border-gray-300 dark:border-gray-700
      p-4
      flex flex-wrap
      gap-3
      items-center
      bg-white
      dark:bg-gray-900
    ">

      <button
        className={buttonClass}
        onClick={() => router.push("/dashboard")}
      >
        Dashboard
      </button>


      <button
        className={buttonClass}
        onClick={() => router.push("/contribute")}
      >
        Contribute
      </button>


      <button
        className={buttonClass}
        onClick={() => router.push("/transactions")}
      >
        Transactions
      </button>


      <button
        className={buttonClass}
        onClick={() => router.push("/fund-breakdown")}
      >
        Fund Breakdown
      </button>


      <button
        className={buttonClass}
        onClick={() => router.push("/admin")}
      >
        Admin
      </button>


      <button
        className={buttonClass}
        onClick={toggleTheme}
      >
        {theme === "light" ? "🌙 Dark" : "☀️ Light"}
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
          ml-auto
        "
        onClick={logout}
      >
        Logout
      </button>


    </nav>
  )
}