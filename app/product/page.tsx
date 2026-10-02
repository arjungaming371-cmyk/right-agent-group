import Link from "next/link"
import {
  Bot, PhoneCall, Brain, MessageCircle, FileText, BarChart3, UserCheck,
  Building2, ScrollText, ShieldCheck, Ban, Mic, ListChecks, ArrowRight,
  Briefcase, Network, Landmark,
} from "lucide-react"
import SiteShell from "@/components/site/site-shell"

// Product tour page. "What you get" mirrors what the console actually ships;
// no invented metrics anywhere.
const WHO = [
  {
    icon: Briefcase,
    title: "Loan agencies",
    desc: "Run outreach, qualification and follow-up for personal, business and home loan leads without growing the calling team first.",
  },
  {
    icon: Network,
    title: "DSA teams",
    desc: "Connect lead lists from every DSA associate in your network to one pipeline, with per-branch numbers, quotas and dashboards.",
  },
  {
    icon: Landmark,
    title: "Multi-branch finance businesses",
    desc: "Standardize scripts and compliance centrally while each branch works its own leads and customers.",
  },
]

const WHAT = [
  { icon: Bot, title: "AI employees", desc: "Priya and other AI agents you configure, scoped to branches and channels." },
  { icon: PhoneCall, title: "Call queue with campaign talking points", desc: "Leads queue up with the points your campaign wants covered on every call." },
  { icon: Brain, title: "Lead Brain", desc: "Per-lead AI memory — every conversation remembered, never re-asked." },
  { icon: MessageCircle, title: "WhatsApp + Instagram inbox", desc: "One shared inbox for customer chats, with AI replies and human takeover." },
  { icon: FileText, title: "Application forms", desc: "Secure, trackable application links sent over WhatsApp." },
  { icon: BarChart3, title: "Analytics", desc: "Calls, qualification funnel, sentiment and branch performance." },
  { icon: UserCheck, title: "Roles", desc: "Admin, Branch Manager, Agent, Viewer, Developer — plus custom roles." },
  { icon: Building2, title: "Branches", desc: "Per-branch numbers, scripts, AI employees and quotas." },
  { icon: ScrollText, title: "Audit", desc: "Sensitive actions recorded and traceable, end to end." },
]

const CONTROL = [
  { icon: UserCheck, label: "Permissions enforced in every API" },
  { icon: Ban, label: "One-click kill switch, global or per branch" },
  { icon: ShieldCheck, label: "DND lists checked before every dial" },
  { icon: Mic, label: "Recordings with spoken consent, role-gated" },
  { icon: ScrollText, label: "Audit logs on sensitive actions" },
]

const STEPS = [
  { title: "Capture", desc: "Leads arrive from forms, WhatsApp, Instagram or imports." },
  { title: "Call", desc: "Priya calls the moment the lead arrives." },
  { title: "Qualify", desc: "Your questions asked; answers and sentiment recorded." },
  { title: "Follow up", desc: "Retries, callbacks and WhatsApp nudges within calling-hour rules." },
  { title: "Send application", desc: "Secure link over WhatsApp; status tracked on the lead." },
  { title: "Hand off", desc: "Humans step in with full context when it matters." },
]

export default function ProductPage() {
  return (
    <SiteShell>
      <div className="rgpage">
        <span className="rg-eyebrow">
          <Bot size={12} strokeWidth={2} /> The product
        </span>
        <h1>
          One operations console for <span className="rg-grad">AI loan calling.</span>
        </h1>
        <p className="rg-lead">
          AI employees make the calls. Your team runs everything — scripts, branches, roles,
          compliance — from a single console built for lending teams.
        </p>
      </div>

      {/* Who it's for */}
      <section className="rg-section" style={{ paddingBottom: 0 }} aria-labelledby="who-h">
        <div className="rg-center">
          <h2 className="rg-h2" id="who-h">
            Who it&apos;s for
          </h2>
        </div>
        <div className="rg-cards">
          {WHO.map(({ icon: Icon, title, desc }) => (
            <div key={title} className="rg-glass rg-card">
              <div className="rg-card-icon">
                <Icon size={19} strokeWidth={1.9} />
              </div>
              <h3>{title}</h3>
              <p>{desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* What you get */}
      <section className="rg-section" style={{ paddingTop: 0 }} aria-labelledby="what-h">
        <div className="rg-center">
          <h2 className="rg-h2" id="what-h">
            What you get
          </h2>
        </div>
        <div className="rgint-grid" style={{ marginTop: 36 }}>
          {WHAT.map(({ icon: Icon, title, desc }) => (
            <div key={title} className="rg-glass rg-card rg-minicard">
              <div className="rgint-tag">
                <Icon size={11} strokeWidth={2.2} style={{ verticalAlign: "-1px", marginRight: 5 }} />
                Module
              </div>
              <h3>{title}</h3>
              <p>{desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Built for control */}
      <section className="rg-section" style={{ paddingTop: 0 }} aria-labelledby="control-h">
        <div className="rg-center">
          <h2 className="rg-h2" id="control-h">
            Built for <span className="rg-grad">control</span>
          </h2>
          <p className="rg-lead">
            Automation without oversight is a liability. These are always on, for every plan.
          </p>
        </div>
        <div className="rgchips">
          {CONTROL.map(({ icon: Icon, label }) => (
            <span key={label} className="rgchip">
              <Icon size={14} strokeWidth={2} />
              {label}
            </span>
          ))}
        </div>
      </section>

      {/* How it works — condensed */}
      <section className="rg-section" id="how" style={{ paddingTop: 0 }} aria-labelledby="how-h">
        <div className="rg-center">
          <h2 className="rg-h2" id="how-h">
            How it works, <span className="rg-grad">condensed</span>
          </h2>
        </div>
        <div className="rg-steps">
          {STEPS.map((s, i) => (
            <div key={s.title} className="rg-glass rg-step">
              <span className="rg-step-num">{i + 1}</span>
              <h3 style={{ marginTop: 14 }}>{s.title}</h3>
              <p>{s.desc}</p>
            </div>
          ))}
        </div>
        <div className="rg-links-row">
          <Link href="/#how">See the full six steps</Link>
          <span aria-hidden="true" style={{ color: "#3d4660" }}>
            ·
          </span>
          <Link href="/pricing">View pricing</Link>
          <span aria-hidden="true" style={{ color: "#3d4660" }}>
            ·
          </span>
          <Link href="/security">Read about security</Link>
        </div>
      </section>

      {/* CTA */}
      <section className="rg-cta" style={{ paddingTop: 0 }} aria-labelledby="product-cta-h">
        <div className="rg-glass">
          <h2 className="rg-h3" id="product-cta-h" style={{ marginTop: 0 }}>
            See the console on your own use case
          </h2>
          <div className="rg-cta-actions">
            <Link href="/demo" className="rg-btn rg-btn-primary rg-btn-lg">
              Book a Demo <ArrowRight size={16} strokeWidth={2.2} />
            </Link>
            <Link href="/#demo" className="rg-btn rg-btn-ghost rg-btn-lg">
              <Bot size={16} strokeWidth={2.1} /> Test Priya
            </Link>
          </div>
          <p className="dmc-disclosure" style={{ justifyContent: "center", marginTop: 18 }}>
            <ListChecks size={13} strokeWidth={2} />
            <span>Every demo walks through a live qualification call — not a slide deck.</span>
          </p>
        </div>
      </section>
    </SiteShell>
  )
}
