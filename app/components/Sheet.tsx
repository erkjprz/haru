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

  // Locks the page behind the sheet from scrolling while it's open --
  // overflow:hidden alone can still let a touch-drag on the backdrop
  // chain into scrolling the page underneath on iOS Safari, so
  // overscroll-behavior:none backs it up. Deliberately NOT `position:
  // fixed`: setting the page root to position:fixed while the sheet is
  // open (tried on both document.body and document.documentElement)
  // makes WebKit recompute a visualViewport ~59px shorter than the real
  // screen in the installed home-screen app -- confirmed on-device on
  // both elements. A sibling app's own sheet never touches the page
  // root's position at all and never had the bug.
  //
  // Known remaining gap: iOS's native "scroll the focused input into
  // view" behavior can still scroll the page behind the sheet when a
  // text field inside it gets focus -- overflow:hidden doesn't reliably
  // block that specific behavior the way position:fixed used to (as a
  // side effect, at the cost of the viewport bug above). Toast.tsx was
  // moved to a top anchor to keep that glitch from landing right where
  // a bottom-anchored toast used to appear; the underlying scroll-on-
  // focus behavior itself is still open.
  //
  // Each Sheet captures/restores whatever was already on body when it
  // mounted, not a hardcoded default, so this nests correctly when a
  // picker sheet (loan, type) opens on top of this one -- the inner
  // one's cleanup just hands back the outer one's own locked state.
  useEffect(() => {
    const body = document.body
    const previous = {
      overflow: body.style.overflow,
      overscrollBehavior: body.style.overscrollBehavior
    }

    body.style.overflow = "hidden"
    body.style.overscrollBehavior = "none"

    return () => {
      body.style.overflow = previous.overflow
      body.style.overscrollBehavior = previous.overscrollBehavior
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
        className={`fixed left-0 right-0 bottom-0 z-50 max-h-[92dvh] flex flex-col bg-paper-2 border-t border-hairline rounded-t-2xl overflow-hidden shadow-xl transition-transform duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] ${
          open ? "translate-y-0" : "translate-y-full"
        }`}
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
