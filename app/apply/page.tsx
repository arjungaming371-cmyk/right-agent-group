"use client"
import Link from "next/link"
import {
  Phone,
  MessageCircle,
  Brain,
  Users,
  ArrowRight,
  Sparkles,
  Languages,
  BarChart3,
  CheckCircle2,
  Clock,
  ShieldCheck,
  PhoneCall,
  FileText,
  Send as SendIcon,
} from "lucide-react"
import { Reveal } from "./Reveal"
import { VoicePlayer } from "./VoicePlayer"
import { ApplicationForm } from "./ApplicationForm"

const NAV_LINKS = [
  { href: "#voice", label: "Hear Priya" },
  { href: "#features", label: "Features" },
  { href: "#how", label: "How it works" },
  { href: "#pricing", label: "Pricing" },
  { href: "#apply", label: "Apply" },
]

// Capability claims only — no invented usage numbers or unverified
// performance metrics (this page used to claim "10,000+ calls/day" and
// "<2s average reply latency" with nothing behind either figure).
const STATS = [
  { value: "3", label: "languages, mid-conversation" },
  { value: "24/7", label: "never off shift" },
  { value: "Live", label: "sentiment tracked every call" },
  { value: "Streamed", label: "replies, not a static script" },
]

const FEATURES = [
  {
    icon: Phone,
    title: "Human-sounding voice calls",
    desc: "Priya calls, listens, and replies with natural pacing — not a script read aloud. Sentiment is tracked live on every call.",
  },
  {
    icon: Languages,
    title: "English, Hindi & Telugu",
    desc: "Code-switches mid-sentence exactly like your customers do — Roman-script Tenglish/Hinglish included.",
  },
  {
    icon: Brain,
    title: "Groq-fast AI brain",
    desc: "Llama 3.3 70B inference keeps replies near-instant, so calls feel like a conversation, not a queue.",
  },
  {
    icon: MessageCircle,
    title: "Automatic WhatsApp follow-up",
    desc: "Every call ends with a personalized WhatsApp message and application link sent without lifting a finger.",
  },
  {
    icon: Users,
    title: "Built-in lead pipeline",
    desc: "Every conversation is scored, tagged, and dropped straight into a pipeline your team can work from day one.",
  },
  {
    icon: ShieldCheck,
    title: "Compliance & security",
    desc: "Do-not-call lists, encrypted recordings, audit trails, and role-based access — enterprise-ready out of the box.",
  },
]

const STEPS = [
  { icon: FileText, title: "Upload your leads", desc: "CSV, CRM export, or connect your pipeline — Priya starts calling within minutes." },
  { icon: PhoneCall, title: "Priya calls & qualifies", desc: "Natural conversations in the customer's language, with objections handled and interest scored." },
  { icon: BarChart3, title: "You get the dashboard", desc: "Live sentiment, call recordings, transcripts, and a ranked lead queue in one console." },
  { icon: SendIcon, title: "Close the deal", desc: "Hot leads are WhatsApped and handed to your team the moment a customer says yes." },
]

// Hypothetical usage patterns — deliberately no invented headline numbers
// (this used to say "5,000 leads in under 3 days" etc. with nothing behind
// the figures). Kept qualitative on purpose; the "Illustrative scenarios"
// disclaimer below only works if the copy itself doesn't smuggle in fake data.
const USE_CASES = [
  {
    tag: "Example scenario",
    title: "NBFC — home loan outreach",
    detail: "A batch of warm leads called in Telugu and Hindi, with automatic WhatsApp EMI calculators sent to every interested lead.",
  },
  {
    tag: "Example scenario",
    title: "Bank — personal loan re-engagement",
    detail: "Dormant leads from past months re-qualified overnight, surfacing the ones still shopping for a rate before a human ever dials.",
  },
  {
    tag: "Example scenario",
    title: "DSA network — multi-branch coverage",
    detail: "One AI voice agent covering call volume across multiple branches, with per-branch dashboards and compliance logs.",
  },
]

