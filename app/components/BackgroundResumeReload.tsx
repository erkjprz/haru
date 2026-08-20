"use client"

import { useEffect } from "react"

// After the installed PWA sits backgrounded long enough, iOS tears down its
// network connections without telling any in-flight or freshly-issued
// fetch() about it -- data fetches then hang forever with no error, and the
// only thing that's reliably fixed it is a full reload (same as
// PullToRefresh's manual one). Do that automatically on return instead of
// leaving the app stuck on loading skeletons until the user notices and
// pulls to refresh themselves.
const BACKGROUND_RELOAD_THRESHOLD_MS = 5 * 60 * 1000

export function BackgroundResumeReload() {
  useEffect(() => {
    let hiddenAt: number | null = null

    function onVisibilityChange() {
      if (document.visibilityState === "hidden") {
        hiddenAt = Date.now()
        return
      }

      if (hiddenAt !== null && Date.now() - hiddenAt >= BACKGROUND_RELOAD_THRESHOLD_MS) {
        window.location.reload()
        return
      }

      hiddenAt = null
    }

    document.addEventListener("visibilitychange", onVisibilityChange)
    return () => document.removeEventListener("visibilitychange", onVisibilityChange)
  }, [])

  return null
}
