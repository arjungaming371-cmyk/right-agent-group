import type { Metadata } from "next"
import Link from "next/link"
import {
  Sparkles, ArrowRight, Bot, Clock, Activity, Phone, MessageCircle, Instagram,
  FileText, PhoneCall, ListChecks, RefreshCw, Send, Users, Brain, Building2,
  UserCheck, ShieldCheck, BarChart3, Languages, Calculator, ChevronDown,
} from "lucide-react"
import EmiCalculator from "@/components/emi-calculator"
import DemoChat from "@/components/site/demo-chat"
import SiteShell from "@/components/site/site-shell"

// PUBLIC HOMEPAGE — the website's front door.
//
// Structure: hero → the manual-calling problem (#why) → six-step funnel
// (#how) → live text demo of Priya (#demo) → channels → platform bento
// (#platform) → EMI calculator → FAQ → final CTA. Static sections render
// zero client JS; the only islands are the demo chat and the EMI calculator.
//
// Copy discipline: capability claims only. NO invented statistics (no %, no
// volume numbers, no customer counts), no customer quotes, no certification
// claims — integrations are "Works with", security is "controls implemented
// in the platform".

export const metadata: Metadata = {
  title: "AI Loan Calling & Lead Management Platform",
  description:
    "Priya, your AI loan agent, automatically calls, qualifies, follows up and manages loan leads across Phone, WhatsApp and Instagram — with multi-branch control, compliance gates and humans in charge.",
}

// Pipeline chips for the "manual vs Priya" comparison — capability framing,
// not invented metrics.
const TRADITIONAL_FLOW = [
  "Lead arrives",
  "Employee calls",
  "No answer",
  "Manual follow-up",
  "WhatsApp copy-paste",
  "Application on paper",
  "CRM updated by hand",
  "Manager checks spreadsheets",
]

const PRIYA_FLOW = [
  "Lead arrives",
  "AI calls instantly",
  "AI qualifies",
  "AI answers questions",
  "WhatsApp follow-up",
  "Application link",
  "Human handoff when needed",
  "Complete audit trail",
]

const HOW_STEPS = [
  {
    icon: FileText,
    title: "Capture lead",
    desc: "Web forms, WhatsApp, Instagram and imported lists land in one pipeline.",
  },
  {
    icon: PhoneCall,
    title: "AI calls",
    desc: "Priya calls over phone or WhatsApp voice the moment a lead arrives.",
  },
  {
    icon: ListChecks,
    title: "Qualify customer",
    desc: "Asks your qualification questions, records answers and sentiment.",
  },
  {
    icon: RefreshCw,
    title: "Follow up",
    desc: "Automatic retries, callbacks and WhatsApp nudges — within calling-hour rules.",
  },
  {
    icon: Send,
    title: "Send application",
    desc: "A secure application link over WhatsApp; status tracked on the lead.",
  },
  {
    icon: Users,
    title: "Human handoff",
    desc: "Frustration, complex questions or high-value leads go to your team with full context.",
  },
]

const CHANNELS = [
  {
    icon: Phone,
    title: "Phone",
    desc: "Exotel-powered voice calls with recordings — outbound campaigns and inbound answering, with every call logged.",
    points: [
      "Calls placed inside your calling-window rules",
      "Recordings and transcripts in the console",
      "DND lists checked before every dial",
    ],
  },
  {
    icon: MessageCircle,
    title: "WhatsApp",
    desc: "Voice calls, messages and application links on the channel your customers already use.",
    points: [
      "Voice calls and messages answered by the AI",
      "Secure application links with status tracked",
      "Follow-ups and nudges, compliance-gated",
    ],
  },
  {
    icon: Instagram,
    title: "Instagram",
    desc: "DMs and comment replies qualified into leads — interest captured the moment it appears.",
    points: [
      "Instant comment replies on your posts",
      "DM conversations with the same AI brain",
      "Interested contacts routed into your pipeline",
    ],
  },
]

