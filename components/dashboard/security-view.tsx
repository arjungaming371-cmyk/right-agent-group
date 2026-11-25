"use client"
import { useEffect, useState } from "react"
import { ShieldCheck, AlertTriangle, RotateCcw, FileLock2, PhoneOff, Clock, X, Plus, HeartPulse } from "lucide-react"
import { SkeletonList } from "../ui/skeleton"
import { useToast } from "../ui/toast"
import { formatDateTime } from "@/lib/utils"
import AiPauseCard from "./ai-pause-card"
import SystemHealthView from "./system-health-view"

type Setting = { key: string; enabled: boolean }
type AuditLog = { id: string; action: string; performed_by: string; created_at: string; metadata?: any }

type ComplianceSettings = { enabled: boolean; startHour: number; endHour: number; days: string[] }
type DndEntry = { phone: string; reason: string | null; source: string; created_at: string }

const DAY_OPTIONS = [
  { code: "mon", label: "Mon" }, { code: "tue", label: "Tue" }, { code: "wed", label: "Wed" },
  { code: "thu", label: "Thu" }, { code: "fri", label: "Fri" }, { code: "sat", label: "Sat" },
  { code: "sun", label: "Sun" },
]

function hourLabel(h: number) {
  const period = h < 12 ? "AM" : "PM"
  const hr12 = h % 12 === 0 ? 12 : h % 12
  return `${hr12}:00 ${period}`
}

