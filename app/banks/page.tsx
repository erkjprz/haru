"use client"

import { useEffect, useState } from "react"
import { supabase } from "@/lib/supabase"

export default function BanksPage() {

  const [banks, setBanks] = useState<any[]>([])
  const [loading, setLoading] = useState(true)


  async function loadBanks() {

    const { data, error } = await supabase
      .from("bank_accounts")
      .select("*")
      .order("created_at", { ascending: false })


    if (!error) {
      setBanks(data ?? [])
    }

    setLoading(false)
  }


  useEffect(() => {
    loadBanks()
  }, [])


  if (loading) {
    return (
      <main className="p-6">
        Loading banks...
      </main>
    )
  }


  return (
    <main className="min-h-screen p-6">

      <h1 className="text-3xl font-bold">
        Bank Accounts
      </h1>


      <div className="mt-6 grid gap-4">

        {banks.map((bank) => (

          <div
            key={bank.id}
            className="border rounded p-4"
          >

            <h2 className="text-xl font-bold">
              {bank.account_name || bank.bank_name}
            </h2>


            <p className="mt-2">
              Bank: {bank.bank_name}
            </p>


            <p>
              Opening Balance: ${Number(bank.opening_balance).toFixed(2)}
            </p>


            <p>
              Interest Rate: {bank.interest_rate}%
            </p>

          </div>

        ))}


        {banks.length === 0 && (
          <p>
            No bank accounts found.
          </p>
        )}

      </div>

    </main>
  )
}