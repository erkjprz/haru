"use client"

import { useEffect } from "react"

// Registers the push service worker on every page load, unconditionally --
// this only wires up the worker so it exists when the user later opts in
// to notifications from /notifications. It never itself prompts for
// Notification permission (that's a deliberate user action, not a page-load
// side effect).
export function ServiceWorkerRegister() {
  useEffect(() => {
    if (typeof window === "undefined" || !("serviceWorker" in navigator)) return
    navigator.serviceWorker.register("/sw.js").catch(() => {})

    // The installed PWA can sit backgrounded across a Vercel deploy and never notice -- there's
    // no navigation to trigger Next's own client-side update check while it's just resuming
    // from the background, and page/component code changes far more often than sw.js's own
    // bytes do, so the browser's built-in SW update check (keyed on sw.js changing) wouldn't
    // catch most deploys anyway. Comparing this bundle's own baked-in build id against whatever
    // the server is actually running right now, whenever the tab comes back to the foreground,
    // catches it directly and reloads once to pick it up.
    let reloaded = false
    async function checkForUpdate() {
      if (document.visibilityState !== "visible" || reloaded) return
      try {
        const res = await fetch("/api/build-id", { cache: "no-store" })
        const { buildId } = await res.json()
        if (buildId && buildId !== process.env.NEXT_PUBLIC_BUILD_ID) {
          reloaded = true
          window.location.reload()
        }
      } catch {
        // Offline or the request failed -- nothing to do differently than staying on the
        // current, still-working bundle.
      }
    }
    document.addEventListener("visibilitychange", checkForUpdate)
    window.addEventListener("pageshow", checkForUpdate)

    return () => {
      document.removeEventListener("visibilitychange", checkForUpdate)
      window.removeEventListener("pageshow", checkForUpdate)
    }
  }, [])

  return null
}
