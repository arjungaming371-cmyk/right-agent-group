import type { Metadata } from "next"

export const metadata: Metadata = {
  title: "Help Center",
  description:
    "Guides for Right Agent Group: getting started, AI employees, voice calling, WhatsApp, leads, applications, branches, team access, analytics, security and troubleshooting.",
}

export default function HelpLayout({ children }: { children: React.ReactNode }) {
  return children
}
