import type { Metadata, Viewport } from "next"
import { Inter } from "next/font/google"
import "./globals.css"
import { THEME_INIT_SCRIPT } from "@/lib/theme"

const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" })

// Canonical site URL. Falls back to localhost so builds never crash when the
// env is missing — production deployments set NEXT_PUBLIC_APP_URL anyway
// (the auth flow already depends on it).
const SITE_URL = (process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000").replace(/\/$/, "")

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  // Title template: child routes set their own title and get the brand suffix
  // automatically ("About — Right Agent Group").
  title: {
    default: "Right Agent Group — AI Voice & WhatsApp for Lending Teams",
    template: "%s — Right Agent Group",
  },
  description:
    "Priya, your AI agent, qualifies loan leads over phone, WhatsApp and Instagram in English, Hindi and Telugu — 24/7, with live sentiment, instant follow-ups and a full operations console.",
  keywords: [
    "AI voice agent",
    "loan lead qualification",
    "WhatsApp Business Cloud API",
    "AI calling agent India",
    "Telugu AI voice",
    "lead pipeline automation",
    "Right Agent Group",
  ],
  applicationName: "Right Agent Group",
  authors: [{ name: "Right Agent Group" }],
  openGraph: {
    type: "website",
    siteName: "Right Agent Group",
    locale: "en_IN",
    url: SITE_URL,
    title: "Right Agent Group — AI Voice & WhatsApp for Lending Teams",
    description:
      "Every lead answered. Every call handled. Priya — your AI agent — works phone, WhatsApp and Instagram around the clock, in English, Hindi and Telugu.",
  },
  twitter: {
    card: "summary_large_image",
    title: "Right Agent Group — AI Voice & WhatsApp for Lending Teams",
    description:
      "Every lead answered. Every call handled. AI voice + WhatsApp + Instagram, one operations console.",
  },
  robots: {
    index: true,
    follow: true,
    googleBot: { index: true, follow: true, "max-image-preview": "large" },
  },
  icons: { icon: "/icon.svg" },
}

export const viewport: Viewport = {
  themeColor: "#05070c",
  width: "device-width",
  initialScale: 1,
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