const LABELS: Record<string, { label: string; desc: string }> = {
  two_factor_auth: { label: "Two-Factor Authentication", desc: "When enabled, sends a one-time 6-digit verification code after sign-in via Email & WhatsApp." },
  single_sign_on:  { label: "Single Sign-On (SSO)",        desc: "Google SSO is the primary sign-in method — allowlisted emails only." },
  ip_allowlist:    { label: "IP Allowlist",                desc: "Block console access from IPs not on the configured IP allowlist." },
  call_recording_encryption: { label: "Block Recording Playback Caching", desc: "Recordings are always encrypted at rest by the telephony provider. When this is on, playback is streamed only — never cached to local disk." },
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

type Role = "admin" | "agent" | "viewer" | "developer" | "branch_manager"

export default function SecurityView({ role = "admin" }: { role?: Role }) {
  const toast = useToast()
  const [settings, setSettings] = useState<Setting[]>([])
  const [logs, setLogs] = useState<AuditLog[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState<string | null>(null)

  const [compliance, setCompliance] = useState<ComplianceSettings>({ enabled: true, startHour: 8, endHour: 19, days: [] })
  const [dndCount, setDndCount] = useState(0)
  const [complianceLoading, setComplianceLoading] = useState(true)
  const [savingWindow, setSavingWindow] = useState(false)
  const [dndEntries, setDndEntries] = useState<DndEntry[]>([])
  const [showDndList, setShowDndList] = useState(false)
  const [dndPaste, setDndPaste] = useState("")
  const [addingDnd, setAddingDnd] = useState(false)

  // RULES OF HOOKS: this guard used to early-return BEFORE the useState
  // block — if the `role` prop ever changed across renders of a mounted
  // instance (shell re-fetch of /api/auth/me), React threw "rendered more
  // hooks than during the previous render". All hooks now run
  // unconditionally; the denial renders below.
  const accessDenied = role !== "admin" && role !== "developer"

  useEffect(() => {
    if (!accessDenied) {
      load()
      loadCompliance()
    }
  }, [accessDenied])

  if (accessDenied) {
    return (
      <div style={{ padding: 40, background: "var(--bg-secondary)", borderRadius: 12, border: "1px solid var(--border)", textAlign: "center", color: "var(--accent-red)" }}>
        <ShieldCheck size={40} style={{ margin: "0 auto 12px", opacity: 0.7 }} />
        <div style={{ fontSize: 17, fontWeight: 700, color: "var(--text-primary)" }}>Access Denied</div>
        <div style={{ fontSize: 13, color: "var(--text-muted)", marginTop: 6 }}>
          Security settings and System API Keys can only be accessed by Administrators.
        </div>
      </div>
    )
  }

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

  async function loadCompliance() {
    setComplianceLoading(true)
    try {
      const res = await fetch("/api/compliance")
      const data = await res.json()
      if (data.settings) setCompliance(data.settings)
      setDndCount(data.dndCount ?? 0)
    } catch {}
    setComplianceLoading(false)
  }

  async function loadDndEntries() {
    try {
      const res = await fetch("/api/compliance/dnd")
      if (res.ok) {
        const data = await res.json()
        setDndEntries(data.entries ?? [])
      } else {
        toast.error(`Could not load DND suppression list (${res.status})`)
      }
    } catch {
      toast.error("Failed to connect to DND endpoint")
    }
  }

  function toggleDay(code: string) {
    setCompliance((c) => ({
      ...c,
      days: c.days.includes(code) ? c.days.filter((d) => d !== code) : [...c.days, code],
    }))
  }

  async function saveCallingWindow() {
    setSavingWindow(true)
    try {
      const res = await fetch("/api/compliance", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(compliance),
      })
      if (res.ok) { toast.success("Calling-window settings saved"); await loadCompliance() }
      else { const d = await res.json().catch(() => ({})); toast.error(d.error || "Save failed") }
    } catch {
      toast.error("Save failed")
    }
    setSavingWindow(false)
  }

  async function addDndNumbers() {
    const phones = dndPaste.split(/[\n,]/).map((s) => s.trim()).filter(Boolean)
    if (phones.length === 0) return
    setAddingDnd(true)
    try {
      const res = await fetch("/api/compliance/dnd", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phones }),
      })
      const d = await res.json().catch(() => ({}))
      if (res.ok) {
        toast.success(`Added ${d.added} number(s) to the suppression list${d.added < d.total ? ` (${d.total - d.added} already present)` : ""}`)
        setDndPaste("")
        await loadCompliance()
        if (showDndList) await loadDndEntries()
      } else {
        toast.error(d.error || "Could not add numbers")
      }
    } catch {
      toast.error("Could not add numbers")
    }
    setAddingDnd(false)
  }

  async function removeDndNumber(phone: string) {
    if (!window.confirm(`Remove ${phone} from the Do-Not-Call suppression list? This number can be called again once removed.`)) return
    try {
      const res = await fetch(`/api/compliance/dnd?phone=${encodeURIComponent(phone)}`, { method: "DELETE" })
      if (res.ok) { toast.success("Removed from suppression list"); await loadCompliance(); await loadDndEntries() }
      else toast.error("Could not remove number")
    } catch {
      toast.error("Could not remove number")
    }
  }

  async function toggleDndList() {
    const next = !showDndList
    setShowDndList(next)
    if (next) {
      await loadDndEntries()
      if (dndCount === 0 && dndEntries.length === 0) {
        toast.info("DND suppression list is currently empty (0 numbers)")
      }
    }
  }

  async function toggle(key: string, current: boolean) {
    setSaving(key)
    const nextVal = !current
    setSettings(prev => prev.map(s => s.key === key ? { ...s, enabled: nextVal } : s))
    try {
      const res = await fetch("/api/security", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key, enabled: nextVal }),
      })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(d.error || `Could not update ${LABELS[key]?.label || key}`)
        setSettings(prev => prev.map(s => s.key === key ? { ...s, enabled: current } : s))
      } else {
        toast.success(`${LABELS[key]?.label || key} ${nextVal ? "enabled" : "disabled"}`)
        await load()
      }
    } catch {
      // revert on failure
      setSettings(prev => prev.map(s => s.key === key ? { ...s, enabled: current } : s))
      toast.error(`Could not update ${LABELS[key]?.label || key}`)
    }
    setSaving(null)
  }

  const orderedSettings = ORDER.map(key => settings.find(s => s.key === key)).filter(Boolean) as Setting[]
  const activeCount = orderedSettings.filter(s => s.enabled || s.key === "single_sign_on").length
  const total = orderedSettings.length || 4
  const score = Math.round((activeCount / total) * 100)
  const grade = score === 100 ? "A+" : score >= 75 ? "A" : score >= 50 ? "B" : "C"

  return (
    <div className="grid grid-cols-1 items-start gap-4 md:grid-cols-[1fr_320px] md:gap-5">
      {/* Left */}
      <div style={{ display:"flex",flexDirection:"column",gap:16 }}>
        {/* PAUSE AI — emergency kill switch (global toggles + branch scopes) */}
        <AiPauseCard />

        {/* Access Controls */}
        <div style={{ background:"var(--bg-card)",border:"1px solid var(--border)",borderRadius:12 }}>
          <div style={{ padding:"18px 24px",borderBottom:"1px solid var(--border)",display:"flex",justifyContent:"space-between",alignItems:"center" }}>
            <div style={{ fontWeight:600,fontSize:15 }}>Access Controls</div>
            <span style={{ background:"rgba(45,212,160,0.11)",color:"var(--accent-green)",border:"1px solid rgba(45,212,160,0.3)",borderRadius:6,padding:"4px 12px",fontSize:12,fontWeight:600,display:"inline-flex",alignItems:"center",gap:5 }}><ShieldCheck size={13} strokeWidth={2} /> {activeCount}/{total} active</span>
          </div>
          {loading && <SkeletonList rows={4} />}
          {!loading && orderedSettings.map(item => {
            const meta = LABELS[item.key] ?? { label: item.key, desc: "" }
            const isAlwaysOn = item.key === "single_sign_on"
            return (
              <div key={item.key} style={{ padding:"18px 24px",borderBottom:"1px solid var(--border-light)",display:"flex",alignItems:"center",justifyContent:"space-between" }}>
                <div>
                  <div style={{ fontWeight:500,fontSize:14 }}>{meta.label}</div>
                  <div style={{ fontSize:12,color:"var(--text-muted)",marginTop:3 }}>{meta.desc}</div>
                </div>
                {isAlwaysOn ? (
                  <span style={{ background:"rgba(45,212,160,0.11)",color:"var(--accent-green)",border:"1px solid rgba(45,212,160,0.3)",borderRadius:6,padding:"5px 12px",fontSize:11.5,fontWeight:600,whiteSpace:"nowrap" }}>Always On</span>
                ) : (
                  <button
                    className={`toggle ${item.enabled ? "on" : ""}`}
                    onClick={() => toggle(item.key, item.enabled)}
                    disabled={saving === item.key}
                    style={{ opacity: saving === item.key ? 0.5 : 1 }}
                  />
                )}
              </div>
            )
          })}
        </div>

        {/* Regulatory Compliance — TRAI/RBI calling-window + DND suppression */}
        <div style={{ background:"var(--bg-card)",border:"1px solid var(--border)",borderRadius:12 }}>
          <div style={{ padding:"18px 24px",borderBottom:"1px solid var(--border)" }}>
            <div style={{ display:"flex",justifyContent:"space-between",alignItems:"center" }}>
              <div style={{ fontWeight:600,fontSize:15,display:"flex",alignItems:"center",gap:8 }}><Clock size={15} strokeWidth={2} style={{ color:"var(--text-muted)" }} /> Regulatory Compliance</div>
              <span style={{ background:"rgba(139,124,255,0.11)",color:"var(--accent-violet)",border:"1px solid rgba(139,124,255,0.3)",borderRadius:6,padding:"4px 12px",fontSize:12,fontWeight:600,display:"inline-flex",alignItems:"center",gap:5 }}><PhoneOff size={12} strokeWidth={2} /> {dndCount} suppressed</span>
            </div>
            <div style={{ fontSize:12,color:"var(--text-muted)",marginTop:6,lineHeight:1.5 }}>
              Blocks outbound calls outside the configured hours (TRAI/RBI) and against the suppression list below. This is not a live sync with TRAI's National Customer Preference Register — that requires Registered Telemarketer (RTM) registration. Verify these defaults with your compliance advisor.
            </div>
          </div>

          {complianceLoading && <SkeletonList rows={3} />}
          {!complianceLoading && (
            <>
              <div style={{ padding:"18px 24px",borderBottom:"1px solid var(--border-light)" }}>
                <div style={{ display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:14 }}>
                  <div style={{ fontWeight:500,fontSize:14 }}>Enforce calling window</div>
                  <button
                    className={`toggle ${compliance.enabled ? "on" : ""}`}
                    onClick={() => setCompliance((c) => ({ ...c, enabled: !c.enabled }))}
                  />
                </div>
                <div style={{ display:"flex", gap: 12, flexWrap: "wrap", marginBottom: 14, opacity: compliance.enabled ? 1 : 0.5 }}>
                  <div>
                    <label style={{ fontSize:11,color:"var(--text-muted)",display:"block",marginBottom:4 }}>Start</label>
                    <select
                      value={compliance.startHour}
                      disabled={!compliance.enabled}
                      onChange={(e) => setCompliance((c) => ({ ...c, startHour: parseInt(e.target.value, 10) }))}
                      style={{ height:32,fontSize:12.5,width:110 }}
                    >
                      {Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{hourLabel(h)}</option>)}
                    </select>
                  </div>
                  <div>
                    <label style={{ fontSize:11,color:"var(--text-muted)",display:"block",marginBottom:4 }}>End</label>
                    <select
                      value={compliance.endHour}
                      disabled={!compliance.enabled}
                      onChange={(e) => setCompliance((c) => ({ ...c, endHour: parseInt(e.target.value, 10) }))}
                      style={{ height:32,fontSize:12.5,width:110 }}
                    >
                      {Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{hourLabel(h)}</option>)}
                    </select>
                  </div>
                  <div style={{ flex:1, minWidth: 180 }}>
                    <label style={{ fontSize:11,color:"var(--text-muted)",display:"block",marginBottom:4 }}>Allowed days (IST)</label>
                    <div style={{ display:"flex", gap:5, flexWrap:"wrap" }}>
                      {DAY_OPTIONS.map((d) => (
                        <button
                          key={d.code}
                          disabled={!compliance.enabled}
                          onClick={() => toggleDay(d.code)}
                          style={{
                            fontSize:11, padding:"5px 9px", borderRadius:6, cursor: compliance.enabled ? "pointer" : "default",
                            border: `1px solid ${compliance.days.includes(d.code) ? "rgba(139,124,255,0.5)" : "var(--border)"}`,
                            background: compliance.days.includes(d.code) ? "rgba(139,124,255,0.15)" : "transparent",
                            color: compliance.days.includes(d.code) ? "var(--accent-violet)" : "var(--text-muted)",
                          }}
                        >{d.label}</button>
                      ))}
                    </div>
                  </div>
                </div>
                <button onClick={saveCallingWindow} disabled={savingWindow} className="btn-primary" style={{ height:32, fontSize:12.5 }}>
                  {savingWindow ? "Saving…" : "Save Calling Window"}
                </button>
              </div>

              <div style={{ padding:"18px 24px" }}>
                <div style={{ display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:10 }}>
                  <div style={{ fontWeight:500,fontSize:14 }}>DND / Opt-out Suppression List</div>
                  <button onClick={toggleDndList} className="btn-ghost" style={{ height:28,padding:"0 10px",fontSize:11.5 }}>
                    {showDndList ? "Hide list" : "View list"}
                  </button>
                </div>
                <div style={{ display:"flex", gap: 8, alignItems: "flex-start" }}>
                  <textarea
                    value={dndPaste}
                    onChange={(e) => setDndPaste(e.target.value)}
                    placeholder="Paste phone numbers to suppress, one per line (or an NCPR extract if you're a Registered Telemarketer)…"
                    rows={2}
                    style={{ flex:1, background:"var(--bg-card)", border:"1px solid var(--border)", color:"var(--text-primary)", borderRadius:8, padding:8, fontSize:12.5, resize:"vertical" }}
                  />
                  <button
                    onClick={addDndNumbers}
                    disabled={addingDnd || !dndPaste.trim()}
                    className="btn-primary"
                    style={{ height:32, fontSize:12, padding:"0 12px", alignSelf:"flex-start", opacity: addingDnd || !dndPaste.trim() ? 0.5 : 1 }}
                  ><Plus size={12} strokeWidth={2.2} /> Add</button>
                </div>

                {showDndList && (
                  <div style={{ marginTop:14, maxHeight:220, overflowY:"auto", border:"1px solid var(--border-light)", borderRadius:8, background: "var(--bg-secondary)" }}>
                    {dndEntries.length === 0 && (
                      <div style={{ padding: 20, textAlign: "center", color: "var(--text-muted)", fontSize: 12.5 }}>
                        <div style={{ fontWeight: 600, color: "var(--text-secondary)", marginBottom: 4 }}>DND suppression list is currently empty (0 numbers).</div>
                        <div>Outbound calling is allowed for all leads within the scheduled calling window. Paste numbers above to suppress.</div>
                      </div>
                    )}
                    {dndEntries.map((e) => (
                      <div key={e.phone} style={{ display:"flex", alignItems:"center", gap:10, padding:"9px 12px", borderBottom:"1px solid var(--border-light)", fontSize:12.5 }}>
                        <span style={{ fontFamily:"monospace", color:"var(--text-primary)" }}>{e.phone}</span>
                        <span style={{ color:"var(--text-muted)", fontSize:11 }}>{e.source}</span>
                        <div style={{ flex:1 }} />
                        <button onClick={() => removeDndNumber(e.phone)} title="Remove" className="icon-btn" style={{ width:24, height:24 }}>
                          <X size={12} strokeWidth={2} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </div>

        {/* Audit Log */}
        <div style={{ background:"var(--bg-card)",border:"1px solid var(--border)",borderRadius:12, overflow:"hidden" }}>
          <div style={{ padding:"18px 24px",borderBottom:"1px solid var(--border)",fontWeight:600,fontSize:15,display:"flex",justifyContent:"space-between",alignItems:"center" }}>
            <span>Audit Log {logs.length > 0 ? `(${logs.length})` : ""}</span>
            <button onClick={load} className="btn-ghost" style={{ height:30,padding:"0 12px",fontSize:12 }}><RotateCcw size={12} strokeWidth={1.9} /> Refresh</button>
          </div>
          {!loading && logs.length === 0 && (
            <div style={{ padding: 24, textAlign: "center", color: "var(--text-muted)", fontSize: 13 }}>No audit events yet.</div>
          )}
          <div style={{ maxHeight: 560, overflowY: "auto" }}>
          {logs.map((log) => {
            let meta: any = null
            if (log.metadata) {
              if (typeof log.metadata === "object") meta = log.metadata
              else if (typeof log.metadata === "string") {
                try { meta = JSON.parse(log.metadata) } catch {}
              }
            }
            const extraDetails = meta && typeof meta === "object"
              ? Object.entries(meta)
                  .filter(([k, v]) => v !== null && v !== undefined && v !== "" && !["sentCount", "skippedDnd", "failedCount", "total"].includes(k))
                  .map(([k, v]) => `${k}: ${typeof v === "object" ? JSON.stringify(v) : String(v)}`)
                  .join(" · ")
              : ""

            return (
              <div key={log.id} style={{ padding:"14px 24px",borderBottom:"1px solid var(--border-light)",display:"flex",alignItems:"center",gap:14 }}>
                <span style={{ width:30,height:30,borderRadius:8,background:"var(--overlay-hover)",display:"inline-flex",alignItems:"center",justifyContent:"center",color:"var(--text-muted)",flexShrink:0 }}><FileLock2 size={14} strokeWidth={1.8} /></span>
                <div style={{ flex:1, minWidth: 0 }}>
                  <div style={{ fontSize:14,fontWeight:500,display:"flex",alignItems:"center",gap:8,flexWrap:"wrap" }}>
                    <span>{log.action}</span>
                    {meta?.sentCount !== undefined && (
                      <span style={{ display:"inline-flex",alignItems:"center",gap:6,fontSize:11,fontWeight:600 }}>
                        <span style={{ background:"rgba(34,197,94,0.15)",color:"#22c55e",padding:"2px 8px",borderRadius:5 }}>
                          {meta.sentCount} sent
                        </span>
                        {meta.skippedDnd > 0 && (
                          <span style={{ background:"rgba(234,179,8,0.15)",color:"#eab308",padding:"2px 8px",borderRadius:5 }}>
                            {meta.skippedDnd} DND
                          </span>
                        )}
                        {meta.failedCount > 0 && (
                          <span style={{ background:"rgba(239,68,68,0.15)",color:"#ef4444",padding:"2px 8px",borderRadius:5 }}>
                            {meta.failedCount} failed
                          </span>
                        )}
                        <span style={{ color:"var(--text-muted)",fontSize:10.5 }}>
                          (of {meta.total} leads)
                        </span>
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize:12,color:"var(--text-muted)",marginTop:2 }}>{log.performed_by}</div>
                  {extraDetails && (
                    <div style={{ fontSize:11,color:"var(--text-secondary)",marginTop:3,wordBreak:"break-word" }}>
                      {extraDetails}
                    </div>
                  )}
                </div>
                <div style={{ fontSize:12,color:"var(--text-muted)",whiteSpace:"nowrap",textAlign:"right" }}>
                  <div>{timeAgo(log.created_at)}</div>
                  <div style={{ fontSize:10.5 }}>{formatDateTime(log.created_at)}</div>
                </div>
              </div>
            )
          })}
          </div>
        </div>
      </div>

      {/* Right panel */}
      <div style={{ display:"flex",flexDirection:"column",gap:16 }}>
        <div style={{ background:"var(--bg-card)",border:"1px solid var(--border)",borderRadius:12,padding:24 }}>
          <div style={{ fontWeight:600,fontSize:15,marginBottom:20 }}>Security Posture</div>
          <div style={{ display:"flex",alignItems:"center",gap:16,marginBottom:16 }}>
            <div style={{ width:52,height:52,borderRadius:"50%",background: score >= 75 ? "rgba(45,212,160,0.12)" : "rgba(247,183,49,0.12)",border: `2px solid ${score >= 75 ? "var(--accent-green)" : "var(--accent-yellow)"}`,display:"flex",alignItems:"center",justifyContent:"center",color: score >= 75 ? "var(--accent-green)" : "var(--accent-yellow)" }}>{score >= 75 ? <ShieldCheck size={22} strokeWidth={2} /> : <AlertTriangle size={20} strokeWidth={2} />}</div>
            <div>
              <div style={{ fontSize:28,fontWeight:700 }}>{grade}</div>
              <div style={{ fontSize:12,color:"var(--text-muted)" }}>{score >= 75 ? "All critical controls enforced" : "Some controls disabled"}</div>
            </div>
          </div>
          <div style={{ background:"var(--bg-secondary)",borderRadius:4,height:8,marginBottom:8 }}>
            <div style={{ width:`${score}%`,height:"100%",background: score >= 75 ? "var(--accent-green)" : "var(--accent-yellow)",borderRadius:4,transition:"width 0.5s" }} />
          </div>
          <div style={{ fontSize:12,color:"var(--text-muted)" }}>{score}% compliance score</div>
        </div>

        <div style={{ background:"var(--bg-card)", border:"1px solid var(--border)", borderRadius:12, padding:20 }}>
          <div style={{ fontWeight:600, fontSize:15, marginBottom:14, display:"flex", alignItems:"center", gap:8 }}>
            <HeartPulse size={15} strokeWidth={2} style={{ color:"var(--text-muted)" }} /> System Health
          </div>
          <SystemHealthView compact />
        </div>
      </div>
    </div>
  )
}
