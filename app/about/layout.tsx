import type { Metadata } from "next"

export const metadata: Metadata = {
  title: "About",
  description:
    "Why we built Right Agent Group: AI employees that turn leads into loan applications for banks, NBFCs, DSAs and multi-branch loan businesses.",
}

export default function AboutLayout({ children }: { children: React.ReactNode }) {
  return children
}
