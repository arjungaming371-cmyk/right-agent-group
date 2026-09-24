import type { Metadata } from "next"

export const metadata: Metadata = {
  title: "About the Platform",
  description:
    "How Right Agent Group's operations console works — AI voice calls, WhatsApp automation, lead management, role-based access and compliance.",
}
export default function AboutLayout({ children }: { children: React.ReactNode }) {
  return children
}