const PLANS = [
  {
    name: "Starter",
    price: "₹24,999",
    period: "/month",
    tagline: "For a single branch or small team getting started",
    features: ["Up to 2,000 calls / month", "1 language", "WhatsApp follow-up", "Dashboard access", "Email support"],
    cta: "Apply for Starter",
    highlight: false,
  },
  {
    name: "Growth",
    price: "₹59,999",
    period: "/month",
    tagline: "For teams scaling outbound across regions",
    features: [
      "Up to 10,000 calls / month",
      "English, Hindi & Telugu",
      "Sentiment analytics",
      "Lead pipeline + scoring",
      "Priority support",
    ],
    cta: "Apply for Growth",
    highlight: true,
  },
  {
    name: "Scale",
    price: "Custom",
    period: "",
    tagline: "For banks, NBFCs & large DSA networks",
    features: [
      "Unlimited call volume",
      "Dedicated infrastructure",
      "Custom integrations & CRM sync",
      "Onboarding manager",
      "SLA-backed uptime",
    ],
    cta: "Talk to sales",
    highlight: false,
  },
]

export default function ApplyPage() {
  return (
    <main style={{ minHeight: "100vh", overflowX: "hidden" }}>
      {/* Nav */}
      <header
        className="glass"
        style={{ position: "sticky", top: 0, zIndex: 50, borderBottom: "1px solid var(--border-light)" }}
      >
        <div
          className="flex items-center justify-between"
          style={{ maxWidth: 1180, margin: "0 auto", padding: "14px 20px" }}
        >
          <Link href="/apply" style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div
              style={{
                width: 32,
                height: 32,
                borderRadius: 9,
                background: "var(--gradient-brand)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontWeight: 800,
                color: "#fff",
                fontSize: 15,
                boxShadow: "0 4px 14px -3px rgba(91,124,250,0.5)",
              }}
            >
              R
            </div>
            <span style={{ fontWeight: 700, fontSize: 15, color: "var(--text-primary)" }}>Right Agent Group</span>
          </Link>
          <nav className="hidden md:flex" style={{ gap: 28 }}>
            {NAV_LINKS.map((l) => (
              <a key={l.href} href={l.href} style={{ fontSize: 13.5, color: "var(--text-secondary)", fontWeight: 500 }}>
                {l.label}
              </a>
            ))}
          </nav>
          <a href="#apply" className="btn-primary">
            Apply now
          </a>
        </div>
      </header>

      {/* Hero */}
      <section style={{ position: "relative", padding: "100px 20px 80px", overflow: "hidden" }}>
        <div
          aria-hidden
          style={{
            position: "absolute",
            top: "-10%",
            left: "-10%",
            width: 480,
            height: 480,
            borderRadius: "50%",
            background: "radial-gradient(circle, rgba(139,124,255,0.35), transparent 70%)",
            filter: "blur(20px)",
            animation: "blobFloat1 14s ease-in-out infinite, heroGlow 6s ease-in-out infinite",
          }}
        />
        <div
          aria-hidden
          style={{
            position: "absolute",
            top: "10%",
            right: "-10%",
            width: 420,
            height: 420,
            borderRadius: "50%",
            background: "radial-gradient(circle, rgba(56,189,248,0.3), transparent 70%)",
            filter: "blur(20px)",
            animation: "blobFloat2 16s ease-in-out infinite",
          }}
        />

        <div style={{ maxWidth: 900, margin: "0 auto", textAlign: "center", position: "relative" }}>
          <Reveal>
            <div
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 8,
                padding: "6px 14px",
                borderRadius: 999,
                background: "rgba(139,124,255,0.1)",
                border: "1px solid rgba(139,124,255,0.3)",
                fontSize: 12.5,
                fontWeight: 600,
                color: "var(--accent-purple)",
                marginBottom: 24,
              }}
            >
              <Sparkles size={14} />
              Meet Priya — your AI voice agent
            </div>
          </Reveal>

          <Reveal delay={80}>
            <h1
              style={{
                fontSize: "clamp(32px, 6vw, 62px)",
                fontWeight: 800,
                lineHeight: 1.08,
                letterSpacing: "-0.03em",
                color: "var(--text-primary)",
                marginBottom: 22,
              }}
            >
              An AI voice agent that calls, sells, and{" "}
              <span className="gradient-text">never clocks out</span>
            </h1>
          </Reveal>

          <Reveal delay={160}>
            <p
              style={{
                fontSize: 17,
                color: "var(--text-secondary)",
                lineHeight: 1.7,
                maxWidth: 620,
                margin: "0 auto 36px",
              }}
            >
              Priya calls your leads in English, Hindi, and Telugu, qualifies them like a real relationship manager,
              and hands your team the ones ready to close — all on autopilot, running every month for a fixed price.
            </p>
          </Reveal>

          <Reveal delay={240}>
            <div className="flex items-center justify-center" style={{ gap: 14, flexWrap: "wrap" }}>
              <a href="#apply" className="btn-primary" style={{ height: 46, padding: "0 24px", fontSize: 14 }}>
                Apply now <ArrowRight size={16} />
              </a>
              <a href="#voice" className="btn-ghost" style={{ height: 46, padding: "0 24px", fontSize: 14 }}>
                Hear Priya speak
              </a>
            </div>
          </Reveal>

          <Reveal delay={320}>
            <div
              className="grid grid-cols-2 md:grid-cols-4"
              style={{ gap: 20, marginTop: 64, maxWidth: 760, marginLeft: "auto", marginRight: "auto" }}
            >
              {STATS.map((s) => (
                <div key={s.label}>
                  <div className="gradient-text" style={{ fontSize: 26, fontWeight: 800 }}>
                    {s.value}
                  </div>
                  <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 4 }}>{s.label}</div>
                </div>
              ))}
            </div>
          </Reveal>
        </div>
      </section>

      {/* Marquee */}
      <div style={{ borderTop: "1px solid var(--border-light)", borderBottom: "1px solid var(--border-light)", padding: "18px 0", overflow: "hidden" }}>
        <div style={{ display: "flex", width: "max-content", animation: "marqueeScroll 26s linear infinite" }}>
          {[...Array(2)].map((_, dup) => (
            <div key={dup} style={{ display: "flex", gap: 48, paddingRight: 48 }}>
              {["Home Loans", "Personal Loans", "Business Loans", "Gold Loans", "Insurance", "Credit Cards", "NBFC Outreach", "Bank Campaigns"].map(
                (item) => (
                  <span key={item} style={{ fontSize: 13, fontWeight: 600, color: "var(--text-muted)", whiteSpace: "nowrap" }}>
                    {item}
                  </span>
                )
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Voice demos */}
      <section id="voice" style={{ padding: "100px 20px", maxWidth: 1180, margin: "0 auto" }}>
        <Reveal>
          <div style={{ textAlign: "center", marginBottom: 48 }}>
            <h2 style={{ fontSize: "clamp(26px, 4vw, 38px)", fontWeight: 800, color: "var(--text-primary)", marginBottom: 12 }}>
              Hear Priya in her own voice
            </h2>
            <p style={{ fontSize: 15, color: "var(--text-secondary)", maxWidth: 560, margin: "0 auto" }}>
              Real synthesized samples — the exact voice engine used on live calls. No actors, no scripts read by a
              human.
            </p>
          </div>
        </Reveal>
        <div className="grid grid-cols-1 md:grid-cols-3" style={{ gap: 20 }}>
          <Reveal delay={0}>
            <VoicePlayer label="English" flag="🇬🇧" blurb="Indian-English, expressive" src="/promo/audio/priya-english.mp3" />
          </Reveal>
          <Reveal delay={100}>
            <VoicePlayer label="Hindi" flag="🇮🇳" blurb="हिंदी — native script" src="/promo/audio/priya-hindi.mp3" />
          </Reveal>
          <Reveal delay={200}>
            <VoicePlayer label="Telugu" flag="🇮🇳" blurb="తెలుగు — native script" src="/promo/audio/priya-telugu.mp3" />
          </Reveal>
        </div>
      </section>

      {/* Features */}
      <section id="features" style={{ padding: "40px 20px 100px", maxWidth: 1180, margin: "0 auto" }}>
        <Reveal>
          <div style={{ textAlign: "center", marginBottom: 48 }}>
            <h2 style={{ fontSize: "clamp(26px, 4vw, 38px)", fontWeight: 800, color: "var(--text-primary)", marginBottom: 12 }}>
              Everything a call center does. None of the overhead.
            </h2>
          </div>
        </Reveal>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3" style={{ gap: 18 }}>
          {FEATURES.map((f, i) => {
            const Icon = f.icon
            return (
              <Reveal key={f.title} delay={(i % 3) * 90}>
                <div className="card" style={{ padding: 24, height: "100%" }}>
                  <div
                    style={{
                      width: 42,
                      height: 42,
                      borderRadius: 11,
                      background: "rgba(91,124,250,0.12)",
                      border: "1px solid rgba(91,124,250,0.25)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      marginBottom: 16,
                    }}
                  >
                    <Icon size={20} style={{ color: "var(--accent-blue)" }} />
                  </div>
                  <div style={{ fontSize: 15.5, fontWeight: 700, color: "var(--text-primary)", marginBottom: 8 }}>{f.title}</div>
                  <div style={{ fontSize: 13.5, color: "var(--text-secondary)", lineHeight: 1.65 }}>{f.desc}</div>
                </div>
              </Reveal>
            )
          })}
        </div>
      </section>

      {/* How it works */}
      <section id="how" style={{ padding: "40px 20px 100px", background: "var(--bg-secondary)" }}>
        <div style={{ maxWidth: 1180, margin: "0 auto" }}>
          <Reveal>
            <div style={{ textAlign: "center", marginBottom: 56 }}>
              <h2 style={{ fontSize: "clamp(26px, 4vw, 38px)", fontWeight: 800, color: "var(--text-primary)", marginBottom: 12 }}>
                Live in four steps
              </h2>
            </div>
          </Reveal>
          <div className="grid grid-cols-1 md:grid-cols-4" style={{ gap: 24, position: "relative" }}>
            {STEPS.map((s, i) => {
              const Icon = s.icon
              return (
                <Reveal key={s.title} delay={i * 110}>
                  <div style={{ textAlign: "center", position: "relative" }}>
                    <div
                      style={{
                        width: 56,
                        height: 56,
                        borderRadius: "50%",
                        background: "var(--gradient-brand)",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        margin: "0 auto 18px",
                        boxShadow: "var(--shadow-glow)",
                      }}
                    >
                      <Icon size={22} color="#fff" />
                    </div>
                    <div style={{ fontSize: 12, fontWeight: 700, color: "var(--accent-purple)", marginBottom: 6 }}>
                      STEP {i + 1}
                    </div>
                    <div style={{ fontSize: 15, fontWeight: 700, color: "var(--text-primary)", marginBottom: 8 }}>{s.title}</div>
                    <div style={{ fontSize: 13, color: "var(--text-secondary)", lineHeight: 1.6 }}>{s.desc}</div>
                  </div>
                </Reveal>
              )
            })}
          </div>
        </div>
      </section>

      {/* Use cases */}
      <section style={{ padding: "100px 20px", maxWidth: 1180, margin: "0 auto" }}>
        <Reveal>
          <div style={{ textAlign: "center", marginBottom: 48 }}>
            <h2 style={{ fontSize: "clamp(26px, 4vw, 38px)", fontWeight: 800, color: "var(--text-primary)", marginBottom: 12 }}>
              Where teams put Priya to work
            </h2>
            <p style={{ fontSize: 13, color: "var(--text-muted)" }}>
              Illustrative scenarios — not claims about a specific customer.
            </p>
          </div>
        </Reveal>
        <div className="grid grid-cols-1 md:grid-cols-3" style={{ gap: 20 }}>
          {USE_CASES.map((u, i) => (
            <Reveal key={u.title} delay={i * 100}>
              <div className="card" style={{ padding: 26, height: "100%" }}>
                <div
                  style={{
                    display: "inline-block",
                    fontSize: 11,
                    fontWeight: 700,
                    color: "var(--accent-cyan)",
                    background: "rgba(56,189,248,0.1)",
                    border: "1px solid rgba(56,189,248,0.25)",
                    borderRadius: 999,
                    padding: "3px 10px",
                    marginBottom: 14,
                  }}
                >
                  {u.tag}
                </div>
                <div style={{ fontSize: 16, fontWeight: 700, color: "var(--text-primary)", marginBottom: 10 }}>{u.title}</div>
                <div style={{ fontSize: 13.5, color: "var(--text-secondary)", lineHeight: 1.65 }}>{u.detail}</div>
              </div>
            </Reveal>
          ))}
        </div>
      </section>

      {/* Pricing */}
      <section id="pricing" style={{ padding: "40px 20px 110px", maxWidth: 1180, margin: "0 auto" }}>
        <Reveal>
          <div style={{ textAlign: "center", marginBottom: 16 }}>
            <h2 style={{ fontSize: "clamp(26px, 4vw, 38px)", fontWeight: 800, color: "var(--text-primary)", marginBottom: 12 }}>
              Simple monthly pricing
            </h2>
            <p style={{ fontSize: 13, color: "var(--text-muted)", maxWidth: 500, margin: "0 auto" }}>
              Indicative pricing shown below — apply and we'll confirm the final number for your call volume on a
              quick call.
            </p>
          </div>
        </Reveal>
        <div className="grid grid-cols-1 md:grid-cols-3" style={{ gap: 22, marginTop: 40, alignItems: "stretch" }}>
          {PLANS.map((p, i) => (
            <Reveal key={p.name} delay={i * 100}>
              <div
                className="card"
                style={{
                  padding: 30,
                  height: "100%",
                  display: "flex",
                  flexDirection: "column",
                  position: "relative",
                  border: p.highlight ? "1px solid var(--accent-blue)" : undefined,
                  boxShadow: p.highlight ? "var(--shadow-glow)" : "var(--shadow-soft)",
                  transform: p.highlight ? "scale(1.03)" : undefined,
                }}
              >
                {p.highlight && (
                  <div
                    style={{
                      position: "absolute",
                      top: -13,
                      left: "50%",
                      transform: "translateX(-50%)",
                      background: "var(--gradient-brand)",
                      color: "#fff",
                      fontSize: 11,
                      fontWeight: 700,
                      padding: "4px 14px",
                      borderRadius: 999,
                    }}
                  >
                    MOST POPULAR
                  </div>
                )}
                <div style={{ fontSize: 15, fontWeight: 700, color: "var(--text-primary)", marginBottom: 6 }}>{p.name}</div>
                <div style={{ display: "flex", alignItems: "baseline", gap: 4, marginBottom: 8 }}>
                  <span style={{ fontSize: 32, fontWeight: 800, color: "var(--text-primary)" }}>{p.price}</span>
                  <span style={{ fontSize: 13, color: "var(--text-muted)" }}>{p.period}</span>
                </div>
                <div style={{ fontSize: 12.5, color: "var(--text-secondary)", marginBottom: 22 }}>{p.tagline}</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 11, marginBottom: 26, flex: 1 }}>
                  {p.features.map((f) => (
                    <div key={f} style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
                      <CheckCircle2 size={16} style={{ color: "var(--accent-green)", flexShrink: 0, marginTop: 1 }} />
                      <span style={{ fontSize: 13, color: "var(--text-secondary)" }}>{f}</span>
                    </div>
                  ))}
                </div>
                <a href="#apply" className={p.highlight ? "btn-primary" : "btn-ghost"} style={{ width: "100%", height: 42 }}>
                  {p.cta}
                </a>
              </div>
            </Reveal>
          ))}
        </div>
      </section>

      {/* Apply form */}
      <section id="apply" style={{ padding: "20px 20px 120px", background: "var(--bg-secondary)" }}>
        <div style={{ maxWidth: 640, margin: "0 auto" }}>
          <Reveal>
            <div style={{ textAlign: "center", marginBottom: 36 }}>
              <div
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "6px 14px",
                  borderRadius: 999,
                  background: "rgba(45,212,160,0.1)",
                  border: "1px solid rgba(45,212,160,0.3)",
                  fontSize: 12.5,
                  fontWeight: 600,
                  color: "var(--accent-green)",
                  marginBottom: 18,
                }}
              >
                <Clock size={14} />
                Usually a reply within one business day
              </div>
              <h2 style={{ fontSize: "clamp(26px, 4vw, 34px)", fontWeight: 800, color: "var(--text-primary)", marginBottom: 10 }}>
                Apply to put Priya to work
              </h2>
              <p style={{ fontSize: 14, color: "var(--text-secondary)" }}>
                Tell us a bit about your business — we'll follow up to confirm pricing and get you set up.
              </p>
            </div>
          </Reveal>
          <Reveal delay={100}>
            <ApplicationForm />
          </Reveal>
        </div>
      </section>

      {/* Footer */}
      <footer style={{ borderTop: "1px solid var(--border-light)", padding: "36px 20px" }}>
        <div
          className="flex flex-col md:flex-row items-center justify-between"
          style={{ maxWidth: 1180, margin: "0 auto", gap: 16 }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div
              style={{
                width: 26,
                height: 26,
                borderRadius: 7,
                background: "var(--gradient-brand)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontWeight: 800,
                color: "#fff",
                fontSize: 12,
              }}
            >
              R
            </div>
            <span style={{ fontSize: 13, color: "var(--text-muted)" }}>© {new Date().getFullYear()} Right Agent Group</span>
          </div>
          <div style={{ display: "flex", gap: 20 }}>
            <Link href="/about" style={{ fontSize: 13, color: "var(--text-muted)" }}>
              About
            </Link>
            <Link href="/login" style={{ fontSize: 13, color: "var(--text-muted)" }}>
              Team login
            </Link>
            <a href="#apply" style={{ fontSize: 13, color: "var(--text-muted)" }}>
              Apply
            </a>
          </div>
        </div>
      </footer>
    </main>
  )
}
