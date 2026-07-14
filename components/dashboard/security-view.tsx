"use client"
import { useEffect, useState } from "react"
import { ShieldCheck, AlertTriangle, RotateCcw, FileLock2, PhoneOff, Clock, X, Plus } from "lucide-react"
import { SkeletonList } from "../ui/skeleton"
import { useToast } from "../ui/toast"

type Setting = { key: string; enabled: boolean }
type AuditLog = { id: string; action: string; performed_by: string; created_at: string }

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
      const data = await res.json()
      setDndEntries(data.entries ?? [])
    } catch {}
  }

  useEffect(() => { load(); loadCompliance() }, [])

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
    if (next && dndEntries.length === 0) await loadDndEntries()
  }

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
    <div className="grid grid-cols-1 items-start gap-4 md:grid-cols-[1fr_320px] md:gap-5">
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

        {/* Regulatory Compliance — TRAI/RBI calling-window + DND suppression */}
        <div style={{ background:"var(--bg-card)",border:"1px solid var(--border)",borderRadius:12 }}>
          <div style={{ padding:"18px 24px",borderBottom:"1px solid var(--border)" }}>
            <div style={{ display:"flex",justifyContent:"space-between",alignItems:"center" }}>
              <div style={{ fontWeight:600,fontSize:15,display:"flex",alignItems:"center",gap:8 }}><Clock size={15} strokeWidth={2} style={{ color:"var(--text-muted)" }} /> Regulatory Compliance</div>
              <span style={{ background:"rgba(139,124,255,0.11)",color:"#a5b0ff",border:"1px solid rgba(139,124,255,0.3)",borderRadius:6,padding:"4px 12px",fontSize:12,fontWeight:600,display:"inline-flex",alignItems:"center",gap:5 }}><PhoneOff size={12} strokeWidth={2} /> {dndCount} suppressed</span>
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
                            color: compliance.days.includes(d.code) ? "#a5b0ff" : "var(--text-muted)",
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
                    style={{ flex:1, background:"#0d1422", border:"1px solid var(--border)", color:"var(--text-primary)", borderRadius:8, padding:8, fontSize:12.5, resize:"vertical" }}
                  />
                  <button
                    onClick={addDndNumbers}
                    disabled={addingDnd || !dndPaste.trim()}
                    className="btn-primary"
                    style={{ height:32, fontSize:12, padding:"0 12px", alignSelf:"flex-start", opacity: addingDnd || !dndPaste.trim() ? 0.5 : 1 }}
                  ><Plus size={12} strokeWidth={2.2} /> Add</button>
                </div>

                {showDndList && (
                  <div style={{ marginTop:14, maxHeight:220, overflowY:"auto", border:"1px solid var(--border-light)", borderRadius:8 }}>
                    {dndEntries.length === 0 && <div style={{ padding:16, textAlign:"center", color:"var(--text-muted)", fontSize:12.5 }}>Suppression list is empty.</div>}
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
