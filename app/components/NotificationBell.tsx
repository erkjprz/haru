"use client"

import { useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { supabase } from "@/lib/supabase"
import { useAuth } from "@/app/auth-context"

type Notification = {
  id: string
  title: string
  body: string
  link: string | null
  read: boolean
  created_at: string
}

const PREVIEW_LIMIT = 8

export function NotificationBell() {
  const router = useRouter()
  const { member } = useAuth()
  const [unreadCount, setUnreadCount] = useState(0)
  const [open, setOpen] = useState(false)
  const [notifications, setNotifications] = useState<Notification[]>([])
  const [loaded, setLoaded] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

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

  useEffect(() => {
    if (!open) return
    function handlePointerDown(e: MouseEvent | TouchEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener("mousedown", handlePointerDown)
    document.addEventListener("touchstart", handlePointerDown)
    return () => {
      document.removeEventListener("mousedown", handlePointerDown)
      document.removeEventListener("touchstart", handlePointerDown)
    }
  }, [open])

  async function toggleOpen() {
    const next = !open
    setOpen(next)
    if (!next || !member) return

    const { data, error } = await supabase
      .from("notifications")
      .select("id, title, body, link, read, created_at")
      .eq("member_id", member.member_id)
      .order("created_at", { ascending: false })
      .limit(PREVIEW_LIMIT)

    if (error) return
    setNotifications(data ?? [])
    setLoaded(true)

    const unreadIds = (data ?? []).filter((n) => !n.read).map((n) => n.id)
    if (unreadIds.length > 0) {
      await supabase.from("notifications").update({ read: true }).in("id", unreadIds)
      setNotifications((prev) => prev.map((n) => (unreadIds.includes(n.id) ? { ...n, read: true } : n)))
      setUnreadCount(0)
    }
  }

  function openNotification(n: Notification) {
    setOpen(false)
    if (n.link) router.push(n.link)
  }

  function viewAll() {
    setOpen(false)
    router.push("/notifications")
  }

  if (!member) return null

  return (
    <div className="relative" ref={containerRef}>
      <button
        onClick={toggleOpen}
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

      {open && (
        <div className="absolute z-50 right-0 mt-1.5 w-80 max-w-[calc(100vw-2rem)] border border-hairline rounded-sm bg-paper shadow-lg overflow-hidden">
          <div className="px-4 py-2.5 border-b border-hairline text-[11px] tracking-[0.14em] uppercase text-gold font-mono">
            Notifications
          </div>

          {!loaded && <div className="px-4 py-6 text-center text-sm text-ink-soft">Loading...</div>}

          {loaded && notifications.length === 0 && (
            <div className="px-4 py-6 text-center text-sm text-ink-soft">Nothing yet.</div>
          )}

          {loaded && notifications.length > 0 && (
            <div className="max-h-80 overflow-y-auto divide-y divide-hairline">
              {notifications.map((n) => (
                <button
                  key={n.id}
                  onClick={() => openNotification(n)}
                  disabled={!n.link}
                  className="w-full text-left px-4 py-3 flex items-start gap-2.5 hover:bg-paper-2 transition-colors disabled:cursor-default"
                >
                  {!n.read && <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-gold shrink-0" />}
                  <div className={n.read ? "flex-1 min-w-0 ml-[14px]" : "flex-1 min-w-0"}>
                    <div className="flex items-baseline justify-between gap-2">
                      <p className="text-sm font-medium text-ink truncate">{n.title}</p>
                      <span className="text-[11px] text-ink-soft font-mono shrink-0">
                        {new Date(n.created_at).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                      </span>
                    </div>
                    <p className="text-[13px] text-ink-soft mt-0.5 line-clamp-2">{n.body}</p>
                  </div>
                </button>
              ))}
            </div>
          )}

          <button
            onClick={viewAll}
            className="w-full text-center px-4 py-2.5 text-[13px] text-ink-soft hover:text-ink hover:bg-paper-2 transition-colors border-t border-hairline"
          >
            View all
          </button>
        </div>
      )}
    </div>
  )
}
