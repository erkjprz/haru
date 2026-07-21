"use client"

import { usePathname, useRouter } from "next/navigation"
import { useAuth } from "@/app/auth-context"

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

  // The transaction forms have their own sticky Amount/Save footer -- a
  // second fixed bar at the bottom would stack on top of it.
  const hideDock =
    pathname === "/transactions/new" || (pathname.startsWith("/transactions/") && pathname.endsWith("/edit"))

  const onNewTransactionPage = pathname.startsWith("/transactions/new")

  // Everything that doesn't get its own docked tab still lives somewhere
  // -- on the Menu page -- so Menu reads as "active" while browsing any of
  // it, the same way Transactions stays active on a transaction's own
  // pages even though there's no separate "Transactions" sub-route tab.
  const MENU_OWNED_PREFIXES = ["/menu", "/account", "/help", "/investment", "/bank", "/loans", "/member-breakdown"]

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
      {/* "+ New" lives in the same sticky bar as the wordmark now, instead
          of being separately `fixed` -- two independently-positioned
          elements could drift out of sync during scroll/bounce on mobile;
          one flex row can't. */}
      <nav className="border-b border-hairline bg-paper sticky top-0 z-40">
        <div className="flex items-center justify-between px-5 py-4 max-w-3xl mx-auto">
          <span className="text-[11px] tracking-[0.18em] uppercase text-gold font-mono">
            Est. 2017
          </span>
          {!onNewTransactionPage && (
            <button
              onClick={() => router.push("/transactions/new")}
              aria-label="New Transaction"
              className="bg-gold text-ink px-4 py-2 rounded-sm text-sm font-semibold shadow-sm hover:opacity-90 transition-opacity flex items-center gap-1.5"
            >
              <span className="text-lg leading-none">+</span>
              New
            </button>
          )}
        </div>
      </nav>

      {!hideDock && (
        <nav
          className="fixed bottom-0 left-0 right-0 z-40 bg-paper border-t border-hairline"
          // iOS Safari can flicker/hide a `fixed` element mid-touch-drag
          // (e.g. swiping Fund Breakdown's member carousel while this dock
          // sits over a scrollable page) unless it's promoted to its own
          // GPU compositing layer -- translateZ(0) forces that.
          style={{ paddingBottom: "env(safe-area-inset-bottom)", transform: "translateZ(0)", willChange: "transform" }}
        >
          <div className="max-w-3xl mx-auto flex items-stretch" style={{ height: "var(--dock-h)" }}>
            {dockItems.map((item) => {
              const active = isActive(item)
              const Icon = item.icon
              return (
                <button
                  key={item.label}
                  onClick={() => router.push(item.path)}
                  className={`flex-1 flex flex-col items-center justify-center gap-1 transition-colors ${
                    active ? "text-gold" : "text-ink-soft"
                  }`}
                >
                  <Icon active={active} />
                  <span className={`text-[10px] font-mono ${active ? "font-semibold" : ""}`}>{item.label}</span>
                </button>
              )
            })}
          </div>
        </nav>
      )}
    </>
  )
}
