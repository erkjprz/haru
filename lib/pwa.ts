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

const SNOOZE_DAYS: Record<OnboardingStep, number> = { install: 7, notify: 3 }
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

export function snooze(step: OnboardingStep) {
  try {
    localStorage.setItem(snoozeKey(step), String(Date.now()))
  } catch {
    // Private mode / blocked storage -- the sheet just comes back next load.
  }
}
