"use client"
import { useEffect, useState } from "react"
import {
  ShieldCheck,
  AlertTriangle,
  RotateCcw,
  FileLock2,
  PhoneOff,
  Clock,
  X,
  Plus,
  HeartPulse,
  ChevronRight,
  Copy,
  Check,
  CheckCircle2,
  Phone,
  Calendar,
  MapPin,
  MessageSquare,
  User,
  Building,
  FileText
} from "lucide-react"
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
  const [selectedLog, setSelectedLog] = useState<AuditLog | null>(null)
  const [copied, setCopied] = useState(false)

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

            const isResolution = log.action.includes("resolved") || log.action.includes("review")
            const hasLead = Boolean(meta?.leadName || meta?.name)
            const leadDisplay = meta?.leadName || meta?.name || ""
            const phoneDisplay = meta?.leadPhone || meta?.phone || ""
            const catDisplay = meta?.category || (log.action.includes("calendar") ? "Appointment" : log.action.includes("loan") ? "Loan" : "")
            const productDisplay = meta?.productInterest || meta?.product || ""
            const amountDisplay = meta?.loanAmount ? `₹${Number(meta.loanAmount).toLocaleString("en-IN")}` : ""
            const noteText = meta?.resolutionNotes || meta?.notes

            return (
              <div
                key={log.id}
                onClick={() => setSelectedLog(log)}
                className="hover:bg-[var(--overlay-soft)] transition cursor-pointer"
                style={{ padding:"14px 24px",borderBottom:"1px solid var(--border-light)",display:"flex",alignItems:"center",gap:14 }}
              >
                <span style={{ width:32,height:32,borderRadius:8,background: isResolution ? "rgba(34,197,94,0.12)" : "var(--overlay-hover)",display:"inline-flex",alignItems:"center",justifyContent:"center",color: isResolution ? "#22c55e" : "var(--text-muted)",flexShrink:0 }}>
                  {isResolution ? <CheckCircle2 size={16} strokeWidth={2} /> : <FileLock2 size={15} strokeWidth={1.8} />}
                </span>
                <div style={{ flex:1, minWidth: 0 }}>
                  <div style={{ fontSize:14,fontWeight:500,display:"flex",alignItems:"center",gap:8,flexWrap:"wrap" }}>
                    <span className="capitalize">{log.action}</span>
                    {catDisplay && (
                      <span style={{ background:"rgba(168,85,247,0.15)",color:"#c084fc",padding:"2px 8px",borderRadius:5,fontSize:11,fontWeight:600 }}>
                        {catDisplay}
                      </span>
                    )}
                    {productDisplay && (
                      <span style={{ background:"rgba(34,197,94,0.15)",color:"#22c55e",padding:"2px 8px",borderRadius:5,fontSize:11,fontWeight:600 }}>
                        {productDisplay.toUpperCase()}{amountDisplay ? ` • ${amountDisplay}` : ""}
                      </span>
                    )}
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
                  {hasLead && (
                    <div style={{ fontSize:12,color:"var(--text-primary)",marginTop:3,fontWeight:500,display:"flex",alignItems:"center",gap:6 }}>
                      <span>👤 {leadDisplay}</span>
                      {phoneDisplay && <span style={{ color:"var(--text-muted)",fontSize:11 }}>({phoneDisplay})</span>}
                    </div>
                  )}
                  {noteText && (
                    <div style={{ fontSize:11.5,color:"#22c55e",marginTop:3,fontWeight:500 }}>
                      📝 Resolution Note: &ldquo;{noteText}&rdquo;
                    </div>
                  )}
                </div>
                <div style={{ fontSize:12,color:"var(--text-muted)",whiteSpace:"nowrap",textAlign:"right",display:"flex",alignItems:"center",gap:8 }}>
                  <div>
                    <div>{timeAgo(log.created_at)}</div>
                    <div style={{ fontSize:10.5 }}>{formatDateTime(log.created_at)}</div>
                  </div>
                  <ChevronRight size={15} style={{ color:"var(--text-muted)", opacity: 0.6 }} />
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

      {/* Audit Log Details Modal */}
      {selectedLog && (() => {
        const meta = selectedLog.metadata && typeof selectedLog.metadata === "object" ? selectedLog.metadata : {}
        const isResolution = selectedLog.action.includes("resolved") || selectedLog.action.includes("review")
        const hasLead = Boolean(meta.leadName || meta.name || meta.leadPhone || meta.phone || meta.fullDescription || meta.originalSummary || meta.calId || meta.commId || meta.loanAppId)
        const leadName = meta.leadName || meta.name || "Customer"
        const phone = meta.leadPhone || meta.phone || ""
        const category = meta.category || (selectedLog.action.includes("calendar") ? "Office Visit" : selectedLog.action.includes("loan") ? "Loan Confirmed" : "Escalation")
        const product = meta.productInterest || meta.product || "Education Loan"
        const amount = meta.loanAmount ? `₹${Number(meta.loanAmount).toLocaleString("en-IN")}` : ""
        const notes = meta.resolutionNotes || meta.notes || ""
        const fullStory = meta.fullDescription || meta.originalSummary || ""
        const location = meta.location || ""
        const eventAt = meta.eventAt ? formatDateTime(meta.eventAt) : ""
        const initials = leadName.split(" ").filter(Boolean).map((p: string) => p[0]).slice(0, 2).join("").toUpperCase() || "CU"

        return (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center p-4"
            style={{ background: "rgba(0,0,0,0.75)", backdropFilter: "blur(6px)" }}
            onClick={() => setSelectedLog(null)}
          >
            <div
              className="w-full max-w-2xl rounded-2xl border border-[var(--border)] bg-[var(--bg-card)] p-6 shadow-2xl transition max-h-[90vh] flex flex-col"
              onClick={e => e.stopPropagation()}
            >
              {/* Modal Top Header */}
              <div className="flex items-start justify-between border-b border-[var(--border)] pb-4">
                <div className="flex items-center gap-3">
                  <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
                    {isResolution ? <CheckCircle2 size={18} strokeWidth={2.2} /> : <FileLock2 size={18} />}
                  </span>
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="text-[16px] font-bold text-[var(--text-primary)] capitalize">
                        {selectedLog.action}
                      </h3>
                      <span className="rounded-md bg-emerald-500/15 px-2 py-0.5 text-[11px] font-semibold text-emerald-400 border border-emerald-500/30">
                        Audit Log
                      </span>
                    </div>
                    <p className="text-[12px] text-[var(--text-muted)] mt-0.5 flex items-center gap-1.5">
                      <span>Recorded by <strong className="text-[var(--text-secondary)]">{selectedLog.performed_by}</strong></span>
                      <span>•</span>
                      <span>{timeAgo(selectedLog.created_at)}</span>
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => setSelectedLog(null)}
                  className="flex h-8 w-8 items-center justify-center rounded-lg text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--overlay-soft)] transition"
                >
                  <X size={18} />
                </button>
              </div>

              {/* Modal Body */}
              <div className="flex-1 overflow-y-auto py-5 space-y-5 pr-1">
                {hasLead ? (
                  <>
                    {/* 1. Need Human Header Bar */}
                    <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-surface)] p-4">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div className="flex items-center gap-3">
                          <div className="flex h-11 w-11 items-center justify-center rounded-full bg-gradient-to-br from-emerald-500/30 to-teal-500/20 text-emerald-300 font-bold text-sm border border-emerald-500/30">
                            {initials}
                          </div>
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="text-[15px] font-bold text-[var(--text-primary)]">{leadName}</span>
                              {phone && (
                                <span className="inline-flex items-center gap-1 text-[12px] text-[var(--text-muted)] font-mono">
                                  <Phone size={11} /> {phone}
                                </span>
                              )}
                            </div>
                            <div className="flex flex-wrap items-center gap-2 mt-1">
                              {/* Category Badge */}
                              {category === "Office Visit" && (
                                <span className="rounded-full bg-purple-500/20 border border-purple-500/40 px-2.5 py-0.5 text-[11px] font-bold text-purple-300 flex items-center gap-1">
                                  🏢 Office Visit
                                </span>
                              )}
                              {category === "Loan Confirmed" && (
                                <span className="rounded-full bg-emerald-500/20 border border-emerald-500/40 px-2.5 py-0.5 text-[11px] font-bold text-emerald-300 flex items-center gap-1">
                                  🟢 Loan Confirmed
                                </span>
                              )}
                              {category === "Callback" && (
                                <span className="rounded-full bg-blue-500/20 border border-blue-500/40 px-2.5 py-0.5 text-[11px] font-bold text-blue-300 flex items-center gap-1">
                                  📞 Callback
                                </span>
                              )}
                              {category === "Loan Application" && (
                                <span className="rounded-full bg-indigo-500/20 border border-indigo-500/40 px-2.5 py-0.5 text-[11px] font-bold text-indigo-300 flex items-center gap-1">
                                  📄 Loan Application
                                </span>
                              )}
                              {category === "Escalation" && (
                                <span className="rounded-full bg-amber-500/20 border border-amber-500/40 px-2.5 py-0.5 text-[11px] font-bold text-amber-300 flex items-center gap-1">
                                  ⚠️ Escalation
                                </span>
                              )}
                              {/* Product & Loan Amount Badge */}
                              <span className="rounded-full bg-emerald-500/15 border border-emerald-500/30 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-400">
                                {product.toUpperCase()}{amount ? ` • ${amount}` : ""}
                              </span>
                            </div>
                          </div>
                        </div>

                        {/* Event Time / Location if applicable */}
                        {(eventAt || location) && (
                          <div className="text-right text-[12px] text-[var(--text-muted)] space-y-0.5">
                            {eventAt && (
                              <div className="flex items-center justify-end gap-1 font-medium text-purple-300">
                                <Calendar size={12} /> {eventAt}
                              </div>
                            )}
                            {location && (
                              <div className="flex items-center justify-end gap-1 text-[11px] text-[var(--text-secondary)] max-w-xs truncate" title={location}>
                                <MapPin size={11} /> {location}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    </div>

                    {/* 2. Original Request & Conversation Intel (Need Human Context) */}
                    <div>
                      <div className="text-[11px] font-bold uppercase tracking-wider text-[var(--text-muted)] flex items-center gap-1.5 mb-2">
                        <MessageSquare size={13} className="text-blue-400" /> Original Request & Customer Context (From Need Human)
                      </div>
                      <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-surface)] p-4 text-[13px] leading-relaxed text-[var(--text-primary)] shadow-sm">
                        {fullStory || "Caller requested human assistance or confirmed requirement during conversation."}
                      </div>
                    </div>

                    {/* 3. What Was Resolved & Written Notes */}
                    <div>
                      <div className="text-[11px] font-bold uppercase tracking-wider text-emerald-400 flex items-center gap-1.5 mb-2">
                        <CheckCircle2 size={14} /> What Was Resolved & Officer Notes
                      </div>
                      <div className="rounded-xl border border-emerald-500/35 bg-gradient-to-b from-emerald-500/10 to-transparent p-4.5 space-y-3">
                        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-emerald-500/20 pb-2.5 text-[12px]">
                          <div>
                            <span className="text-[var(--text-muted)]">Resolved by: </span>
                            <span className="font-semibold text-[var(--text-primary)]">{selectedLog.performed_by}</span>
                          </div>
                          <div className="flex items-center gap-1.5 text-[var(--text-muted)]">
                            <Clock size={12} />
                            <span>{formatDateTime(selectedLog.created_at)}</span>
                          </div>
                        </div>

                        <div>
                          <div className="text-[11px] font-bold text-emerald-400 uppercase tracking-wide">
                            Loan Officer Written Notes:
                          </div>
                          <div className="mt-2 rounded-xl border border-emerald-500/30 bg-[var(--bg-card)] p-3.5 text-[13.5px] font-medium text-[var(--text-primary)] leading-relaxed shadow-sm">
                            &ldquo;{notes || "Marked resolved without additional notes."}&rdquo;
                          </div>
                        </div>
                      </div>
                    </div>
                  </>
                ) : (
                  /* Non-lead system action card */
                  <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-surface)] p-4 space-y-4">
                    <div className="flex items-center gap-2">
                      <span className="text-[14px] font-bold text-[var(--text-primary)] capitalize">{selectedLog.action}</span>
                    </div>

                    {meta?.sentCount !== undefined ? (
                      <div>
                        <div className="text-[11px] font-bold uppercase tracking-wider text-[var(--text-muted)] mb-2">Campaign Broadcast Results</div>
                        <div className="grid grid-cols-2 gap-2 text-[12px]">
                          <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-card)] p-2.5">
                            <div className="text-[10.5px] text-[var(--text-muted)]">Messages Sent</div>
                            <div className="text-[16px] font-bold text-emerald-400">{meta.sentCount}</div>
                          </div>
                          <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-card)] p-2.5">
                            <div className="text-[10.5px] text-[var(--text-muted)]">Total Targeted</div>
                            <div className="text-[16px] font-bold text-[var(--text-primary)]">{meta.total}</div>
                          </div>
                          <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-card)] p-2.5">
                            <div className="text-[10.5px] text-[var(--text-muted)]">Skipped DND</div>
                            <div className="text-[16px] font-bold text-amber-400">{meta.skippedDnd || 0}</div>
                          </div>
                          <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-card)] p-2.5">
                            <div className="text-[10.5px] text-[var(--text-muted)]">Failed</div>
                            <div className="text-[16px] font-bold text-rose-400">{meta.failedCount || 0}</div>
                          </div>
                        </div>
                      </div>
                    ) : meta?.email ? (
                      <div className="space-y-1.5 text-[12.5px]">
                        <div><strong className="text-[var(--text-muted)]">User Email:</strong> <span className="font-semibold text-[var(--text-primary)]">{meta.email}</span></div>
                        {meta.role && <div><strong className="text-[var(--text-muted)]">Assigned Role:</strong> <span className="capitalize text-emerald-400 font-semibold">{meta.role}</span></div>}
                      </div>
                    ) : (
                      <div className="text-[13px] text-[var(--text-secondary)]">
                        Action performed successfully by <strong className="text-[var(--text-primary)]">{selectedLog.performed_by}</strong> on {formatDateTime(selectedLog.created_at)}.
                      </div>
                    )}
                  </div>
                )}

                {/* Collapsed Technical JSON Payload (Only visible if explicitly opened) */}
                <details className="mt-4 border-t border-[var(--border)] pt-3 text-[11px] text-[var(--text-muted)] cursor-pointer">
                  <summary className="select-none font-medium hover:text-[var(--text-primary)] transition">
                    Technical Event Payload (Developer Details)
                  </summary>
                  <pre className="mt-2 max-h-40 overflow-auto rounded-lg bg-[var(--bg-surface)] p-3 text-[10.5px] font-mono text-[var(--text-secondary)] border border-[var(--border)]">
                    {JSON.stringify(selectedLog, null, 2)}
                  </pre>
                </details>
              </div>

              {/* Modal Footer */}
              <div className="mt-3 border-t border-[var(--border)] pt-3 flex justify-end">
                <button
                  onClick={() => setSelectedLog(null)}
                  className="h-8.5 rounded-lg border border-[var(--border)] px-5 text-[12px] font-semibold text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--overlay-soft)] transition"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        )
      })()}
    </div>
  )
}
