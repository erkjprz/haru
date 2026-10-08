// Install/standalone detection and the onboarding sheet's per-step snooze
// timers. Kept separate from lib/push.ts, which only deals with the Web Push
// subscription itself.

export type OnboardingStep = "install" | "notify"

// Chrome's BeforeInstallPromptEvent isn't in lib.dom yet.
export type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>
}

export function isIOS(): boolean {
  if (typeof navigator === "undefined") return false
  // iPadOS reports itself as desktop Safari ("MacIntel"), so touch support is
  // the only way left to tell it apart from a real Mac.
  return /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
}

export function isAndroid(): boolean {
  if (typeof navigator === "undefined") return false
  return /android/i.test(navigator.userAgent)
}

// Webviews inside other apps (a link tapped in Messenger, Instagram, the
// Google app, ...) can't install a PWA at all -- the only way forward is
// opening the page in the real browser. Best effort: these apps identify
// themselves in the user agent, and Android webviews carry "; wv)".
export function isInAppBrowser(): boolean {
  if (typeof navigator === "undefined") return false
  return /FBAN|FBAV|FB_IAB|FBIOS|Instagram|Messenger|MicroMessenger|Line\/|Snapchat|LinkedInApp|TikTok|musical_ly|Twitter|GSA\/|; wv\)/i.test(
    navigator.userAgent
  )
}

// iOS Chrome/Firefox/Edge can add to the Home Screen too (iOS 16.4+), but
// their Share button isn't in Safari's bottom toolbar.
export function isIOSSafari(): boolean {
  if (typeof navigator === "undefined") return false
  return isIOS() && !/CriOS|FxiOS|EdgiOS|OPiOS/i.test(navigator.userAgent)
}

export function isStandalone(): boolean {
  if (typeof window === "undefined") return false
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  )
}

// Captured at module load rather than inside a component's effect --
// Chrome can fire beforeinstallprompt before React has hydrated anything,
// and the event is only ever delivered once per page load.
let deferredPrompt: BeforeInstallPromptEvent | null = null
// The browser tab that just installed the app is still not standalone
// itself, so isStandalone() alone can't tell it to move on to notifications.
let installedThisSession = false
const listeners = new Set<() => void>()

function notify() {
  listeners.forEach((fn) => fn())
}

if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (e) => {
    // Suppresses Chrome's own mini-infobar so the onboarding sheet is the
    // one place install gets offered.
    e.preventDefault()
    deferredPrompt = e as BeforeInstallPromptEvent
    notify()
  })
  window.addEventListener("appinstalled", () => {
    deferredPrompt = null
    installedThisSession = true
    notify()
  })
}

export function getDeferredPrompt(): BeforeInstallPromptEvent | null {
  return deferredPrompt
}

export function clearDeferredPrompt() {
  deferredPrompt = null
  notify()
}

export function wasInstalledThisSession(): boolean {
  return installedThisSession
}

export function subscribeToInstallState(fn: () => void): () => void {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}

const SNOOZE_DAYS: Record<OnboardingStep, number> = { install: 1, notify: 1 }
const DAY_MS = 24 * 60 * 60 * 1000

function snoozeKey(step: OnboardingStep) {
  return `pwa-onboarding-snooze:${step}`
}

export function isSnoozed(step: OnboardingStep): boolean {
  try {
    const at = Number(localStorage.getItem(snoozeKey(step))) || 0
    return Date.now() - at < SNOOZE_DAYS[step] * DAY_MS
  } catch {
    return false
  }
}

// The full-screen install gate on /login and /signup -- "Continue in
// browser" keeps it away for a week rather than for good, since the
// onboarding sheet and /install still cover anyone who changes their mind.
const GATE_KEY = "install-gate-dismissed"
const GATE_SNOOZE_DAYS = 7

export function isGateDismissed(): boolean {
  try {
    const at = Number(localStorage.getItem(GATE_KEY)) || 0
    return Date.now() - at < GATE_SNOOZE_DAYS * DAY_MS
  } catch {
    return false
  }
}

export function dismissGate() {
  try {
    localStorage.setItem(GATE_KEY, String(Date.now()))
  } catch {
    // Blocked storage -- the gate just comes back next load.
  }
}

export function snooze(step: OnboardingStep) {
  try {
    localStorage.setItem(snoozeKey(step), String(Date.now()))
  } catch {
    // Private mode / blocked storage -- the sheet just comes back next load.
  }
}
