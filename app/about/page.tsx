"use client"
import { ArrowLeft, Zap, Brain, Phone, MessageCircle, Lock, Users, Check } from "lucide-react"
import Link from "next/link"

export default function AboutPage() {
  return (
    <main style={{ minHeight: "100vh", background: "linear-gradient(135deg, #0f172a 0%, #1a1f35 100%)", padding: "60px 20px" }}>
      <div style={{ maxWidth: 900, margin: "0 auto" }}>
        {/* Header */}
        <div style={{ marginBottom: 60, textAlign: "center" }}>
          <Link href="/login" style={{ display: "inline-flex", alignItems: "center", gap: 8, color: "#8b7cff", textDecoration: "none", marginBottom: 24, fontSize: 14, fontWeight: 500 }}>
            <ArrowLeft size={16} strokeWidth={2} />
            Back to Login
          </Link>

          <div style={{ width: 60, height: 60, borderRadius: 14, background: "var(--gradient-brand)", boxShadow: "0 8px 24px rgba(91,124,250,0.4)", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 24px", fontSize: 28, fontWeight: 800, color: "white" }}>
            R
          </div>

          <h1 style={{ fontSize: 40, fontWeight: 800, color: "#f1f5f9", marginBottom: 12, letterSpacing: "-0.02em" }}>
            Right Agent Group
          </h1>
          <p style={{ fontSize: 18, color: "#94a3b8", marginBottom: 8 }}>
            AI-Powered Customer Engagement Platform
          </p>
          <p style={{ fontSize: 13, color: "#64748b" }}>
            Seamless voice, text, and data automation for modern enterprises
          </p>
        </div>

        {/* About Section */}
        <div style={{ marginBottom: 60 }}>
          <div style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(139,124,255,0.2)", borderRadius: 16, padding: "40px", marginBottom: 32 }}>
            <h2 style={{ fontSize: 24, fontWeight: 700, color: "#f1f5f9", marginBottom: 16 }}>About This Platform</h2>
            <p style={{ fontSize: 15, color: "#cbd5e1", lineHeight: 1.8, marginBottom: 16 }}>
              Right Agent Group's Operations Console is a complete solution for managing customer engagement across voice, WhatsApp, and data channels. Built with enterprise security, role-based access control, and AI-powered intelligence, it enables teams to work efficiently while maintaining complete data privacy.
            </p>
            <p style={{ fontSize: 15, color: "#cbd5e1", lineHeight: 1.8 }}>
              Powered by Groq's cloud AI for fast, reliable inference. Whether you're managing loan applications, tracking customer sentiment, or automating outreach campaigns, every feature is designed for scale and reliability.
            </p>
          </div>

          {/* Key Features */}
          <h3 style={{ fontSize: 18, fontWeight: 700, color: "#f1f5f9", marginBottom: 16 }}>Core Features</h3>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(250px, 1fr))", gap: 16 }}>
            {[
              { icon: Phone, label: "Voice Calls", desc: "AI-powered phone conversations with sentiment analysis" },
              { icon: MessageCircle, label: "WhatsApp Chat", desc: "Real-time customer messaging with auto-reply" },
              { icon: Brain, label: "Groq Cloud AI", desc: "Fast llama-3.3-70b inference for calls and chat" },
              { icon: Users, label: "Lead Management", desc: "Pipeline tracking and contact organization" },
              { icon: Lock, label: "Enterprise Security", desc: "2FA, Google OAuth, encryption" },
              { icon: Zap, label: "Fast AI Replies", desc: "Groq cloud inference keeps replies near-instant" },
            ].map((feature, i) => {
              const Icon = feature.icon
              return (
                <div key={i} style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 12, padding: "20px", display: "flex", gap: 12 }}>
                  <Icon size={20} style={{ color: "#10b981", flexShrink: 0, marginTop: 2 }} strokeWidth={2} />
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 600, color: "#f1f5f9", marginBottom: 4 }}>{feature.label}</div>
                    <div style={{ fontSize: 12, color: "#94a3b8" }}>{feature.desc}</div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        {/* Role System */}
        <div style={{ marginBottom: 60 }}>
          <h3 style={{ fontSize: 18, fontWeight: 700, color: "#f1f5f9", marginBottom: 16 }}>Role-Based Access Control</h3>
          <div style={{ overflowX: "auto", background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 12, padding: 0 }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ borderBottom: "1px solid rgba(255,255,255,0.1)" }}>
                  {["Capability", "Admin", "Agent", "Viewer"].map(h => (
                    <th key={h} style={{ padding: "16px", textAlign: "left", fontSize: 12, fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.05em" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {[
                  ["Full Dashboard Access", "✓", "✓", "Limited"],
                  ["Edit Settings", "✓", "✗", "✗"],
                  ["Send Messages", "✓", "✓", "✗"],
                  ["Can Be Deleted by Admin", "Limited", "✓", "✓"],
                  ["Max Count", "2", "Unlimited", "Unlimited"],
                ].map((row, i) => (
                  <tr key={i} style={{ borderBottom: i < 4 ? "1px solid rgba(255,255,255,0.05)" : "none" }}>
                    <td style={{ padding: "12px 16px", fontSize: 13, color: "#cbd5e1", fontWeight: 500 }}>{row[0]}</td>
                    <td style={{ padding: "12px 16px", fontSize: 13, color: "#10b981", fontWeight: 600 }}>{row[1]}</td>
                    <td style={{ padding: "12px 16px", fontSize: 13, color: "#38bdf8", fontWeight: 600 }}>{row[2]}</td>
                    <td style={{ padding: "12px 16px", fontSize: 13, color: "#64708c" }}>{row[3]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Technology Stack */}
        <div style={{ marginBottom: 60 }}>
          <h3 style={{ fontSize: 18, fontWeight: 700, color: "#f1f5f9", marginBottom: 16 }}>Technology Stack</h3>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12 }}>
            {[
              { category: "Frontend", tech: "Next.js 15, React, TypeScript" },
              { category: "Backend", tech: "Node.js, API Routes, Express" },
              { category: "Database", tech: "PostgreSQL, Supabase, Redis" },
              { category: "AI/ML", tech: "Groq API, Whisper STT" },
              { category: "Voice", tech: "Exotel, Sarvam AI (STT/TTS), Cartesia" },
              { category: "Messaging", tech: "Meta WhatsApp Cloud API" },
              { category: "Auth", tech: "Google OAuth, HMAC, JWT" },
              { category: "Deployment", tech: "Dedicated on-premise server, Cloudflare Tunnel" },
            ].map((item, i) => (
              <div key={i} style={{ background: "rgba(139,124,255,0.1)", border: "1px solid rgba(139,124,255,0.3)", borderRadius: 10, padding: "16px" }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: "#a5b0ff", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 6 }}>{item.category}</div>
                <div style={{ fontSize: 13, color: "#cbd5e1" }}>{item.tech}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Security & Privacy */}
        <div style={{ marginBottom: 60 }}>
          <h3 style={{ fontSize: 18, fontWeight: 700, color: "#f1f5f9", marginBottom: 16 }}>Security & Privacy Commitments</h3>
          <div style={{ display: "grid", gap: 12 }}>
            {[
              { icon: "🔐", title: "End-to-End Encryption", desc: "All voice calls and messages encrypted in transit and at rest" },
              { icon: "🛡️", title: "Enterprise Security", desc: "2FA, Google OAuth, and role-based access control" },
              { icon: "⚡", title: "Fast AI Replies", desc: "Groq cloud inference keeps call and chat replies near-instant" },
              { icon: "✓", title: "Compliance Ready", desc: "Do Not Call lists, call recording encryption, audit trails" },
            ].map((item, i) => (
              <div key={i} style={{ display: "flex", alignItems: "flex-start", gap: 12, background: "rgba(16,185,129,0.05)", border: "1px solid rgba(16,185,129,0.15)", borderRadius: 10, padding: "16px" }}>
                <div style={{ fontSize: 20 }}>{item.icon}</div>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 600, color: "#f1f5f9", marginBottom: 4 }}>{item.title}</div>
                  <div style={{ fontSize: 12, color: "#94a3b8" }}>{item.desc}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

      </div>

      <style>{`
        @media (max-width: 768px) {
          main { padding: 40px 16px; }
          h1 { font-size: 28px; }
          h3 { font-size: 16px; }
        }
      `}</style>
    </main>
  )
}