const PLATFORM = [
  {
    icon: Brain,
    title: "Lead Brain",
    wide: true,
    desc: "AI remembers every conversation per lead — known facts, summaries and sentiment history, so no customer is ever re-asked what they already said and your team walks into every follow-up fully briefed.",
  },
  {
    icon: Building2,
    title: "Multi-branch",
    desc: "Per-branch numbers, scripts, AI employees and quotas — one console, many offices.",
  },
  {
    icon: UserCheck,
    title: "Roles & permissions",
    desc: "Admin, Branch Manager, Agent, Viewer and Developer roles — plus custom roles. Every API enforces permissions server-side.",
  },
  {
    icon: ShieldCheck,
    title: "Compliance",
    desc: "DND lists, calling windows and consent — enforced at dial time, fail-closed, not by policy documents.",
  },
  {
    icon: BarChart3,
    title: "Analytics",
    desc: "Calls, qualification funnel, sentiment and branch performance — with exports.",
  },
  {
    icon: Languages,
    title: "Native speech",
    desc: "English, Hindi and Telugu — Priya speaks native Indic scripts, not transliteration, and code-switches mid-conversation.",
  },
]

const FAQS = [
  {
    q: "Is the AI disclosed to customers?",
    a: "Yes. Conversations open with an AI disclosure and a recording consent notice before the call proceeds. Customers always know they are speaking with an AI employee — and every conversation is recorded and reviewable by your team.",
  },
  {
    q: "Can I stop the AI instantly?",
    a: "Yes. A one-click pause stops AI calls and automated messages — scoped globally or per branch — and your team takes over the queue immediately.",
  },
  {
    q: "What about do-not-call numbers?",
    a: "DND lists are enforced before every dial. Numbers on the list are suppressed automatically, and calls are only placed inside your permitted calling windows.",
  },
  {
    q: "Which languages does Priya speak?",
    a: "English, Hindi and Telugu with native Indic speech — not transliteration. She code-switches mid-conversation the way customers actually talk.",
  },
  {
    q: "What happens when a customer is frustrated or asks for a human?",
    a: "The AI detects frustration and human requests mid-conversation and hands the lead to your team with full context — transcript, sentiment and history.",
  },
  {
    q: "How do we get started?",
    a: "Book a demo. We walk you through a live qualification call, set up your script and knowledge base, and plan the rollout branch by branch.",
  },
]

