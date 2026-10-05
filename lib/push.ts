import { supabase } from "@/lib/supabase"

// Web Push wants the VAPID key as a raw Uint8Array, but it's only ever
// handed out as a URL-safe base64 string.
function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/")
  const rawData = atob(base64)
  const array = new Uint8Array(new ArrayBuffer(rawData.length))
  for (let i = 0; i < rawData.length; i++) array[i] = rawData.charCodeAt(i)
  return array
}

export function isPushSupported(): boolean {
  return typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window
}

// Set when the member taps Disable. Unsubscribing leaves the browser's
// permission at "granted", so without this syncPushSubscription() below
// would quietly re-subscribe them on the next page load.
const OPT_OUT_KEY = "push-opted-out"

function isOptedOut(): boolean {
  try {
    return localStorage.getItem(OPT_OUT_KEY) === "1"
  } catch {
    return false
  }
}

function setOptedOut(optedOut: boolean) {
  try {
    if (optedOut) localStorage.setItem(OPT_OUT_KEY, "1")
    else localStorage.removeItem(OPT_OUT_KEY)
  } catch {
    // Storage blocked -- worst case a Disable gets undone on a later visit.
  }
}

export async function getExistingSubscription(): Promise<PushSubscription | null> {
  if (!isPushSupported()) return null
  const registration = await navigator.serviceWorker.ready
  return registration.pushManager.getSubscription()
}

/**
 * Requests notification permission (if not already decided) and stores the
 * resulting push subscription for the given member. Throws if permission is
 * denied or the VAPID public key isn't configured -- callers show that as
 * an error rather than silently no-op'ing, since "I tapped enable and
 * nothing happened" is worse than a visible failure.
 */
export async function subscribeToPush(memberId: string): Promise<void> {
  if (!isPushSupported()) throw new Error("Push notifications aren't supported on this browser.")

  const vapidPublicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY
  if (!vapidPublicKey) throw new Error("Push notifications aren't configured yet.")

  // Already granted (e.g. switched on in iOS Settings / site settings) means
  // there's nothing to ask -- skip requestPermission, which some browsers
  // only allow from a tap, so syncPushSubscription() can run without one.
  const permission =
    Notification.permission === "granted" ? "granted" : await Notification.requestPermission()
  recordPermission(permission)
  if (permission !== "granted") throw new Error("Notification permission was denied.")

  const registration = await navigator.serviceWorker.ready
  const subscription =
    (await registration.pushManager.getSubscription()) ??
    (await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(vapidPublicKey)
    }))

  const json = subscription.toJSON()
  if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) {
    throw new Error("This browser returned an incomplete push subscription.")
  }

  const { error } = await supabase.from("push_subscriptions").upsert(
    {
      member_id: memberId,
      endpoint: json.endpoint,
      p256dh: json.keys.p256dh,
      auth: json.keys.auth
    },
    { onConflict: "endpoint" }
  )

  if (error) throw new Error(error.message)
  setOptedOut(false)
}

// The last Notification.permission this app saw on this device. Auto-
// subscribing is only safe when the app itself watched permission become
// "granted" (blocked/unasked -> allowed in Settings). "Already granted the
// first time we look" is ambiguous: it's also exactly what a member who
// tapped Disable before the opt-out flag above existed looks like, and
// re-subscribing them would undo a deliberate choice.
const LAST_PERMISSION_KEY = "push-last-permission"

function readLastPermission(): string | null {
  try {
    return localStorage.getItem(LAST_PERMISSION_KEY)
  } catch {
    return null
  }
}

function recordPermission(permission: NotificationPermission) {
  try {
    localStorage.setItem(LAST_PERMISSION_KEY, permission)
  } catch {
    // Storage blocked -- auto-subscribe just never kicks in; Enable still works.
  }
}

let syncInFlight: Promise<boolean> | null = null

/**
 * Creates the push subscription when notifications were switched on outside
 * the app -- e.g. the member tapped "Don't Allow", then turned them on in
 * iOS Settings, which grants permission without the app ever getting a
 * chance to subscribe. Only acts when this app previously saw permission as
 * blocked or unasked and now sees it granted; never prompts, and respects
 * an explicit Disable. Resolves to whether this device is subscribed
 * afterwards. Concurrent callers (the bell and the Notifications card both
 * run it) share one attempt.
 */
export function syncPushSubscription(memberId: string): Promise<boolean> {
  if (!isPushSupported() || typeof Notification === "undefined") return Promise.resolve(false)

  const permission = Notification.permission
  const previous = readLastPermission()
  recordPermission(permission)

  if (permission !== "granted") {
    return getExistingSubscription().then((sub) => !!sub).catch(() => false)
  }
  const sawItGranted = previous === "denied" || previous === "default"

  syncInFlight ??= (async () => {
    try {
      if (await getExistingSubscription()) return true
      if (isOptedOut() || !sawItGranted) return false
      await subscribeToPush(memberId)
      return true
    } catch {
      return false
    } finally {
      syncInFlight = null
    }
  })()
  return syncInFlight
}

export async function unsubscribeFromPush(): Promise<void> {
  const subscription = await getExistingSubscription()
  if (!subscription) return

  const endpoint = subscription.endpoint
  await subscription.unsubscribe()
  await supabase.from("push_subscriptions").delete().eq("endpoint", endpoint)
  setOptedOut(true)
}
