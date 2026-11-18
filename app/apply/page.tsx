"use client"

import { useState } from "react"
import Link from "next/link"
import {
  PhoneCall,
  ShieldCheck,
  CheckCircle2,
  Clock,
  Sparkles,
  Building2,
  Lock,
  ArrowRight,
  MessageCircle,
  Zap,
  Check,
  Phone,
  Loader2,
  Send,
  HelpCircle,
} from "lucide-react"
import SiteShell from "@/components/site/site-shell"

const LOAN_TYPES = [
  { id: "Home Loan", label: "🏠 Home Loan", sub: "from 7.25% p.a." },
  { id: "Business Loan", label: "💼 Business Loan", sub: "up to ₹75 Lakhs" },
  { id: "Loan Against Property", label: "🏢 LAP", sub: "up to ₹5 Crores" },
  { id: "Personal Loan", label: "💳 Personal Loan", sub: "instant approval" },
]

const AMOUNT_PRESETS = ["₹15 Lakhs", "₹30 Lakhs", "₹50 Lakhs", "₹1 Crore+"]

const PARTNER_BANKS = [
  "State Bank of India (SBI)",
  "HDFC Bank",
  "ICICI Bank",
  "Axis Bank",
  "Kotak Mahindra Bank",
  "Bank of Baroda",
  "Punjab National Bank",
  "Tata Capital",
  "Bajaj Finserv",
]

