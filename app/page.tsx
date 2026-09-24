import type { Metadata } from "next"
import Link from "next/link"
import {
  Phone, MessageCircle, Instagram, ShieldCheck, Languages, Brain,
  BarChart3, Building2, CheckCircle2, ArrowRight, Sparkles, PhoneCall,
  FileText, Send, GitBranch, UserCheck, ScrollText, ChevronDown, Globe,
  Clock, Activity, Lock,
} from "lucide-react"

// PUBLIC HOMEPAGE — the website's front door.
//
// Until now "/" 302'd straight into the console, so every visitor's first
// impression was a login wall. This page is the real landing: what Right
// Agent Group is, the channels Priya works, how it works, the platform
// behind it, compliance posture, FAQ — and two doors (customers → /apply,
// staff → /login). Server-rendered, zero client JS, zero polling: LCP is
// the markup itself.
//
// Copy discipline (mirrors /apply): capability claims only, NO invented
// usage numbers or metrics we can't back up.

export const metadata: Metadata = {
  title: "Right Agent Group — AI Voice & WhatsApp for Lending Teams",
  description:
    "Priya, your AI agent, qualifies loan leads over phone, WhatsApp and Instagram in English, Hindi and Telugu — 24/7, with live sentiment, instant follow-ups and a full operations console.",
}

