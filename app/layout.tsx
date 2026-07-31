import type { Metadata } from "next"
import { Inter } from "next/font/google"
import "./globals.css"
import { THEME_INIT_SCRIPT } from "@/lib/theme"

const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" })

export const metadata: Metadata = {
  title: "Right Agent Group — Operations Console",
  description: "AI-powered operations console",
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // suppressHydrationWarning is required here, not a workaround for a bug.
    // THEME_INIT_SCRIPT below runs in <head> before React hydrates and sets
    // data-theme / style.colorScheme on <html> from localStorage. The server
    // cannot know localStorage, so it renders neither attribute and React
    // reports a mismatch on every page load. The mismatch is the intended
    // behaviour — the client value must win, which is the whole point of
    // applying the theme before first paint.
    //
    // This only suppresses the warning for <html>'s own attributes, one level
    // deep, so real hydration bugs anywhere inside the app still surface.
    <html lang="en" className={inter.variable} suppressHydrationWarning>
      <head>
        {/* Applies the saved theme before first paint — without this, every
            load flashes the dark theme for a frame even on Light. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body>{children}</body>
    </html>
  )
}