export default function ApplyPage() {
  const [name, setName] = useState("")
  const [phone, setPhone] = useState("")
  const [loanType, setLoanType] = useState("Home Loan")
  const [loanAmount, setLoanAmount] = useState("₹30 Lakhs")
  const [language, setLanguage] = useState("telugu")
  const [website, setWebsite] = useState("") // honeypot
  const [loading, setLoading] = useState(false)
  const [errorMsg, setErrorMsg] = useState("")
  const [submitted, setSubmitted] = useState(false)
  const [submittedPhone, setSubmittedPhone] = useState("")

  function sanitizeDigits(raw: string) {
    let d = raw.replace(/\D/g, "")
    if (d.length === 11 && d.startsWith("0")) d = d.slice(1)
    if (d.length === 12 && d.startsWith("91")) d = d.slice(2)
    return d.slice(0, 10)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (loading) return
    setErrorMsg("")

    const cleanName = name.trim()
    const cleanPhone = sanitizeDigits(phone)

    if (!cleanName) {
      setErrorMsg("Please enter your full name.")
      return
    }

    if (!/^[6-9]\d{9}$/.test(cleanPhone)) {
      setErrorMsg("Please enter a valid 10-digit Indian mobile number.")
      return
    }

    setLoading(true)

    try {
      const res = await fetch("/api/fast-lead", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: cleanName,
          phone: `+91${cleanPhone}`,
          loanType,
          loanAmount,
          language,
          website,
        }),
      })

      const data = await res.json().catch(() => ({}))

      if (res.ok) {
        setSubmittedPhone(`+91 ${cleanPhone.slice(0, 5)} ${cleanPhone.slice(5)}`)
        setSubmitted(true)
      } else {
        setErrorMsg(data.error || "Failed to submit. Please try again.")
      }
    } catch {
      setErrorMsg("Network error. Please check your connection or WhatsApp us directly.")
    } finally {
      setLoading(false)
    }
  }

  return (
    <SiteShell>
      {/* Subpage Hero with website styling */}
      <div className="rgpage">
        <span className="rg-eyebrow">
          <Zap size={13} strokeWidth={2.4} /> Instant Speed-to-Lead Pre-Qualification
        </span>
        <h1>
          Check Loan Offers Across <span className="rg-grad">20+ Top Banks</span>
        </h1>
        <p className="rg-lead">
          Compare the lowest interest rates in Hyderabad, verify your eligibility with 0 advance fees, and receive an instant AI qualification callback from Priya in 30 seconds.
        </p>
      </div>

      <section className="rg-section" style={{ paddingTop: 36 }}>
        <div className="rg-demo-grid">
          {/* Main Card: Form or Success */}
          <div className="rg-glass rgf-card">
            {!submitted ? (
              <form onSubmit={handleSubmit}>
                <div style={{ marginBottom: 20 }}>
                  <h2 style={{ fontSize: 18, fontWeight: 700, color: "#fff", margin: "0 0 6px" }}>
                    Quick Pre-Qualification Form
                  </h2>
                  <p style={{ fontSize: 13, color: "#8b96ad", margin: 0 }}>
                    Enter your details below — Priya will dial your phone right away.
                  </p>
                </div>

                <div className="rgf-grid">
                  {/* Full Name */}
                  <div className="rgf-field">
                    <label className="rgf-label" htmlFor="app-name">
                      Full Name <span className="rgf-req">*</span>
                    </label>
                    <input
                      id="app-name"
                      className="rgf-input"
                      type="text"
                      required
                      placeholder="e.g. Rahul Sharma"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                    />
                  </div>

                  {/* 10-Digit Mobile */}
                  <div className="rgf-field">
                    <label className="rgf-label" htmlFor="app-phone">
                      Mobile Number (WhatsApp) <span className="rgf-req">*</span>
                    </label>
                    <div style={{ display: "flex", gap: 8 }}>
                      <div
                        style={{
                          height: 44,
                          padding: "0 12px",
                          borderRadius: 10,
                          border: "1px solid #1c2437",
                          background: "rgba(5,7,12,0.7)",
                          color: "#9aa5bd",
                          fontSize: 13.5,
                          fontWeight: 700,
                          display: "flex",
                          alignItems: "center",
                          whiteSpace: "nowrap",
                        }}
                      >
                        🇮🇳 +91
                      </div>
                      <input
                        id="app-phone"
                        className="rgf-input"
                        type="tel"
                        required
                        maxLength={10}
                        placeholder="98765 43210"
                        value={phone}
                        onChange={(e) => setPhone(e.target.value.replace(/\D/g, ""))}
                      />
                    </div>
                  </div>

                  {/* Loan Type */}
                  <div className="rgf-field rgf-full">
                    <label className="rgf-label">Select Loan Type</label>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 10 }}>
                      {LOAN_TYPES.map((t) => (
                        <button
                          key={t.id}
                          type="button"
                          onClick={() => setLoanType(t.id)}
                          style={{
                            padding: "10px 14px",
                            borderRadius: 10,
                            border: loanType === t.id ? "1px solid #5b7cfa" : "1px solid #1c2437",
                            background: loanType === t.id ? "rgba(91,124,250,0.15)" : "rgba(5,7,12,0.6)",
                            color: loanType === t.id ? "#fff" : "#9aa5bd",
                            cursor: "pointer",
                            textAlign: "left",
                            display: "flex",
                            flexDirection: "column",
                            gap: 3,
                            transition: "all 0.15s ease",
                          }}
                        >
                          <span style={{ fontWeight: 700, fontSize: 13 }}>{t.label}</span>
                          <span style={{ fontSize: 11, color: loanType === t.id ? "#a5b0ff" : "#64708c" }}>{t.sub}</span>
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Loan Amount */}
                  <div className="rgf-field rgf-full">
                    <label className="rgf-label">Estimated Loan Amount</label>
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                      {AMOUNT_PRESETS.map((amt) => (
                        <button
                          key={amt}
                          type="button"
                          onClick={() => setLoanAmount(amt)}
                          style={{
                            padding: "8px 16px",
                            borderRadius: 999,
                            border: loanAmount === amt ? "1px solid #2dd4a0" : "1px solid #1c2437",
                            background: loanAmount === amt ? "rgba(45,212,160,0.15)" : "rgba(5,7,12,0.6)",
                            color: loanAmount === amt ? "#2dd4a0" : "#9aa5bd",
                            fontSize: 12.5,
                            fontWeight: 600,
                            cursor: "pointer",
                            transition: "all 0.15s ease",
                          }}
                        >
                          {amt}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Language */}
                  <div className="rgf-field rgf-full">
                    <label className="rgf-label">Language for Priya's Call</label>
                    <div style={{ display: "flex", gap: 8 }}>
                      {[
                        { id: "telugu", label: "తెలుగు (Telugu)" },
                        { id: "english", label: "English" },
                        { id: "hindi", label: "हिंदी (Hindi)" },
                      ].map((l) => (
                        <button
                          key={l.id}
                          type="button"
                          onClick={() => setLanguage(l.id)}
                          style={{
                            flex: 1,
                            padding: "9px 8px",
                            borderRadius: 10,
                            border: language === l.id ? "1px solid #a5b0ff" : "1px solid #1c2437",
                            background: language === l.id ? "rgba(165,176,255,0.12)" : "rgba(5,7,12,0.6)",
                            color: language === l.id ? "#fff" : "#9aa5bd",
                            fontSize: 12.5,
                            fontWeight: 600,
                            cursor: "pointer",
                            textAlign: "center",
                          }}
                        >
                          {l.label}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Honeypot field for bot spam suppression */}
                <div className="rgf-hp" aria-hidden="true">
                  <input
                    type="text"
                    tabIndex={-1}
                    autoComplete="off"
                    value={website}
                    onChange={(e) => setWebsite(e.target.value)}
                  />
                </div>

                {errorMsg && (
                  <p className="rgf-error" style={{ marginTop: 14 }}>
                    {errorMsg}
                  </p>
                )}

                <div className="rgf-actions" style={{ marginTop: 24 }}>
                  <button
                    type="submit"
                    className="rg-btn rg-btn-primary rg-btn-lg"
                    style={{ width: "100%" }}
                    disabled={loading}
                  >
                    {loading ? (
                      <>
                        <Loader2 size={16} className="spin" strokeWidth={2.2} /> Connecting to Priya…
                      </>
                    ) : (
                      <>
                        <PhoneCall size={16} strokeWidth={2.2} /> Call Me Now with Priya (Free)
                      </>
                    )}
                  </button>
                </div>

                <p className="rgf-hint" style={{ textAlign: "center", marginTop: 14 }}>
                  <Lock size={11} style={{ display: "inline", verticalAlign: "middle", marginRight: 4 }} />
                  We never charge any upfront fees or ask for OTPs/PINs. 100% confidential.
                </p>
              </form>
            ) : (
              /* Success / Active Dialing State */
              <div className="rgf-success">
                <div
                  className="rgf-success-icon"
                  style={{
                    width: 64,
                    height: 64,
                    background: "rgba(45,212,160,0.14)",
                    border: "2px solid #2dd4a0",
                    boxShadow: "0 0 30px rgba(45,212,160,0.35)",
                  }}
                >
                  <PhoneCall size={28} />
                </div>
                <h3>Priya is Calling You Now!</h3>
                <p>
                  Please keep your phone handy. Our AI Loan Advisor Priya is placing an outbound call to{" "}
                  <strong style={{ color: "#2dd4a0", fontFamily: "monospace" }}>{submittedPhone}</strong> right now to explain your {loanType} options.
                </p>

                <div
                  style={{
                    background: "rgba(255,255,255,0.03)",
                    border: "1px solid rgba(255,255,255,0.08)",
                    borderRadius: 12,
                    padding: "16px 20px",
                    textAlign: "left",
                    marginBottom: 24,
                    fontSize: 13,
                    color: "#9aa5bd",
                    lineHeight: 1.6,
                  }}
                >
                  <div style={{ color: "#fff", fontWeight: 700, marginBottom: 6 }}>Next Steps:</div>
                  <div>• Answer Priya&apos;s call to discuss your {loanType} requirements ({loanAmount})</div>
                  <div>• Receive your official loan quote and rate chart directly on WhatsApp</div>
                  <div>• No physical bank visits — digital pre-approval through our DSA desk</div>
                </div>

                <a
                  href="https://wa.me/916301689511?text=Hi%20Right%20Agent%20Group,%20I%20just%20submitted%20my%20loan%20enquiry"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="rg-btn rg-btn-ghost rg-btn-lg"
                  style={{ width: "100%", color: "#25D366", borderColor: "rgba(37,211,102,0.3)", background: "rgba(37,211,102,0.08)" }}
                >
                  <MessageCircle size={16} /> Open WhatsApp Chat Instead
                </a>
              </div>
            )}
          </div>

          {/* Right Column: Trust & Banking Partners Sidebar */}
          <aside className="rg-glass rg-side-card" aria-label="Why Right Agent Group">
            <h2>Why Choose Right Agent Group?</h2>
            <ul className="rg-side-list">
              <li>
                <Clock size={16} strokeWidth={2} />
                <span>
                  <strong style={{ color: "#fff" }}>30-Second Speed-to-Lead:</strong> Our AI advisor Priya dials your number immediately to confirm your requirement without holding on lines.
                </span>
              </li>
              <li>
                <Building2 size={16} strokeWidth={2} />
                <span>
                  <strong style={{ color: "#fff" }}>20+ Banking Partners:</strong> We compare State Bank of India, HDFC, ICICI, Axis, Kotak, and more to guarantee you the lowest interest rate.
                </span>
              </li>
              <li>
                <ShieldCheck size={16} strokeWidth={2} />
                <span>
                  <strong style={{ color: "#fff" }}>Zero Advance Fees:</strong> We never charge processing fees or consultancy charges upfront. Our DSA services are 100% free for applicants.
                </span>
              </li>
              <li>
                <MessageCircle size={16} strokeWidth={2} />
                <span>
                  <strong style={{ color: "#fff" }}>Instant WhatsApp Follow-up:</strong> Rate comparison sheets, EMI charts, and document checklists are sent straight to your WhatsApp.
                </span>
              </li>
            </ul>

            <div style={{ marginTop: 24, paddingTop: 18, borderTop: "1px solid rgba(255,255,255,0.06)" }}>
              <div style={{ fontSize: 11.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "#64708c", marginBottom: 12 }}>
                Partner Lending Institutions
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {PARTNER_BANKS.map((b) => (
                  <span
                    key={b}
                    style={{
                      fontSize: 11,
                      background: "rgba(255,255,255,0.03)",
                      border: "1px solid rgba(255,255,255,0.06)",
                      borderRadius: 6,
                      padding: "3px 8px",
                      color: "#9aa5bd",
                    }}
                  >
                    {b}
                  </span>
                ))}
              </div>
            </div>

            <p className="rg-side-note">
              Head Office: Gandimaisamma, Hyderabad. Licensed Direct Selling Agent (DSA). All loans subject to bank credit approval and documentation.
            </p>
          </aside>
        </div>

        {/* Back Link */}
        <p className="rg-flowline" style={{ marginTop: 44, textAlign: "center" }}>
          Need assistance right now?{" "}
          <a
            href="https://wa.me/916301689511?text=Hi%20Right%20Agent%20Group,%20I%20need%20immediate%20loan%20help"
            target="_blank"
            rel="noopener noreferrer"
            className="rg-grad"
            style={{ textDecoration: "none", fontWeight: 700 }}
          >
            Chat with our senior loan desk on WhatsApp ↗
          </a>
        </p>
      </section>
    </SiteShell>
  )
}