// ---- Scoped design system (matches the login page's dark-premium look) ----
// Inline <style> keeps the landing self-contained: no globals.css coupling,
// no theme-switcher interference (the console theme is staff-only).
const LANDING_CSS = `
.rg-root { min-height: 100vh; background: #05070c; color: #e6eaf2; font-family: var(--font-inter), Inter, system-ui, sans-serif; overflow-x: hidden; }
.rg-root * { box-sizing: border-box; }
.rg-shell { position: relative; z-index: 1; }
.rg-bg { position: fixed; inset: 0; z-index: 0; pointer-events: none;
  background:
    radial-gradient(1100px 640px at 0% -5%, rgba(139,124,255,0.14), transparent 55%),
    radial-gradient(900px 560px at 100% 15%, rgba(56,189,248,0.08), transparent 55%),
    radial-gradient(800px 600px at 50% 110%, rgba(139,124,255,0.10), transparent 60%),
    #05070c; }
.rg-grid { position: fixed; inset: 0; z-index: 0; pointer-events: none; opacity: 0.35;
  background-image: linear-gradient(rgba(255,255,255,0.025) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.025) 1px, transparent 1px);
  background-size: 44px 44px;
  mask-image: radial-gradient(ellipse 90% 70% at 50% 0%, black, transparent); }
.rg-nav { position: sticky; top: 0; z-index: 50; display: flex; align-items: center; justify-content: space-between;
  padding: 14px clamp(18px, 5vw, 56px); border-bottom: 1px solid rgba(255,255,255,0.05);
  background: rgba(5,7,12,0.72); backdrop-filter: blur(16px) saturate(150%); }
.rg-nav-links { display: flex; align-items: center; gap: 26px; }
.rg-nav-links a { color: #9aa5bd; text-decoration: none; font-size: 13.5px; font-weight: 500; transition: color .15s; }
.rg-nav-links a:hover { color: #fff; }
.rg-btn { display: inline-flex; align-items: center; justify-content: center; gap: 8px; border-radius: 11px;
  font-size: 14px; font-weight: 600; text-decoration: none; cursor: pointer; transition: all .18s; white-space: nowrap; }
.rg-btn-primary { background: linear-gradient(135deg, #6d5cff, #4f46e5 55%, #0ea5e9); color: #fff;
  padding: 12px 22px; box-shadow: 0 8px 28px -8px rgba(99,102,241,0.55); }
.rg-btn-primary:hover { filter: brightness(1.12); transform: translateY(-1px); box-shadow: 0 12px 34px -8px rgba(99,102,241,0.7); }
.rg-btn-ghost { border: 1px solid rgba(255,255,255,0.10); color: #e6eaf2; padding: 12px 22px; background: rgba(255,255,255,0.03); }
.rg-btn-ghost:hover { border-color: rgba(165,176,255,0.45); background: rgba(139,124,255,0.08); }
.rg-btn-sm { padding: 9px 16px; font-size: 13px; border-radius: 10px; }
.rg-section { max-width: 1140px; margin: 0 auto; padding: clamp(64px, 9vw, 110px) clamp(18px, 5vw, 40px); }
.rg-eyebrow { display: inline-flex; align-items: center; gap: 8px; border-radius: 999px;
  border: 1px solid rgba(139,124,255,0.25); background: rgba(139,124,255,0.10);
  color: #a5b0ff; font-size: 12px; font-weight: 500; padding: 7px 14px; letter-spacing: 0.02em; }
.rg-h2 { font-size: clamp(26px, 3.6vw, 40px); font-weight: 700; letter-spacing: -0.02em; line-height: 1.15; color: #fff; margin: 18px 0 12px; }
.rg-lead { color: #9aa5bd; font-size: 15.5px; line-height: 1.7; max-width: 640px; }
.rg-center { text-align: center; }
.rg-center .rg-lead { margin: 0 auto; }
.rg-grad { background: linear-gradient(135deg, #a5b0ff, #5b7cfa 50%, #38bdf8);
  -webkit-background-clip: text; background-clip: text; color: transparent; }
.rg-glass { background: rgba(14,19,32,0.66); border: 1px solid rgba(255,255,255,0.06); border-radius: 18px;
  backdrop-filter: blur(14px) saturate(140%); box-shadow: 0 24px 60px -30px rgba(0,0,0,0.8); }
.rg-hero { display: grid; grid-template-columns: 1.05fr 0.95fr; gap: clamp(32px, 5vw, 72px); align-items: center;
  max-width: 1140px; margin: 0 auto; padding: clamp(56px, 8vw, 96px) clamp(18px, 5vw, 40px) clamp(56px, 7vw, 88px); }
.rg-hero h1 { font-size: clamp(34px, 5.2vw, 58px); font-weight: 800; letter-spacing: -0.03em; line-height: 1.08; color: #fff; margin: 22px 0 0; }
.rg-hero p { margin: 20px 0 0; color: #9aa5bd; font-size: clamp(14.5px, 1.4vw, 16.5px); line-height: 1.75; max-width: 520px; }
.rg-hero-cta { display: flex; flex-wrap: wrap; gap: 14px; margin-top: 32px; }
.rg-hero-stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin-top: 40px; max-width: 520px; }
.rg-stat { background: rgba(255,255,255,0.025); border: 1px solid rgba(255,255,255,0.06); border-radius: 13px; padding: 14px 12px; }
.rg-stat b { display: block; font-size: 17px; color: #fff; font-weight: 700; letter-spacing: -0.01em; }
.rg-stat span { display: block; margin-top: 3px; font-size: 11px; color: #64708c; line-height: 1.4; }
.rg-console { position: relative; border-radius: 20px; padding: 14px; }
.rg-console-bar { display: flex; align-items: center; gap: 6px; padding: 2px 6px 12px; }
.rg-dot { width: 9px; height: 9px; border-radius: 50%; background: rgba(255,255,255,0.14); }
.rg-console-body { background: rgba(5,7,12,0.8); border: 1px solid rgba(255,255,255,0.05); border-radius: 12px; padding: 18px; display: flex; flex-direction: column; gap: 12px; }
.rg-row { display: flex; align-items: center; gap: 10px; }
.rg-bubble { border-radius: 13px; padding: 10px 13px; font-size: 12.5px; line-height: 1.5; max-width: 78%; }
.rg-in { background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.05); color: #c6cede; border-bottom-left-radius: 4px; }
.rg-out { background: linear-gradient(135deg, rgba(109,92,255,0.28), rgba(14,165,233,0.22)); border: 1px solid rgba(139,124,255,0.28); color: #e4e7ff; border-bottom-right-radius: 4px; margin-left: auto; }
.rg-callcard { display: flex; align-items: center; gap: 12px; background: rgba(45,212,160,0.06); border: 1px solid rgba(45,212,160,0.18); border-radius: 12px; padding: 12px 14px; }
.rg-pulse { width: 9px; height: 9px; border-radius: 50%; background: #2dd4a0; box-shadow: 0 0 0 0 rgba(45,212,160,0.5); animation: rg-pulse 1.8s infinite; }
@keyframes rg-pulse { 0% { box-shadow: 0 0 0 0 rgba(45,212,160,0.45); } 70% { box-shadow: 0 0 0 9px rgba(45,212,160,0); } 100% { box-shadow: 0 0 0 0 rgba(45,212,160,0); } }
.rg-float { animation: rg-float 7s ease-in-out infinite; }
@keyframes rg-float { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-9px); } }
@media (prefers-reduced-motion: reduce) { .rg-float, .rg-pulse { animation: none; } }
.rg-cards { display: grid; grid-template-columns: repeat(3, 1fr); gap: 18px; margin-top: 44px; }
.rg-card { padding: 26px 24px; transition: transform .2s, border-color .2s; }
.rg-card:hover { transform: translateY(-4px); border-color: rgba(139,124,255,0.35); }
.rg-card-icon { width: 42px; height: 42px; border-radius: 12px; display: flex; align-items: center; justify-content: center;
  border: 1px solid rgba(139,124,255,0.25); background: rgba(139,124,255,0.10); color: #a5b0ff; margin-bottom: 18px; }
.rg-card h3 { font-size: 16px; font-weight: 700; color: #fff; margin: 0 0 8px; letter-spacing: -0.01em; }
.rg-card p { font-size: 13.5px; color: #8b96ad; line-height: 1.65; margin: 0; }
.rg-card ul { list-style: none; padding: 0; margin: 14px 0 0; display: flex; flex-direction: column; gap: 7px; }
.rg-card li { display: flex; gap: 8px; align-items: flex-start; font-size: 12.5px; color: #9aa5bd; line-height: 1.5; }
.rg-card li svg { flex-shrink: 0; margin-top: 2px; color: #2dd4a0; }
.rg-steps { display: grid; grid-template-columns: repeat(4, 1fr); gap: 18px; margin-top: 48px; counter-reset: rgstep; }
.rg-step { position: relative; padding: 24px 22px; }
.rg-step-num { position: absolute; top: -14px; left: 22px; width: 28px; height: 28px; border-radius: 9px;
  background: linear-gradient(135deg, #6d5cff, #0ea5e9); color: #fff; font-size: 13px; font-weight: 700;
  display: flex; align-items: center; justify-content: center; box-shadow: 0 6px 18px -6px rgba(99,102,241,0.6); }
.rg-step h3 { font-size: 14.5px; font-weight: 700; color: #fff; margin: 10px 0 7px; }
.rg-step p { font-size: 12.5px; color: #8b96ad; line-height: 1.6; margin: 0; }
.rg-bento { display: grid; grid-template-columns: repeat(3, 1fr); gap: 18px; margin-top: 44px; }
.rg-bento .rg-wide { grid-column: span 2; }
.rg-faq { max-width: 780px; margin: 44px auto 0; display: flex; flex-direction: column; gap: 12px; }
.rg-faq details { background: rgba(14,19,32,0.66); border: 1px solid rgba(255,255,255,0.06); border-radius: 14px; padding: 0; overflow: hidden; }
.rg-faq summary { list-style: none; cursor: pointer; display: flex; align-items: center; justify-content: space-between; gap: 14px;
  padding: 18px 22px; font-size: 14.5px; font-weight: 600; color: #e6eaf2; }
.rg-faq summary::-webkit-details-marker { display: none; }
.rg-faq summary svg { color: #64708c; flex-shrink: 0; transition: transform .2s; }
.rg-faq details[open] summary svg { transform: rotate(180deg); }
.rg-faq .rg-answer { padding: 0 22px 18px; font-size: 13.5px; color: #8b96ad; line-height: 1.7; }
.rg-cta { text-align: center; padding: clamp(56px, 8vw, 96px) clamp(18px, 5vw, 40px); }
.rg-cta .rg-glass { max-width: 860px; margin: 0 auto; padding: clamp(36px, 5vw, 60px) clamp(24px, 5vw, 56px);
  background: linear-gradient(160deg, rgba(109,92,255,0.14), rgba(14,19,32,0.85) 45%), rgba(14,19,32,0.66); }
.rg-footer { border-top: 1px solid rgba(255,255,255,0.05); padding: 34px clamp(18px, 5vw, 56px) 44px;
  display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 18px; max-width: 1140px; margin: 0 auto; }
.rg-footer a { color: #64708c; text-decoration: none; font-size: 12.5px; transition: color .15s; }
.rg-footer a:hover { color: #a5b0ff; }
.rg-footer-links { display: flex; gap: 22px; flex-wrap: wrap; }
.rg-marquee { display: flex; flex-wrap: wrap; justify-content: center; gap: 12px 28px; margin-top: 34px; }
.rg-marquee span { display: inline-flex; align-items: center; gap: 8px; color: #64708c; font-size: 12.5px; }
.rg-marquee svg { color: #2dd4a0; }
@media (max-width: 960px) {
  .rg-hero { grid-template-columns: 1fr; }
  .rg-nav-links { display: none; }
  .rg-cards, .rg-bento { grid-template-columns: 1fr 1fr; }
  .rg-bento .rg-wide { grid-column: span 2; }
  .rg-steps { grid-template-columns: 1fr 1fr; row-gap: 30px; }
}
@media (max-width: 620px) {
  .rg-cards, .rg-bento { grid-template-columns: 1fr; }
  .rg-bento .rg-wide { grid-column: span 1; }
  .rg-steps { grid-template-columns: 1fr; }
  .rg-hero-stats { grid-template-columns: repeat(2, 1fr); }
  .rg-hero-cta .rg-btn { flex: 1; }
}
`

