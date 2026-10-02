import SiteShell from "@/components/site/site-shell"

// Terms — deliberately plain language. Legal placeholders are clearly
// marked and must be reviewed by counsel before publishing.
export default function TermsPage() {
  return (
    <SiteShell>
      <div className="rgpage">
        <h1>
          Terms of <span className="rg-grad">Service</span>
        </h1>
        <p className="rg-lead">
          The short version: we provide an AI calling and lead management platform, you use it
          lawfully and honestly, and humans stay accountable for every customer conversation.
        </p>
      </div>

      <section className="rg-section" style={{ paddingTop: 40 }}>
        <div className="rg-legal">
          <h2>What the service does</h2>
          <p>
            Right Agent Group provides a platform where AI employees call, message and qualify
            your loan leads over Phone, WhatsApp and Instagram, manage them through your
            pipeline, and hand conversations to your human team when needed. You control the
            scripts, the knowledge base and the rules; the platform executes them.
          </p>

          <h2>Acceptable use</h2>
          <ul>
            <li>
              Obey the telecom and consumer-protection law that applies to your calls and
              messages, in every jurisdiction you contact.
            </li>
            <li>
              Do not send unsolicited marketing to numbers on do-not-call lists — the platform
              enforces DND lists and calling windows, but you remain responsible for the lists
              you load and the campaigns you run.
            </li>
            <li>
              Keep the AI disclosure enabled. Customers must never be deceived about whether they
              are talking to an AI employee.
            </li>
            <li>Do not use the platform for unlawful, deceptive or harassing purposes of any kind.</li>
          </ul>

          <h2>AI limitations</h2>
          <p>
            The AI can make mistakes. It may misunderstand a customer or generate an imperfect
            reply — which is exactly why humans can review every conversation, override any
            outcome, and pause the AI instantly with the kill switch. Qualified leads should be
            confirmed by your team before any commitment is made to a customer.
          </p>

          <h2>Availability</h2>
          <p>
            The platform is provided on a best-effort basis. Calling and messaging depend on
            third-party providers (telephony, Meta, AI inference), and outages on their side can
            interrupt service. Scale commitments are documented in your individual agreement.
          </p>

          <h2>Data</h2>
          <p>
            What we process, why, and the rights available to you are described on the{" "}
            <a href="/privacy">Privacy page</a>. Those descriptions are part of these terms.
          </p>

          <h2>Liability</h2>
          <p>
            <span className="rg-ph">
              [Liability cap and governing-law clause — insert after legal review]
            </span>
          </p>

          <h2>Changes to these terms</h2>
          <p>
            We may update these terms as the platform evolves. Material changes will be
            communicated before they take effect, and the current version always lives on this
            page.
          </p>

          <h2>Contact</h2>
          <p>
            <span className="rg-ph">[Company Legal Name — update before publishing]</span> ·{" "}
            <span className="rg-ph">[support@yourdomain.com]</span>
          </p>

          <p className="rg-legal-notice">
            Every <span className="rg-ph">[placeholder]</span> on this page must be filled in and
            reviewed by qualified counsel before this document is published.
          </p>
        </div>
      </section>
    </SiteShell>
  )
}
