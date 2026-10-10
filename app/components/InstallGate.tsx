"use client"

import { useEffect, useState, useSyncExternalStore } from "react"
import { usePathname } from "next/navigation"
import { useAuth } from "@/app/auth-context"
import {
  clearDeferredPrompt,
  dismissGate,
  getDeferredPrompt,
  isAndroid,
  isGateDismissed,
  isInAppBrowser,
  isIOS,
  iosBrowser,
  isStandalone,
  subscribeToInstallState,
  wasInstalledThisSession
} from "@/lib/pwa"

// Only the signed-out entry points. On iOS a Home Screen app keeps its own
// login, separate from Safari's, so offering install *before* sign-in means
// people only ever sign in once -- inside the installed app. Signed-in
// browser visits are left to PwaOnboardingSheet, and links people arrive on
// from email (/reset-password, /forgot-password) are never covered.
const GATED_ON = ["/login", "/signup"]

function noopSubscribe() {
  return () => {}
}

type Variant = "ios" | "android" | "in-app"

function pickVariant(): Variant | null {
  if (isStandalone() || isGateDismissed()) return null
  if (isInAppBrowser()) return "in-app"
  if (isIOS()) return "ios"
  if (isAndroid()) return "android"
  // Desktop: installing is optional there, so no gate at all.
  return null
}

function IconShare({ className = "w-[17px] h-[17px]" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={`inline -mt-0.5 text-gold ${className}`} aria-hidden="true">
      <path d="M12 3v12M7 8l5-5 5 5M5 13v6a2 2 0 002 2h10a2 2 0 002-2v-6" />
    </svg>
  )
}

function IconAddSquare() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="inline -mt-0.5 w-[17px] h-[17px] text-gold" aria-hidden="true">
      <rect x="3" y="3" width="18" height="18" rx="4" />
      <path d="M12 8v8M8 12h8" />
    </svg>
  )
}

function IconDots() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className="inline -mt-0.5 w-[17px] h-[17px] text-gold" aria-hidden="true">
      <circle cx="5" cy="12" r="2" />
      <circle cx="12" cy="12" r="2" />
      <circle cx="19" cy="12" r="2" />
    </svg>
  )
}

function IconKebab() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className="inline -mt-0.5 w-[17px] h-[17px] text-gold" aria-hidden="true">
      <circle cx="12" cy="5" r="2" />
      <circle cx="12" cy="12" r="2" />
      <circle cx="12" cy="19" r="2" />
    </svg>
  )
}

function IconArrow({ up }: { up?: boolean }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" className={`w-[30px] h-[30px] motion-safe:animate-bounce ${up ? "rotate-180" : ""}`} aria-hidden="true">
      <path d="M12 4v15M6 13l6 6 6-6" />
    </svg>
  )
}

function Step({ n, last, children }: { n: number; last?: boolean; children: React.ReactNode }) {
  return (
    <li className={`flex items-center gap-3.5 py-3.5 ${last ? "" : "border-b border-hairline"}`}>
      <span className="shrink-0 w-7 h-7 rounded-full bg-gold/15 text-gold font-bold text-sm flex items-center justify-center">{n}</span>
      <span className="text-[15px] leading-snug text-ink">{children}</span>
    </li>
  )
}

function Benefit({ icon, children, last }: { icon: React.ReactNode; children: React.ReactNode; last?: boolean }) {
  return (
    <li className={`flex items-center gap-3.5 py-3.5 ${last ? "" : "border-b border-hairline"}`}>
      <span className="shrink-0 text-gold">{icon}</span>
      <span className="text-[15px] leading-snug text-ink">{children}</span>
    </li>
  )
}

const primaryButton =
  "w-full min-h-[52px] bg-ink text-paper rounded-full text-base font-bold shadow-lg motion-safe:transition-transform motion-safe:active:scale-[0.97]"

