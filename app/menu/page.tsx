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

const APPEARANCE_OPTIONS: { value: "system" | "light" | "dark"; label: string }[] = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" }
]

export default function MenuPage() {
  const router = useRouter()
  const { loading: authLoading, member } = useAuth()
  const { preference, setPreference } = useTheme()

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
            <ChevronRow label="Notifications" onClick={() => router.push("/notifications")} />
            <ChevronRow label="Help" onClick={() => router.push("/help")} />
          </MenuSection>

          <div className="mt-6">
            <div className="bg-paper-2 border border-hairline rounded-md px-5 py-3.5">
              <p className="text-sm text-ink mb-3">Appearance</p>
              <div className="flex items-center gap-1 bg-paper border border-hairline rounded-md p-1">
                {APPEARANCE_OPTIONS.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => setPreference(option.value)}
                    className={`flex-1 py-2 rounded-md text-sm ${
                      preference === option.value
                        ? "bg-gold-soft text-ink font-semibold"
                        : "text-ink-soft"
                    }`}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>

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
