"use client"

import { useRouter } from "next/navigation"
import { supabase } from "@/lib/supabase"


export default function Navbar() {


  const router = useRouter()



  async function logout(){

    await supabase.auth.signOut()

    router.push("/login")

  }




  return (

    <nav className="border-b p-4 flex flex-wrap gap-3">


      <button
        className="border px-3 py-2 rounded"
        onClick={() => router.push("/dashboard")}
      >
        Dashboard
      </button>



      <button
        className="border px-3 py-2 rounded"
        onClick={() => router.push("/banks")}
      >
        Banks
      </button>



      <button
        className="border px-3 py-2 rounded"
        onClick={() => router.push("/contribute")}
      >
        Contribute
      </button>



      <button
        className="border px-3 py-2 rounded"
        onClick={() => router.push("/admin/members")}
      >
        Members
      </button>



      <button
        className="border px-3 py-2 rounded"
        onClick={() => router.push("/transactions")}
      >
        Transactions
      </button>



      <button
        className="border px-3 py-2 rounded"
        onClick={() => router.push("/fund-breakdown")}
      >
        Fund Breakdown
      </button>



      <button
        className="border px-3 py-2 rounded"
        onClick={() => router.push("/admin")}
      >
        Admin
      </button>



      <button
        className="bg-black text-white px-3 py-2 rounded"
        onClick={logout}
      >
        Logout
      </button>


    </nav>

  )

}