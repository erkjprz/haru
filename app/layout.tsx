import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono, Manrope } from "next/font/google";
import { Analytics } from "@vercel/analytics/next";
import "./globals.css";
import { ThemeProvider } from "@/app/components/ThemeProvider";
import { PullToRefresh } from "@/app/components/PullToRefresh";
import { ScrollToTop } from "@/app/scroll-to-top";
import { AuthProvider } from "@/app/auth-context";
import { ServiceWorkerRegister } from "@/app/components/ServiceWorkerRegister";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// globals.css's --font-display references --font-manrope -- this is what
// actually loads it, matching the pattern already used for Geist/Geist Mono.
const manrope = Manrope({
  variable: "--font-manrope",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Haru",
  description: "Shared fund tracker",
  appleWebApp: {
    title: "Haru",
    statusBarStyle: "black-translucent",
  },
};

// Theme follows the device's prefers-color-scheme by default, unless the
// user has explicitly picked light or dark (stored in localStorage -- see
// ThemeProvider). "dark" here is just the pre-hydration fallback for the
// rare case JS hasn't run yet; ThemeProvider (and the inline script below)
// resolve the real value before paint.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#0a0a0a",
  colorScheme: "dark light",
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} ${manrope.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <head>
        {/* Runs synchronously during HTML parsing, before first paint --
            applies the stored theme override if there is one, otherwise
            resolves the device's prefers-color-scheme, so a hard reload
            never shows a flash of the wrong theme while React hydrates.
            Without this, pull-to-refresh's window.location.reload() briefly
            painted the wrong background every time. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem("haru-theme");var isDark=t==="dark"?true:t==="light"?false:window.matchMedia("(prefers-color-scheme: dark)").matches;document.documentElement.classList.toggle("dark",isDark);var m=document.querySelector('meta[name="theme-color"]');if(m)m.setAttribute("content",isDark?"#0a0a0a":"#ffffff")}catch(e){}})()`
          }}
        />
      </head>
      <body className="min-h-full flex flex-col">
        <ScrollToTop />
        <ServiceWorkerRegister />
        <AuthProvider>
          <ThemeProvider>
            <PullToRefresh>{children}</PullToRefresh>
          </ThemeProvider>
        </AuthProvider>
        <Analytics />
      </body>
    </html>
  );
}