export function InstallGate() {
  const { loading, user } = useAuth()
  const pathname = usePathname()
  const [dismissed, setDismissed] = useState(false)
  const [guiding, setGuiding] = useState(false)
  const [accepted, setAccepted] = useState(false)
  const [copied, setCopied] = useState(false)
  // Every input below (user agent, display mode, storage) is client-only:
  // false on the server and during hydration, so neither ever includes the
  // gate. Chrome's install prompt and appinstalled can also arrive well
  // after mount, so both are read through the same subscription.
  const hydrated = useSyncExternalStore(noopSubscribe, () => true, () => false)
  const prompt = useSyncExternalStore(subscribeToInstallState, getDeferredPrompt, () => null)
  const installedNow = useSyncExternalStore(subscribeToInstallState, wasInstalledThisSession, () => false)
  const installed = accepted || installedNow

  const eligible =
    hydrated &&
    !loading &&
    !user &&
    !dismissed &&
    GATED_ON.includes(pathname) &&
    // A failed confirmation link lands on /login with its reason in the
    // hash -- leave that explanation visible.
    !window.location.hash.includes("error_code=")
  const variant = eligible ? pickVariant() : null

  // The page underneath shouldn't scroll behind a full-screen cover.
  useEffect(() => {
    if (!variant) return
    const prev = document.body.style.overflow
    document.body.style.overflow = "hidden"
    return () => {
      document.body.style.overflow = prev
    }
  }, [variant])

  if (!variant) return null

  const browser = iosBrowser()
  // The guide only earns its place where it can point at the real button.
  const canGuide = variant === "android" || browser !== "other"

  function continueInBrowser() {
    dismissGate()
    setDismissed(true)
  }

  async function installAndroid() {
    if (!prompt) {
      setGuiding(true)
      return
    }
    await prompt.prompt()
    const { outcome } = await prompt.userChoice
    clearDeferredPrompt()
    if (outcome === "accepted") setAccepted(true)
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(window.location.origin + "/login")
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Clipboard blocked in some webviews -- the steps above still apply.
    }
  }

  let title: string
  let body: React.ReactNode
  let actions: React.ReactNode

  if (installed) {
    title = "You're all set"
    body = (
      <p className="mt-2.5 text-[15px] leading-relaxed text-ink-soft text-center max-w-[310px]">
        Open Est. 2017 from your home screen and sign in there.
      </p>
    )
    actions = (
      <button type="button" onClick={continueInBrowser} className="text-[15px] font-medium text-ink-soft px-5 py-3 min-h-[44px]">
        Continue in browser
      </button>
    )
  } else if (variant === "in-app") {
    title = "Open in your browser"
    body = (
      <>
        <p className="mt-2.5 text-[15px] leading-relaxed text-ink-soft text-center max-w-[320px]">
          This link opened inside another app, which can&apos;t install Est. 2017. Open it in Safari or Chrome to get the app.
        </p>
        <ol className="card mt-7 w-full px-[18px] py-1.5">
          <Step n={1}>
            Tap the <IconDots /> <strong>menu</strong> at the top or bottom of this screen
          </Step>
          <Step n={2} last>
            Choose <strong>Open in Safari</strong> or <strong>Open in browser</strong>
          </Step>
        </ol>
        <p className="mt-3.5 px-1 text-[13px] leading-normal text-ink-soft text-center">
          No menu? Copy the link and paste it into Safari or Chrome.
        </p>
      </>
    )
    actions = (
      <>
        <button
          type="button"
          onClick={copyLink}
          className="w-full min-h-[52px] bg-paper-2 text-ink border border-hairline rounded-full text-base font-bold flex items-center justify-center gap-2"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-[18px] h-[18px]" aria-hidden="true">
            <rect x="9" y="9" width="12" height="12" rx="2" />
            <path d="M5 15V5a2 2 0 012-2h10" />
          </svg>
          {copied ? "Copied" : "Copy link"}
        </button>
        <button type="button" onClick={continueInBrowser} className="mt-2.5 text-[15px] font-medium text-ink-soft px-5 py-3 min-h-[44px]">
          Continue here anyway
        </button>
      </>
    )
  } else if (variant === "ios") {
    title = "Add Est. 2017 to your Home Screen"
    body = (
      <>
        <p className="mt-2.5 text-[15px] leading-relaxed text-ink-soft text-center max-w-[310px]">
          It opens full-screen like any other app, and it&apos;s the only way to get alerts on iPhone.
        </p>
        <ol className="card mt-7 w-full px-[18px] py-1.5">
          <Step n={1}>
            {browser === "safari" ? (
              <>
                Tap <IconShare /> <strong>Share</strong>{" "}in Safari&apos;s toolbar
              </>
            ) : browser === "chrome" ? (
              <>
                Tap <IconShare /> <strong>Share</strong>{" "}in Chrome&apos;s address bar
              </>
            ) : (
              <>
                Tap your browser&apos;s <IconShare /> <strong>Share</strong> button
              </>
            )}
          </Step>
          <Step n={2}>
            Choose <IconAddSquare /> <strong>Add to Home Screen</strong>
          </Step>
          <Step n={3} last>
            Open it from your Home Screen and <strong>sign in there</strong>
          </Step>
        </ol>
        <p className="mt-3.5 px-1 text-[13px] leading-normal text-ink-soft text-center">
          The Home Screen app keeps its own login, separate from {browser === "safari" ? "Safari" : "your browser"}, so you&apos;ll only sign in once.
        </p>
      </>
    )
    actions = (
      <>
        {canGuide && (
          <button type="button" onClick={() => setGuiding(true)} className={primaryButton}>
            Show me how
          </button>
        )}
        <button type="button" onClick={continueInBrowser} className="mt-2.5 text-[15px] font-medium text-ink-soft px-5 py-3 min-h-[44px]">
          Continue in browser
        </button>
      </>
    )
  } else {
    title = "Install Est. 2017"
    body = (
      <>
        <p className="mt-2.5 text-[15px] leading-relaxed text-ink-soft text-center max-w-[310px]">
          Get the app on your home screen. It takes a couple of seconds.
        </p>
        <ul className="card mt-7 w-full px-[18px] py-1.5">
          <Benefit
            icon={
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-[22px] h-[22px]" aria-hidden="true">
                <rect x="6" y="2" width="12" height="20" rx="3" />
                <path d="M11 18h2" />
              </svg>
            }
          >
            Opens full-screen from your home screen
          </Benefit>
          <Benefit
            icon={
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-[22px] h-[22px]" aria-hidden="true">
                <path d="M6 8a6 6 0 0112 0c0 7 3 9 3 9H3s3-2 3-9" />
                <path d="M10.3 21a1.94 1.94 0 003.4 0" />
              </svg>
            }
          >
            Alerts when something needs your attention
          </Benefit>
          <Benefit
            last
            icon={
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-[22px] h-[22px]" aria-hidden="true">
                <path d="M13 2L4 14h7l-1 8 9-12h-7z" />
              </svg>
            }
          >
            Faster to open than a browser tab
          </Benefit>
        </ul>
      </>
    )
    actions = (
      <>
        {/* Chrome only hands over its install prompt once its own checks
            pass; until then the button walks through the menu instead. */}
        <button type="button" onClick={installAndroid} className={primaryButton}>
          {prompt ? "Install app" : "Show me how"}
        </button>
        <button type="button" onClick={continueInBrowser} className="mt-2.5 text-[15px] font-medium text-ink-soft px-5 py-3 min-h-[44px]">
          Continue in browser
        </button>
      </>
    )
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="install-gate-title"
      className="fixed inset-0 z-50 bg-paper overflow-y-auto font-sans"
    >
      <div className="min-h-full max-w-md mx-auto flex flex-col items-center px-6 pt-[calc(env(safe-area-inset-top)+64px)] pb-[calc(env(safe-area-inset-bottom)+28px)]">
        <img
          src="/icons/icon-192.png"
          alt=""
          width={96}
          height={96}
          className="w-24 h-24 rounded-[22px] shadow-[0_8px_24px_rgba(17,17,26,0.10)]"
        />
        <h1 id="install-gate-title" className="mt-6 font-display font-extrabold text-[28px] leading-tight tracking-[-0.02em] text-ink text-center">
          {title}
        </h1>
        {body}
        <div className="flex-1 min-h-8" />
        {actions}
      </div>

      {guiding && (
        // On iPhone the steps are already on screen, so the guide only adds
        // what they can't: where the button actually is. Android's main
        // screen lists benefits instead, so its guide carries the steps.
        <button
          type="button"
          onClick={() => setGuiding(false)}
          aria-label="Close guide"
          className={`fixed inset-0 z-10 bg-paper flex flex-col px-6 text-left ${
            variant === "ios" && browser === "safari"
              ? "justify-end items-center pb-[calc(env(safe-area-inset-bottom)+24px)]"
              : "justify-start items-end pt-[calc(env(safe-area-inset-top)+12px)]"
          }`}
        >
          {variant === "android" ? (
            <>
              <span className="mr-1 flex flex-col items-center gap-1 text-gold">
                <IconArrow up />
                <span className="text-xs font-bold uppercase tracking-[0.06em]">Menu is up here</span>
              </span>
              <span className="card mt-3 block w-full max-w-md px-5 py-[18px] text-ink">
                <span className="block font-display font-extrabold text-lg">Install from Chrome&apos;s menu</span>
                <span className="block mt-1.5 text-[15px] leading-relaxed">
                  Tap the <IconKebab /> <strong>menu</strong> in the top-right corner, then <strong>Install app</strong> (or{" "}
                  <strong>Add to Home screen</strong>).
                </span>
              </span>
              <span className="self-center mt-4 text-[13px] text-ink-soft">Tap anywhere to close</span>
            </>
          ) : browser === "safari" ? (
            <>
              <span className="text-[13px] text-ink-soft">Tap anywhere to close</span>
              <span className="mt-8 flex flex-col items-center gap-1.5 text-gold text-center">
                <span className="text-lg font-bold text-ink">
                  Tap <IconShare className="w-5 h-5" /> Share down here
                </span>
                <span className="text-sm text-ink-soft">
                  Don&apos;t see it? It&apos;s under <IconDots />
                </span>
                <IconArrow />
              </span>
            </>
          ) : (
            <>
              <span className="mr-2 flex flex-col items-end gap-1.5 text-gold text-right">
                <IconArrow up />
                <span className="text-lg font-bold text-ink">
                  Tap <IconShare className="w-5 h-5" /> Share up here
                </span>
              </span>
              <span className="self-center mt-8 text-[13px] text-ink-soft">Tap anywhere to close</span>
            </>
          )}
        </button>
      )}
    </div>
  )
}
