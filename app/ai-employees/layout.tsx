import type { Metadata } from "next"

export const metadata: Metadata = {
  title: "AI Employees",
  description:
    "Hire AI employees your team actually controls. Meet Priya — Loan Qualification Agent for Phone and WhatsApp, speaking English, Hindi and Telugu.",
}

export default function AiEmployeesLayout({ children }: { children: React.ReactNode }) {
  return children
}
