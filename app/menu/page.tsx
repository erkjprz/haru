"use client"

import { useEffect } from "react"
import { useRouter } from "next/navigation"
import { supabase } from "@/lib/supabase"
import Navbar from "@/app/components/Navbar"
import { useTheme } from "@/app/components/ThemeProvider"
import { useAuth } from "@/app/auth-context"
import { SkeletonPanel } from "@/app/components/Skeleton"

function ChevronRow({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="w-full flex items-center justify-between px-5 py-3.5 text-left border-b border-hairline last:border-b-0"
    >
      <span className="text-sm text-ink">{label}</span>
      <span className="text-ink-soft">→</span>
    </button>
  )
}

function MenuSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mt-6 first:mt-0">
      <p className="text-[11px] uppercase tracking-wide text-ink-soft font-mono mb-2">{title}</p>
      <div className="bg-paper-2 border border-hairline rounded-md">{children}</div>
    </div>
  )
}

export default function MenuPage() {
  const router = useRouter()
  const { loading: authLoading, member } = useAuth()
  const { theme, toggleTheme } = useTheme()

  useEffect(() => {
    if (authLoading) return

    if (!member) {
      router.push("/login")
      return
    }

    if (member.status !== "approved") {
      router.push("/waiting")
      return
    }

    if (member.role === "borrower") {
      router.push("/borrower")
      return
    }
  }, [authLoading, member, router])

  async function logout() {
    await supabase.auth.signOut()
    router.push("/login")
  }

  if (authLoading || !member) {
    return (
      <>
        <Navbar />
        <main className="min-h-screen bg-paper text-ink font-sans overflow-x-hidden">
          <div className="max-w-3xl mx-auto px-4 sm:px-5 pt-8 pb-[calc(3rem+var(--dock-h)+env(safe-area-inset-bottom))]">
            <SkeletonPanel />
          </div>
        </main>
      </>
    )
  }

  return (
    <>
      <Navbar />
      <main className="min-h-screen bg-paper text-ink font-sans overflow-x-hidden">
        <div className="max-w-3xl mx-auto px-4 sm:px-5 pt-8 pb-[calc(3rem+var(--dock-h)+env(safe-area-inset-bottom))]">
          <div className="text-[11px] tracking-[0.18em] uppercase text-gold font-mono mb-2">
            More
          </div>
          <h1 className="font-display text-3xl sm:text-4xl font-semibold text-ink mb-1">Menu</h1>
          <p className="text-[13px] text-ink-soft mb-6">
            Everything that doesn&apos;t live on the main bar.
          </p>

          <MenuSection title="You">
            <ChevronRow label="Account" onClick={() => router.push("/account")} />
            <ChevronRow label="Preferences" onClick={() => router.push("/account/preferences")} />
            <ChevronRow label="Help" onClick={() => router.push("/help")} />
          </MenuSection>

          <div className="mt-6">
            <button
              onClick={toggleTheme}
              className="w-full flex items-center justify-between px-5 py-3.5 bg-paper-2 border border-hairline rounded-md text-sm text-ink"
            >
              <span>Appearance</span>
              <span>{theme === "light" ? "🌙 Dark mode" : "☀️ Light mode"}</span>
            </button>

            <button
              onClick={logout}
              className="w-full flex items-center justify-center gap-2 bg-ink text-paper rounded-md py-3.5 text-sm font-medium mt-3"
            >
              <span>⏻</span>
              Sign Out
            </button>
          </div>
        </div>
      </main>
    </>
  )
}
