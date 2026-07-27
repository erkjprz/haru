"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { supabase } from "@/lib/supabase"
import { useAuth } from "@/app/auth-context"

export function NotificationBell() {
  const router = useRouter()
  const { member } = useAuth()
  const [unreadCount, setUnreadCount] = useState(0)

  useEffect(() => {
    if (!member) return

    async function loadCount() {
      const { count } = await supabase
        .from("notifications")
        .select("id", { count: "exact", head: true })
        .eq("member_id", member!.member_id)
        .eq("read", false)

      setUnreadCount(count ?? 0)
    }

    loadCount()

    // Realtime keeps the badge live while the app is open (e.g. an admin
    // approves your transaction while you're sitting on another page)
    // instead of only updating on the next full page load.
    const channel = supabase
      .channel(`notifications-badge-${member.member_id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "notifications", filter: `member_id=eq.${member.member_id}` },
        loadCount
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [member])

  if (!member) return null

  return (
    <button
      onClick={() => router.push("/notifications")}
      aria-label="Notifications"
      className="relative w-9 h-9 flex items-center justify-center text-ink-soft hover:text-ink transition-colors"
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" className="w-[21px] h-[21px]">
        <path d="M18 8a6 6 0 10-12 0c0 7-3 9-3 9h18s-3-2-3-9" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M13.73 21a2 2 0 01-3.46 0" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      {unreadCount > 0 && (
        <span className="absolute top-0.5 right-0.5 min-w-[16px] h-[16px] px-1 rounded-full bg-rust text-paper text-[10px] font-mono font-bold flex items-center justify-center">
          {unreadCount > 9 ? "9+" : unreadCount}
        </span>
      )}
    </button>
  )
}
