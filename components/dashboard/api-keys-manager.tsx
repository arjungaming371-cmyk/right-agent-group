"use client"

import React, { useEffect, useState } from "react"
import { Key, Eye, EyeOff, CheckCircle2, AlertCircle, Save, RefreshCw, Zap, MessageCircle, Instagram, Phone, Bot, Activity } from "lucide-react"
import { useToast } from "../ui/toast"

type KeyStatus = {
  configured: boolean
  preview: string
  source: "database" | "env" | "none"
}

type UsageStats = {
  today: Record<string, number>
  month: Record<string, number>
}

const KEY_GROUPS = [
  {
    title: "AI Brain & LLM Models",
    icon: Bot,
    description: "Powers Priya AI automated chat, voice call turns, and Lead Brain extraction.",
    fields: [
      { name: "GROQ_API_KEY", label: "Groq Cloud API Key", placeholder: "gsk_...", provider: "groq" },
      { name: "SARVAM_API_KEY", label: "Sarvam AI API Key", placeholder: "sarvam_...", provider: "sarvam" },
    ],
  },
  {
    title: "Meta WhatsApp Business Cloud API",
    icon: MessageCircle,
    description: "Official WhatsApp messaging without local QR scanning or ban risks.",
    fields: [
      { name: "WHATSAPP_TOKEN", label: "Permanent Access Token", placeholder: "EAAG...", provider: "whatsapp" },
      { name: "WHATSAPP_PHONE_NUMBER_ID", label: "Phone Number ID", placeholder: "10593...", provider: "whatsapp" },
      { name: "WHATSAPP_APP_SECRET", label: "Meta App Secret (Webhook Sig)", placeholder: "a3b8...", provider: "whatsapp" },
    ],
  },
  {
    title: "Meta Instagram Direct Messaging & Comments",
    icon: Instagram,
    description: "Handles Instagram DMs and automated post comment replies.",
    fields: [
      { name: "INSTAGRAM_ACCESS_TOKEN", label: "Instagram Access Token", placeholder: "EAAG...", provider: "instagram" },
      { name: "INSTAGRAM_ACCOUNT_ID", label: "Instagram Business Account ID", placeholder: "17841...", provider: "instagram" },
      { name: "INSTAGRAM_APP_SECRET", label: "Meta App Secret", placeholder: "a3b8...", provider: "instagram" },
    ],
  },
  {
    title: "Voice, Speech & Telephony",
    icon: Phone,
    description: "Cartesia neural TTS and Exotel virtual phone line integration.",
    fields: [
      { name: "CARTESIA_API_KEY", label: "Cartesia TTS API Key", placeholder: "car_...", provider: "cartesia" },
      { name: "CARTESIA_VOICE_ID", label: "Cartesia Voice ID", placeholder: "79a6...", provider: "cartesia" },
      { name: "EXOTEL_SID", label: "Exotel Account SID", placeholder: "rightagent...", provider: "exotel" },
      { name: "EXOTEL_TOKEN", label: "Exotel API Token", placeholder: "ex_...", provider: "exotel" },
      { name: "EXOTEL_CALLER_ID", label: "Virtual Caller ID Number", placeholder: "080...", provider: "exotel" },
    ],
  },
]

