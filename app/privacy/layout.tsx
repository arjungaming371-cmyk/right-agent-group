import type { Metadata } from "next"

export const metadata: Metadata = {
  title: "Privacy Policy",
  description:
    "What data Right Agent Group processes, why, and the rights you have over it — in plain language.",
}

export default function PrivacyLayout({ children }: { children: React.ReactNode }) {
  return children
}
