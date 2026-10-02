"use client"

// Help Center — a client island for search (title + body filtering), wrapped
// in the shared site chrome. Content describes capabilities and where they
// live in the console; no step-by-step UI instructions that could drift from
// the real product.
import { useMemo, useState } from "react"
import {
  Rocket, Bot, PhoneCall, MessageCircle, Users, FileText, Building2, UserCheck,
  BarChart3, ShieldCheck, Wrench, Search,
} from "lucide-react"
import SiteShell from "@/components/site/site-shell"

type Article = { title: string; body: string }
type Category = { name: string; icon: React.ComponentType<{ size?: number; strokeWidth?: number }>; articles: Article[] }

const CATEGORIES: Category[] = [
  {
    name: "Getting Started",
    icon: Rocket,
    articles: [
      {
        title: "Deploying the platform",
        body: "Right Agent Group deploys on your own server against your own PostgreSQL database. The deployment guide covers environment variables, provider keys and first-run checks — your data never leaves infrastructure you control.",
      },
      {
        title: "Signing in to the console",
        body: "Team members sign in with Google sign-in. Access is limited to allowlisted email addresses, and admins can additionally require two-factor. If you can't sign in, ask your Admin to check the allowlist.",
      },
      {
        title: "Understanding roles",
        body: "Five built-in roles — Admin, Branch Manager, Agent, Viewer and Developer — control what each person sees and can do, and custom roles can be created for specific needs. Permissions are enforced on every API call, not just in the interface.",
      },
    ],
  },
  {
    name: "AI Employees",
    icon: Bot,
    articles: [
      {
        title: "Creating an AI employee",
        body: "AI Employees are managed from their own console screen. You define the employee's name, script, languages and channels, and scope them to branches. Each employee works the channels you assign — phone, WhatsApp or both.",
      },
      {
        title: "Pausing the AI instantly",
        body: "The kill switch stops AI calls and automated messages with one click. Pausing can be scoped globally or per branch, and paused leads return to your team's manual queue — nothing is lost, everything waits.",
      },
      {
        title: "Scripts and the knowledge base",
        body: "Scripts define what the AI says and asks, per channel. The knowledge base grounds every answer: upload your FAQs as documents or CSV, and the AI quotes your approved information instead of improvising.",
      },
    ],
  },
  {
    name: "Voice Calling",
    icon: PhoneCall,
    articles: [
      {
        title: "How the call queue works",
        body: "Leads land in a call queue with the campaign's talking points attached. The AI works the queue within your calling-hour rules and DND lists, and every attempt is logged against the lead.",
      },
      {
        title: "Call outcomes and recordings",
        body: "Every call ends with an outcome, a recording and a transcript. Authorized roles can play recordings from the Calls area of the console — access is role-gated and audited.",
      },
    ],
  },
  {
    name: "WhatsApp",
    icon: MessageCircle,
    articles: [
      {
        title: "Connecting WhatsApp",
        body: "WhatsApp connects through the official Meta WhatsApp Business Cloud API — no QR codes or unofficial libraries. Number verification and webhook setup happen once, during onboarding with your team.",
      },
      {
        title: "Auto-replies and follow-ups",
        body: "The AI answers inbound WhatsApp messages and voice calls, and sends follow-ups including secure application links. Business-initiated messages follow compliance rules — DND and consent are checked before anything is sent.",
      },
    ],
  },
  {
    name: "Leads",
    icon: Users,
    articles: [
      {
        title: "Importing leads",
        body: "Upload CSV lead lists, or let leads flow in from web forms, WhatsApp and Instagram automatically. Every lead lands in one pipeline with its source recorded, so you always know where it came from.",
      },
      {
        title: "Statuses and callbacks",
        body: "Move leads through statuses as they qualify, schedule callbacks, and let the AI handle automatic retries within calling windows. Lead Brain keeps a running memory of every conversation so nobody re-asks what the customer already answered.",
      },
    ],
  },
  {
    name: "Applications",
    icon: FileText,
    articles: [
      {
        title: "Sending application forms",
        body: "Send a secure application link to any lead over WhatsApp. The customer fills the form on their phone, and submission status is tracked on the lead — no paper, no copy-paste.",
      },
    ],
  },
  {
    name: "Branches",
    icon: Building2,
    articles: [
      {
        title: "Adding a branch",
        body: "Create branches from the Branches screen. Each branch can have its own phone numbers, scripts, AI employees and call quotas. Branch staff see only their branch; Admins see everything.",
      },
    ],
  },
  {
    name: "Team Access",
    icon: UserCheck,
    articles: [
      {
        title: "Modules and permissions",
        body: "Console modules can be allotted per role, and custom roles combine the permissions your team needs. Every API request re-checks permissions server-side, so restricting the menu always restricts the capability.",
      },
    ],
  },
  {
    name: "Analytics",
    icon: BarChart3,
    articles: [
      {
        title: "Reading the qualification funnel",
        body: "Analytics cover call volume, the qualification funnel, sentiment trends and branch performance. Data can be exported for your own reporting — the console shows the same conversations the AI and your team actually had.",
      },
    ],
  },
  {
    name: "Security",
    icon: ShieldCheck,
    articles: [
      {
        title: "Kill switch, audit logs and IP allowlist",
        body: "Pause all AI activity with the kill switch, trace sensitive actions in the audit log, and restrict console access to approved network ranges with the IP allowlist. These controls live in the Security area, Admin-only.",
      },
    ],
  },
  {
    name: "Troubleshooting",
    icon: Wrench,
    articles: [
      {
        title: "Call audio and provider keys",
        body: "Most call-audio and connection problems trace to provider configuration — check provider keys, webhook status and recent errors in the developer logs view. Recordings for each call are attached to the call entry for playback.",
      },
    ],
  },
]

