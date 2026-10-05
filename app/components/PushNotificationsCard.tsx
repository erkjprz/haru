"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { isPushSupported, getExistingSubscription, subscribeToPush, unsubscribeFromPush } from "@/lib/push"
import { isIOS, isStandalone } from "@/lib/pwa"

// Once a site's permission is "denied", Notification.requestPermission()
// resolves straight back to "denied" without showing anything -- the only
// way back is the browser's/OS's own settings, so say where those are.
function blockedHelp(): string {
  if (isIOS()) return "Open iOS Settings → Notifications → Est. 2017 and turn on Allow Notifications."
  if (/android/i.test(navigator.userAgent)) {
    return "Tap the icon next to the address bar (or long-press the app icon → App info), open Notifications, and allow them."
  }
  return "Click the icon next to the address bar, open Site settings, and set Notifications to Allow."
}

export function PushNotificationsCard({ memberId }: { memberId: string }) {
  const [supported] = useState(() => isPushSupported())
  // iOS only exposes Web Push inside the installed home-screen app, so a
  // Safari tab looks "unsupported" even on a phone that can do it.
  const [needsInstall] = useState(() => isIOS() && !isStandalone())
  const [permission, setPermission] = useState<NotificationPermission | null>(() =>
    typeof Notification !== "undefined" ? Notification.permission : null
  )
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
      if (typeof Notification !== "undefined") setPermission(Notification.permission)
    }
  }

  if (!checked) return null

  const blocked = supported && permission === "denied"

  let description: React.ReactNode
  if (needsInstall) {
    description = (
      <>
        On iPhone and iPad, notifications only work from the installed app.{" "}
        <Link href="/install" className="text-gold hover:underline">
          Add Est. 2017 to your Home Screen
        </Link>
        , then turn them on here.
      </>
    )
  } else if (!supported) {
    description = "This browser doesn't support push notifications."
  } else if (blocked) {
    description = "Notifications are blocked for this site, and your browser won't ask again."
  } else {
    description = "Get notified on this device even when Est. 2017 isn't open."
  }

  return (
    <div className="bg-paper-2 border border-hairline rounded-md p-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-lg font-medium text-ink">Push Notifications</h2>
          <p className="text-[13px] text-ink-soft mt-0.5">{description}</p>
        </div>
        {supported && !blocked && (
          <button
            onClick={toggle}
            disabled={busy}
            className={`shrink-0 px-4 py-2 rounded-md text-sm font-semibold disabled:opacity-60 ${
              subscribed ? "bg-paper border border-hairline text-ink" : "bg-gold-soft text-ink"
            }`}
          >
            {busy ? "..." : subscribed ? "Disable" : "Enable"}
          </button>
        )}
      </div>
      {blocked && (
        <p className="text-[13px] text-ink bg-paper border border-hairline rounded-md px-3 py-2 mt-3">
          <span className="font-semibold">To turn them on:</span> {blockedHelp()}
        </p>
      )}
      {error && <p className="text-sm text-rust mt-3">{error}</p>}
    </div>
  )
}
