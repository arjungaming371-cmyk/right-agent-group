import {
  Phone, MessageCircle, Instagram, Languages, AudioWaveform, Zap, LogIn, Database, KeyRound, ShieldCheck,
} from "lucide-react"
import SiteShell from "@/components/site/site-shell"

// Integrations — every card says "Works with", never "partner". These are
// the providers the platform actually integrates with; the disclaimer line
// below is required wording, not a claim.
const PROVIDERS = [
  {
    icon: Phone,
    name: "Exotel",
    what: "Telephony",
    desc: "Phone calls placed and received through Exotel, with recordings stored in your console.",
  },
  {
    icon: MessageCircle,
    name: "Meta WhatsApp Business Cloud API",
    what: "Messaging",
    desc: "Official WhatsApp messages and voice calls through Meta's Cloud API — no unofficial clients.",
  },
  {
    icon: Instagram,
    name: "Instagram",
    what: "Social",
    desc: "DMs and comment replies via the Meta Graph API, qualified into your lead pipeline.",
  },
  {
    icon: Languages,
    name: "Sarvam",
    what: "Indic AI",
    desc: "LLM, speech-to-text and text-to-speech built for Indian languages — native English, Hindi and Telugu speech.",
  },
  {
    icon: AudioWaveform,
    name: "Cartesia",
    what: "Voice",
    desc: "Alternative text-to-speech voices for deployments that want a different sound.",
  },
  {
    icon: Zap,
    name: "Groq",
    what: "LLM",
    desc: "Fast LLM inference used as the conversational engine and fallback path.",
  },
  {
    icon: LogIn,
    name: "Google",
    what: "Sign-in",
    desc: "Google sign-in for your team, with optional two-factor for admins.",
  },
  {
    icon: Database,
    name: "PostgreSQL",
    what: "Data",
    desc: "Your database, your data — the platform runs on your own PostgreSQL instance.",
  },
]

export default function IntegrationsPage() {
  return (
    <SiteShell>
      <div className="rgpage">
        <span className="rg-eyebrow">
          <ShieldCheck size={12} strokeWidth={2} /> Integrations
        </span>
        <h1>
          Works with the stack <span className="rg-grad">you already run.</span>
        </h1>
        <p className="rg-lead">
          Right Agent Group connects to the telephony, messaging and AI providers your operation
          depends on — configured per deployment, under your accounts.
        </p>
      </div>

      <section className="rg-section" style={{ paddingTop: 20 }}>
        <div className="rgint-grid">
          {PROVIDERS.map(({ icon: Icon, name, what, desc }) => (
            <div key={name} className="rg-glass rg-card rgint-card">
              <div className="rgint-tag">
                <Icon size={11} strokeWidth={2.2} style={{ verticalAlign: "-1px", marginRight: 5 }} />
                Works with · {what}
              </div>
              <h3>{name}</h3>
              <p>{desc}</p>
            </div>
          ))}
        </div>

        <div className="rgint-foot">
          <p className="rgint-line">
            <ShieldCheck size={15} strokeWidth={2} />
            <span>
              Right Agent Group works with these providers; no partnership is implied. Provider
              names and logos belong to their respective owners.
            </span>
          </p>
          <p className="rgint-line">
            <KeyRound size={15} strokeWidth={2} />
            <span>
              Provider API keys and secrets stay server-side only — they are never shipped to the
              browser or embedded in the app.
            </span>
          </p>
        </div>
      </section>
    </SiteShell>
  )
}
