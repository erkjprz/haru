"use client"

import { useEffect, useState } from "react"
import { supabase } from "@/lib/supabase"
import Navbar from "@/app/components/Navbar"

export default function AdminBanksPage() {

  const [banks, setBanks] = useState<any[]>([])

  const [editingId, setEditingId] = useState<string | null>(null)

  const [bankName, setBankName] = useState("")
  const [accountName, useAccountName] = useState("")
  const [openingBalance, setOpeningBalance] = useState("")
  const [interestRate, setInterestRate] = useState("")

  const [message, setMessage] = useState("")



  async function loadBanks() {

    const { data } = await supabase
      .from("bank_accounts")
      .select("*")
      .order("created_at", {
        ascending: false
      })

    setBanks(data ?? [])

  }



  useEffect(() => {
    loadBanks()
  }, [])



  function clearForm() {

    setEditingId(null)
    setBankName("")
    useAccountName("")
    setOpeningBalance("")
    setInterestRate("")

  }




  async function saveBank() {


    const bankData = {

      bank_name: bankName,

      account_name: accountName,

      opening_balance: Number(openingBalance),

      interest_rate: Number(interestRate)

    }



    if (editingId) {


      const { error } = await supabase
        .from("bank_accounts")
        .update(bankData)
        .eq("id", editingId)


      if (error) {

        setMessage(error.message)
        return

      }


      setMessage("Bank updated")


    } else {


      const { error } = await supabase
        .from("bank_accounts")
        .insert(bankData)


      if (error) {

        setMessage(error.message)
        return

      }


      setMessage("Bank added")

    }



    clearForm()
    loadBanks()

  }




  function editBank(bank: any) {

    setEditingId(bank.id)

    setBankName(bank.bank_name ?? "")

    useAccountName(bank.account_name ?? "")

    setOpeningBalance(
      String(bank.opening_balance ?? "")
    )

    setInterestRate(
      String(bank.interest_rate ?? "")
    )

  }





  return (

    <>
      <Navbar />

      <main className="min-h-screen bg-paper text-ink font-sans">

        <div className="max-w-3xl mx-auto px-5 pt-10 pb-24">


          <div className="text-[11px] tracking-[0.18em] uppercase text-gold font-mono mb-2">
            Administration
          </div>


          <h1 className="font-display text-4xl font-semibold">
            Bank Accounts
          </h1>



          <div className="mt-6 bg-paper-2 border border-hairline rounded-md p-5 space-y-3">


            <h2 className="font-display text-xl">
              {editingId ? "Edit Bank Account" : "Add Bank Account"}
            </h2>



            <input
              className="border border-hairline bg-paper px-3 py-2 rounded-md w-full"
              placeholder="Bank name"
              value={bankName}
              onChange={(e)=>setBankName(e.target.value)}
            />


            <input
              className="border border-hairline bg-paper px-3 py-2 rounded-md w-full"
              placeholder="Account name"
              value={accountName}
              onChange={(e)=>useAccountName(e.target.value)}
            />


            <input
              className="border border-hairline bg-paper px-3 py-2 rounded-md w-full"
              placeholder="Opening balance"
              type="number"
              value={openingBalance}
              onChange={(e)=>setOpeningBalance(e.target.value)}
            />


            <input
              className="border border-hairline bg-paper px-3 py-2 rounded-md w-full"
              placeholder="Interest rate %"
              type="number"
              value={interestRate}
              onChange={(e)=>setInterestRate(e.target.value)}
            />



            <button
              className="bg-ink text-paper px-4 py-2 rounded-md w-full"
              onClick={saveBank}
            >
              {editingId ? "Save Changes" : "Add Bank"}
            </button>



            {editingId && (

              <button
                className="border border-hairline px-4 py-2 rounded-md w-full"
                onClick={clearForm}
              >
                Cancel
              </button>

            )}



            {message && (
              <p className="text-sm text-ink-soft">
                {message}
              </p>
            )}

          </div>





          <div className="mt-8 space-y-3">


            {banks.map((bank)=>(

              <div
                key={bank.id}
                className="bg-paper-2 border border-hairline rounded-md p-5"
              >

                <div className="font-display text-lg">
                  {bank.account_name || bank.bank_name}
                </div>


                <div className="text-sm text-ink-soft mt-2 space-y-1">

                  <p>
                    Bank: {bank.bank_name}
                  </p>

                  <p>
                    Opening Balance: ₱{bank.opening_balance}
                  </p>

                  <p>
                    Interest: {bank.interest_rate}%
                  </p>

                </div>


                <button
                  className="mt-4 border border-hairline px-4 py-2 rounded-md text-sm"
                  onClick={() => editBank(bank)}
                >
                  Edit
                </button>


              </div>

            ))}


          </div>


        </div>

      </main>

    </>
  )

}