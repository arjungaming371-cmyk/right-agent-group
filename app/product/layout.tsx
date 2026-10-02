import type { Metadata } from "next"

export const metadata: Metadata = {
  title: "Product",
  description:
    "One operations console for AI loan calling: AI employees, call queue, Lead Brain memory, WhatsApp and Instagram inbox, application forms, analytics, roles and branches.",
}

export default function ProductLayout({ children }: { children: React.ReactNode }) {
  return children
}
