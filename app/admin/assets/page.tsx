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
      .order("created_at", { ascending: false })

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
    setAmount(String(asset.amount ?? ""))
    setStatus(asset.status ?? "active")
    setNotes(asset.notes ?? "")
  }

  return (
    <>
      <Navbar />
      <main className="p-6">
        <h1 className="text-3xl font-bold">
          Manage Assets
        </h1>

        <div className="mt-6 border rounded p-4 max-w-md space-y-3">
          <h2 className="font-bold">
            {editingId ? "Edit Asset" : "Add Asset"}
          </h2>

          <input
            className="border p-3 rounded w-full"
            placeholder="Name (e.g. FarmOn, Sonny Loan)"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />

          <select
            className="border p-3 rounded w-full"
            value={type}
            onChange={(e) => setType(e.target.value)}
          >
            <option value="business">Business</option>
            <option value="loan">Loan</option>
            <option value="investment">Investment</option>
          </select>

          <input
            className="border p-3 rounded w-full"
            placeholder="Amount (use negative for capital deployed out)"
            type="number"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />

          <select
            className="border p-3 rounded w-full"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
          >
            <option value="active">Active</option>
            <option value="closed">Closed</option>
            <option value="written_off">Written Off</option>
          </select>

          <input
            className="border p-3 rounded w-full"
            placeholder="Notes (optional)"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />

          <button
            className="bg-black text-white px-4 py-2 rounded w-full"
            onClick={saveAsset}
          >
            {editingId ? "Save Changes" : "Add Asset"}
          </button>

          {editingId && (
            <button
              className="border px-4 py-2 rounded w-full"
              onClick={clearForm}
            >
              Cancel
            </button>
          )}

          <p>
            {message}
          </p>
        </div>

        <div className="mt-8 space-y-4">
          <h2 className="text-xl font-bold">
            Existing Assets
          </h2>

          {assets.map((asset) => (
            <div
              key={asset.id}
              className="border rounded p-4"
            >
              <h3 className="font-bold">
                {asset.name}
              </h3>
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
              <button
                className="mt-3 border px-4 py-2 rounded"
                onClick={() => editAsset(asset)}
              >
                Edit
              </button>
            </div>
          ))}

          {assets.length === 0 && (
            <p>
              No assets yet
            </p>
          )}
        </div>
      </main>
    </>
  )
}
