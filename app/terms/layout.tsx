import type { Metadata } from "next"

export const metadata: Metadata = {
  title: "Terms of Service",
  description:
    "Plain-language terms for using the Right Agent Group platform: what the service does, acceptable use, AI limitations and availability.",
}

export default function TermsLayout({ children }: { children: React.ReactNode }) {
  return children
}
