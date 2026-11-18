"use client"

import { useState } from "react"
import {
  PhoneCall,
  Loader2,
  Lock,
  CheckCircle2,
  MessageCircle,
} from "lucide-react"

const LOAN_TYPES = [
  { id: "Home Loan", label: "🏠 Home Loan", sub: "from 7.25% p.a." },
  { id: "Business Loan", label: "💼 Business Loan", sub: "up to ₹75 Lakhs" },
  { id: "Loan Against Property", label: "🏢 LAP", sub: "up to ₹5 Crores" },
  { id: "Personal Loan", label: "💳 Personal Loan", sub: "instant approval" },
]

const AMOUNT_PRESETS = ["₹15 Lakhs", "₹30 Lakhs", "₹50 Lakhs", "₹1 Crore+"]

const LANGUAGES = [
  { id: "telugu", label: "తెలుగు (Telugu)" },
  { id: "english", label: "English" },
  { id: "hindi", label: "हिंदी (Hindi)" },
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
      setErrorMsg("Network error. Please try again or WhatsApp us at +91 63016 89511.")
    } finally {
      setLoading(false)
    }
  }

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#05070c",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "24px 16px",
        fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
        color: "#ffffff",
        position: "relative",
      }}
    >
      {/* Background radial glow */}
      <div
        style={{
          position: "fixed",
          top: "20%",
          left: "50%",
          transform: "translate(-50%, -20%)",
          width: 700,
          height: 600,
          background: "radial-gradient(circle, rgba(91,124,250,0.12) 0%, transparent 70%)",
          filter: "blur(90px)",
          pointerEvents: "none",
          zIndex: 0,
        }}
      />

      {/* The Exact Form Card */}
      <div
        style={{
          width: "100%",
          maxWidth: 560,
          background: "rgba(12, 16, 27, 0.94)",
          backdropFilter: "blur(24px)",
          WebkitBackdropFilter: "blur(24px)",
          border: "1px solid rgba(255, 255, 255, 0.08)",
          borderRadius: 22,
          padding: "clamp(24px, 4vw, 36px)",
          boxShadow: "0 25px 70px -15px rgba(0, 0, 0, 0.8), inset 0 1px 0 rgba(255, 255, 255, 0.05)",
          position: "relative",
          zIndex: 1,
        }}
      >
        {!submitted ? (
          <form onSubmit={handleSubmit}>
            {/* Header */}
            <div style={{ marginBottom: 24 }}>
              <h1
                style={{
                  fontSize: 22,
                  fontWeight: 700,
                  color: "#ffffff",
                  margin: "0 0 6px",
                  letterSpacing: "-0.01em",
                }}
              >
                Quick Pre-Qualification Form
              </h1>
              <p style={{ fontSize: 13, color: "#8b96ad", margin: 0, lineHeight: 1.5 }}>
                Enter your details below — Priya will dial your phone right away.
              </p>
            </div>

            {/* Row 1: Full Name & Mobile Number */}
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
                gap: 14,
                marginBottom: 20,
              }}
            >
              {/* Full Name */}
              <div>
                <label
                  htmlFor="app-name"
                  style={{
                    display: "block",
                    fontSize: 12.5,
                    fontWeight: 600,
                    color: "#cbd5e1",
                    marginBottom: 7,
                  }}
                >
                  Full Name <span style={{ color: "#fb5670" }}>*</span>
                </label>
                <input
                  id="app-name"
                  type="text"
                  required
                  placeholder="e.g. Rahul Sharma"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  style={{
                    width: "100%",
                    height: 44,
                    borderRadius: 10,
                    border: "1px solid #1c2437",
                    background: "rgba(5, 7, 12, 0.75)",
                    color: "#ffffff",
                    padding: "0 14px",
                    fontSize: 13.5,
                    outline: "none",
                    boxSizing: "border-box",
                  }}
                />
              </div>

              {/* Mobile Number */}
              <div>
                <label
                  htmlFor="app-phone"
                  style={{
                    display: "block",
                    fontSize: 12.5,
                    fontWeight: 600,
                    color: "#cbd5e1",
                    marginBottom: 7,
                  }}
                >
                  Mobile Number (WhatsApp) <span style={{ color: "#fb5670" }}>*</span>
                </label>
                <div style={{ display: "flex", gap: 8 }}>
                  <div
                    style={{
                      height: 44,
                      padding: "0 12px",
                      borderRadius: 10,
                      border: "1px solid #1c2437",
                      background: "rgba(5, 7, 12, 0.75)",
                      color: "#9aa5bd",
                      fontSize: 13,
                      fontWeight: 700,
                      display: "flex",
                      alignItems: "center",
                      whiteSpace: "nowrap",
                    }}
                  >
                    IN +91
                  </div>
                  <input
                    id="app-phone"
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
                      border: "1px solid #1c2437",
                      background: "rgba(5, 7, 12, 0.75)",
                      color: "#ffffff",
                      padding: "0 14px",
                      fontSize: 13.5,
                      outline: "none",
                      boxSizing: "border-box",
                    }}
                  />
                </div>
              </div>
            </div>

            {/* Select Loan Type */}
            <div style={{ marginBottom: 20 }}>
              <label
                style={{
                  display: "block",
                  fontSize: 12.5,
                  fontWeight: 600,
                  color: "#cbd5e1",
                  marginBottom: 8,
                }}
              >
                Select Loan Type
              </label>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: 10,
                }}
              >
                {LOAN_TYPES.map((t) => {
                  const isSelected = loanType === t.id
                  return (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => setLoanType(t.id)}
                      style={{
                        padding: "12px 14px",
                        borderRadius: 11,
                        border: isSelected ? "1.5px solid #5b7cfa" : "1px solid #1c2437",
                        background: isSelected ? "rgba(91, 124, 250, 0.16)" : "rgba(5, 7, 12, 0.6)",
                        color: isSelected ? "#ffffff" : "#9aa5bd",
                        cursor: "pointer",
                        textAlign: "left",
                        display: "flex",
                        flexDirection: "column",
                        gap: 3,
                        transition: "all 0.15s ease",
                      }}
                    >
                      <span style={{ fontWeight: 700, fontSize: 13.5, color: isSelected ? "#fff" : "#e2e8f0" }}>
                        {t.label}
                      </span>
                      <span style={{ fontSize: 11.5, color: isSelected ? "#a5b0ff" : "#64708c" }}>
                        {t.sub}
                      </span>
                    </button>
                  )
                })}
              </div>
            </div>

            {/* Estimated Loan Amount */}
            <div style={{ marginBottom: 20 }}>
              <label
                style={{
                  display: "block",
                  fontSize: 12.5,
                  fontWeight: 600,
                  color: "#cbd5e1",
                  marginBottom: 8,
                }}
              >
                Estimated Loan Amount
              </label>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {AMOUNT_PRESETS.map((amt) => {
                  const isSelected = loanAmount === amt
                  return (
                    <button
                      key={amt}
                      type="button"
                      onClick={() => setLoanAmount(amt)}
                      style={{
                        padding: "7px 16px",
                        borderRadius: 999,
                        border: isSelected ? "1.5px solid #2dd4a0" : "1px solid #1c2437",
                        background: isSelected ? "rgba(45, 212, 160, 0.15)" : "rgba(5, 7, 12, 0.6)",
                        color: isSelected ? "#2dd4a0" : "#9aa5bd",
                        fontSize: 12.5,
                        fontWeight: 600,
                        cursor: "pointer",
                        transition: "all 0.15s ease",
                      }}
                    >
                      {amt}
                    </button>
                  )
                })}
              </div>
            </div>

            {/* Language for Priya's Call */}
            <div style={{ marginBottom: 24 }}>
              <label
                style={{
                  display: "block",
                  fontSize: 12.5,
                  fontWeight: 600,
                  color: "#cbd5e1",
                  marginBottom: 8,
                }}
              >
                Language for Priya&apos;s Call
              </label>
              <div style={{ display: "flex", gap: 8 }}>
                {LANGUAGES.map((l) => {
                  const isSelected = language === l.id
                  return (
                    <button
                      key={l.id}
                      type="button"
                      onClick={() => setLanguage(l.id)}
                      style={{
                        flex: 1,
                        padding: "9px 8px",
                        borderRadius: 10,
                        border: isSelected ? "1.5px solid #a5b0ff" : "1px solid #1c2437",
                        background: isSelected ? "rgba(165, 176, 255, 0.14)" : "rgba(5, 7, 12, 0.6)",
                        color: isSelected ? "#ffffff" : "#9aa5bd",
                        fontSize: 12.5,
                        fontWeight: 600,
                        cursor: "pointer",
                        textAlign: "center",
                        transition: "all 0.15s ease",
                      }}
                    >
                      {l.label}
                    </button>
                  )
                })}
              </div>
            </div>

            {/* Honeypot field for bot spam suppression */}
            <div style={{ display: "none" }} aria-hidden="true">
              <input
                type="text"
                tabIndex={-1}
                autoComplete="off"
                value={website}
                onChange={(e) => setWebsite(e.target.value)}
              />
            </div>

            {errorMsg && (
              <p
                style={{
                  background: "rgba(251,86,112,0.1)",
                  border: "1px solid rgba(251,86,112,0.3)",
                  borderRadius: 10,
                  padding: "9px 12px",
                  color: "#fb5670",
                  fontSize: 12.5,
                  margin: "0 0 16px",
                  textAlign: "center",
                }}
              >
                {errorMsg}
              </p>
            )}

            {/* Big Action Button */}
            <button
              type="submit"
              disabled={loading}
              style={{
                width: "100%",
                height: 48,
                borderRadius: 12,
                background: "linear-gradient(135deg, #5b7cfa 0%, #38bdf8 100%)",
                border: "none",
                color: "#ffffff",
                fontSize: 14.5,
                fontWeight: 700,
                cursor: loading ? "not-allowed" : "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 8,
                boxShadow: "0 4px 18px -4px rgba(91, 124, 250, 0.5)",
                transition: "all 0.15s ease",
              }}
            >
              {loading ? (
                <>
                  <Loader2 size={16} className="animate-spin" />
                  <span>Connecting to Priya…</span>
                </>
              ) : (
                <>
                  <PhoneCall size={16} />
                  <span>Call Me Now with Priya (Free)</span>
                </>
              )}
            </button>

            {/* Microcopy */}
            <p
              style={{
                textAlign: "center",
                fontSize: 11.5,
                color: "#64708c",
                margin: "14px 0 0",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 5,
              }}
            >
              <Lock size={12} />
              We never charge any upfront fees or ask for OTPs/PINs. 100% confidential.
            </p>
          </form>
        ) : (
          /* Dialing / Success State */
          <div style={{ textAlign: "center", padding: "16px 0" }}>
            <div
              style={{
                width: 64,
                height: 64,
                borderRadius: "50%",
                background: "rgba(45, 212, 160, 0.14)",
                border: "2px solid #2dd4a0",
                boxShadow: "0 0 30px rgba(45, 212, 160, 0.35)",
                margin: "0 auto 16px",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <PhoneCall size={28} color="#2dd4a0" />
            </div>

            <h2 style={{ fontSize: 22, fontWeight: 700, color: "#fff", margin: "0 0 8px" }}>
              Priya is Calling You Now!
            </h2>

            <p style={{ fontSize: 13.5, color: "#9aa5bd", lineHeight: 1.6, margin: "0 0 20px" }}>
              Please keep your phone handy. Our AI Loan Advisor Priya is placing an outbound call to{" "}
              <strong style={{ color: "#2dd4a0", fontFamily: "monospace" }}>{submittedPhone}</strong> right now to explain your {loanType} options.
            </p>

            <div
              style={{
                background: "rgba(255, 255, 255, 0.03)",
                border: "1px solid rgba(255, 255, 255, 0.08)",
                borderRadius: 12,
                padding: "14px 16px",
                textAlign: "left",
                marginBottom: 20,
                fontSize: 12.5,
                color: "#9aa5bd",
                lineHeight: 1.6,
              }}
            >
              <div style={{ color: "#fff", fontWeight: 700, marginBottom: 4 }}>Next Steps:</div>
              <div>• Answer Priya&apos;s call to discuss your {loanType} requirements ({loanAmount})</div>
              <div>• Receive your official loan quote and rate chart directly on WhatsApp</div>
              <div>• No physical bank visits — digital pre-approval through our DSA desk</div>
            </div>

            <a
              href="https://wa.me/916301689511?text=Hi%20Right%20Agent%20Group,%20I%20just%20submitted%20my%20loan%20enquiry"
              target="_blank"
              rel="noopener noreferrer"
              style={{
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 8,
                width: "100%",
                height: 44,
                borderRadius: 10,
                background: "rgba(37, 211, 102, 0.12)",
                border: "1px solid rgba(37, 211, 102, 0.35)",
                color: "#25D366",
                fontSize: 13.5,
                fontWeight: 600,
                textDecoration: "none",
              }}
            >
              <MessageCircle size={16} /> Open WhatsApp Chat Instead
            </a>
          </div>
        )}
      </div>
    </div>
  )
}
