import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { ThemeProvider } from "@/app/components/ThemeProvider";
import { PullToRefresh } from "@/app/components/PullToRefresh";
import { ScrollToTop } from "@/app/scroll-to-top";
import { AuthProvider } from "@/app/auth-context";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
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

// Theme is a manual toggle stored in localStorage (see ThemeProvider), not
// driven by prefers-color-scheme, so this is just the pre-hydration default
// -- ThemeProvider updates the theme-color meta tag to match on toggle.
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
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <head>
        {/* Runs synchronously during HTML parsing, before first paint --
            applies the stored theme (defaulting to dark, same default
            ThemeProvider's own state starts with) so a hard reload never
            shows a flash of the light theme while React hydrates. Without
            this, pull-to-refresh's window.location.reload() briefly
            painted the default light background every time. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem("haru-theme");var isDark=t?t==="dark":true;document.documentElement.classList.toggle("dark",isDark);var m=document.querySelector('meta[name="theme-color"]');if(m)m.setAttribute("content",isDark?"#0a0a0a":"#ffffff")}catch(e){}})()`
          }}
        />
      </head>
      <body className="min-h-full flex flex-col">
        <ScrollToTop />
        <AuthProvider>
          <ThemeProvider>
            <PullToRefresh>{children}</PullToRefresh>
          </ThemeProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
