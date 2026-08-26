"use client"

import { useEffect, useState, type ReactNode } from "react"
import { Portal } from "@/app/components/Portal"

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
  useEffect(() => {
    const raf = requestAnimationFrame(() => setOpen(true))
    return () => cancelAnimationFrame(raf)
  }, [])

  // `dvh` is still a CSS unit the browser has to calculate on its own, and
  // iOS's installed-home-screen-app display mode has real cases where that
  // calculation doesn't match the actual visible screen. `visualViewport`
  // is the browser's own live, JS-readable measurement of the same thing
  // it's the API iOS keeps accurate specifically because vh/dvh aren't
  // reliable enough here on their own -- so this measures directly instead
  // of trusting the CSS unit to get it right. Falls back to the h-dvh
  // class (still on the element below) if visualViewport isn't available
  // at all, or hasn't reported yet.
  const [viewportHeight, setViewportHeight] = useState<number | null>(null)
  useEffect(() => {
    const vv = window.visualViewport
    if (!vv) return
    function update() {
      setViewportHeight(vv!.height)
    }
    update()
    vv.addEventListener("resize", update)
    vv.addEventListener("scroll", update)
    return () => {
      vv.removeEventListener("resize", update)
      vv.removeEventListener("scroll", update)
    }
  }, [])

  // A Sheet mounts fresh on every open, not behind a route change --
  // Navbar's own page-level scroll-nudge (see its file comment on the
  // same iOS bug) only fires on navigation/resume, so it doesn't
  // necessarily run again for a sheet opened via local state mid-session.
  // Nudging here too forces iOS to recompute this sheet's own
  // `position: fixed` layout against the real current viewport. Has to
  // run before the body-lock effect below sets `overflow: hidden`, or
  // there's nothing left to actually scroll.
  useEffect(() => {
    window.scrollTo(0, 1)
    window.scrollTo(0, 0)
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
          past the real visible bottom edge. The inline height (once
          visualViewport has reported) overrides h-dvh with the actual
          measured pixel value -- see the hook above for why. */}
      <div
        className="fixed top-0 left-0 right-0 h-dvh z-50"
        style={viewportHeight ? { height: `${viewportHeight}px` } : undefined}
      >
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
          className={`absolute left-0 right-0 bottom-0 max-h-[92dvh] flex flex-col bg-paper-2 border-t border-hairline rounded-t-2xl overflow-hidden shadow-xl transition-transform duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] ${
            open ? "translate-y-0" : "translate-y-full"
          }`}
          style={viewportHeight ? { maxHeight: `${viewportHeight * 0.92}px` } : undefined}
        >
          <div className="w-9 h-1 rounded-full bg-hairline mx-auto mt-2.5 flex-shrink-0" />
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
              field after it's passed off the top of the view. */}
          <div className="flex-1 overflow-y-auto overscroll-contain px-4 pb-4">{children}</div>
          {footer && (
            <div
              className="px-4 pt-3 flex-shrink-0 border-t border-hairline"
              style={{ paddingBottom: "max(1rem, calc(env(safe-area-inset-bottom) + 0.5rem))" }}
            >
              {footer}
            </div>
          )}
        </div>
      </div>
    </Portal>
  )
}
