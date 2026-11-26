"use client"

import { useState, useEffect } from "react"
import {
  PhoneCall,
  Loader2,
  Lock,
  MessageCircle,
  GraduationCap,
} from "lucide-react"

const LANGUAGES = [
  { id: "telugu", label: "తెలుగు (Telugu)" },
  { id: "english", label: "English" },
  { id: "hindi", label: "हिंदी (Hindi)" },
]

export default function ApplyPage() {
  const [name, setName] = useState("")
  const [phone, setPhone] = useState("")
  const [loanType, setLoanType] = useState("") // Program / Technology Interest
  const [loanAmount, setLoanAmount] = useState("") // 12th Stream & Year
  const [language, setLanguage] = useState("telugu")
  const [website, setWebsite] = useState("") // honeypot
  const [loading, setLoading] = useState(false)
  const [errorMsg, setErrorMsg] = useState("")
  const [submitted, setSubmitted] = useState(false)
  const [submittedPhone, setSubmittedPhone] = useState("")

  useEffect(() => {
    if (typeof window !== "undefined") {
      const p = new URLSearchParams(window.location.search)
      if (p.get("name")) setName(p.get("name") || "")
      if (p.get("phone")) setPhone(p.get("phone") || "")
      if (p.get("type") || p.get("program")) setLoanType(p.get("type") || p.get("program") || "")
      if (p.get("amount") || p.get("stream")) setLoanAmount(p.get("amount") || p.get("stream") || "")
    }
  }, [])

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
    const cleanProgram = loanType.trim()
    const cleanStream = loanAmount.trim()

    if (!cleanName) {
      setErrorMsg("Please enter your full name.")
      return
    }

    if (!/^[6-9]\d{9}$/.test(cleanPhone)) {
      setErrorMsg("Please enter a valid 10-digit Indian mobile number.")
      return
    }

    if (!cleanProgram) {
      setErrorMsg("Please enter your preferred technology program.")
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
          loanType: cleanProgram,
          loanAmount: cleanStream || "12th Student",
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
          background: "radial-gradient(circle, rgba(59,130,246,0.14) 0%, transparent 70%)",
          filter: "blur(90px)",
          pointerEvents: "none",
          zIndex: 0,
        }}
      />

      {/* Form Card */}
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
          <form onSubmit={handleSubmit} noValidate>
            {/* Header */}
            <div style={{ marginBottom: 24 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
                <div style={{ width: 38, height: 38, borderRadius: 10, background: "linear-gradient(135deg, #2563eb, #06b6d4)", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 900, color: "#fff", fontSize: 18, boxShadow: "0 0 16px rgba(37,99,235,0.4)" }}>
                  N
                </div>
                <div>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <span style={{ fontSize: 17, fontWeight: 800, letterSpacing: "-0.01em", color: "#fff" }}>NIAT</span>
                    <span style={{ fontSize: 9, fontWeight: 700, padding: "2px 6px", borderRadius: 4, background: "rgba(59,130,246,0.2)", color: "#60a5fa", border: "1px solid rgba(59,130,246,0.3)" }}>ADMISSIONS</span>
                  </div>
                  <div style={{ fontSize: 10.5, color: "#94a3b8" }}>NxtWave Innovation in Advanced Technologies</div>
                </div>
              </div>
              <h1
                style={{
                  fontSize: 22,
                  fontWeight: 700,
                  color: "#ffffff",
                  margin: "0 0 6px",
                  letterSpacing: "-0.01em",
                }}
              >
                Undergraduate Admissions Enquiry
              </h1>
              <p style={{ fontSize: 13, color: "#8b96ad", margin: 0, lineHeight: 1.5 }}>
                Enter your details below — our AI Admissions Counsellor will call you right away.
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
                  Mobile Number <span style={{ color: "#fb5670" }}>*</span>
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
                      fontWeight: 600,
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

            {/* Program / Specialization */}
            <div style={{ marginBottom: 20 }}>
              <label
                htmlFor="app-program"
                style={{
                  display: "block",
                  fontSize: 12.5,
                  fontWeight: 600,
                  color: "#cbd5e1",
                  marginBottom: 7,
                }}
              >
                Preferred Technology Program <span style={{ color: "#fb5670" }}>*</span>
              </label>
              <input
                id="app-program"
                type="text"
                required
                placeholder="e.g. B.Tech Computer Science & AI, Data Science, Robotics…"
                value={loanType}
                onChange={(e) => setLoanType(e.target.value)}
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

            {/* 12th Stream & Year */}
            <div style={{ marginBottom: 20 }}>
              <label
                htmlFor="app-stream"
                style={{
                  display: "block",
                  fontSize: 12.5,
                  fontWeight: 600,
                  color: "#cbd5e1",
                  marginBottom: 7,
                }}
              >
                12th Intermediate Stream &amp; Year
              </label>
              <div style={{ display: "flex", gap: 8 }}>
                <div
                  style={{
                    height: 44,
                    padding: "0 14px",
                    borderRadius: 10,
                    border: "1px solid #1c2437",
                    background: "rgba(5, 7, 12, 0.75)",
                    color: "#60a5fa",
                    fontSize: 14,
                    fontWeight: 700,
                    display: "flex",
                    alignItems: "center",
                    whiteSpace: "nowrap",
                  }}
                >
                  <GraduationCap size={16} />
                </div>
                <input
                  id="app-stream"
                  type="text"
                  placeholder="e.g. MPC (2024 / 2025 / 2026), CBSE, BiPC"
                  value={loanAmount}
                  onChange={(e) => setLoanAmount(e.target.value)}
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

            {/* Preferred Call Language */}
            <div style={{ marginBottom: 24 }}>
              <label
                style={{
                  display: "block",
                  fontSize: 12.5,
                  fontWeight: 600,
                  color: "#cbd5e1",
                  marginBottom: 9,
                }}
              >
                Preferred Call Language
              </label>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10 }}>
                {LANGUAGES.map((l) => {
                  const sel = language === l.id
                  return (
                    <button
                      key={l.id}
                      type="button"
                      onClick={() => setLanguage(l.id)}
                      style={{
                        height: 40,
                        borderRadius: 10,
                        border: sel ? "1px solid #3b82f6" : "1px solid #1c2437",
                        background: sel ? "rgba(59, 130, 246, 0.15)" : "rgba(5, 7, 12, 0.75)",
                        color: sel ? "#60a5fa" : "#9aa5bd",
                        fontSize: 12.5,
                        fontWeight: sel ? 700 : 500,
                        cursor: "pointer",
                        transition: "all 0.15s ease",
                      }}
                    >
                      {l.label}
                    </button>
                  )
                })}
              </div>
            </div>

            {/* Honeypot field for bot spam prevention */}
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

            {/* Action Button */}
            <button
              type="submit"
              disabled={loading}
              style={{
                width: "100%",
                height: 48,
                borderRadius: 12,
                background: "linear-gradient(135deg, #2563eb 0%, #06b6d4 100%)",
                border: "none",
                color: "#ffffff",
                fontSize: 14.5,
                fontWeight: 700,
                cursor: loading ? "not-allowed" : "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 8,
                boxShadow: "0 4px 18px -4px rgba(37, 99, 235, 0.5)",
                transition: "all 0.15s ease",
              }}
            >
              {loading ? (
                <>
                  <Loader2 size={16} className="animate-spin" />
                  <span>Connecting with Admissions AI…</span>
                </>
              ) : (
                <>
                  <PhoneCall size={16} />
                  <span>Connect with Admissions AI (Free)</span>
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
              Official NIAT counselling support. No spam, 100% confidential.
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
                background: "rgba(59, 130, 246, 0.14)",
                border: "2px solid #3b82f6",
                boxShadow: "0 0 30px rgba(59, 130, 246, 0.35)",
                margin: "0 auto 16px",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <PhoneCall size={28} color="#60a5fa" />
            </div>

            <h2 style={{ fontSize: 22, fontWeight: 700, color: "#fff", margin: "0 0 8px" }}>
              Our AI Admissions Counsellor is Calling You!
            </h2>

            <p style={{ fontSize: 13.5, color: "#9aa5bd", lineHeight: 1.6, margin: "0 0 20px" }}>
              Please keep your phone handy. Our AI Admissions Counsellor is placing a call to{" "}
              <strong style={{ color: "#60a5fa", fontFamily: "monospace" }}>{submittedPhone}</strong> right now to explain your {loanType} options and collaborating universities.
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
              <div>• Answer the call to explore undergraduate tech programmes and campus options</div>
              <div>• Receive the official NIAT curriculum and NAT guide directly on WhatsApp</div>
              <div>• 1-on-1 guidance on UGC-recognized collaborating institutions &amp; eligibility</div>
            </div>

            <a
              href="https://wa.me/916301689511?text=Hi%20NIAT,%20I%20just%20submitted%20my%20admissions%20enquiry"
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
