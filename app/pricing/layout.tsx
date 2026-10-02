import type { Metadata } from "next"

export const metadata: Metadata = {
  title: "Pricing",
  description:
    "Simple monthly plans for AI loan calling: Starter ₹24,999/mo, Growth ₹59,999/mo, and Scale (custom) for multi-branch organizations.",
}

export default function PricingLayout({ children }: { children: React.ReactNode }) {
  return children
}
