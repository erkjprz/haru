"use client"

import { useEffect, useRef, useState, type ReactNode } from "react"
import { Portal } from "@/app/components/Portal"

// TEMPORARY -- decoupling the panel from its wrapper (previous build)
// made no difference at all: panelBottom was still exactly 793, same as
// every other technique tried (visualViewport, dvh, svh, screen.height,
// edge-anchoring). That's now six different ways of sizing/anchoring a
// `position: fixed` element, all landing on the identical number -- this
// isn't a technique problem, `position: fixed` itself appears to have a
// hard paint ceiling at 793 in this exact device/standalone context,
// full stop.
//
// Before guessing at a seventh technique, this build adds a real
// diagnostic instead: docH/bodyH read `document.documentElement` and
// `document.body`'s own rendered heights (unaffected by fixed-position
// compositing), and absProbeBottom measures where a plain
// `position: absolute; bottom: 0` element resolves when appended
// directly to `<html>` (bypassing `<body>`, which our own scroll-lock
// effect makes `position: fixed` while the sheet is open, so testing
// against body would just inherit body's own potential cap). If docH/
// absProbeBottom read ~852, the *document* isn't capped -- only
// `position: fixed`'s own containing-block math is -- and the real fix
// is to stop using `position: fixed` for the panel, since body is
// already scroll-locked while the sheet is open anyway, so fixed's
// viewport-pinning behavior isn't even needed here. If they also read
// ~793, the whole page is capped in this context, matching the sibling
// app's root-layout finding, and the fix has to be more structural.
// Remove this readout once we know which one it is and have shipped
// the real fix.
const BUILD_TAG = "sheet-debug-7"

