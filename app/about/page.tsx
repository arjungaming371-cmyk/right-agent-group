import Link from "next/link"
import { PhoneCall, MessageCircle, Instagram, Users, Building2, Languages, Bot, ClipboardList } from "lucide-react"
import SiteShell from "@/components/site/site-shell"

// About page — the story behind Right Agent Group. Copy discipline: same as
// the rest of the marketing site, NO invented statistics, no customer counts,
// no conversion percentages. Everything here describes what the product DOES.
const CAPABILITIES = [
  {
    icon: PhoneCall,
    title: "Voice AI that actually qualifies",
    desc: "Priya places and answers calls, speaks English, Hindi and Telugu naturally, asks the qualification questions your team asks, and logs every detail back into the CRM.",
  },
  {
    icon: MessageCircle,
    title: "WhatsApp that follows up",
    desc: "Application form links, reminders and answers over the official WhatsApp Business Cloud API — with the AI and your humans sharing one conversation history.",
  },
  {
    icon: Instagram,
    title: "Instagram lead capture",
    desc: "DMs and comments become CRM prospects. The AI responds instantly, extracts phone numbers, and promotes real prospects into the dialing pipeline.",
  },
  {
    icon: Users,
    title: "A CRM built for loan sales",
    desc: "Lead scores, lane separation, follow-ups, callbacks, call recordings, transcripts and AI memory — one 360° view of every customer.",
  },
  {
    icon: Building2,
    title: "Multi-branch by design",
    desc: "Every branch carries its own phone number, WhatsApp number, branding, quotas and AI employees — while head office keeps one command center.",
  },
  {
    icon: Languages,
    title: "Built for Indian customers",
    desc: "English, Hindi and Telugu conversations — spoken the way customers actually speak, with roman-script transcripts your team can read at a glance.",
  },
]

const PRINCIPLES = [
  {
    icon: Bot,
    title: "AI employees, not IVR menus",
    desc: "Customers talk to a colleague, not a keypad tree. The AI listens, answers objections, and hands over to a human the moment frustration or a complex request appears.",
  },
  {
    icon: ClipboardList,
    title: "Honest software",
    desc: "Every number in the dashboard comes from your real pipeline. No vanity metrics, no invented statistics — the console shows exactly what happened, and nothing else.",
  },
]

export default function AboutPage() {
  return (
    <SiteShell>
      <div className="rgpage">
        <span className="rg-eyebrow">
          <Building2 size={12} strokeWidth={2} /> About
        </span>
        <h1>
          Your sales team, <span className="rg-grad">multiplied.</span>
        </h1>
        <p className="rg-lead">
          Right Agent Group builds AI employees that turn leads into loan applications. We started
          with a simple observation: loan businesses lose most opportunities not to bad products,
          but to calls that were never made, follow-ups that slipped, and leads sitting in spreadsheets.
        </p>
      </div>

      <section className="rg-section" style={{ paddingTop: 20 }}>
        <div className="rgsec-grid">
          {CAPABILITIES.map(({ icon: Icon, title, desc }) => (
            <div key={title} className="rg-glass rgsec-card">
              <h3>
                <Icon size={17} strokeWidth={2} />
                {title}
              </h3>
              <p>{desc}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="rg-section" style={{ paddingTop: 0 }}>
        <div className="rg-center">
          <h2 style={{ fontSize: "clamp(22px, 3vw, 32px)", fontWeight: 800, letterSpacing: "-0.02em", color: "#fff", margin: 0 }}>
            How we think about the work
          </h2>
        </div>
        <div className="rgsec-grid">
          {PRINCIPLES.map(({ icon: Icon, title, desc }) => (
            <div key={title} className="rg-glass rgsec-card">
              <h3>
                <Icon size={17} strokeWidth={2} />
                {title}
              </h3>
              <p>{desc}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="rg-section rg-cta" style={{ paddingTop: 0 }}>
        <div className="rg-glass">
          <h2 style={{ fontSize: "clamp(22px, 3vw, 30px)", fontWeight: 800, letterSpacing: "-0.02em", color: "#fff", margin: 0 }}>
            Hear your AI employee before you buy anything
          </h2>
          <p className="rg-lead" style={{ margin: "14px auto 0" }}>
            Book a demo and Priya will call you — in English, Hindi or Telugu — the same way she
            would call your customers.
          </p>
          <div className="rg-center" style={{ marginTop: 22 }}>
            <Link href="/demo" className="rg-btn rg-btn-primary">
              Book a Demo
            </Link>
            <Link href="/product" className="rg-btn rg-btn-ghost" style={{ marginLeft: 10 }}>
              Explore the Product
            </Link>
          </div>
        </div>
      </section>
    </SiteShell>
  )
}