export default function HomePage() {
  return (
    <SiteShell>
      {/* ================= HERO ================= */}
      <header className="rg-hero">
        <div>
          <span className="rg-eyebrow">
            <Sparkles size={12} strokeWidth={2} />
            AI loan calling &amp; lead management
          </span>
          <h1>
            Turn Every Loan Lead Into a <span className="rg-grad">Conversation.</span>
          </h1>
          <p className="rg-sub">
            AI employees automatically call, qualify, follow up and manage loan leads across
            Phone, WhatsApp and Instagram — from one powerful operations console.
          </p>
          <div className="rg-hero-cta">
            <Link href="/demo" className="rg-btn rg-btn-primary">
              Book a Demo <ArrowRight size={15} strokeWidth={2.2} />
            </Link>
            <a href="#demo" className="rg-btn rg-btn-ghost">
              <Bot size={16} strokeWidth={2.1} /> Test Priya
            </a>
          </div>
          <p className="rg-trust">
            <ShieldCheck size={14} strokeWidth={2} />
            <span>
              Works with your Phone, WhatsApp Business and Instagram — AI disclosed, humans in
              control.
            </span>
          </p>
        </div>

        {/* Product vignette — a quiet, static mock of the console: a live
            call card plus a WhatsApp exchange. aria-hidden, CSS only, and
            deliberately free of invented dashboard numbers. */}
        <div className="rg-glass rg-vignette rg-float" aria-hidden="true">
          <div className="rg-vbar">
            <span className="rg-dot" />
            <span className="rg-dot" />
            <span className="rg-dot" />
          </div>
          <div className="rg-vbody">
            <div className="rg-callcard">
              <span className="rg-pulse" />
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 12.5, fontWeight: 600, color: "#d9efe6" }}>
                  Priya · live call
                </div>
                <div style={{ fontSize: 11, color: "#7ba694", marginTop: 2 }}>
                  Voice agent speaking Telugu · sentiment: positive
                </div>
              </div>
              <Activity size={16} style={{ color: "#2dd4a0" }} />
            </div>
            <div className="rg-vrow">
              <div className="rg-bubble rg-in">Sir, loan cheyyadaniki interest vundhaa?</div>
            </div>
            <div className="rg-vrow">
              <div className="rg-bubble rg-out">
                Definitely! Tell me the amount and tenure you have in mind, and I&apos;ll work
                through the EMI with you.
              </div>
            </div>
            <div className="rg-vrow">
              <div className="rg-bubble rg-in">5 lakhs, 3 years</div>
            </div>
            <div className="rg-vrow">
              <div className="rg-bubble rg-out">
                Noted ✓ — I&apos;ve sent the EMI schedule and a secure application link on
                WhatsApp. A colleague from the team can take over any time you prefer.
              </div>
            </div>
          </div>
        </div>
      </header>

      {/* ================= PROBLEM ================= */}
      <section className="rg-section" id="why" aria-labelledby="why-h">
        <div className="rg-center">
          <span className="rg-eyebrow">
            <Clock size={12} strokeWidth={2} /> The problem
          </span>
          <h2 className="rg-h2" id="why-h">
            Manual loan calling <span className="rg-grad">breaks down fast.</span>
          </h2>
          <p className="rg-lead">
            Leads arrive all day — but a human team can only dial so many numbers, chase so many
            callbacks, and update so many spreadsheets before things slip.
          </p>
        </div>

        <div className="rg-flows">
          <div className="rg-glass rg-flow rg-flow-bad">
            <div className="rg-flow-head">
              <Clock size={17} strokeWidth={2} style={{ color: "#fb5670" }} />
              Traditional process
            </div>
            <div className="rg-flowsteps">
              {TRADITIONAL_FLOW.map((step, i) => (
                <span key={step} style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                  {i > 0 && (
                    <span className="rg-flow-arrow" aria-hidden="true">
                      <ArrowRight size={13} strokeWidth={2} />
                    </span>
                  )}
                  <span className="rg-flowstep">{step}</span>
                </span>
              ))}
            </div>
          </div>

          <div className="rg-glass rg-flow rg-flow-good">
            <div className="rg-flow-head">
              <Bot size={17} strokeWidth={2} style={{ color: "#2dd4a0" }} />
              With Priya
            </div>
            <div className="rg-flowsteps">
              {PRIYA_FLOW.map((step, i) => (
                <span key={step} style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                  {i > 0 && (
                    <span className="rg-flow-arrow" aria-hidden="true">
                      <ArrowRight size={13} strokeWidth={2} />
                    </span>
                  )}
                  <span className="rg-flowstep">{step}</span>
                </span>
              ))}
            </div>
          </div>
        </div>

        <p className="rg-flowline">Same team. Every lead contacted. Nothing left in a spreadsheet.</p>
      </section>

      {/* ================= HOW IT WORKS ================= */}
      <section className="rg-section" id="how" style={{ paddingTop: 0 }} aria-labelledby="how-h">
        <div className="rg-center">
          <span className="rg-eyebrow">
            <ListChecks size={12} strokeWidth={2} /> The funnel
          </span>
          <h2 className="rg-h2" id="how-h">
            From lead to application <span className="rg-grad">in six steps.</span>
          </h2>
          <p className="rg-lead">
            Your team stays in control at every step — Priya does the dialing, chasing and
            note-taking, and hands over exactly when a human should step in.
          </p>
        </div>

        <div className="rg-steps">
          {HOW_STEPS.map(({ icon: Icon, title, desc }, i) => (
            <div key={title} className="rg-glass rg-step">
              <span className="rg-step-num">{i + 1}</span>
              <div className="rg-card-icon" style={{ marginBottom: 0, marginTop: 10 }}>
                <Icon size={18} strokeWidth={1.9} />
              </div>
              <h3>{title}</h3>
              <p>{desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ================= TEST PRIYA ================= */}
      <section className="rg-section" id="demo" style={{ paddingTop: 0 }} aria-labelledby="demo-h">
        <div className="rg-center">
          <span className="rg-eyebrow">
            <Bot size={12} strokeWidth={2} /> Live text demo
          </span>
          <h2 className="rg-h2" id="demo-h">
            Test Priya — <span className="rg-grad">your AI loan agent.</span>
          </h2>
          <p className="rg-lead">
            Chat with her right here. On the phone she speaks, listens and reacts in English,
            Hindi and Telugu — here you can get a feel for how she qualifies a lead.
          </p>
        </div>

        <DemoChat />

        <p className="rg-flowline" style={{ marginTop: 30 }}>
          Want her calling your real leads?{" "}
          <Link
            href="/demo"
            className="rg-grad"
            style={{ textDecoration: "none", fontWeight: 700 }}
          >
            Book a Demo
          </Link>
        </p>
      </section>

      {/* ================= CHANNELS ================= */}
      <section className="rg-section" style={{ paddingTop: 0 }} aria-labelledby="channels-h">
        <div className="rg-center">
          <span className="rg-eyebrow">
            <MessageCircle size={12} strokeWidth={2} /> Three channels, one AI
          </span>
          <h2 className="rg-h2" id="channels-h">
            Wherever the customer talks, <span className="rg-grad">Priya is there</span>
          </h2>
          <p className="rg-lead">
            One AI employee across every channel your customers already use — with shared lead
            memory, one pipeline and one compliance rulebook.
          </p>
        </div>

        <div className="rg-cards">
          {CHANNELS.map(({ icon: Icon, title, desc, points }) => (
            <div key={title} className="rg-glass rg-card">
              <div className="rg-card-icon">
                <Icon size={19} strokeWidth={1.9} />
              </div>
              <h3>{title}</h3>
              <p>{desc}</p>
              <ul>
                {points.map((p) => (
                  <li key={p}>
                    <ShieldCheck size={13} strokeWidth={2} />
                    {p}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>

      {/* ================= PLATFORM BENTO ================= */}
      <section className="rg-section" id="platform" style={{ paddingTop: 0 }} aria-labelledby="platform-h">
        <div className="rg-center">
          <span className="rg-eyebrow">
            <Building2 size={12} strokeWidth={2} /> The platform behind the agent
          </span>
          <h2 className="rg-h2" id="platform-h">
            An operations console your <span className="rg-grad">whole team</span> can run
          </h2>
          <p className="rg-lead">
            Priya is the face. Behind her: lead intelligence, multi-branch operations, roles and
            compliance gates — with full visibility into every conversation.
          </p>
        </div>

        <div className="rg-bento">
          {PLATFORM.map(({ icon: Icon, title, desc, wide }) => (
            <div key={title} className={`rg-glass rg-card ${wide ? "rg-wide" : ""}`}>
              <div className="rg-card-icon">
                <Icon size={19} strokeWidth={1.9} />
              </div>
              <h3>{title}</h3>
              <p>{desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ================= EMI CALCULATOR ================= */}
      <section className="rg-section" id="calculator" style={{ paddingTop: 0 }} aria-labelledby="calc-h">
        <div className="rg-center">
          <span className="rg-eyebrow">
            <Calculator size={12} strokeWidth={2} /> Real math, right now
          </span>
          <h2 className="rg-h2" id="calc-h">
            Run the numbers <span className="rg-grad">yourself</span>
          </h2>
          <p className="rg-lead">
            This is not a lead magnet with hidden assumptions — it is the same calculation engine
            Priya uses on live calls, running in your browser. Move a slider and every figure
            updates instantly.
          </p>
        </div>
        <div style={{ marginTop: 40 }}>
          <EmiCalculator />
        </div>
      </section>

      {/* ================= FAQ ================= */}
      <section className="rg-section" id="faq" style={{ paddingTop: 0 }} aria-labelledby="faq-h">
        <div className="rg-center">
          <span className="rg-eyebrow">
            <ChevronDown size={12} strokeWidth={2} /> Questions
          </span>
          <h2 className="rg-h2" id="faq-h">
            Straight answers, <span className="rg-grad">no fine print</span>
          </h2>
        </div>

        <div className="rg-faq">
          {FAQS.map(({ q, a }) => (
            <details key={q}>
              <summary>
                {q}
                <ChevronDown size={17} strokeWidth={2} />
              </summary>
              <div className="rg-answer">{a}</div>
            </details>
          ))}
        </div>
      </section>

      {/* ================= FINAL CTA ================= */}
      <section className="rg-cta" aria-labelledby="cta-h">
        <div className="rg-glass">
          <span className="rg-eyebrow">
            <PhoneCall size={12} strokeWidth={2} /> Ready when you are
          </span>
          <h2 className="rg-h2" id="cta-h">
            Your next lead is waiting. <span className="rg-grad">Let Priya start the conversation.</span>
          </h2>
          <p className="rg-lead" style={{ margin: "0 auto" }}>
            See a live qualification call, your own script and knowledge base, and the branch and
            role controls your team will run — the whole demo takes less time than one missed
            call.
          </p>
          <div className="rg-cta-actions">
            <Link href="/demo" className="rg-btn rg-btn-primary rg-btn-lg">
              Book a Demo <ArrowRight size={16} strokeWidth={2.2} />
            </Link>
            <a href="#demo" className="rg-btn rg-btn-ghost rg-btn-lg">
              <Bot size={16} strokeWidth={2.1} /> Test Priya
            </a>
          </div>
        </div>
      </section>
    </SiteShell>
  )
}
