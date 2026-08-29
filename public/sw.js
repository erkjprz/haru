// Deliberately no caching/offline logic here -- this service worker exists
// solely to receive Web Push events while the app isn't open. Adding a
// fetch handler/cache later is a separate decision with its own tradeoffs
// (stale data in a financial app is worse than no offline support).

self.addEventListener("push", (event) => {
  let data = {}
  try {
    data = event.data ? event.data.json() : {}
  } catch {
    data = { title: "Est. 2017", body: event.data ? event.data.text() : "" }
  }

  const title = data.title || "Est. 2017"
  const options = {
    body: data.body || "",
    icon: "/icons/icon-192.png",
    badge: "/icons/icon-192.png",
    data: { link: data.link || "/" }
  }

  event.waitUntil(self.registration.showNotification(title, options))
})

self.addEventListener("notificationclick", (event) => {
  event.notification.close()
  const link = event.notification.data?.link || "/"

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if (client.url.includes(link) && "focus" in client) return client.focus()
      }
      if (clients.length > 0 && "focus" in clients[0]) {
        clients[0].navigate(link)
        return clients[0].focus()
      }
      return self.clients.openWindow(link)
    })
  )
})
