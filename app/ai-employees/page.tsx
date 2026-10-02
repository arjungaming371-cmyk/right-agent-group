import Link from "next/link"
import { CheckCircle2, XCircle, Bot, ArrowRight } from "lucide-react"
import SiteShell from "@/components/site/site-shell"

// AI Employees — the honesty page. What Priya CAN do and what she CANNOT do
// are stated with equal clarity; that's the deal: capability in exchange for
// control.
const CAN = [
  "Call leads over phone and WhatsApp voice",
  "Ask your qualification questions and record the answers",
  "Answer approved FAQs from your knowledge base",
  "Send WhatsApp messages and application links",
  "Schedule follow-ups and callbacks",
  "Update lead status as conversations progress",
  "Escalate to humans — on frustration, a direct request, or a high-value lead",
]

const CANNOT = [
  "Approve loans",
  "Promise approval to a customer",
  "Change financial terms",
  "Invent eligibility rules",
  "Make unsupported claims about your products",
  "Access other branches' leads or data",
  "Change team permissions",
]

export default function AiEmployeesPage() {
  return (
    <SiteShell>
      <div className="rgpage">
        <span className="rg-eyebrow">
          <Bot size={12} strokeWidth={2} /> AI employees
        </span>
        <h1>
          Hire AI employees your team <span className="rg-grad">actually controls.</span>
        </h1>
        <p className="rg-lead">
          An AI employee works a channel the way your best agent would — inside the limits you
          set, with every conversation on the record.
        </p>
      </div>

      <section className="rg-section" style={{ paddingTop: 10 }}>
        {/* Priya profile card */}
        <div className="rg-glass rgai-card">
          <div className="rgai-head">
            <span className="rgai-avatar" aria-hidden="true">
              P
            </span>
            <div>
              <h2 className="rgai-name">Priya</h2>
              <p className="rgai-role">Loan Qualification Agent</p>
            </div>
            <span className="rgai-status">
              <i aria-hidden="true" />
              Active
            </span>
          </div>
          <div className="rgai-meta">
            <div>
              Channels
              <b>Phone · WhatsApp</b>
            </div>
            <div>
              Languages
              <b>English · Hindi · Telugu</b>
            </div>
            <div>
              Coverage
              <b>Works across your branches</b>
            </div>
          </div>
        </div>

        {/* Can / Cannot */}
        <div className="rgai-cols">
          <div className="rg-glass rg-card">
            <h3>What Priya can do</h3>
            <p>Everything on this list is a capability your team can switch on, script and audit.</p>
            <ul className="rgai-list rgai-can">
              {CAN.map((item) => (
                <li key={item}>
                  <CheckCircle2 size={15} strokeWidth={2} />
                  {item}
                </li>
              ))}
            </ul>
          </div>

          <div className="rg-glass rg-card">
            <h3>What Priya cannot do</h3>
            <p>Hard limits, enforced in the platform — not suggestions in a policy document.</p>
            <ul className="rgai-list rgai-cant">
              {CANNOT.map((item) => (
                <li key={item}>
                  <XCircle size={15} strokeWidth={2} />
                  {item}
                </li>
              ))}
            </ul>
          </div>
        </div>

        <p className="rgai-honest">
          Every conversation is disclosed as AI, recorded with consent, and reviewable by your
          team.
        </p>
      </section>

      <section className="rg-cta" style={{ paddingTop: 0 }} aria-labelledby="ai-cta-h">
        <div className="rg-glass">
          <h2 className="rg-h3" id="ai-cta-h" style={{ marginTop: 0 }}>
            Hear her qualify a real lead
          </h2>
          <p className="rg-lead" style={{ margin: "0 auto 24px" }}>
            We&apos;ll run a live qualification call against your use case and show you exactly
            where her limits sit.
          </p>
          <div className="rg-cta-actions" style={{ marginTop: 0 }}>
            <Link href="/demo" className="rg-btn rg-btn-primary rg-btn-lg">
              Book a Demo <ArrowRight size={16} strokeWidth={2.2} />
            </Link>
          </div>
        </div>
      </section>
    </SiteShell>
  )
}
