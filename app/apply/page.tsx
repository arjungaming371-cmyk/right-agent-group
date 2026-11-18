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
} from "lucide-react"

const LOAN_TYPES = [
  { id: "Home Loan", label: "🏠 Home Loan", rate: "from 7.25% p.a." },
  { id: "Business Loan", label: "💼 Business Loan", rate: "up to ₹75 Lakhs" },
  { id: "Loan Against Property", label: "🏢 LAP", rate: "up to ₹5 Crores" },
  { id: "Personal Loan", label: "💳 Personal Loan", rate: "instant approval" },
]

const AMOUNT_PRESETS = ["₹15 Lakhs", "₹30 Lakhs", "₹50 Lakhs", "₹1 Crore+"]

const BANKS = [
  "State Bank of India",
  "HDFC Bank",
  "ICICI Bank",
  "Axis Bank",
  "Kotak Mahindra",
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
    <div
      style={{
        minHeight: "100vh",
        background: "linear-gradient(180deg, #090b10 0%, #0d111a 100%)",
        color: "#f8fafc",
        fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        padding: "24px 16px 48px",
      }}
    >
      {/* Brand Header */}
      <header
        style={{
          width: "100%",
          maxWidth: 480,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          paddingBottom: 20,
          borderBottom: "1px solid rgba(255,255,255,0.08)",
          marginBottom: 24,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div
            style={{
              width: 38,
              height: 38,
              borderRadius: 10,
              background: "linear-gradient(135deg, #10b981, #059669)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontWeight: 800,
              fontSize: 16,
              color: "#fff",
              boxShadow: "0 2px 10px rgba(16,185,129,0.3)",
            }}
          >
            RAG
          </div>
          <div>
            <div style={{ fontWeight: 800, fontSize: 15, letterSpacing: "-0.01em" }}>Right Agent Group</div>
            <div style={{ fontSize: 11, color: "#94a3b8" }}>Loan Advisory • Hyderabad</div>
          </div>
        </div>

        <a
          href="https://wa.me/916301689511?text=Hi%20Right%20Agent%20Group,%20I%20have%20questions%20about%20loans"
          target="_blank"
          rel="noopener noreferrer"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 5,
            padding: "5px 12px",
            borderRadius: 20,
            background: "rgba(37,211,102,0.12)",
            border: "1px solid rgba(37,211,102,0.3)",
            color: "#25D366",
            fontSize: 12,
            fontWeight: 700,
            textDecoration: "none",
          }}
        >
          <MessageCircle size={13} />
          <span>WhatsApp</span>
        </a>
      </header>

      {/* Main Container */}
      <main style={{ width: "100%", maxWidth: 480 }}>
        {!submitted ? (
          <div>
            {/* Top Hook Banner */}
            <div style={{ textAlign: "center", marginBottom: 24 }}>
              <div
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  background: "rgba(139,124,255,0.12)",
                  border: "1px solid rgba(139,124,255,0.3)",
                  color: "#a78bfa",
                  borderRadius: 20,
                  padding: "4px 12px",
                  fontSize: 12,
                  fontWeight: 700,
                  marginBottom: 12,
                }}
              >
                <Zap size={13} />
                <span>Instant Speed-to-Lead Callback in 30 Seconds</span>
              </div>

              <h1
                style={{
                  fontSize: 26,
                  fontWeight: 800,
                  lineHeight: 1.25,
                  margin: "0 0 10px",
                  letterSpacing: "-0.02em",
                }}
              >
                Check Loan Offers Across <span style={{ color: "#10b981" }}>20+ Banks</span>
              </h1>

              <p style={{ fontSize: 13.5, color: "#94a3b8", margin: 0, lineHeight: 1.5 }}>
                Fill out this quick form. Our Senior AI Loan Advisor <strong style={{ color: "#f1f5f9" }}>Priya</strong> will call your phone in seconds with exact interest rates and eligibility.
              </p>
            </div>

            {/* Form Card */}
            <form
              onSubmit={handleSubmit}
              style={{
                background: "rgba(255,255,255,0.03)",
                border: "1px solid rgba(255,255,255,0.1)",
                borderRadius: 18,
                padding: "24px 20px",
                display: "flex",
                flexDirection: "column",
                gap: 18,
                boxShadow: "0 10px 30px rgba(0,0,0,0.4)",
              }}
            >
              {/* Honeypot field for bot suppression */}
              <div style={{ display: "none" }}>
                <input
                  type="text"
                  name="website"
                  value={website}
                  onChange={(e) => setWebsite(e.target.value)}
                  tabIndex={-1}
                  autoComplete="off"
                />
              </div>

              {/* 1. Full Name */}
              <div>
                <label style={{ display: "block", fontSize: 12, fontWeight: 700, color: "#cbd5e1", marginBottom: 6 }}>
                  Your Full Name
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Rahul Sharma"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  style={{
                    width: "100%",
                    height: 44,
                    borderRadius: 10,
                    border: "1px solid rgba(255,255,255,0.15)",
                    background: "rgba(255,255,255,0.06)",
                    color: "#fff",
                    padding: "0 14px",
                    fontSize: 14,
                    outline: "none",
                  }}
                />
              </div>

              {/* 2. Mobile Number */}
              <div>
                <label style={{ display: "block", fontSize: 12, fontWeight: 700, color: "#cbd5e1", marginBottom: 6 }}>
                  10-Digit Mobile Number (for Instant Call & WhatsApp)
                </label>
                <div style={{ display: "flex", gap: 8 }}>
                  <div
                    style={{
                      height: 44,
                      padding: "0 12px",
                      borderRadius: 10,
                      border: "1px solid rgba(255,255,255,0.15)",
                      background: "rgba(255,255,255,0.08)",
                      color: "#94a3b8",
                      fontSize: 14,
                      fontWeight: 700,
                      display: "flex",
                      alignItems: "center",
                    }}
                  >
                    🇮🇳 +91
                  </div>
                  <input
                    type="tel"
                    required
                    maxLength={10}
                    placeholder="98765 43210"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value.replace(/\D/g, ""))}
                    style={{
                      flex: 1,
                      height: 44,
                      borderRadius: 10,
                      border: "1px solid rgba(255,255,255,0.15)",
                      background: "rgba(255,255,255,0.06)",
                      color: "#fff",
                      padding: "0 14px",
                      fontSize: 15,
                      fontWeight: 600,
                      letterSpacing: "0.04em",
                      outline: "none",
                    }}
                  />
                </div>
              </div>

              {/* 3. Loan Type Selection */}
              <div>
                <label style={{ display: "block", fontSize: 12, fontWeight: 700, color: "#cbd5e1", marginBottom: 8 }}>
                  Loan Type
                </label>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                  {LOAN_TYPES.map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => setLoanType(t.id)}
                      style={{
                        padding: "10px 12px",
                        borderRadius: 10,
                        border: loanType === t.id ? "1px solid #10b981" : "1px solid rgba(255,255,255,0.1)",
                        background: loanType === t.id ? "rgba(16,185,129,0.12)" : "rgba(255,255,255,0.04)",
                        color: loanType === t.id ? "#10b981" : "#cbd5e1",
                        fontSize: 12.5,
                        fontWeight: 700,
                        textAlign: "left",
                        cursor: "pointer",
                        display: "flex",
                        flexDirection: "column",
                        gap: 2,
                      }}
                    >
                      <span>{t.label}</span>
                      <span style={{ fontSize: 10.5, color: loanType === t.id ? "#34d399" : "#64748b", fontWeight: 500 }}>
                        {t.rate}
                      </span>
                    </button>
                  ))}
                </div>
              </div>

              {/* 4. Loan Amount Selection */}
              <div>
                <label style={{ display: "block", fontSize: 12, fontWeight: 700, color: "#cbd5e1", marginBottom: 6 }}>
                  Estimated Loan Amount
                </label>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
                  {AMOUNT_PRESETS.map((amt) => (
                    <button
                      key={amt}
                      type="button"
                      onClick={() => setLoanAmount(amt)}
                      style={{
                        padding: "6px 12px",
                        borderRadius: 8,
                        border: loanAmount === amt ? "1px solid #a78bfa" : "1px solid rgba(255,255,255,0.1)",
                        background: loanAmount === amt ? "rgba(167,139,250,0.15)" : "rgba(255,255,255,0.04)",
                        color: loanAmount === amt ? "#c4b5fd" : "#94a3b8",
                        fontSize: 12,
                        fontWeight: 600,
                        cursor: "pointer",
                      }}
                    >
                      {amt}
                    </button>
                  ))}
                </div>
              </div>

              {/* 5. Language Preference for Call */}
              <div>
                <label style={{ display: "block", fontSize: 12, fontWeight: 700, color: "#cbd5e1", marginBottom: 6 }}>
                  Language for Priya's Call
                </label>
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
                        padding: "8px 6px",
                        borderRadius: 8,
                        border: language === l.id ? "1px solid #10b981" : "1px solid rgba(255,255,255,0.1)",
                        background: language === l.id ? "rgba(16,185,129,0.15)" : "rgba(255,255,255,0.04)",
                        color: language === l.id ? "#34d399" : "#94a3b8",
                        fontSize: 12,
                        fontWeight: 700,
                        cursor: "pointer",
                      }}
                    >
                      {l.label}
                    </button>
                  ))}
                </div>
              </div>

              {errorMsg && (
                <div
                  style={{
                    padding: "10px 12px",
                    borderRadius: 8,
                    background: "rgba(239,68,68,0.12)",
                    border: "1px solid rgba(239,68,68,0.3)",
                    color: "#fca5a5",
                    fontSize: 12,
                    textAlign: "center",
                  }}
                >
                  {errorMsg}
                </div>
              )}

              {/* Submit CTA */}
              <button
                type="submit"
                disabled={loading}
                style={{
                  height: 48,
                  borderRadius: 12,
                  background: "linear-gradient(135deg, #10b981, #059669)",
                  border: "none",
                  color: "#fff",
                  fontSize: 15,
                  fontWeight: 800,
                  cursor: loading ? "wait" : "pointer",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 8,
                  boxShadow: "0 4px 16px rgba(16,185,129,0.35)",
                  transition: "transform 0.1s ease",
                }}
              >
                <PhoneCall size={18} />
                <span>{loading ? "Connecting to Priya..." : "Call Me Now with Priya (Free)"}</span>
              </button>

              <div
                style={{
                  fontSize: 11,
                  color: "#64748b",
                  textAlign: "center",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 5,
                }}
              >
                <Lock size={11} />
                <span>Zero advance fees • 100% confidential • RBI verified</span>
              </div>
            </form>
          </div>
        ) : (
          /* Success Screen: Instant Dialing State */
          <div
            style={{
              background: "rgba(255,255,255,0.03)",
              border: "1px solid rgba(16,185,129,0.3)",
              borderRadius: 20,
              padding: "36px 20px",
              textAlign: "center",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              boxShadow: "0 10px 40px rgba(16,185,129,0.15)",
            }}
          >
            {/* Animated Dialing Radar */}
            <div
              style={{
                width: 72,
                height: 72,
                borderRadius: "50%",
                background: "rgba(16,185,129,0.15)",
                border: "2px solid #10b981",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "#10b981",
                marginBottom: 20,
                boxShadow: "0 0 24px rgba(16,185,129,0.4)",
              }}
            >
              <PhoneCall size={32} />
            </div>

            <div
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 5,
                background: "rgba(16,185,129,0.15)",
                color: "#34d399",
                borderRadius: 20,
                padding: "3px 10px",
                fontSize: 11.5,
                fontWeight: 700,
                marginBottom: 10,
              }}
            >
              <CheckCircle2 size={13} />
              <span>Priya is Dialing You Now!</span>
            </div>

            <h2 style={{ fontSize: 22, fontWeight: 800, margin: "0 0 8px" }}>
              Please Answer Your Phone
            </h2>

            <p style={{ fontSize: 13, color: "#94a3b8", lineHeight: 1.5, maxWidth: 360, margin: "0 0 20px" }}>
              Our Senior AI Loan Advisor <strong style={{ color: "#fff" }}>Priya</strong> is placing a call to{" "}
              <strong style={{ color: "#34d399", fontFamily: "monospace" }}>{submittedPhone}</strong> right now to explain your {loanType} options.
            </p>

            <div
              style={{
                width: "100%",
                padding: "14px 16px",
                borderRadius: 12,
                background: "rgba(255,255,255,0.04)",
                border: "1px solid rgba(255,255,255,0.08)",
                marginBottom: 20,
                textAlign: "left",
                fontSize: 12.5,
                color: "#cbd5e1",
                lineHeight: 1.6,
              }}
            >
              <div style={{ fontWeight: 700, color: "#f8fafc", marginBottom: 4 }}>What Priya will help you with:</div>
              <div>• Comparing interest rates across 20+ partner banks</div>
              <div>• Checking exact EMI calculation for {loanAmount}</div>
              <div>• Verifying your documents readiness (Zero fees)</div>
            </div>

            <a
              href="https://wa.me/916301689511?text=Hi%20Right%20Agent%20Group,%20I%20just%20submitted%20my%20loan%20enquiry"
              target="_blank"
              rel="noopener noreferrer"
              style={{
                width: "100%",
                height: 44,
                borderRadius: 10,
                background: "#25D366",
                color: "#fff",
                fontWeight: 700,
                fontSize: 14,
                textDecoration: "none",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 8,
                boxShadow: "0 2px 10px rgba(37,211,102,0.3)",
              }}
            >
              <MessageCircle size={16} />
              <span>Or Chat on WhatsApp Instead</span>
            </a>
          </div>
        )}

        {/* Banking Partner Trust Strip */}
        <div style={{ marginTop: 32, textAlign: "center" }}>
          <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "#64748b", marginBottom: 12 }}>
            Official Loan Partners with 20+ Financial Institutions
          </div>
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: 8,
              justifyContent: "center",
            }}
          >
            {BANKS.map((b) => (
              <span
                key={b}
                style={{
                  fontSize: 11,
                  background: "rgba(255,255,255,0.04)",
                  border: "1px solid rgba(255,255,255,0.08)",
                  borderRadius: 6,
                  padding: "3px 8px",
                  color: "#94a3b8",
                }}
              >
                {b}
              </span>
            ))}
          </div>

          <div
            style={{
              marginTop: 20,
              fontSize: 11,
              color: "#475569",
              lineHeight: 1.5,
            }}
          >
            Right Agent Group • Head Office: Gandimaisamma, Hyderabad<br />
            We never charge any upfront fees or ask for OTPs / banking PINs.
          </div>
        </div>
      </main>
    </div>
  )
}
