"use client"
import { useEffect, useState } from "react"
import { Lock, Clock, Terminal, CheckCircle2 } from "lucide-react"
import { formatDateTime } from "@/lib/utils"

type LogEntry = { id: string; action: string; timestamp: string; status: "success" | "error" | "info" }

function timeAgo(dateStr: string) {
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return "just now"
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  if (days < 30) return `${days}d ago`
  return new Date(dateStr).toLocaleDateString()
}

export default function DeveloperLogsView({ userEmail }: { userEmail: string }) {
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [lastLogin, setLastLogin] = useState<string | null>(null)

  useEffect(() => {
    async function loadLogs() {
      try {
        const res = await fetch("/api/developer/logs")
        const data = await res.json()
        setLogs(data.logs || [])
        setLastLogin(data.lastLogin || null)
      } catch (e) {
        console.error("Failed to load logs:", e)
      }
      setLoading(false)
    }
    loadLogs()
  }, [])

  const statusColor = (status: string) => {
    switch (status) {
      case "success": return "#10b981"
      case "error": return "#ef4444"
      default: return "#64748b"
    }
  }

  const statusIcon = (status: string) => {
    switch (status) {
      case "success": return "✓"
      case "error": return "✕"
      default: return "•"
    }
  }

  return (
    <div className="space-y-6">
      {/* Header Card */}
      <div style={{
        background: "linear-gradient(135deg, rgba(16,185,129,0.1) 0%, rgba(6,182,212,0.05) 100%)",
        border: "1px solid rgba(16,185,129,0.2)",
        borderRadius: 12,
        padding: "20px",
        display: "flex",
        alignItems: "center",
        gap: 16,
      }}>
        <Lock size={24} style={{ color: "#10b981" }} strokeWidth={2} />
        <div>
          <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text-primary)" }}>
            Your Session
          </div>
          <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 2 }}>
            This information is private and visible only to you. Admins cannot see your activity or login details.
          </div>
          {lastLogin && (
            <div style={{ fontSize: 11, color: "#10b981", marginTop: 6, fontWeight: 500 }}>
              Last login: {timeAgo(lastLogin)} ({formatDateTime(lastLogin)})
            </div>
          )}
        </div>
      </div>

      {/* Activity Logs */}
      <div style={{
        background: "var(--bg-card)",
        border: "1px solid var(--border)",
        borderRadius: 12,
        overflow: "hidden",
      }}>
        <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", gap: 8 }}>
          <Terminal size={16} style={{ color: "var(--text-secondary)" }} strokeWidth={2} />
          <span style={{ fontWeight: 600, fontSize: 14 }}>Activity Log</span>
          <span style={{
            marginLeft: "auto",
            background: "var(--bg-secondary)",
            borderRadius: 6,
            padding: "3px 10px",
            fontSize: 12,
            color: "var(--text-muted)",
          }}>
            {logs.length} {logs.length === 1 ? "event" : "events"}
          </span>
        </div>

        {loading && (
          <div style={{ padding: "40px 20px", textAlign: "center", color: "var(--text-muted)" }}>
            Loading activity...
          </div>
        )}

        {!loading && logs.length === 0 && (
          <div style={{ padding: "40px 20px", textAlign: "center" }}>
            <CheckCircle2 size={32} style={{ color: "var(--text-muted)", opacity: 0.5, margin: "0 auto 12px" }} />
            <div style={{ fontSize: 13.5, color: "var(--text-secondary)", fontWeight: 500 }}>No activity yet</div>
            <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 4 }}>
              Your actions will appear here
            </div>
          </div>
        )}

        {!loading && logs.map((log, i) => (
          <div
            key={log.id}
            style={{
              padding: "14px 20px",
              borderBottom: i < logs.length - 1 ? "1px solid var(--border-light)" : "none",
              display: "flex",
              alignItems: "center",
              gap: 12,
            }}
          >
            <div style={{
              width: 24,
              height: 24,
              borderRadius: "50%",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              background: `${statusColor(log.status)}20`,
              color: statusColor(log.status),
              fontSize: 11,
              fontWeight: 700,
              flexShrink: 0,
            }}>
              {statusIcon(log.status)}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13.5, color: "var(--text-primary)", fontWeight: 500 }}>
                {log.action}
              </div>
              <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2, display: "flex", alignItems: "center", gap: 4 }}>
                <Clock size={11} /> {timeAgo(log.timestamp)} · {formatDateTime(log.timestamp)}
              </div>
            </div>
            <span style={{
              background: `${statusColor(log.status)}1a`,
              color: statusColor(log.status),
              fontSize: 10,
              fontWeight: 600,
              padding: "4px 8px",
              borderRadius: 4,
              textTransform: "uppercase",
              flexShrink: 0,
            }}>
              {log.status}
            </span>
          </div>
        ))}
      </div>

      {/* Privacy Notice */}
      <div style={{
        background: "rgba(59,130,246,0.05)",
        border: "1px solid rgba(59,130,246,0.2)",
        borderRadius: 12,
        padding: "16px",
        display: "flex",
        gap: 12,
        alignItems: "flex-start",
      }}>
        <Lock size={16} style={{ color: "#3b82f6", marginTop: 2, flexShrink: 0 }} strokeWidth={2} />
        <div style={{ fontSize: 12, color: "var(--text-secondary)", lineHeight: 1.6 }}>
          <strong>Your privacy is protected.</strong> Admins cannot view your login history, activity logs, or any actions you perform. Your data is encrypted and remains private.
        </div>
      </div>
    </div>
  )
}