// Generic bottom sheet -- backdrop + slide-up panel, mounted closed and
// opened a tick later so the transform actually has a starting point to
// animate away from (otherwise the browser paints it already-open and
// there's nothing to transition). Close button/backdrop tap play the same
// slide-down-then-unmount transition; a child's own action (e.g. a form's
// Submit) closes by calling onClose directly instead, so it just
// disappears immediately rather than replaying this animation.
export function Sheet({
  title,
  onClose,
  children,
  footer
}: {
  title: string
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
}) {
  const [open, setOpen] = useState(false)
  const panelRef = useRef<HTMLDivElement>(null)
  const [debugInfo, setDebugInfo] = useState("")
  useEffect(() => {
    const raf = requestAnimationFrame(() => setOpen(true))
    return () => cancelAnimationFrame(raf)
  }, [])

  // A Sheet mounts fresh on every open, not behind a route change --
  // Navbar's own page-level scroll-nudge (see its file comment on the
  // same iOS bug) only fires on navigation/resume, so it doesn't
  // necessarily run again for a sheet opened via local state mid-session.
  // Nudging here too forces iOS to recompute this sheet's own
  // `position: fixed` layout against the real current viewport. Declared
  // (and so committed) before the visualViewport measurement below, so
  // that measurement reads the just-nudged layout instead of racing it.
  // Has to run before the body-lock effect further down sets `overflow:
  // hidden`, or there's nothing left to actually scroll.
  useEffect(() => {
    window.scrollTo(0, 1)
    window.scrollTo(0, 0)
  }, [])

  // TEMPORARY -- see BUILD_TAG comment above. No more JS-measured height
  // state to key off of; this just samples the same numbers once layout
  // has settled so a device screenshot can compare CSS dvh's actual
  // paintable result against the old 793 figure.
  useEffect(() => {
    function update() {
      const rect = panelRef.current?.getBoundingClientRect()

      // Appended directly to <html>, not <body> -- see BUILD_TAG comment
      // above for why body itself isn't a clean control here.
      const probe = document.createElement("div")
      probe.style.position = "absolute"
      probe.style.left = "0"
      probe.style.bottom = "0"
      probe.style.width = "1px"
      probe.style.height = "1px"
      probe.style.pointerEvents = "none"
      probe.style.opacity = "0"
      document.documentElement.appendChild(probe)
      const absProbeBottom = probe.getBoundingClientRect().bottom
      document.documentElement.removeChild(probe)

      setDebugInfo(
        `${BUILD_TAG} scrH:${window.screen.height} innerH:${window.innerHeight} ` +
          `standalone:${window.matchMedia("(display-mode: standalone)").matches} ` +
          `panelBottom:${rect?.bottom.toFixed(0) ?? "?"} clipped:${rect ? rect.bottom > window.innerHeight : "?"} ` +
          `docH:${document.documentElement.getBoundingClientRect().height.toFixed(0)} ` +
          `bodyH:${document.body.getBoundingClientRect().height.toFixed(0)} ` +
          `absProbeBottom:${absProbeBottom.toFixed(0)}`
      )
    }
    update()
    const raf = requestAnimationFrame(update)
    const t = setTimeout(update, 500)
    window.addEventListener("resize", update)
    return () => {
      cancelAnimationFrame(raf)
      clearTimeout(t)
      window.removeEventListener("resize", update)
    }
  }, [])

  // Locks the page behind the sheet from scrolling while it's open. A
  // plain `overflow: hidden` on body doesn't reliably stop it on iOS
  // Safari (a well-known quirk -- touch-scrolling the backdrop can still
  // drag the page underneath), so this pins body in place with `position:
  // fixed` instead and restores the exact scroll position on close. Each
  // Sheet captures/restores whatever was already on body when it mounted,
  // not a hardcoded default, so this nests correctly when a picker sheet
  // (loan, type) opens on top of this one -- the inner one's cleanup just
  // hands back the outer one's own locked state, not real scroll.
  useEffect(() => {
    const scrollY = window.scrollY
    const body = document.body
    const previous = {
      position: body.style.position,
      top: body.style.top,
      left: body.style.left,
      right: body.style.right,
      overflow: body.style.overflow
    }

    body.style.position = "fixed"
    body.style.top = `-${scrollY}px`
    body.style.left = "0"
    body.style.right = "0"
    body.style.overflow = "hidden"

    return () => {
      body.style.position = previous.position
      body.style.top = previous.top
      body.style.left = previous.left
      body.style.right = previous.right
      body.style.overflow = previous.overflow
      window.scrollTo(0, scrollY)
    }
  }, [])

  function handleClose() {
    setOpen(false)
    setTimeout(onClose, 200)
  }

  return (
    <Portal>
      {/* Its own full-screen fixed layer, not a wrapper the panel sits
          inside of -- see BUILD_TAG comment above for why that nesting was
          the actual bug. No backdrop-blur -- `backdrop-filter` combined
          with `position: fixed` is a known WebKit bug on iOS (confirmed on
          a sibling app's bottom nav, same combination) where the element's
          compositing goes wrong, independent of its actual DOM box --
          layout stays correct but the paint doesn't. bg-black/80 is opaque
          enough on its own. */}
      <div
        className={`fixed inset-0 z-50 bg-black/80 transition-opacity duration-200 ${
          open ? "opacity-100" : "opacity-0"
        }`}
        onClick={handleClose}
      />
      {/* Its own independent `position: fixed; bottom: 0` element (not
          `absolute` inside a full-height wrapper) -- see BUILD_TAG comment
          above. */}
      <div
        ref={panelRef}
        className={`fixed left-0 right-0 bottom-0 z-50 max-h-[92dvh] flex flex-col bg-paper-2 border-t border-hairline rounded-t-2xl overflow-hidden shadow-xl transition-transform duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] ${
          open ? "translate-y-0" : "translate-y-full"
        }`}
      >
        <div className="w-9 h-1 rounded-full bg-hairline mx-auto mt-2.5 flex-shrink-0" />
        <div className="text-[9px] font-mono text-rust text-center flex-shrink-0 break-all px-1">{debugInfo}</div>
        <div className="relative flex items-center justify-center px-4 pt-3 pb-4 flex-shrink-0">
          <h2 className="font-display text-lg font-medium text-ink">{title}</h2>
          <button
            type="button"
            onClick={handleClose}
            aria-label="Close"
            className="absolute right-4 w-8 h-8 rounded-full bg-ink text-paper flex items-center justify-center text-lg leading-none"
          >
            ×
          </button>
        </div>
        {/* overscroll-contain stops scroll chaining: without it, dragging
            past the top/bottom of this list on a touch device hands the
            rest of the gesture to whatever's behind it (the backdrop, the
            locked page), which can register as the tap that closes the
            sheet mid-scroll -- e.g. scrolling back up to reach the Amount
            field after it's passed off the top of the view. min-h-0 is
            load-bearing here, not decorative -- a flex child with
            overflow-y-auto defaults its minimum height to its own
            content size (a WebKit quirk), not 0, which can push this
            panel's flex column past its own max-height cap and squeeze
            the footer below out from under `overflow-hidden` on the
            panel, clipping the Submit/Save button even though the
            numbers on paper say everything should fit. */}
        <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-4 pb-4">{children}</div>
        {footer && (
          <div
            className="px-4 pt-3 flex-shrink-0 border-t border-hairline"
            style={{ paddingBottom: "max(1rem, env(safe-area-inset-bottom))" }}
          >
            {footer}
          </div>
        )}
      </div>
    </Portal>
  )
}
