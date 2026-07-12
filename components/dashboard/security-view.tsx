"use client"
import { useEffect, useState } from "react"
import { ShieldCheck, AlertTriangle, RotateCcw, FileLock2 } from "lucide-react"
import { SkeletonList } from "../ui/skeleton"

type Setting = { key: string; enabled: boolean }
type AuditLog = { id: string; action: string; performed_by: string; created_at: string }

const LABELS: Record<string, { label: string; desc: string }> = {
  two_factor_auth: { label: "Two-Factor Authentication", desc: "Require a one-time code for every admin sign-in." },
  single_sign_on:  { label: "Single Sign-On (SSO)",        desc: "Authenticate through your corporate identity provider." },
  ip_allowlist:    { label: "IP Allowlist",                desc: "Restrict console access to approved network ranges." },
  call_recording_encryption: { label: "Call Recording Encryption", desc: "Encrypt voice recordings at rest with AES-256." },
}

const ORDER = ["two_factor_auth", "single_sign_on", "ip_allowlist", "call_recording_encryption"]

function timeAgo(dateStr: string) {
  if (!dateStr) return "—"
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return "just now"
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

export default function SecurityView() {
  const [settings, setSettings] = useState<Setting[]>([])
  const [logs, setLogs] = useState<AuditLog[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState<string | null>(null)

  async function load() {
    setLoading(true)
    try {
      const res = await fetch("/api/security")
      const data = await res.json()
      setSettings(data.settings ?? [])
      setLogs(data.logs ?? [])
    } catch {}
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  async function toggle(key: string, current: boolean) {
    setSaving(key)
    setSettings(prev => prev.map(s => s.key === key ? { ...s, enabled: !current } : s))
    try {
      await fetch("/api/security", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key, enabled: !current }),
      })
      await load()
    } catch {
      // revert on failure
      setSettings(prev => prev.map(s => s.key === key ? { ...s, enabled: current } : s))
    }
    setSaving(null)
  }

  const orderedSettings = ORDER.map(key => settings.find(s => s.key === key)).filter(Boolean) as Setting[]
  const activeCount = orderedSettings.filter(s => s.enabled).length
  const total = orderedSettings.length || 4
  const score = Math.round((activeCount / total) * 100)
  const grade = score === 100 ? "A+" : score >= 75 ? "A" : score >= 50 ? "B" : "C"

  return (
    <div style={{ display:"grid",gridTemplateColumns:"1fr 320px",gap:20,alignItems:"start" }}>
      {/* Left */}
      <div style={{ display:"flex",flexDirection:"column",gap:16 }}>
        {/* Access Controls */}
        <div style={{ background:"var(--bg-card)",border:"1px solid var(--border)",borderRadius:12 }}>
          <div style={{ padding:"18px 24px",borderBottom:"1px solid var(--border)",display:"flex",justifyContent:"space-between",alignItems:"center" }}>
            <div style={{ fontWeight:600,fontSize:15 }}>Access Controls</div>
            <span style={{ background:"rgba(45,212,160,0.11)",color:"#2dd4a0",border:"1px solid rgba(45,212,160,0.3)",borderRadius:6,padding:"4px 12px",fontSize:12,fontWeight:600,display:"inline-flex",alignItems:"center",gap:5 }}><ShieldCheck size={13} strokeWidth={2} /> {activeCount}/{total} active</span>
          </div>
          {loading && <SkeletonList rows={4} />}
          {!loading && orderedSettings.map(item => {
            const meta = LABELS[item.key] ?? { label: item.key, desc: "" }
            return (
              <div key={item.key} style={{ padding:"18px 24px",borderBottom:"1px solid var(--border-light)",display:"flex",alignItems:"center",justifyContent:"space-between" }}>
                <div>
                  <div style={{ fontWeight:500,fontSize:14 }}>{meta.label}</div>
                  <div style={{ fontSize:12,color:"var(--text-muted)",marginTop:3 }}>{meta.desc}</div>
                </div>
                <button
                  className={`toggle ${item.enabled ? "on" : ""}`}
                  onClick={() => toggle(item.key, item.enabled)}
                  disabled={saving === item.key}
                  style={{ opacity: saving === item.key ? 0.5 : 1 }}
                />
              </div>
            )
          })}
        </div>

        {/* Audit Log */}
        <div style={{ background:"var(--bg-card)",border:"1px solid var(--border)",borderRadius:12 }}>
          <div style={{ padding:"18px 24px",borderBottom:"1px solid var(--border)",fontWeight:600,fontSize:15,display:"flex",justifyContent:"space-between",alignItems:"center" }}>
            <span>Audit Log</span>
            <button onClick={load} className="btn-ghost" style={{ height:30,padding:"0 12px",fontSize:12 }}><RotateCcw size={12} strokeWidth={1.9} /> Refresh</button>
          </div>
          {!loading && logs.length === 0 && (
            <div style={{ padding: 24, textAlign: "center", color: "var(--text-muted)", fontSize: 13 }}>No audit events yet.</div>
          )}
          {logs.map((log) => (
            <div key={log.id} style={{ padding:"14px 24px",borderBottom:"1px solid var(--border-light)",display:"flex",alignItems:"center",gap:14 }}>
              <span style={{ width:30,height:30,borderRadius:8,background:"rgba(255,255,255,0.04)",display:"inline-flex",alignItems:"center",justifyContent:"center",color:"var(--text-muted)",flexShrink:0 }}><FileLock2 size={14} strokeWidth={1.8} /></span>
              <div style={{ flex:1 }}>
                <div style={{ fontSize:14,fontWeight:500 }}>{log.action}</div>
                <div style={{ fontSize:12,color:"var(--text-muted)",marginTop:2 }}>{log.performed_by}</div>
              </div>
              <div style={{ fontSize:12,color:"var(--text-muted)",whiteSpace:"nowrap" }}>{timeAgo(log.created_at)}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Right panel */}
      <div style={{ display:"flex",flexDirection:"column",gap:16 }}>
        <div style={{ background:"var(--bg-card)",border:"1px solid var(--border)",borderRadius:12,padding:24 }}>
          <div style={{ fontWeight:600,fontSize:15,marginBottom:20 }}>Security Posture</div>
          <div style={{ display:"flex",alignItems:"center",gap:16,marginBottom:16 }}>
            <div style={{ width:52,height:52,borderRadius:"50%",background: score >= 75 ? "rgba(45,212,160,0.12)" : "rgba(247,183,49,0.12)",border: `2px solid ${score >= 75 ? "#2dd4a0" : "#f7b731"}`,display:"flex",alignItems:"center",justifyContent:"center",color: score >= 75 ? "#2dd4a0" : "#f7b731" }}>{score >= 75 ? <ShieldCheck size={22} strokeWidth={2} /> : <AlertTriangle size={20} strokeWidth={2} />}</div>
            <div>
              <div style={{ fontSize:28,fontWeight:700 }}>{grade}</div>
              <div style={{ fontSize:12,color:"var(--text-muted)" }}>{score >= 75 ? "All critical controls enforced" : "Some controls disabled"}</div>
            </div>
          </div>
          <div style={{ background:"var(--bg-secondary)",borderRadius:4,height:8,marginBottom:8 }}>
            <div style={{ width:`${score}%`,height:"100%",background: score >= 75 ? "#22c55e" : "#f59e0b",borderRadius:4,transition:"width 0.5s" }} />
          </div>
          <div style={{ fontSize:12,color:"var(--text-muted)" }}>{score}% compliance score</div>
        </div>
      </div>
    </div>
  )
}