export default function HomePage() {
  return (
    <div className="rg-root">
      <style dangerouslySetInnerHTML={{ __html: LANDING_CSS }} />
      <div className="rg-bg" />
      <div className="rg-grid" />

      <div className="rg-shell">
        {/* ================= NAV ================= */}
        <nav className="rg-nav">
          <Link href="/" style={{ display: "flex", alignItems: "center" }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo.png" alt="Right Agent Group" style={{ height: 38, width: "auto", objectFit: "contain" }} />
          </Link>
          <div className="rg-nav-links">
            <a href="#channels">Channels</a>
            <a href="#how">How it works</a>
            <a href="#platform">Platform</a>
            <a href="#faq">FAQ</a>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <Link href="/login" className="rg-btn rg-btn-ghost rg-btn-sm">Sign in</Link>
            <Link href="/apply" className="rg-btn rg-btn-primary rg-btn-sm">
              Get started <ArrowRight size={15} strokeWidth={2.2} />
            </Link>
          </div>
        </nav>

        {/* ================= HERO ================= */}
        <header className="rg-hero">
          <div>
            <span className="rg-eyebrow">
              <Sparkles size={12} strokeWidth={2} />
              AI voice · WhatsApp · Instagram — one console
            </span>
            <h1>
              Every lead answered.{" "}
              <span className="rg-grad">Every call handled.</span>
            </h1>
            <p>
              Right Agent Group runs loan outreach, qualification and follow-ups on
              autopilot. <strong style={{ color: "#e6eaf2", fontWeight: 600 }}>Priya</strong> — your
              AI agent — speaks English, Hindi and Telugu, works the phone, WhatsApp
              and Instagram around the clock, and hands your team leads that are
              already warm.
            </p>
            <div className="rg-hero-cta">
              <Link href="/apply#voice" className="rg-btn rg-btn-primary">
                <PhoneCall size={16} strokeWidth={2.1} /> Hear Priya live
              </Link>
              <Link href="/apply" className="rg-btn rg-btn-ghost">
                See the platform <ArrowRight size={15} strokeWidth={2.2} />
              </Link>
            </div>
            <div className="rg-hero-stats">
              <div className="rg-stat"><b>3</b><span>languages, mid-conversation</span></div>
              <div className="rg-stat"><b>24/7</b><span>never off shift</span></div>
              <div className="rg-stat"><b>Live</b><span>sentiment on every call</span></div>
              <div className="rg-stat"><b>3</b><span>channels, one funnel</span></div>
            </div>
          </div>

          {/* Product vignette — a quiet mock of the console: WhatsApp bubble +
              live call card. Static markup, CSS only, no fake dashboard numbers. */}
          <div className="rg-glass rg-console rg-float" aria-hidden="true">
            <div className="rg-console-bar">
              <span className="rg-dot" /><span className="rg-dot" /><span className="rg-dot" />
            </div>
            <div className="rg-console-body">
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
              <div className="rg-row">
                <div className="rg-bubble rg-in">
                  Sir, EMI cheyyadaniki interest vundhaa? 💬
                </div>
              </div>
              <div className="rg-row">
                <div className="rg-bubble rg-out">
                  Definitely! For ₹5L at 10.5% for 5 years, EMI is ₹10,746/mo. Shall I WhatsApp the details?
                </div>
              </div>
              <div className="rg-row">
                <div className="rg-bubble rg-in">Haan, send kijiye 👍</div>
              </div>
              <div className="rg-row">
                <div className="rg-bubble rg-out">
                  Sent ✓ Application link + EMI schedule on WhatsApp. Lead scored <b style={{ color: "#a5b0ff" }}>92</b> — hot.
                </div>
              </div>
            </div>
          </div>
        </header>

        {/* ================= TRUST MARQUEE ================= */}
        <div className="rg-section rg-center" style={{ paddingTop: 8, paddingBottom: 0 }}>
          <div className="rg-marquee">
            <span><ShieldCheck size={14} /> Official Meta Cloud API</span>
            <span><ShieldCheck size={14} /> DND / TRAI compliance built in</span>
            <span><ShieldCheck size={14} /> Signed sessions & audit trails</span>
            <span><ShieldCheck size={14} /> Role-based access control</span>
            <span><ShieldCheck size={14} /> Multi-branch ready</span>
          </div>
        </div>

        {/* ================= CHANNELS ================= */}
        <section className="rg-section" id="channels">
          <div className="rg-center">
            <span className="rg-eyebrow"><Globe size={12} strokeWidth={2} /> Three channels, one AI</span>
            <h2 className="rg-h2">Wherever the customer talks, <span className="rg-grad">Priya is there</span></h2>
            <p className="rg-lead">
              One voice agent across every channel your customers already use — with
              shared memory, one lead pipeline and one compliance rulebook.
            </p>
          </div>

          <div className="rg-cards">
            <div className="rg-glass rg-card">
              <div className="rg-card-icon"><Phone size={19} strokeWidth={1.9} /></div>
              <h3>Voice calls that sound human</h3>
              <p>
                Outbound campaigns and inbound answering on the phone line, plus
                WhatsApp Business Calling — Priya listens, replies with natural
                pacing, and reads sentiment live.
              </p>
              <ul>
                <li><CheckCircle2 size={13} /> English, Hindi & Telugu — code-switched mid-sentence</li>
                <li><CheckCircle2 size={13} /> Barge-in aware: interrupts cleanly, never talks over</li>
                <li><CheckCircle2 size={13} /> Recordings + transcripts in the console</li>
              </ul>
            </div>

            <div className="rg-glass rg-card">
              <div className="rg-card-icon"><MessageCircle size={19} strokeWidth={1.9} /></div>
              <h3>WhatsApp, the official way</h3>
              <p>
                Built on the Meta Cloud API — no QR codes, no ban risk. Replies in
                the 24-hour window are free, and every call ends with a follow-up.
              </p>
              <ul>
                <li><CheckCircle2 size={13} /> Auto-replies, media, documents, reactions</li>
                <li><CheckCircle2 size={13} /> Voice notes transcribed and understood</li>
                <li><CheckCircle2 size={13} /> WhatsApp voice calls answered by Priya too</li>
              </ul>
            </div>

            <div className="rg-glass rg-card">
              <div className="rg-card-icon"><Instagram size={19} strokeWidth={1.9} /></div>
              <h3>Instagram on autopilot</h3>
              <p>
                Comments and DMs handled the moment they land — interest is captured
                quietly in the background and routed into the same pipeline.
              </p>
              <ul>
                <li><CheckCircle2 size={13} /> Instant comment replies, any post</li>
                <li><CheckCircle2 size={13} /> DMs answered with the same lead brain</li>
                <li><CheckCircle2 size={13} /> Every touch logged on the lead's timeline</li>
              </ul>
            </div>
          </div>
        </section>

        {/* ================= HOW IT WORKS ================= */}
        <section className="rg-section" id="how" style={{ paddingTop: 0 }}>
          <div className="rg-center">
            <span className="rg-eyebrow"><GitBranch size={12} strokeWidth={2} /> The funnel</span>
            <h2 className="rg-h2">From raw lead to <span className="rg-grad">closed conversation</span></h2>
            <p className="rg-lead">
              Four steps, no manual dialing. Your team only enters when there's a
              real human to close.
            </p>
          </div>

          <div className="rg-steps">
            {[
              { icon: FileText, title: "Leads come in", desc: "Form fills, WhatsApp messages, Instagram comments, inbound calls — all land in one pipeline automatically." },
              { icon: PhoneCall, title: "Priya reaches out", desc: "Calls and messages in the customer's own language, handling objections and scoring interest on every turn." },
              { icon: Brain, title: "The console thinks", desc: "Lead Brain summarizes every conversation, flags frustration, and ranks who's worth a human's time next." },
              { icon: Send, title: "Your team closes", desc: "Hot leads arrive pre-qualified with transcripts, sentiment and the application link already sent." },
            ].map(({ icon: Icon, title, desc }, i) => (
              <div key={title} className="rg-glass rg-step">
                <span className="rg-step-num">{i + 1}</span>
                <div className="rg-card-icon" style={{ marginBottom: 0, marginTop: 8 }}><Icon size={18} strokeWidth={1.9} /></div>
                <h3>{title}</h3>
                <p>{desc}</p>
              </div>
            ))}
          </div>
        </section>

        {/* ================= PLATFORM ================= */}
        <section className="rg-section" id="platform" style={{ paddingTop: 0 }}>
          <div className="rg-center">
            <span className="rg-eyebrow"><Building2 size={12} strokeWidth={2} /> The platform behind the agent</span>
            <h2 className="rg-h2">An operations console your <span className="rg-grad">whole team</span> can run</h2>
            <p className="rg-lead">
              Priya is the face. Behind her: a console with lead intelligence,
              multi-branch operations, compliance gates and full visibility into
              every conversation.
            </p>
          </div>

          <div className="rg-bento">
            <div className="rg-glass rg-card rg-wide">
              <div className="rg-card-icon"><Brain size={19} strokeWidth={1.9} /></div>
              <h3>Lead Brain — memory that compounds</h3>
              <p>
                Every call, message and form field becomes structured memory: known
                facts, rolling summaries, sentiment history and a live lead score.
                The agent never re-asks what the customer already said, and your
                officers walk into every follow-up fully briefed.
              </p>
            </div>
            <div className="rg-glass rg-card">
              <div className="rg-card-icon"><Building2 size={19} strokeWidth={1.9} /></div>
              <h3>Multi-branch</h3>
              <p>Branch-scoped leads, quotas, voices and even separate WhatsApp numbers — one console, many offices.</p>
            </div>
            <div className="rg-glass rg-card">
              <div className="rg-card-icon"><UserCheck size={19} strokeWidth={1.9} /></div>
              <h3>Roles & access</h3>
              <p>Admin, branch manager, agent and viewer roles. Google sign-in with 2FA for admins, allowlisted emails only.</p>
            </div>
            <div className="rg-glass rg-card">
              <div className="rg-card-icon"><ScrollText size={19} strokeWidth={1.9} /></div>
              <h3>Compliance gates</h3>
              <p>DND/opt-out suppression on every business-initiated send, call-recording consent flow, audit trail on sensitive actions.</p>
            </div>
            <div className="rg-glass rg-card">
              <div className="rg-card-icon"><BarChart3 size={19} strokeWidth={1.9} /></div>
              <h3>Analytics & logs</h3>
              <p>Call logs with recordings, WhatsApp delivery ticks, comm timelines and a developer log view for debugging live traffic.</p>
            </div>
            <div className="rg-glass rg-card rg-wide">
              <div className="rg-card-icon"><Languages size={19} strokeWidth={1.9} /></div>
              <h3>Made for India, in India's languages</h3>
              <p>
                Telugu-first, with Hindi and English. Roman-script Tenglish and
                Hinglish are understood the way customers actually type and speak —
                not a translation layer, a native ear. EMI math is computed, never
                hallucinated, and rates are quoted exactly from your knowledge base.
              </p>
            </div>
          </div>
        </section>

        {/* ================= FAQ ================= */}
        <section className="rg-section" id="faq" style={{ paddingTop: 0 }}>
          <div className="rg-center">
            <span className="rg-eyebrow"><ChevronDown size={12} strokeWidth={2} /> Questions</span>
            <h2 className="rg-h2">Straight answers, <span className="rg-grad">no fine print</span></h2>
          </div>

          <div className="rg-faq">
            {[
              {
                q: "Is the voice agent actually AI, or a recorded script?",
                a: "Real AI. Priya listens to the caller, understands Telugu, Hindi and English (including Roman-script Tenglish/Hinglish), computes answers like EMI on the fly, and streams replies sentence-by-sentence so there's no robotic pause. Every conversation is unique — nothing is pre-recorded.",
              },
              {
                q: "Is the WhatsApp integration official?",
                a: "Yes — the Meta Cloud API with a verified business number. No QR scanning, no unofficial libraries, no ban risk. Inbound messages and calls are answered automatically, and business-initiated templates are sent only through approved, compliant flows.",
              },
              {
                q: "What happens when a customer is angry or says 'stop calling'?",
                a: "Frustration is detected mid-conversation and your team is notified immediately. Anyone on the DND/opt-out list is suppressed from every business-initiated message and call — enforced in code, not by policy documents.",
              },
              {
                q: "Can multiple branches use it without mixing up leads?",
                a: "Yes. Each branch sees its own leads, calls and quotas, can have its own WhatsApp number and even its own AI voice. Admins see everything; branch staff see only their branch.",
              },
              {
                q: "Where do recordings, transcripts and messages live?",
                a: "In your own console — calls with recordings and transcripts, WhatsApp threads with delivery ticks, and a communication timeline per lead. Nothing important lives only in someone's phone.",
              },
              {
                q: "How do we get started?",
                a: "Apply through the form — we set up your number, knowledge base and script, then run Priya alongside your team. Most teams start with re-engaging old leads, because that's where the fastest wins are.",
              },
            ].map(({ q, a }) => (
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
        <section className="rg-cta">
          <div className="rg-glass">
            <span className="rg-eyebrow"><Clock size={12} strokeWidth={2} /> Ready when you are</span>
            <h2 className="rg-h2">Your next lead is calling. <span className="rg-grad">Let Priya pick up.</span></h2>
            <p className="rg-lead" style={{ margin: "0 auto 32px" }}>
              Hear the voice agent live, see the console, and get a setup plan for
              your team — the whole demo takes less time than one missed call.
            </p>
            <div style={{ display: "flex", justifyContent: "center", flexWrap: "wrap", gap: 14 }}>
              <Link href="/apply" className="rg-btn rg-btn-primary" style={{ padding: "13px 28px", fontSize: 15 }}>
                Get started <ArrowRight size={16} strokeWidth={2.2} />
              </Link>
              <Link href="/apply#voice" className="rg-btn rg-btn-ghost" style={{ padding: "13px 28px", fontSize: 15 }}>
                <PhoneCall size={16} strokeWidth={2.1} /> Hear Priya live
              </Link>
            </div>
          </div>
        </section>

        {/* ================= FOOTER ================= */}
        <footer className="rg-footer">
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo.png" alt="Right Agent Group" style={{ height: 30, width: "auto", objectFit: "contain", opacity: 0.9 }} />
            <span style={{ fontSize: 12, color: "#4a5568" }}>© {new Date().getFullYear()} · Hyderabad</span>
          </div>
          <div className="rg-footer-links">
            <Link href="/apply">Platform & pricing</Link>
            <Link href="/about">About</Link>
            <Link href="/apply#faq">FAQ</Link>
            <Link href="/login">Console sign in</Link>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 12, color: "#4a5568" }}>
            <Lock size={12} /> Encrypted · Audited · DND-compliant
          </div>
        </footer>
      </div>
    </div>
  )
}
