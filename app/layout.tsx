import type { Metadata, Viewport } from "next"
import { Inter, Noto_Sans_Telugu } from "next/font/google"
import "./globals.css"
import { THEME_INIT_SCRIPT } from "@/lib/theme"

const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" })
const notoSansTelugu = Noto_Sans_Telugu({
  subsets: ["telugu"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-telugu",
  display: "swap",
})

// Canonical site URL. Falls back to localhost so builds never crash when the
// env is missing — production deployments set NEXT_PUBLIC_APP_URL anyway
// (the auth flow already depends on it).
const SITE_URL = (process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000").replace(/\/$/, "")

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  // Title template: child routes set their own title and get the brand suffix
  // automatically ("About — Right Agent Group").
  title: {
    default: "NIAT Admissions AI — AI Voice & WhatsApp for Technology Admissions",
    template: "%s — NIAT Admissions",
  },
  description:
    "NIAT AI Admissions Counsellor guides students and parents over phone, WhatsApp and Instagram in English, Hindi and Telugu — 24/7, explaining the 4-year curriculum, NAT assessment, collaborating universities and admission process.",
  keywords: [
    "NIAT",
    "NxtWave",
    "AI voice counsellor",
    "technology admissions",
    "NAT assessment",
    "AI admissions agent India",
    "Telugu AI voice",
    "B.Tech admissions",
  ],
  applicationName: "NIAT Admissions",
  authors: [{ name: "NIAT Admissions" }],
  openGraph: {
    type: "website",
    siteName: "NIAT Admissions",
    locale: "en_IN",
    url: SITE_URL,
    title: "NIAT Admissions AI — Intelligent Technology Admissions Counsellor",
    description:
      "Every inquiry answered. Every call handled. NIAT AI Admissions Counsellor guides students and parents over phone, WhatsApp and Instagram in English, Hindi and Telugu.",
  },
  twitter: {
    card: "summary_large_image",
    title: "NIAT Admissions AI — Technology Admissions Counsellor",
    description:
      "Every inquiry answered. Every call handled. AI voice + WhatsApp + Instagram admissions console.",
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
    <html lang="en" className={`${inter.variable} ${notoSansTelugu.variable}`} suppressHydrationWarning>
      <head>
        {/* Applies the saved theme before first paint — without this, every
            load flashes the dark theme for a frame even on Light. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body>{children}</body>
    </html>
  )
}
