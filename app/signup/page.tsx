"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { supabase } from "@/lib/supabase"

export default function SignupPage() {

  const router = useRouter()

  const [name, setName] = useState("")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [message, setMessage] = useState("")


  async function signup() {

    const { data, error } = await supabase.auth.signUp({
      email,
      password,
    })


    if (error) {
      setMessage(error.message)
      return
    }


    if (data.user) {

      const { error: memberError } = await supabase
        .from("members")
        .insert({
          name,
          email,
          role: "member",
          status: "pending"
        })


      if (memberError) {
        setMessage(memberError.message)
        return
      }


      setMessage(
        "Account created. Waiting for admin approval."
      )


      setTimeout(() => {
        router.push("/login")
      }, 2000)

    }
  }


  return (
    <main className="flex min-h-screen items-center justify-center">

      <div className="w-full max-w-sm space-y-4">

        <h1 className="text-3xl font-bold">
          Create Account
        </h1>


        <input
          className="w-full border p-3 rounded"
          placeholder="Name"
          value={name}
          onChange={(e)=>setName(e.target.value)}
        />


        <input
          className="w-full border p-3 rounded"
          placeholder="Email"
          value={email}
          onChange={(e)=>setEmail(e.target.value)}
        />


        <input
          className="w-full border p-3 rounded"
          placeholder="Password"
          type="password"
          value={password}
          onChange={(e)=>setPassword(e.target.value)}
        />


        <button
          className="w-full bg-black text-white p-3 rounded"
          onClick={signup}
        >
          Sign Up
        </button>


        <p>{message}</p>

      </div>

    </main>
  )
}