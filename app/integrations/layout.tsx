import type { Metadata } from "next"

export const metadata: Metadata = {
  title: "Integrations",
  description:
    "Right Agent Group works with the stack you already run: Exotel, Meta WhatsApp Business Cloud API, Instagram, Sarvam, Cartesia, Groq, Google and PostgreSQL.",
}

export default function IntegrationsLayout({ children }: { children: React.ReactNode }) {
  return children
}