export default function HelpPage() {
  const [q, setQ] = useState("")

  const filtered = useMemo(() => {
    const query = q.trim().toLowerCase()
    if (!query) return CATEGORIES
    return CATEGORIES.map((c) => ({
      ...c,
      articles: c.articles.filter(
        (a) => a.title.toLowerCase().includes(query) || a.body.toLowerCase().includes(query)
      ),
    })).filter((c) => c.articles.length > 0)
  }, [q])

  const totalShown = filtered.reduce((n, c) => n + c.articles.length, 0)

  return (
    <SiteShell>
      <div className="rgpage">
        <span className="rg-eyebrow">
          <Search size={12} strokeWidth={2} /> Help Center
        </span>
        <h1>
          How can we <span className="rg-grad">help?</span>
        </h1>
        <p className="rg-lead">
          Short guides for every part of the platform — from your first sign-in to branch
          controls and provider troubleshooting.
        </p>

        <div className="rhelp-search">
          <input
            className="rgf-input"
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search articles — try “callback”, “DND”, “scripts”…"
            aria-label="Search help articles"
          />
        </div>
        {q.trim() !== "" && (
          <p className="rhelp-count" role="status">
            {totalShown} article{totalShown === 1 ? "" : "s"} matching “{q.trim()}”
          </p>
        )}
      </div>

      <section className="rg-section" style={{ paddingTop: 10 }}>
        {filtered.length === 0 ? (
          <p className="rhelp-empty">
            No articles match your search. Try a different word — or{" "}
            <a href="/demo" style={{ color: "#a5b0ff" }}>
              book a demo
            </a>{" "}
            and ask us directly.
          </p>
        ) : (
          <div className="rhelp-cats">
            {filtered.map((cat) => {
              const Icon = cat.icon
              return (
                <div key={cat.name} className="rhelp-cat">
                  <h2>
                    <Icon size={17} strokeWidth={2} />
                    {cat.name}
                  </h2>
                  <div className="rhelp-grid">
                    {cat.articles.map((a) => (
                      <article key={a.title} className="rg-glass rhelp-card">
                        <h3>{a.title}</h3>
                        <p>{a.body}</p>
                      </article>
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </section>
    </SiteShell>
  )
}
