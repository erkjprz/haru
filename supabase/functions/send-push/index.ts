import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from "npm:@supabase/supabase-js@2"
import webpush from "npm:web-push@3.6.7"

const supabaseUrl = Deno.env.get("SUPABASE_URL")!
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 })
  }

  const admin = createClient(supabaseUrl, serviceRoleKey)

  const { data: secretRows, error: secretError } = await admin
    .schema("vault")
    .from("decrypted_secrets")
    .select("name, decrypted_secret")
    .in("name", ["push_dispatch_secret", "vapid_public_key", "vapid_private_key", "vapid_subject"])

  if (secretError || !secretRows) {
    return new Response("Secret lookup failed", { status: 500 })
  }

  const secrets = Object.fromEntries(secretRows.map((r) => [r.name, r.decrypted_secret]))

  const providedSecret = req.headers.get("x-dispatch-secret")
  if (!providedSecret || providedSecret !== secrets.push_dispatch_secret) {
    return new Response("Unauthorized", { status: 401 })
  }

  const { notification_id } = await req.json()
  if (!notification_id) {
    return new Response("Missing notification_id", { status: 400 })
  }

  const { data: notification, error: notificationError } = await admin
    .from("notifications")
    .select("id, member_id, title, body, link")
    .eq("id", notification_id)
    .single()

  if (notificationError || !notification) {
    return new Response("Notification not found", { status: 404 })
  }

  const { data: subscriptions, error: subsError } = await admin
    .from("push_subscriptions")
    .select("id, endpoint, p256dh, auth")
    .eq("member_id", notification.member_id)

  if (subsError) {
    return new Response("Subscription lookup failed", { status: 500 })
  }

  webpush.setVapidDetails(secrets.vapid_subject, secrets.vapid_public_key, secrets.vapid_private_key)

  const payload = JSON.stringify({
    title: notification.title,
    body: notification.body,
    link: notification.link ?? "/"
  })

  const results = await Promise.allSettled(
    (subscriptions ?? []).map(async (sub) => {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          payload
        )
      } catch (err) {
        const statusCode = (err as { statusCode?: number }).statusCode
        if (statusCode === 404 || statusCode === 410) {
          await admin.from("push_subscriptions").delete().eq("id", sub.id)
        } else {
          throw err
        }
      }
    })
  )

  const sent = results.filter((r) => r.status === "fulfilled").length
  const failed = results.length - sent

  return new Response(JSON.stringify({ sent, failed }), {
    headers: { "Content-Type": "application/json" }
  })
})
