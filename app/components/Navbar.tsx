"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { supabase } from "@/lib/supabase"

export default function Navbar() {

  const router = useRouter()
  const [isAdmin, setIsAdmin] = useState(false)


  useEffect(() => {

    async function checkAdmin() {

      const {
        data: { user }
      } = await supabase.auth.getUser()


      if (!user) return


      const { data: member } = await supabase
        .from("members")
        .select("role")
        .eq("email", user.email)
        .single()


      if (member?.role === "admin") {
        setIsAdmin(true)
      }

    }


    checkAdmin()

  }, [])



  async function logout() {

    await supabase.auth.signOut()

    router.push("/login")

  }



  return (

    <nav className="border-b p-4 flex flex-wrap gap-3 items-center">


      <button
        className="font-bold mr-4"
        onClick={() => router.push("/dashboard")}
      >
        Shared Fund
      </button>



      <button
        className="border px-3 py-1 rounded"
        onClick={() => router.push("/dashboard")}
      >
        Dashboard
      </button>



      <button
        className="border px-3 py-1 rounded"
        onClick={() => router.push("/banks")}
      >
        Banks
      </button>

      <button
        className="border px-3 py-2 rounded"
        onClick={() => router.push("/transactions")}
      >
        Transactions
      </button>

      <button
        className="border px-3 py-1 rounded"
        onClick={() => router.push("/contribute")}
      >
        Contribution
      </button>



      {isAdmin && (

        <button
          className="border px-3 py-1 rounded"
          onClick={() => router.push("/admin")}
        >
          Admin
        </button>

      )}



      <button
        className="ml-auto border px-3 py-1 rounded"
        onClick={logout}
      >
        Logout
      </button>


    </nav>

  )

}