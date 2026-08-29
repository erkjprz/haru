import type { MetadataRoute } from "next"

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Est. 2017 — Shared Fund Tracker",
    short_name: "Est. 2017",
    description: "Shared fund tracker",
    start_url: "/",
    display: "standalone",
    // Matches the icon's own paper background -- this is the native splash
    // color the OS paints behind the icon before any of the app's own CSS
    // has loaded, so it has to agree with the icon rather than the current
    // light/dark theme (which isn't knowable yet at that point anyway).
    background_color: "#faf7f2",
    theme_color: "#faf7f2",
    icons: [
      {
        src: "/icons/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any"
      },
      {
        src: "/icons/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any"
      },
      {
        src: "/icons/icon-512-maskable.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable"
      }
    ]
  }
}
