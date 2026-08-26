"use client"

import { useEffect, useRef, useState, type ReactNode } from "react"
import { Portal } from "@/app/components/Portal"

// TEMPORARY -- overflow:hidden + overscroll-behavior:none (the fix that
// closed the standalone-PWA viewport-shrink bug) turned out to only
// cover touch-drag scroll-chaining, not a separate iOS quirk: focusing a
// text input inside the sheet can still make iOS scroll the page BEHIND
// it into view, since that native "scroll focused element into view"
// behavior is known to bypass a plain `overflow: hidden` on iOS Safari
// -- position:fixed on body used to block this as a side effect, which
// is exactly why removing it reopened it. This build locks
// `document.documentElement` (<html>) with position:fixed instead of
// `document.body` -- same "remove it from flow, nothing to scroll"
// reliability, but confirmed-different element than the one that caused
// the viewport shrink. Needs on-device confirmation on both counts
// (button position AND no background-scroll-on-focus) before this
// readout comes out.
const BUILD_TAG = "sheet-debug-13"

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

  // TEMPORARY -- see BUILD_TAG comment above.
  useEffect(() => {
    function update() {
      const rect = panelRef.current?.getBoundingClientRect()
      setDebugInfo(`${BUILD_TAG} innerH:${window.innerHeight} panelBottom:${rect?.bottom.toFixed(0) ?? "?"}`)
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

  // TEMPORARY -- locks <html> instead of <body> this round, see BUILD_TAG
  // comment above. Locks the page behind the sheet from scrolling while
  // it's open, including iOS's native "scroll the focused input into
  // view" behavior when a text field inside the sheet gets focus (a
  // plain overflow:hidden doesn't reliably stop either on iOS Safari --
  // touch-dragging the backdrop, or that focus behavior). Each Sheet
  // captures/restores whatever was already on the element when it
  // mounted, not a hardcoded default, so this nests correctly when a
  // picker sheet (loan, type) opens on top of this one -- the inner
  // one's cleanup just hands back the outer one's own locked state.
  useEffect(() => {
    const scrollY = window.scrollY
    const el = document.documentElement
    const previous = {
      position: el.style.position,
      top: el.style.top,
      left: el.style.left,
      right: el.style.right,
      width: el.style.width,
      overflow: el.style.overflow
    }

    el.style.position = "fixed"
    el.style.top = `-${scrollY}px`
    el.style.left = "0"
    el.style.right = "0"
    el.style.width = "100%"
    el.style.overflow = "hidden"

    return () => {
      el.style.position = previous.position
      el.style.top = previous.top
      el.style.left = previous.left
      el.style.right = previous.right
      el.style.width = previous.width
      el.style.overflow = previous.overflow
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
          inside of -- a bottom sheet used to be structured as a full-
          height `fixed` wrapper with the panel `absolute bottom:0`
          inside it, but nesting it that way meant the panel's floor was
          always wherever the wrapper's own bottom edge landed, which was
          short of the real screen in the installed home-screen app. No
          backdrop-blur -- `backdrop-filter` combined with `position:
          fixed` is a known WebKit bug on iOS (confirmed on a sibling
          app's bottom nav, same combination) where the element's
          compositing goes wrong, independent of its actual DOM box --
          layout stays correct but the paint doesn't. bg-black/80 is opaque
          enough on its own. */}
      <div
        className={`fixed inset-0 z-50 bg-black/80 transition-opacity duration-200 ${
          open ? "opacity-100" : "opacity-0"
        }`}
        onClick={handleClose}
      />
      {/* Its own independent `position: fixed; bottom: 0` element, not
          `absolute` inside a full-height wrapper -- see the comment on
          the backdrop above. */}
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
