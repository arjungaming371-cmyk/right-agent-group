import SiteShell from "@/components/site/site-shell"

// Privacy policy — plain language, no invented registration numbers, no
// certification claims. Every value that must be filled in before publishing
// is written in plain language so customers can understand the platform's
// data handling before they book a demo or connect an account.
export default function PrivacyPage() {
  return (
    <SiteShell>
      <div className="rgpage">
        <h1>
          Privacy <span className="rg-grad">Policy</span>
        </h1>
        <p className="rg-lead">
          What we process, why we process it, and what you can ask us to do about it.
        </p>
        <p className="rg-updated">Plain-language summary — the full sections follow below.</p>
      </div>

      <section className="rg-section" style={{ paddingTop: 40 }}>
        <div className="rg-legal">
          <h2>Data we process</h2>
          <p>
            When your business uses Right Agent Group, the platform processes on your behalf:
          </p>
          <ul>
            <li>Lead contact details — names, phone numbers, emails your leads give you.</li>
            <li>Call recordings and transcripts of conversations with your leads.</li>
            <li>WhatsApp and Instagram conversations with your customers.</li>
            <li>Application data you collect through loan application forms.</li>
          </ul>

          <h2>Why we process it</h2>
          <p>
            One purpose: contacting and qualifying the leads you own. The AI calls, messages and
            follow-ups exist to move your leads through your pipeline — nothing else.
          </p>

          <h2>Call recordings</h2>
          <p>
            Calls are recorded with a spoken consent notice at the start of the conversation.
            Recordings are playable only by authorized roles inside your team, and access is
            logged.
          </p>

          <h2>AI processing</h2>
          <p>
            Conversations are processed by AI providers to generate replies, summaries and
            qualification data. The specific providers in use are listed on the{" "}
            <a href="/integrations">Integrations page</a> and are configured per deployment.
          </p>

          <h2>WhatsApp</h2>
          <p>
            Messages are sent through the Meta WhatsApp Business Cloud API, to customers who
            contacted you first or opted in to hear from you. Business-initiated templates follow
            Meta&apos;s approved-template rules.
          </p>

          <h2>Retention</h2>
          <p>
            Retention is configurable to your policy, recordings are capped, and data can be
            deleted on request. Talk to us about the retention window that fits your compliance
            obligations.
          </p>

          <h2>Your rights</h2>
          <p>
            You — and your customers, through you — can request access, correction or deletion of
            personal data via the contact below. We respond to every request.
          </p>

          <h2>Third-party providers</h2>
          <p>
            Telephony, AI and messaging providers process data as needed to deliver the service —
            placing calls, generating replies, delivering messages. They are listed on the{" "}
            <a href="/integrations">Integrations page</a>.
          </p>

          <h2>Contact</h2>
          <p>
            Right Agent Group · Submit a request through the{" "}
            <a href="/demo">Book a Demo</a> page and include the account email associated with
            your request.
          </p>

          <p className="rg-legal-notice">
            This page is a plain-language summary of the platform's data practices. If your
            organization has additional contractual or regulatory requirements, your signed
            agreement and applicable law govern.
          </p>
        </div>
      </section>
    </SiteShell>
  )
}
