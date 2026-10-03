"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { listConversations } from "@/lib/conversations"
import { readCache, writeCache } from "@/lib/cache"

const CACHE_KEY = "admin-messages-unread"

// Admin page's way into the shared member <-> admin inbox, with the count
// of open threads that have something new since this admin last read them.
export function MessagesButton() {
  const router = useRouter()
  const [unread, setUnread] = useState(() => readCache<number>(CACHE_KEY) ?? 0)

  useEffect(() => {
    listConversations().then(({ data }) => {
      if (!data) return
      const next = data.filter((c) => c.unread && c.status === "open").length
      setUnread(next)
      writeCache(CACHE_KEY, next)
    })
  }, [])

  return (
    <button
      onClick={() => router.push("/messages")}
      className="shrink-0 relative inline-flex items-center justify-center w-9 h-9 text-ink-soft border border-hairline rounded-full hover:bg-paper-2 hover:text-ink transition-colors"
      title="Member questions"
      aria-label={unread > 0 ? `Member questions, ${unread} unread` : "Member questions"}
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
        <path d="M4 5h16v11H8l-4 4V5z" />
      </svg>
      {unread > 0 && (
        <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-gold text-paper text-[10px] font-semibold flex items-center justify-center">
          {unread}
        </span>
      )}
    </button>
  )
}