export default function ApiKeysManager() {
  const toast = useToast()
  const [statuses, setStatuses] = useState<Record<string, KeyStatus>>({})
  const [usage, setUsage] = useState<UsageStats>({ today: {}, month: {} })
  const [inputs, setInputs] = useState<Record<string, string>>({})
  const [showValues, setShowValues] = useState<Record<string, boolean>>({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState<string | null>(null)

  async function loadData() {
    setLoading(true)
    try {
      const res = await fetch("/api/security/api-keys")
      if (res.ok) {
        const data = await res.json()
        setStatuses(data.status || {})
        setUsage(data.usage || { today: {}, month: {} })
      }
    } catch {
      toast.error("Failed to load API keys status")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadData()
  }, [])

  function handleInputChange(name: string, val: string) {
    setInputs((prev) => ({ ...prev, [name]: val }))
  }

  function toggleShowValue(name: string) {
    setShowValues((prev) => ({ ...prev, [name]: !prev[name] }))
  }

  async function handleSave() {
    const keysToSave: Record<string, string> = {}
    for (const [k, v] of Object.entries(inputs)) {
      if (v.trim()) keysToSave[k] = v.trim()
    }

    if (Object.keys(keysToSave).length === 0) {
      toast.info("No key changes to save")
      return
    }

    setSaving(true)
    try {
      const res = await fetch("/api/security/api-keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ keys: keysToSave }),
      })

      if (res.ok) {
        const data = await res.json()
        setStatuses(data.status || {})
        setInputs({})
        toast.success("API Keys saved securely to database!")
      } else {
        const err = await res.json()
        toast.error(err.error || "Failed to save API keys")
      }
    } catch {
      toast.error("Network error saving keys")
    } finally {
      setSaving(false)
    }
  }

  async function handleTest(provider: string) {
    setTesting(provider)
    try {
      const res = await fetch("/api/security/api-keys/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider }),
      })
      const data = await res.json()
      if (data.ok) {
        toast.success(data.message || `Connected to ${provider} successfully!`)
      } else {
        toast.error(data.message || `Failed to connect to ${provider}`)
      }
    } catch {
      toast.error(`Error testing ${provider} connection`)
    } finally {
      setTesting(null)
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {/* HEADER & METERS PANEL */}
      <div
        style={{
          background: "var(--bg-secondary)",
          border: "1px solid var(--border)",
          borderRadius: 12,
          padding: 18,
          display: "flex",
          flexDirection: "column",
          gap: 16,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 15, fontWeight: 700 }}>
            <Activity size={18} style={{ color: "var(--accent-cyan)" }} />
            <span>Live Token & API Quota Metering</span>
          </div>
          <button
            onClick={loadData}
            style={{
              background: "transparent",
              border: "1px solid var(--border)",
              color: "var(--text-secondary)",
              padding: "4px 10px",
              borderRadius: 6,
              fontSize: 12,
              display: "flex",
              alignItems: "center",
              gap: 6,
              cursor: "pointer",
            }}
          >
            <RefreshCw size={13} className={loading ? "animate-spin" : ""} />
            <span>Refresh Meters</span>
          </button>
        </div>

        {/* METRIC CARDS GRID */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12 }}>
          <div style={{ background: "var(--bg-primary)", padding: 12, borderRadius: 8, border: "1px solid var(--border)" }}>
            <div style={{ fontSize: 11.5, color: "var(--text-muted)", display: "flex", alignItems: "center", gap: 5 }}>
              <Zap size={13} style={{ color: "var(--accent-cyan)" }} />
              <span>Groq AI Tokens (Today / Month)</span>
            </div>
            <div style={{ fontSize: 18, fontWeight: 700, marginTop: 4, color: "var(--text-primary)" }}>
              {(usage.today.groq || 0).toLocaleString()} <span style={{ fontSize: 12, fontWeight: 400, color: "var(--text-muted)" }}>/ {(usage.month.groq || 0).toLocaleString()}</span>
            </div>
          </div>

          <div style={{ background: "var(--bg-primary)", padding: 12, borderRadius: 8, border: "1px solid var(--border)" }}>
            <div style={{ fontSize: 11.5, color: "var(--text-muted)", display: "flex", alignItems: "center", gap: 5 }}>
              <Bot size={13} style={{ color: "#833ab4" }} />
              <span>Sarvam Tokens (Today / Month)</span>
            </div>
            <div style={{ fontSize: 18, fontWeight: 700, marginTop: 4, color: "var(--text-primary)" }}>
              {(usage.today.sarvam || 0).toLocaleString()} <span style={{ fontSize: 12, fontWeight: 400, color: "var(--text-muted)" }}>/ {(usage.month.sarvam || 0).toLocaleString()}</span>
            </div>
          </div>

          <div style={{ background: "var(--bg-primary)", padding: 12, borderRadius: 8, border: "1px solid var(--border)" }}>
            <div style={{ fontSize: 11.5, color: "var(--text-muted)", display: "flex", alignItems: "center", gap: 5 }}>
              <MessageCircle size={13} style={{ color: "#25d366" }} />
              <span>WhatsApp Messages Sent</span>
            </div>
            <div style={{ fontSize: 18, fontWeight: 700, marginTop: 4, color: "var(--text-primary)" }}>
              {(usage.today.whatsapp || 0).toLocaleString()} <span style={{ fontSize: 12, fontWeight: 400, color: "var(--text-muted)" }}>/ {(usage.month.whatsapp || 0).toLocaleString()}</span>
            </div>
          </div>

          <div style={{ background: "var(--bg-primary)", padding: 12, borderRadius: 8, border: "1px solid var(--border)" }}>
            <div style={{ fontSize: 11.5, color: "var(--text-muted)", display: "flex", alignItems: "center", gap: 5 }}>
              <Instagram size={13} style={{ color: "#e1306c" }} />
              <span>Instagram DMs & Comments</span>
            </div>
            <div style={{ fontSize: 18, fontWeight: 700, marginTop: 4, color: "var(--text-primary)" }}>
              {(usage.today.instagram || 0).toLocaleString()} <span style={{ fontSize: 12, fontWeight: 400, color: "var(--text-muted)" }}>/ {(usage.month.instagram || 0).toLocaleString()}</span>
            </div>
          </div>
        </div>
      </div>

      {/* API KEYS CONFIGURATION FORM */}
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ fontSize: 15, fontWeight: 700, display: "flex", alignItems: "center", gap: 8 }}>
            <Key size={18} style={{ color: "var(--accent-yellow)" }} />
            <span>Manage System API Keys (Website Override)</span>
          </div>

          <button
            type="button"
            onClick={handleSave}
            disabled={saving || Object.keys(inputs).length === 0}
            style={{
              background: "var(--accent-green)",
              color: "#000",
              border: "none",
              borderRadius: 8,
              padding: "8px 16px",
              fontSize: 13,
              fontWeight: 700,
              display: "flex",
              alignItems: "center",
              gap: 6,
              cursor: saving || Object.keys(inputs).length === 0 ? "default" : "pointer",
              opacity: saving || Object.keys(inputs).length === 0 ? 0.5 : 1,
            }}
          >
            <Save size={15} />
            <span>{saving ? "Saving..." : "Save Credentials"}</span>
          </button>
        </div>

        {KEY_GROUPS.map((group) => {
          const GroupIcon = group.icon
          return (
            <div
              key={group.title}
              style={{
                background: "var(--bg-secondary)",
                border: "1px solid var(--border)",
                borderRadius: 12,
                padding: 16,
                display: "flex",
                flexDirection: "column",
                gap: 14,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", borderBottom: "1px solid var(--border)", paddingBottom: 10 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <GroupIcon size={17} style={{ color: "var(--accent-cyan)" }} />
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 13.5 }}>{group.title}</div>
                    <div style={{ fontSize: 11.5, color: "var(--text-muted)" }}>{group.description}</div>
                  </div>
                </div>

                {group.fields[0].provider && (
                  <button
                    type="button"
                    onClick={() => handleTest(group.fields[0].provider)}
                    disabled={testing === group.fields[0].provider}
                    style={{
                      background: "transparent",
                      border: "1px solid var(--border)",
                      color: "var(--text-secondary)",
                      borderRadius: 6,
                      padding: "4px 10px",
                      fontSize: 11.5,
                      cursor: "pointer",
                    }}
                  >
                    {testing === group.fields[0].provider ? "Testing..." : "Test Connection"}
                  </button>
                )}
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 14 }}>
                {group.fields.map((field) => {
                  const st = statuses[field.name] || { configured: false, preview: "Not set", source: "none" }
                  const val = inputs[field.name] ?? ""
                  const isVisible = showValues[field.name] ?? false

                  return (
                    <div key={field.name} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 12 }}>
                        <span style={{ fontWeight: 600, color: "var(--text-primary)" }}>{field.label}</span>
                        <span
                          style={{
                            fontSize: 10.5,
                            padding: "1px 6px",
                            borderRadius: 4,
                            fontWeight: 600,
                            background: st.source === "database" ? "rgba(37,211,102,0.15)" : st.source === "env" ? "rgba(56,189,248,0.15)" : "rgba(255,255,255,0.08)",
                            color: st.source === "database" ? "#25d366" : st.source === "env" ? "var(--accent-cyan)" : "var(--text-muted)",
                          }}
                        >
                          {st.source === "database" ? "DB Override" : st.source === "env" ? ".env Fallback" : "Not Set"}
                        </span>
                      </div>

                      <div style={{ position: "relative", display: "flex", alignItems: "center" }}>
                        <input
                          type={isVisible ? "text" : "password"}
                          placeholder={st.configured ? st.preview : field.placeholder}
                          value={val}
                          onChange={(e) => handleInputChange(field.name, e.target.value)}
                          style={{
                            width: "100%",
                            background: "var(--bg-primary)",
                            border: "1px solid var(--border)",
                            borderRadius: 6,
                            padding: "7px 32px 7px 10px",
                            color: "var(--text-primary)",
                            fontSize: 12.5,
                            fontFamily: "monospace",
                            outline: "none",
                          }}
                        />
                        <button
                          type="button"
                          onClick={() => toggleShowValue(field.name)}
                          style={{
                            position: "absolute",
                            right: 8,
                            background: "none",
                            border: "none",
                            color: "var(--text-muted)",
                            cursor: "pointer",
                          }}
                        >
                          {isVisible ? <EyeOff size={14} /> : <Eye size={14} />}
                        </button>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
