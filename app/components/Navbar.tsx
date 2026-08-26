"use client"

import { useEffect, useRef, useState } from "react"
import { usePathname, useRouter } from "next/navigation"
import { useAuth } from "@/app/auth-context"
import { NotificationBell } from "@/app/components/NotificationBell"
import { NewTransactionSheet } from "@/app/components/NewTransactionSheet"
import { Toast } from "@/app/components/Toast"
import { notifyTransactionsChanged } from "@/lib/transactionEvents"

// Same reduced fraction budget-tracker's BottomNav uses -- a floating pill
// inset from the edge only needs a little clearance from the home
// indicator, not the device's full safe-area inset (which is sized for an
// edge-to-edge bar).
const DOCK_OFFSET = "calc(env(safe-area-inset-bottom) * 0.4)"

function IconHome({ active }: { active: boolean }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={active ? 2.25 : 1.75} className="w-[22px] h-[22px]">
      <path d="M4 11l8-7 8 7v8a2 2 0 01-2 2H6a2 2 0 01-2-2v-8z" />
    </svg>
  )
}

function IconTransactions({ active }: { active: boolean }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={active ? 2.25 : 1.75} className="w-[22px] h-[22px]">
      <path d="M4 7h16M4 12h16M4 17h10" strokeLinecap="round" />
    </svg>
  )
}

function IconBreakdown({ active }: { active: boolean }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={active ? 2.25 : 1.75} className="w-[22px] h-[22px]">
      <path d="M12 2a10 10 0 100 20 10 10 0 000-20z" />
      <path d="M12 2v10l7 7" />
    </svg>
  )
}

function IconAdmin({ active }: { active: boolean }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={active ? 2.25 : 1.75} className="w-[22px] h-[22px]">
      <path d="M12 2l8 4v6c0 5-3.5 8.5-8 10-4.5-1.5-8-5-8-10V6l8-4z" />
    </svg>
  )
}

function IconMenu({ active }: { active: boolean }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={active ? 2.25 : 1.75} className="w-[22px] h-[22px]">
      <rect x="4" y="4" width="7" height="7" rx="1.5" />
      <rect x="13" y="4" width="7" height="7" rx="1.5" />
      <rect x="4" y="13" width="7" height="7" rx="1.5" />
      <rect x="13" y="13" width="7" height="7" rx="1.5" />
    </svg>
  )
}

type DockItem = {
  label: string
  path: string
  icon: (props: { active: boolean }) => React.ReactNode
  // Highlights this tab for any page "owned" by it, not just an exact
  // match -- e.g. Transactions stays highlighted on its own detail pages.
  activeWhen?: (pathname: string) => boolean
}

