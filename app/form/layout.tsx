import type { Metadata } from "next"

export const metadata: Metadata = {
  title: "Loan Application",
  description: "Complete your Right Agent Group loan application — takes a few minutes, saves automatically.",
  // The form is a conversion funnel, not a search surface.
  robots: { index: false, follow: false },
}
export default function FormLayout({ children }: { children: React.ReactNode }) {
  return children
}
