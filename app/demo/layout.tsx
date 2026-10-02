import type { Metadata } from "next"

export const metadata: Metadata = {
  title: "Book a Demo",
  description:
    "See a live AI qualification call, WhatsApp follow-up, your own script and knowledge base, and branch and role controls — book a demo of Right Agent Group.",
}

export default function DemoLayout({ children }: { children: React.ReactNode }) {
  return children
}