export default function Navbar() {
  const router = useRouter()
  const pathname = usePathname()
  const { member } = useAuth()
  const isAdmin = member?.role === "admin"
  const navRef = useRef<HTMLElement>(null)
  const barRef = useRef<HTMLDivElement>(null)
  const fabRef = useRef<HTMLButtonElement>(null)
  const [sheetOpen, setSheetOpen] = useState(false)
  const [toast, setToast] = useState<string | null>(null)

  // The transaction forms have their own sticky Amount/Save footer -- a
  // second fixed bar at the bottom would stack on top of it. The FAB (which
  // replaced the header's "+ New" button) shares this same guard, since it
  // sits right above the dock and would collide with that same footer.
  const hideDock =
    pathname === "/transactions/new" || (pathname.startsWith("/transactions/") && pathname.endsWith("/edit"))

  // Pages reserve bottom padding (--dock-h) to clear whichever floating
  // element sticks up furthest from the bottom edge -- the FAB floats above
  // the pill (see its own `bottom` below) and is taller than the pill
  // overall, so whenever it's showing, it -- not the pill -- is what a page
  // needs to clear. Measured (not hardcoded) so existing pages' padding
  // stays correct without every one of them needing its own update.
  useEffect(() => {
    // Measures actual rendered box edges rather than re-deriving the pill's
    // safe-area padding/gap/height arithmetic by hand -- correct regardless
    // of how any of those are expressed (env(), calc(), rem) and however
    // they change.
    function update() {
      const tops = [barRef.current?.getBoundingClientRect().top, fabRef.current?.getBoundingClientRect().top].filter(
        (t): t is number => t != null
      )
      if (tops.length === 0) return
      document.documentElement.style.setProperty("--dock-h", `${window.innerHeight - Math.min(...tops)}px`)
    }
    update()
    const observers = [barRef.current, fabRef.current]
      .filter((el): el is HTMLDivElement | HTMLButtonElement => !!el)
      .map((el) => {
        const o = new ResizeObserver(update)
        o.observe(el)
        return o
      })
    window.addEventListener("resize", update)
    return () => {
      observers.forEach((o) => o.disconnect())
      window.removeEventListener("resize", update)
    }
  }, [hideDock])

  // iOS can leave a `position: fixed` element positioned against a stale
  // layout viewport on a page too short to ever scroll on its own (a
  // loading screen, a short list) -- WebKit only recomputes fixed-position
  // layout in response to an actual scroll event, which a non-scrollable
  // page never fires. Nudging the scroll position by a pixel and
  // immediately back forces that recompute regardless of whether this
  // particular page happens to be tall enough to scroll by itself (see
  // layout.tsx's spacer div, which guarantees it always has somewhere to
  // nudge into). Fires on every navigation (below), and also on resuming
  // from the background (screen lock, app switch, home-screen icon
  // relaunch without a full process kill) -- a case with no route change
  // at all, but the same layout can just as easily go stale across it.
  useEffect(() => {
    function nudge() {
      window.scrollTo(0, 1)
      requestAnimationFrame(() => window.scrollTo(0, 0))
    }
    function onVisible() {
      if (document.visibilityState === "visible") nudge()
    }
    document.addEventListener("visibilitychange", onVisible)
    window.addEventListener("pageshow", nudge)
    return () => {
      document.removeEventListener("visibilitychange", onVisible)
      window.removeEventListener("pageshow", nudge)
    }
  }, [])

  useEffect(() => {
    window.scrollTo(0, 1)
    requestAnimationFrame(() => window.scrollTo(0, 0))
  }, [pathname])

  // Everything that doesn't get its own docked tab still lives somewhere
  // -- on the Menu page -- so Menu reads as "active" while browsing any of
  // it, the same way Transactions stays active on a transaction's own
  // pages even though there's no separate "Transactions" sub-route tab.
  const MENU_OWNED_PREFIXES = ["/menu", "/account", "/help"]

  const dockItems: DockItem[] = [
    { label: "Dashboard", path: "/dashboard", icon: IconHome },
    { label: "Transactions", path: "/transactions", icon: IconTransactions },
    { label: "Breakdown", path: "/fund-breakdown", icon: IconBreakdown },
    ...(isAdmin ? [{ label: "Admin", path: "/admin", icon: IconAdmin } as DockItem] : []),
    {
      label: "Menu",
      path: "/menu",
      icon: IconMenu,
      activeWhen: (p) => MENU_OWNED_PREFIXES.some((prefix) => p === prefix || p.startsWith(prefix + "/"))
    }
  ]

  function isActive(item: DockItem) {
    if (item.activeWhen) return item.activeWhen(pathname)
    return pathname === item.path || pathname.startsWith(item.path + "/")
  }

  return (
    <>
      {/* Installed on iOS with statusBarStyle "black-translucent" (see
          layout.tsx), the status bar overlays web content instead of
          reserving its own space -- without this top safe-area padding,
          the clock/signal/battery icons render on top of this bar's own
          content instead of above it. */}
      <nav className="border-b border-hairline bg-paper sticky top-0 z-40" style={{ paddingTop: "env(safe-area-inset-top)" }}>
        <div className="flex items-center justify-between px-5 py-4 max-w-3xl mx-auto">
          <button
            onClick={() => router.push("/dashboard")}
            className="text-[11px] tracking-[0.18em] uppercase text-gold font-mono"
          >
            Est. 2017
          </button>
          <NotificationBell />
        </div>
      </nav>

      {!hideDock && (
        <nav ref={navRef} className="fixed inset-x-0 bottom-0 z-40" style={{ paddingBottom: DOCK_OFFSET }}>
          <div className="relative max-w-3xl mx-auto px-4">
            <div
              ref={barRef}
              // No backdrop-blur here -- `backdrop-filter` combined with
              // `position: fixed` is a known WebKit bug on iOS where the
              // element visually detaches and lags behind during momentum
              // scrolling, snapping back into place once scrolling settles.
              // bg-paper-2 is opaque enough on its own that the blur wasn't
              // adding much.
              className="flex items-stretch bg-paper-2 border border-hairline rounded-full shadow-lg px-1.5 py-1"
              // iOS Safari can flicker/hide a `fixed` element mid-touch-drag
              // (e.g. swiping Fund Breakdown's member carousel while this
              // dock sits over a scrollable page) unless it's promoted to
              // its own GPU compositing layer -- translateZ(0) forces that.
              style={{ transform: "translateZ(0)", willChange: "transform" }}
            >
              {dockItems.map((item) => {
                const active = isActive(item)
                const Icon = item.icon
                return (
                  <button
                    key={item.label}
                    onClick={() => router.push(item.path)}
                    className={`flex-1 flex flex-col items-center gap-0.5 py-1.5 rounded-full transition-colors ${
                      active ? "bg-gold/10" : ""
                    }`}
                  >
                    <Icon active={active} />
                    <span className={`text-[10px] font-mono ${active ? "text-gold font-semibold" : "text-ink-soft"}`}>
                      {item.label}
                    </span>
                  </button>
                )
              })}
            </div>

            {/* Replaces the old header "+ New" button -- floats above the
                pill (rather than beside it) so it reads as the one
                emphasized action, not just another dock tab. Gold is
                already this page's everywhere-accent (active tab, filter
                border, chips), so a gold FAB read as just one more gold
                thing instead of standing out -- bg-ink/text-paper plus a
                gold glow is the same "primary action" language every
                submit button elsewhere in the app already uses. Opens the
                quick-entry sheet in place rather than navigating -- the
                full /transactions/new page is still there for the rarer
                admin-only entry types, reachable from Admin > Members or a
                Dashboard shortcut same as before. */}
            <button
              ref={fabRef}
              onClick={() => setSheetOpen(true)}
              aria-label="New Transaction"
              className="absolute right-4 w-14 h-14 rounded-full bg-ink text-paper flex items-center justify-center shadow-lg shadow-gold/30 ring-1 ring-gold/40"
              style={{ bottom: "calc(100% + 0.5rem)", transform: "translateZ(0)", willChange: "transform" }}
            >
              <span className="text-3xl leading-none font-light">+</span>
            </button>
          </div>
        </nav>
      )}

      {sheetOpen && (
        <NewTransactionSheet
          onClose={() => setSheetOpen(false)}
          onSaved={(saveMessage) => {
            setSheetOpen(false)
            setToast(saveMessage)
            notifyTransactionsChanged()
          }}
        />
      )}

      {toast && <Toast message={toast} onDone={() => setToast(null)} />}
    </>
  )
}
