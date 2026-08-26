"use client"

import { useEffect, useRef, useState, type ReactNode } from "react"
import { Portal } from "@/app/components/Portal"

// TEMPORARY -- the on-device readout showed vpH/innerH pinned at 793
// against a screen height of 852, with the panel exactly filling that
// 793px and clipped:false -- i.e. our own JS-measured "viewport" is
// genuinely 59px short of the physical screen, not a clipping bug. A
// side-by-side against another installed PWA (Budget) shows its own
// sheet's Save button sitting flush near the true bottom, well past
// where our 793px figure would allow. That app isn't fighting iOS for
// those 59px with JS the way this one was -- it's plain CSS. `dvh` is
// WebKit's own purpose-built unit for exactly this (a live-tracking
// viewport height, safe-area aware with viewport-fit=cover already set
// in layout.tsx), and visualViewport.height/innerHeight are a JS-side
// figure that on iOS standalone PWAs can under-report versus what CSS
// dvh resolves to. So this build drops the JS-measured inline height
// override entirely and goes back to trusting h-dvh/max-h-[92dvh]
// (pure CSS) the whole way. Remove this readout once a fresh on-device
// screenshot confirms the panel now reaches the true bottom.
const BUILD_TAG = "sheet-debug-4"

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
      setDebugInfo(
        `${BUILD_TAG} scrH:${window.screen.height} innerH:${window.innerHeight} ` +
          `standalone:${window.matchMedia("(display-mode: standalone)").matches} ` +
          `panelBottom:${rect?.bottom.toFixed(0) ?? "?"} clipped:${rect ? rect.bottom > window.innerHeight : "?"}`
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
      {/* top-0 + h-dvh instead of inset-0 -- iOS Safari can size a fixed
          element's containing block against the toolbar-hidden layout
          viewport, which is taller than what's actually visible while the
          toolbar is showing, so inset-0's implied 0-to-0 span can reach
          past the real visible bottom edge. `dvh` tracks the real,
          currently-visible viewport live (that's its whole purpose), so
          no JS-measured pixel override on top of it -- see BUILD_TAG
          comment above for why that override was actually the bug. */}
      <div className="fixed top-0 left-0 right-0 h-dvh z-50">
        {/* No backdrop-blur -- `backdrop-filter` combined with
            `position: fixed` is a known WebKit bug on iOS (confirmed on a
            sibling app's bottom nav, same combination) where the element's
            compositing goes wrong, independent of its actual DOM box --
            layout stays correct but the paint doesn't, which matches how
            no amount of resizing/repositioning this panel ever changed
            what rendered. bg-black/80 is opaque enough on its own. */}
        <div
          className={`absolute inset-0 bg-black/80 transition-opacity duration-200 ${
            open ? "opacity-100" : "opacity-0"
          }`}
          onClick={handleClose}
        />
        <div
          ref={panelRef}
          className={`absolute left-0 right-0 bottom-0 max-h-[92dvh] flex flex-col bg-paper-2 border-t border-hairline rounded-t-2xl overflow-hidden shadow-xl transition-transform duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] ${
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
      </div>
    </Portal>
  )
}
