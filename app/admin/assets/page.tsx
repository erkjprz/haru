"use client"

import { useEffect, useState } from "react"
import { supabase } from "@/lib/supabase"
import Navbar from "@/app/components/Navbar"

export default function AdminAssetsPage() {

  const [assets, setAssets] = useState<any[]>([])

  const [editingId, setEditingId] = useState<string | null>(null)

  const [name, setName] = useState("")
  const [type, setType] = useState("business")
  const [amount, setAmount] = useState("")
  const [status, setStatus] = useState("active")
  const [notes, setNotes] = useState("")

  const [message, setMessage] = useState("")



  async function loadAssets() {

    const { data } = await supabase
      .from("assets")
      .select("*")
      .order("created_at", {
        ascending: false
      })

    setAssets(data ?? [])

  }



  useEffect(() => {
    loadAssets()
  }, [])



  function clearForm() {

    setEditingId(null)
    setName("")
    setType("business")
    setAmount("")
    setStatus("active")
    setNotes("")

  }




  async function saveAsset() {


    const assetData = {

      name,

      type,

      amount: Number(amount),

      status,

      notes: notes || null

    }



    if (editingId) {


      const { error } = await supabase
        .from("assets")
        .update(assetData)
        .eq("id", editingId)



      if (error) {

        setMessage(error.message)
        return

      }


      setMessage("Asset updated")


    } else {


      const { error } = await supabase
        .from("assets")
        .insert(assetData)



      if (error) {

        setMessage(error.message)
        return

      }


      setMessage("Asset added")

    }



    clearForm()
    loadAssets()

  }




  function editAsset(asset: any) {

    setEditingId(asset.id)

    setName(asset.name ?? "")

    setType(asset.type ?? "business")

    setAmount(
      String(asset.amount ?? "")
    )

    setStatus(asset.status ?? "active")

    setNotes(asset.notes ?? "")

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
            Assets
          </h1>




          <div className="mt-6 bg-paper-2 border border-hairline rounded-md p-5 space-y-3">


            <h2 className="font-display text-xl">
              {editingId ? "Edit Asset" : "Add Asset"}
            </h2>



            <input
              className="border border-hairline bg-paper px-3 py-2 rounded-md w-full"
              placeholder="Name (e.g. FarmOn, Sonny Loan)"
              value={name}
              onChange={(e)=>setName(e.target.value)}
            />



            <select
              className="border border-hairline bg-paper px-3 py-2 rounded-md w-full"
              value={type}
              onChange={(e)=>setType(e.target.value)}
            >

              <option value="business">
                Business
              </option>

              <option value="loan">
                Loan
              </option>

              <option value="investment">
                Investment
              </option>

            </select>




            <input
              className="border border-hairline bg-paper px-3 py-2 rounded-md w-full"
              placeholder="Amount (negative for capital deployed)"
              type="number"
              value={amount}
              onChange={(e)=>setAmount(e.target.value)}
            />




            <select
              className="border border-hairline bg-paper px-3 py-2 rounded-md w-full"
              value={status}
              onChange={(e)=>setStatus(e.target.value)}
            >

              <option value="active">
                Active
              </option>

              <option value="closed">
                Closed
              </option>

              <option value="written_off">
                Written Off
              </option>

            </select>




            <input
              className="border border-hairline bg-paper px-3 py-2 rounded-md w-full"
              placeholder="Notes (optional)"
              value={notes}
              onChange={(e)=>setNotes(e.target.value)}
            />




            <button
              className="bg-ink text-paper px-4 py-2 rounded-md w-full"
              onClick={saveAsset}
            >
              {editingId ? "Save Changes" : "Add Asset"}
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


            {assets.map((asset)=>(

              <div
                key={asset.id}
                className="bg-paper-2 border border-hairline rounded-md p-5"
              >


                <div className="font-display text-lg">
                  {asset.name}
                </div>



                <div className="text-sm text-ink-soft mt-2 space-y-1">

                  <p>
                    Type: {asset.type}
                  </p>


                  <p>
                    Amount: ₱{asset.amount}
                  </p>


                  <p>
                    Status: {asset.status}
                  </p>



                  {asset.notes && (

                    <p>
                      Notes: {asset.notes}
                    </p>

                  )}

                </div>




                <button
                  className="mt-4 border border-hairline px-4 py-2 rounded-md text-sm"
                  onClick={() => editAsset(asset)}
                >
                  Edit
                </button>


              </div>

            ))}



            {assets.length === 0 && (

              <p className="text-sm text-ink-soft">
                No assets yet
              </p>

            )}


          </div>


        </div>

      </main>

    </>

  )

}