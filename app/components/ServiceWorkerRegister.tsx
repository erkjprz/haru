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
  }, [])

  return null
}
