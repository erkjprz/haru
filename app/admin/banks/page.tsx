"use client"

import { useEffect, useState } from "react"
import { supabase } from "@/lib/supabase"

export default function AdminBanksPage() {

  const [banks, setBanks] = useState<any[]>([])

  const [editingId, setEditingId] = useState<string | null>(null)

  const [bankName, setBankName] = useState("")
  const [accountName, setAccountName] = useState("")
  const [openingBalance, setOpeningBalance] = useState("")
  const [interestRate, setInterestRate] = useState("")

  const [message, setMessage] = useState("")


  async function loadBanks() {

    const { data } = await supabase
      .from("bank_accounts")
      .select("*")
      .order("created_at", { ascending: false })


    setBanks(data ?? [])

  }



  useEffect(() => {

    loadBanks()

  }, [])



  function clearForm() {

    setEditingId(null)
    setBankName("")
    setAccountName("")
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



  function editBank(bank:any) {

    setEditingId(bank.id)

    setBankName(bank.bank_name ?? "")
    setAccountName(bank.account_name ?? "")
    setOpeningBalance(String(bank.opening_balance ?? ""))
    setInterestRate(String(bank.interest_rate ?? ""))

  }



  return (

    <main className="p-6">


      <h1 className="text-3xl font-bold">
        Manage Bank Accounts
      </h1>



      <div className="mt-6 border rounded p-4 max-w-md space-y-3">


        <h2 className="font-bold">
          {editingId ? "Edit Bank Account" : "Add Bank Account"}
        </h2>



        <input
          className="border p-3 rounded w-full"
          placeholder="Bank name"
          value={bankName}
          onChange={(e)=>setBankName(e.target.value)}
        />



        <input
          className="border p-3 rounded w-full"
          placeholder="Account name"
          value={accountName}
          onChange={(e)=>setAccountName(e.target.value)}
        />



        <input
          className="border p-3 rounded w-full"
          placeholder="Opening balance"
          type="number"
          value={openingBalance}
          onChange={(e)=>setOpeningBalance(e.target.value)}
        />



        <input
          className="border p-3 rounded w-full"
          placeholder="Interest rate %"
          type="number"
          value={interestRate}
          onChange={(e)=>setInterestRate(e.target.value)}
        />



        <button
          className="bg-black text-white px-4 py-2 rounded"
          onClick={saveBank}
        >
          {editingId ? "Save Changes" : "Add Bank"}
        </button>



        {editingId && (

          <button
            className="border px-4 py-2 rounded w-full"
            onClick={clearForm}
          >
            Cancel Edit
          </button>

        )}



        <p>
          {message}
        </p>


      </div>





      <div className="mt-8 space-y-4">


        <h2 className="text-xl font-bold">
          Existing Bank Accounts
        </h2>



        {banks.map((bank)=>(


          <div
            key={bank.id}
            className="border rounded p-4"
          >


            <h3 className="font-bold">
              {bank.account_name || bank.bank_name}
            </h3>


            <p>
              Bank: {bank.bank_name}
            </p>


            <p>
              Opening Balance: ${bank.opening_balance}
            </p>


            <p>
              Interest Rate: {bank.interest_rate}%
            </p>



            <button
              className="mt-3 border px-4 py-2 rounded"
              onClick={() => editBank(bank)}
            >
              Edit
            </button>


          </div>


        ))}


      </div>


    </main>

  )

}