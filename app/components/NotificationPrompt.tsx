"use client"

import { useEffect, useState } from "react"
import { isPushSupported, getExistingSubscription, subscribeToPush } from "@/lib/push"

function dismissedKey(memberId: string) {
  return `haru-notif-prompt-dismissed-${memberId}`
}

// Only shown when there's actually something to prompt for -- already
// subscribed, unsupported, or previously denied/dismissed all mean "don't
// ask again," not just "hide until next visit."
export function NotificationPrompt({ memberId }: { memberId: string }) {
  const [visible, setVisible] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")

  useEffect(() => {
    if (!isPushSupported()) return
    if (typeof Notification !== "undefined" && Notification.permission === "denied") return
    if (localStorage.getItem(dismissedKey(memberId)) === "1") return

    getExistingSubscription().then((sub) => {
      if (!sub) setVisible(true)
    })
  }, [memberId])

  async function enable() {
    setBusy(true)
    setError("")
    try {
      await subscribeToPush(memberId)
      setVisible(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.")
    } finally {
      setBusy(false)
    }
  }

  function dismiss() {
    localStorage.setItem(dismissedKey(memberId), "1")
    setVisible(false)
  }

  if (!visible) return null

  return (
    <div className="mb-5 w-full bg-paper-2 border border-hairline rounded-md px-5 py-4">
      <div className="flex items-center justify-between gap-3">
        <button onClick={enable} disabled={busy} className="flex-1 text-left disabled:opacity-60">
          <p className="text-sm text-ink font-medium">
            {busy ? "Enabling..." : "Enable notifications"}
          </p>
          <p className="text-xs text-gold mt-0.5">Get notified about approvals and gains</p>
        </button>
        <button
          onClick={dismiss}
          aria-label="Dismiss"
          className="shrink-0 text-ink-soft hover:text-ink transition-colors text-lg leading-none px-1"
        >
          ×
        </button>
      </div>
      {error && <p className="text-xs text-rust mt-2">{error}</p>}
    </div>
  )
}
