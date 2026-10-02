import Link from "next/link"
import {
  KeyRound, UserCheck, Building2, Timer, Webhook, ScrollText, Gauge, Bot,
  Database, Archive, ShieldCheck, AlertTriangle,
} from "lucide-react"
import SiteShell from "@/components/site/site-shell"

// Security page — describes controls that actually exist in the platform
// (auth, RBAC, branch isolation, audit logs, rate limits, fail-closed
// webhooks…). Deliberately NO certification claims: the wording below states
// plainly that these are implemented controls, not third-party audits.
const CONTROLS = [
  {
    icon: KeyRound,
    title: "Authentication",
    desc: "Google sign-in with optional two-factor for admins, signed session cookies, and server-side session revocation when access needs to be pulled.",
  },
  {
    icon: UserCheck,
    title: "Authorization",
    desc: "Role-based access: Admin, Branch Manager, Agent, Viewer and Developer — plus custom roles. Every API enforces permissions server-side, not just the UI.",
  },
  {
    icon: Building2,
    title: "Branch isolation",
    desc: "Branch-scoped data access enforced in SQL. Branch managers see and operate on their branch only; admins see everything.",
  },
  {
    icon: Timer,
    title: "Session security",
    desc: "Fail-closed session validation — a session that cannot be verified is rejected — with epoch-based revocation so old tokens stop working the moment access changes.",
  },
  {
    icon: Webhook,
    title: "Webhook verification",
    desc: "Signature checks on Meta and Exotel webhooks. Requests that fail verification are rejected fail-closed, never processed.",
  },
  {
    icon: ScrollText,
    title: "Audit logging",
    desc: "Sensitive actions are recorded in an append-only audit trail, protected from tampering, so changes can always be traced to an actor.",
  },
  {
    icon: Gauge,
    title: "Rate limiting",
    desc: "Public endpoints are rate-limited per client to blunt abuse and credential-stuffing attempts without touching real users.",
  },
  {
    icon: Bot,
    title: "AI controls",
    desc: "One-click AI pause (global or per branch), mandatory AI disclosure, recording consent, and DND enforcement before every dial.",
  },
  {
    icon: Database,
    title: "Data protection",
    desc: "Call recordings are stored server-side and access-controlled by role. Provider keys and secrets live server-side only — never in the browser.",
  },
  {
    icon: Archive,
    title: "Data retention & backups",
    desc: "Retention is configurable to your policy, and backup procedures are documented in the deployment guide for your own operations.",
  },
]

export default function SecurityPage() {
  return (
    <SiteShell>
      <div className="rgpage">
        <span className="rg-eyebrow">
          <ShieldCheck size={12} strokeWidth={2} /> Security
        </span>
        <h1>
          Controls first. <span className="rg-grad">Claims second.</span>
        </h1>
        <p className="rg-lead">
          Here is exactly what the platform implements to protect your leads, recordings and
          customer conversations — in plain language.
        </p>
      </div>

      <section className="rg-section" style={{ paddingTop: 20 }}>
        <div className="rgsec-grid">
          {CONTROLS.map(({ icon: Icon, title, desc }) => (
            <div key={title} className="rg-glass rgsec-card">
              <h3>
                <Icon size={17} strokeWidth={2} />
                {title}
              </h3>
              <p>{desc}</p>
            </div>
          ))}
        </div>

        <div className="rgsec-note">
          <p className="rg-legal-notice">
            These are security controls implemented in the platform. We do not claim
            third-party certifications. If your compliance process requires specific attestations,
            ask us during the demo and we will walk you through the actual implementation.
          </p>
          <p className="rg-legal-notice" style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
            <AlertTriangle size={16} strokeWidth={2} style={{ flexShrink: 0, marginTop: 2 }} />
            <span>
              Report a security concern:{" "}
              <span className="rg-ph">[security@yourdomain.com — update before publishing]</span>. We
              take reports seriously and will respond promptly.
            </span>
          </p>
        </div>

        <div className="rg-center" style={{ marginTop: 26 }}>
          <p className="rg-flowline">
            Want to see these controls in the console?{" "}
            <Link href="/demo" className="rg-grad" style={{ textDecoration: "none", fontWeight: 700 }}>
              Book a Demo
            </Link>
          </p>
        </div>
      </section>
    </SiteShell>
  )
}
