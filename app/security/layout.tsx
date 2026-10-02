import type { Metadata } from "next"

export const metadata: Metadata = {
  title: "Security",
  description:
    "Security controls implemented in the Right Agent Group platform: authentication, role-based access, branch isolation, session security, audit logging and more.",
}

export default function SecurityLayout({ children }: { children: React.ReactNode }) {
  return children
}
