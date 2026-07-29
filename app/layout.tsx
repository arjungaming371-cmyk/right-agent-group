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
    <html lang="en" className={inter.variable}>
      <head>
        {/* Applies the saved theme before first paint — without this, every
            load flashes the dark theme for a frame even on Light. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body>{children}</body>
    </html>
  )
}
