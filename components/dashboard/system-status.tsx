"use client"
import { useEffect, useState } from "react"
import { Phone, MessageCircle, AlertCircle, CheckCircle2, Clock } from "lucide-react"
import { usePolling } from "@/lib/use-poll"

type SystemStatus = {
  voiceBot: { status: "operational" | "degraded" | "down"; lastCheck: string; activeCalls?: number }
  whatsapp: { status: "connected" | "disconnected" | "error"; lastMessage?: string; unread?: number }
}

export default function SystemStatus() {
  const [status, setStatus] = useState<SystemStatus>({
    voiceBot: { status: "operational", lastCheck: new Date().toISOString() },
    whatsapp: { status: "connected", lastMessage: new Date().toISOString() },
  })
  const [loading, setLoading] = useState(true)

  async function checkStatus() {
    try {
      const voiceRes = await fetch("/api/system/status")
      const whatsappRes = await fetch("/api/whatsapp/status")

      const voiceData = await voiceRes.json().catch(() => null)
      const whatsappData = await whatsappRes.json().catch(() => null)

      setStatus({
        voiceBot: {
          status: voiceData?.llm?.running ? "operational" : "down",
          lastCheck: new Date().toISOString(),
          activeCalls: voiceData?.activeCalls || 0,
        },
        whatsapp: {
          status: whatsappData?.ready ? "connected" : "disconnected",
          unread: whatsappData?.unread || 0,
        },
      })
    } catch (e) {
      console.error("Status check failed:", e)
      setStatus({
        voiceBot: { status: "degraded", lastCheck: new Date().toISOString() },
        whatsapp: { status: "error" },
      })
    }
    setLoading(false)
  }

  useEffect(() => {
    checkStatus()
  }, [])
  usePolling(checkStatus, 30000) // Check every 30 seconds while the tab is visible

  const getStatusColor = (s: string) => {
    switch (s) {
      case "operational":
      case "connected":
        return "var(--accent-green)"
      case "degraded":
      case "error":
        return "var(--accent-yellow)"
      case "down":
      case "disconnected":
        return "var(--accent-red)"
      default:
        return "var(--text-muted)"
    }
  }

  const getStatusIcon = (s: string) => {
    switch (s) {
      case "operational":
      case "connected":
        return "●"
      case "degraded":
      case "error":
        return "●"
      default:
        return "●"
    }
  }

  return (
    <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
      {/* Voice Bot Status */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "8px 12px",
          borderRadius: 10,
          background: `${getStatusColor(status.voiceBot.status)}14`,
          border: `1px solid ${getStatusColor(status.voiceBot.status)}3d`,
          minWidth: 140,
        }}
        title={`Voice Bot: ${status.voiceBot.status} - ${status.voiceBot.activeCalls || 0} active calls`}
      >
        <Phone size={14} strokeWidth={2} style={{ color: getStatusColor(status.voiceBot.status) }} />
        <span style={{ fontSize: 12, fontWeight: 600, color: getStatusColor(status.voiceBot.status) }}>
          Voice Bot
        </span>
        <span
          style={{
            fontSize: 10,
            fontWeight: 700,
            color: getStatusColor(status.voiceBot.status),
            marginLeft: "auto",
            animation: "pulse 2s infinite",
          }}
        >
          {getStatusIcon(status.voiceBot.status)}
        </span>
      </div>

      {/* WhatsApp Status */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "8px 12px",
          borderRadius: 10,
          background: `${getStatusColor(status.whatsapp.status)}14`,
          border: `1px solid ${getStatusColor(status.whatsapp.status)}3d`,
          minWidth: 140,
        }}
        title={`WhatsApp: ${status.whatsapp.status} - ${status.whatsapp.unread || 0} unread`}
      >
        <MessageCircle size={14} strokeWidth={2} style={{ color: getStatusColor(status.whatsapp.status) }} />
        <span style={{ fontSize: 12, fontWeight: 600, color: getStatusColor(status.whatsapp.status) }}>
          WhatsApp
        </span>
        <span
          style={{
            fontSize: 10,
            fontWeight: 700,
            color: getStatusColor(status.whatsapp.status),
            marginLeft: "auto",
            animation: "pulse 2s infinite",
          }}
        >
          {getStatusIcon(status.whatsapp.status)}
        </span>
      </div>

      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }
      `}</style>
    </div>
  )
}
