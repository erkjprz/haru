"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { supabase } from "@/lib/supabase"
import Navbar from "@/app/components/Navbar"
import BorrowerHeader from "@/app/components/BorrowerHeader"
import { useAuth } from "@/app/auth-context"
import { SkeletonPanel } from "@/app/components/Skeleton"
import { isPushSupported, getExistingSubscription, subscribeToPush, unsubscribeFromPush } from "@/lib/push"

type Notification = {
  id: string
  type: string
  title: string
  body: string
  link: string | null
  read: boolean
  created_at: string
}

function PushToggle({ memberId }: { memberId: string }) {
  const [supported] = useState(() => isPushSupported())
  const [subscribed, setSubscribed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  // Nothing to check when unsupported -- start "checked" already, so the
  // effect below only ever needs to setState from its async callback.
  const [checked, setChecked] = useState(() => !isPushSupported())

  useEffect(() => {
    if (!supported) return
    getExistingSubscription()
      .then((sub) => setSubscribed(!!sub))
      .finally(() => setChecked(true))
  }, [supported])

  async function toggle() {
    setBusy(true)
    setError("")
    try {
      if (subscribed) {
        await unsubscribeFromPush()
        setSubscribed(false)
      } else {
        await subscribeToPush(memberId)
        setSubscribed(true)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.")
    } finally {
      setBusy(false)
    }
  }

  if (!checked) return null

  return (
    <div className="bg-paper-2 border border-hairline rounded-md p-5 mb-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-lg font-medium text-ink">Push Notifications</h2>
          <p className="text-[13px] text-ink-soft mt-0.5">
            {supported
              ? "Get notified on this device even when Haru isn't open."
              : "This browser doesn't support push notifications."}
          </p>
        </div>
        {supported && (
          <button
            onClick={toggle}
            disabled={busy}
            className={`shrink-0 px-4 py-2 rounded-md text-sm font-semibold disabled:opacity-60 ${
              subscribed ? "bg-paper border border-hairline text-ink" : "bg-gold text-ink"
            }`}
          >
            {busy ? "..." : subscribed ? "Disable" : "Enable"}
          </button>
        )}
      </div>
      {error && <p className="text-sm text-rust mt-3">{error}</p>}
    </div>
  )
}

export default function NotificationsPage() {
  const router = useRouter()
  const { loading: authLoading, member } = useAuth()
  const [dataLoading, setDataLoading] = useState(true)
  const [notifications, setNotifications] = useState<Notification[]>([])
  const [loadError, setLoadError] = useState("")
  const [clearing, setClearing] = useState(false)

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

    async function load() {
      const { data, error } = await supabase
        .from("notifications")
        .select("id, type, title, body, link, read, created_at")
        .eq("member_id", member!.member_id)
        .order("created_at", { ascending: false })
        .limit(100)

      if (error) {
        setLoadError(error.message)
        setDataLoading(false)
        return
      }

      setNotifications(data ?? [])
      setDataLoading(false)

      const unreadIds = (data ?? []).filter((n) => !n.read).map((n) => n.id)
      if (unreadIds.length > 0) {
        await supabase.from("notifications").update({ read: true }).in("id", unreadIds)
      }
    }

    load()
  }, [authLoading, member, router])

  function openNotification(n: Notification) {
    if (n.link) router.push(n.link)
  }

  async function clearAll() {
    if (clearing || !member) return
    setClearing(true)
    const { error } = await supabase.from("notifications").delete().eq("member_id", member.member_id)
    setClearing(false)
    if (!error) setNotifications([])
  }

  const Header = member?.role === "borrower" ? BorrowerHeader : Navbar

  if (authLoading || !member || member.status !== "approved" || dataLoading) {
    return (
      <>
        <Header />
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
      <Header />
      <main className="min-h-screen bg-paper text-ink font-sans overflow-x-hidden">
        <div className="max-w-3xl mx-auto px-4 sm:px-5 pt-8 pb-[calc(3rem+var(--dock-h)+env(safe-area-inset-bottom))]">
          <div className="text-[11px] tracking-[0.18em] uppercase text-gold font-mono mb-2">Activity</div>
          <h1 className="font-display text-3xl sm:text-4xl font-semibold text-ink mb-1">Notifications</h1>
          <p className="text-[13px] text-ink-soft mb-6">Everything Haru has sent you, newest first.</p>

          <PushToggle memberId={member.member_id} />

          {loadError && <p className="text-sm text-rust mb-4">Couldn&apos;t load notifications: {loadError}</p>}

          {!loadError && notifications.length === 0 && (
            <p className="text-sm text-ink-soft text-center py-12 bg-paper-2 border border-hairline rounded-md">
              Nothing yet.
            </p>
          )}

          {notifications.length > 0 && (
            <div className="flex justify-end mb-2">
              <button
                onClick={clearAll}
                disabled={clearing}
                className="text-[13px] text-ink-soft hover:text-ink transition-colors disabled:opacity-60"
              >
                {clearing ? "Clearing..." : "Clear All"}
              </button>
            </div>
          )}

          {notifications.length > 0 && (
            <div className="bg-paper-2 border border-hairline rounded-md divide-y divide-hairline">
              {notifications.map((n) => (
                <button
                  key={n.id}
                  onClick={() => openNotification(n)}
                  disabled={!n.link}
                  className="w-full text-left px-5 py-3.5 flex items-start gap-3 disabled:cursor-default"
                >
                  {!n.read && <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-gold shrink-0" />}
                  <div className={n.read ? "flex-1 min-w-0 ml-[18px]" : "flex-1 min-w-0"}>
                    <div className="flex items-baseline justify-between gap-2">
                      <p className="text-sm font-medium text-ink truncate">{n.title}</p>
                      <span className="text-[11px] text-ink-soft font-mono shrink-0">
                        {new Date(n.created_at).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                      </span>
                    </div>
                    <p className="text-[13px] text-ink-soft mt-0.5">{n.body}</p>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </main>
    </>
  )
}
