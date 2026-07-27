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

  const permission = await Notification.requestPermission()
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
}

export async function unsubscribeFromPush(): Promise<void> {
  const subscription = await getExistingSubscription()
  if (!subscription) return

  const endpoint = subscription.endpoint
  await subscription.unsubscribe()
  await supabase.from("push_subscriptions").delete().eq("endpoint", endpoint)
}
