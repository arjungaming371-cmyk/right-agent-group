"use client"
// Multi-branch management — the parent account's control room.
//
//   Branches    — sub-accounts: DLT ExoPhone, WhatsApp number, white-label,
//                 quotas, suspend/reactivate
//   AI Employees— the personas (Priya & co.), shared across branches or
//                 dedicated to specific ones, voice per employee
//   Scripts     — per-branch script overrides (per language); resolution:
//                 branch override → org default
//   Usage       — per-branch meter for centralized billing allocation
//
// branch_manager sees a READ-ONLY version scoped to their own branch (the
// API enforces it too — the UI restrictions are just ergonomics).

import { useCallback, useEffect, useState } from "react"

type Branch = {
  id: string; org_id: string; name: string; code: string; region: string | null
  status: "active" | "suspended"
  exotel_sid: string | null; exotel_caller_id: string | null; exotel_flow_app_id: string | null
  exotel_api_key_set: boolean; exotel_api_token_set: boolean
  whatsapp_phone_number_id: string | null; whatsapp_display_name: string | null; whatsapp_token_set: boolean
  brand_name: string | null; brand_logo_url: string | null; brand_primary_color: string; brand_tagline: string | null
  monthly_call_limit: number | null; monthly_whatsapp_limit: number | null; max_ai_employees: number | null
}

type AiEmployee = {
  id: string; name: string; description: string | null
  voice_provider: "sarvam" | "cartesia"; voice_speaker: string | null
  languages: string[]; scope: "shared" | "dedicated"; is_active: boolean
}

type Assignment = { branch_id: string; employee_id: string; is_primary: boolean }

type Usage = {
  branch: { id: string; name: string; code: string; status: string }
  limits: { monthly_call_limit: number | null; monthly_whatsapp_limit: number | null }
  current_month: { month: string; calls_made: number; call_seconds: number; whatsapp_messages: number; stt_seconds: number; tts_characters: number }
  history: any[]
}

const TABS = ["Branches", "AI Employees", "Scripts", "Usage & Billing"] as const
type Tab = (typeof TABS)[number]

const inputCls =
  "w-full rounded-[10px] border border-[var(--border)] bg-[var(--bg-secondary)] px-3 py-2 text-[13px] text-[var(--text-primary)] outline-none focus:border-[var(--accent-violet)]"
const labelCls = "mb-1 block text-[11px] font-semibold uppercase tracking-wide text-[var(--text-muted)]"
const btnPrimary =
  "rounded-[10px] px-4 py-2 text-[13px] font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
const btnGhost =
  "rounded-[10px] border border-[var(--border)] px-3 py-1.5 text-[12.5px] font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--overlay-hover)]"

function fmtMinutes(sec: number) {
  if (!sec) return "0m"
  const h = Math.floor(sec / 3600)
  const m = Math.round((sec % 3600) / 60)
  return h ? `${h}h ${m}m` : `${m}m`
}

export default function BranchesView({ role, branchId }: { role: string; branchId?: string | null }) {
  const [tab, setTab] = useState<Tab>("Branches")
  const isManagerOnly = role === "branch_manager"

  // ---- branches ----
  const [branches, setBranches] = useState<Branch[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [editing, setEditing] = useState<Branch | "new" | null>(null)
  const [saving, setSaving] = useState(false)

  // ---- employees ----
  const [employees, setEmployees] = useState<AiEmployee[]>([])
  const [assignments, setAssignments] = useState<Assignment[]>([])
  const [editingEmp, setEditingEmp] = useState<AiEmployee | "new" | null>(null)

  // ---- scripts ----
  const [scriptBranch, setScriptBranch] = useState<string>("")
  const [overrides, setOverrides] = useState<any[]>([])
  const [resolved, setResolved] = useState<Record<string, string | null>>({})
  const [scriptLang, setScriptLang] = useState<"english" | "hindi" | "telugu">("english")
  const [scriptDraft, setScriptDraft] = useState("")
  const [scriptDirty, setScriptDirty] = useState(false)
  const [scriptSaved, setScriptSaved] = useState("")

  // ---- usage ----
  const [usage, setUsage] = useState<Usage | null>(null)
  const [usageBranch, setUsageBranch] = useState<string>("")

  const loadBranches = useCallback(async () => {
    try {
      const r = await fetch("/api/branches")
      const d = await r.json()
      if (Array.isArray(d)) {
        setBranches(d)
        if (!scriptBranch && d[0]) setScriptBranch(d[0].id)
        if (!usageBranch && d[0]) setUsageBranch(d[0].id)
      } else setError(d.error || "Failed to load branches")
    } catch { setError("Failed to load branches") } finally { setLoading(false) }
  }, [scriptBranch, usageBranch])

  const loadEmployees = useCallback(async () => {
    try {
      const r = await fetch("/api/ai-employees")
      const d = await r.json()
      setEmployees(d.employees || []); setAssignments(d.assignments || [])
    } catch {}
  }, [])

  useEffect(() => { loadBranches(); loadEmployees() }, [loadBranches, loadEmployees])

  const loadScripts = useCallback(async () => {
    if (!scriptBranch) return
    setScriptSaved("")
    try {
      const r = await fetch(`/api/branches/${scriptBranch}/scripts`)
      const d = await r.json()
      setOverrides(d.overrides || []); setResolved(d.resolved || {})
    } catch {}
  }, [scriptBranch])
  useEffect(() => { loadScripts() }, [loadScripts])

  const loadUsage = useCallback(async () => {
    if (!usageBranch) return
    try {
      const r = await fetch(`/api/branches/${usageBranch}/usage`)
      const d = await r.json()
      setUsage(d.error ? null : d)
    } catch { setUsage(null) }
  }, [usageBranch])
  useEffect(() => { loadUsage() }, [loadUsage])

  // The override currently being edited (or a blank draft if none).
  const currentOverride = overrides.find(
    (o: any) => o.language === scriptLang && !o.employee_id
  )
  useEffect(() => {
    if (!scriptBranch) return
    setScriptDirty(false)
    setScriptSaved("")
    setScriptDraft(
      currentOverride?.content ??
        // Preview the org default the branch currently inherits.
        resolved[scriptLang] ??
        ""
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scriptBranch, scriptLang, overrides, resolved])

  async function saveScript() {
    try {
      const r = await fetch(`/api/branches/${scriptBranch}/scripts`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ language: scriptLang, content: scriptDraft }),
      })
      const d = await r.json()
      if (d.ok) { setScriptSaved("Saved — live for this branch within ~5 minutes"); setScriptDirty(false); loadScripts() }
      else setScriptSaved(d.error || "Save failed")
    } catch { setScriptSaved("Save failed") }
  }

  async function saveBranch(form: FormData) {
    setSaving(true); setError("")
    try {
      const payload: any = Object.fromEntries(form.entries())
      // Checkboxes + empty-means-clear semantics for secrets
      payload.monthly_call_limit = payload.monthly_call_limit || null
      payload.monthly_whatsapp_limit = payload.monthly_whatsapp_limit || null
      payload.max_ai_employees = payload.max_ai_employees || null
      const isNew = editing === "new"
      const id = isNew ? null : (editing as Branch).id
      const r = await fetch(isNew ? "/api/branches" : `/api/branches/${id}`, {
        method: isNew ? "POST" : "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })
      const d = await r.json()
      if (!r.ok) { setError(d.error || "Save failed"); return }
      setEditing(null); loadBranches()
    } finally { setSaving(false) }
  }

  async function toggleBranchStatus(b: Branch) {
    await fetch(`/api/branches/${b.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: b.status === "active" ? "suspended" : "active" }),
    })
    loadBranches()
  }

  async function deleteBranch(b: Branch) {
    if (!confirm(`Delete branch "${b.name}"? Its leads/calls stay in the database but lose their branch.`)) return
    await fetch(`/api/branches/${b.id}`, { method: "DELETE" })
    loadBranches()
  }

  async function saveEmployee(emp: any) {
    const isNew = editingEmp === "new"
    const id = isNew ? null : (editingEmp as AiEmployee).id
    const r = await fetch(isNew ? "/api/ai-employees" : `/api/ai-employees/${id}`, {
      method: isNew ? "POST" : "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(emp),
    })
    if (r.ok) { setEditingEmp(null); loadEmployees() }
    else { const d = await r.json(); setError(d.error || "Save failed") }
  }

  const branchesForEmp = (empId: string) => assignments.filter((a) => a.employee_id === empId).map((a) => a.branch_id)

  async function toggleAssignment(emp: AiEmployee, branchId: string) {
    if (emp.scope === "shared") return // shared employees serve every branch already
    const current = branchesForEmp(emp.id)
    const next = current.includes(branchId) ? current.filter((b) => b !== branchId) : [...current, branchId]
    setAssignments((prev) => [
      ...prev.filter((a) => a.employee_id !== emp.id),
      ...next.map((b) => ({ branch_id: b, employee_id: emp.id, is_primary: false })),
    ])
    await fetch(`/api/ai-employees/${emp.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ branchIds: next }),
    })
  }

  const visibleBranches = isManagerOnly && branchId ? branches.filter((b) => b.id === branchId) : branches
  const activeBranches = visibleBranches.filter((b) => b.status === "active")

  return (
    <div className="space-y-4">
      {/* Tabs */}
      <div className="flex flex-wrap gap-1.5 rounded-[12px] border border-[var(--border)] bg-[var(--bg-secondary)] p-1.5" style={{ width: "fit-content" }}>
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`rounded-[9px] px-3.5 py-1.5 text-[12.5px] font-semibold transition-colors ${
              tab === t ? "text-white" : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
            }`}
            style={tab === t ? { background: "var(--gradient-brand)" } : undefined}
          >
            {t}
          </button>
        ))}
      </div>

      {error && (
        <div className="rounded-[10px] border border-[var(--accent-red)] bg-[var(--overlay-soft)] px-3.5 py-2.5 text-[12.5px] text-[var(--accent-red)]">{error}</div>
      )}

      {/* ============ BRANCHES ============ */}
      {tab === "Branches" && (
        <div className="space-y-3">
          {!isManagerOnly && (
            <div className="flex justify-end">
              <button className={btnPrimary} style={{ background: "var(--gradient-brand)" }} onClick={() => setEditing("new")}>+ New Branch</button>
            </div>
          )}
          {loading ? (
            <div className="text-[13px] text-[var(--text-muted)]">Loading branches…</div>
          ) : visibleBranches.length === 0 ? (
            <div className="rounded-[12px] border border-[var(--border)] bg-[var(--bg-secondary)] px-4 py-8 text-center text-[13px] text-[var(--text-muted)]">
              No branches yet — create your first branch sub-account. Until then everything works exactly as before (single company, HQ scope).
            </div>
          ) : (
            <div className="overflow-x-auto rounded-[12px] border border-[var(--border)]">
              <table className="w-full text-left text-[13px]">
                <thead>
                  <tr className="border-b border-[var(--border)] bg-[var(--overlay-soft)] text-[11px] uppercase tracking-wide text-[var(--text-muted)]">
                    <th className="px-4 py-2.5">Branch</th>
                    <th className="px-4 py-2.5">Call number (DLT)</th>
                    <th className="px-4 py-2.5">WhatsApp</th>
                    <th className="px-4 py-2.5">Quotas</th>
                    <th className="px-4 py-2.5">Status</th>
                    {!isManagerOnly && <th className="px-4 py-2.5 text-right">Actions</th>}
                  </tr>
                </thead>
                <tbody>
                  {visibleBranches.map((b) => (
                    <tr key={b.id} className="border-b border-[var(--border-light)] last:border-0">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2.5">
                          <span className="h-2.5 w-2.5 flex-shrink-0 rounded-full" style={{ background: b.brand_primary_color || "#4f46e5" }} />
                          <div>
                            <div className="font-semibold text-[var(--text-primary)]">{b.brand_name || b.name}</div>
                            <div className="text-[11.5px] text-[var(--text-muted)]">{b.code}{b.region ? ` · ${b.region}` : ""}</div>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-[var(--text-secondary)]">{b.exotel_caller_id || <span className="text-[var(--text-muted)]">company number</span>}</td>
                      <td className="px-4 py-3 text-[var(--text-secondary)]">
                        {b.whatsapp_phone_number_id
                          ? <span title={b.whatsapp_display_name || ""}>own WABA ✓{b.whatsapp_token_set ? "" : " (token missing)"}</span>
                          : <span className="text-[var(--text-muted)]">company number</span>}
                      </td>
                      <td className="px-4 py-3 text-[var(--text-secondary)]">
                        {b.monthly_call_limit ? `${b.monthly_call_limit} calls/mo` : "unlimited"}
                        {b.monthly_whatsapp_limit ? ` · ${b.monthly_whatsapp_limit} WA/mo` : ""}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className="rounded-full px-2 py-0.5 text-[11px] font-bold"
                          style={b.status === "active"
                            ? { background: "rgba(34,197,94,0.14)", color: "var(--accent-green, #22c55e)" }
                            : { background: "rgba(234,179,8,0.14)", color: "var(--accent-yellow, #eab308)" }}
                        >
                          {b.status}
                        </span>
                      </td>
                      {!isManagerOnly && (
                        <td className="px-4 py-3 text-right">
                          <div className="flex justify-end gap-1.5">
                            <button className={btnGhost} onClick={() => setEditing(b)}>Edit</button>
                            <button className={btnGhost} onClick={() => toggleBranchStatus(b)}>{b.status === "active" ? "Suspend" : "Activate"}</button>
                            <button className={btnGhost} onClick={() => deleteBranch(b)} style={{ color: "var(--accent-red, #ef4444)" }}>Delete</button>
                          </div>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ============ AI EMPLOYEES ============ */}
      {tab === "AI Employees" && (
        <div className="space-y-3">
          {!isManagerOnly && (
            <div className="flex justify-end">
              <button className={btnPrimary} style={{ background: "var(--gradient-brand)" }} onClick={() => setEditingEmp("new")}>+ New AI Employee</button>
            </div>
          )}
          <div className="grid gap-3 md:grid-cols-2">
            {employees.filter((e) => e.is_active).map((emp) => (
              <div key={emp.id} className="rounded-[12px] border border-[var(--border)] bg-[var(--bg-secondary)] p-4">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="text-[14px] font-bold text-[var(--text-primary)]">{emp.name}</div>
                    <div className="text-[11.5px] text-[var(--text-muted)]">
                      {emp.voice_provider} · {emp.voice_speaker || "default speaker"} · {emp.languages.join(", ")}
                    </div>
                  </div>
                  <span className="rounded-full bg-[var(--overlay-chip)] px-2 py-0.5 text-[10.5px] font-bold text-[var(--text-secondary)]">
                    {emp.scope === "shared" ? "SHARED" : "DEDICATED"}
                  </span>
                </div>
                {emp.scope === "dedicated" && (
                  <div className="mt-3">
                    <div className={labelCls}>Serves these branches</div>
                    <div className="flex flex-wrap gap-1.5">
                      {branches.map((b) => {
                        const on = branchesForEmp(emp.id).includes(b.id)
                        return (
                          <button
                            key={b.id}
                            disabled={isManagerOnly}
                            onClick={() => toggleAssignment(emp, b.id)}
                            className="rounded-full border px-2.5 py-1 text-[11.5px] font-medium transition-colors"
                            style={on
                              ? { background: "var(--gradient-brand)", color: "#fff", border: "1px solid transparent" }
                              : { borderColor: "var(--border)", color: "var(--text-secondary)" }}
                          >
                            {b.code}
                          </button>
                        )
                      })}
                    </div>
                  </div>
                )}
                {emp.scope === "shared" && (
                  <div className="mt-3 text-[12px] text-[var(--text-muted)]">Bookable by every branch of the company.</div>
                )}
                {!isManagerOnly && (
                  <div className="mt-3 flex gap-1.5">
                    <button className={btnGhost} onClick={() => setEditingEmp(emp)}>Edit</button>
                    <button
                      className={btnGhost}
                      onClick={async () => {
                        await fetch(`/api/ai-employees/${emp.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ is_active: false }) })
                        loadEmployees()
                      }}
                    >
                      Retire
                    </button>
                  </div>
                )}
              </div>
            ))}
            {employees.filter((e) => e.is_active).length === 0 && (
              <div className="rounded-[12px] border border-[var(--border)] bg-[var(--bg-secondary)] px-4 py-8 text-center text-[13px] text-[var(--text-muted)] md:col-span-2">
                No AI Employees registered yet. The built-in default script still works — register Priya here only when you want per-branch assignment or a second persona.
              </div>
            )}
          </div>
        </div>
      )}

      {/* ============ SCRIPTS ============ */}
      {tab === "Scripts" && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <select className={inputCls} style={{ width: 240 }} value={scriptBranch} onChange={(e) => setScriptBranch(e.target.value)}>
              {visibleBranches.map((b) => <option key={b.id} value={b.id}>{b.name} ({b.code})</option>)}
            </select>
            <div className="flex gap-1.5">
              {(["english", "hindi", "telugu"] as const).map((l) => (
                <button
                  key={l}
                  onClick={() => setScriptLang(l)}
                  className={`rounded-[9px] px-3 py-1.5 text-[12.5px] font-semibold capitalize`}
                  style={scriptLang === l
                    ? { background: "var(--gradient-brand)", color: "#fff" }
                    : { color: "var(--text-secondary)", border: "1px solid var(--border)" }}
                >
                  {l}
                </button>
              ))}
            </div>
            {currentOverride ? (
              <span className="rounded-full bg-[var(--overlay-chip)] px-2.5 py-1 text-[11px] font-bold text-[var(--text-secondary)]">branch override active</span>
            ) : (
              <span className="rounded-full bg-[var(--overlay-chip)] px-2.5 py-1 text-[11px] font-bold text-[var(--text-muted)]">inheriting company script</span>
            )}
          </div>
          <p className="text-[12.5px] text-[var(--text-muted)]">
            The same AI Employee can say different things per branch: save an override here and this branch's calls/WhatsApp use it, while every other branch keeps the company script.
          </p>
          <textarea
            className={`${inputCls} font-mono`}
            style={{ minHeight: 320, lineHeight: 1.55 }}
            value={scriptDraft}
            onChange={(e) => { setScriptDraft(e.target.value); setScriptDirty(true) }}
            disabled={isManagerOnly}
          />
          <div className="flex items-center gap-3">
            {!isManagerOnly && (
              <button className={btnPrimary} style={{ background: "var(--gradient-brand)" }} disabled={!scriptDirty || !scriptBranch} onClick={saveScript}>
                Save branch script
              </button>
            )}
            {!isManagerOnly && currentOverride && (
              <button
                className={btnGhost}
                onClick={async () => {
                  await fetch(`/api/branches/${scriptBranch}/scripts`, {
                    method: "PUT",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ language: scriptLang, content: "" }),
                  })
                  loadScripts()
                }}
              >
                Remove override (back to company script)
              </button>
            )}
            {scriptSaved && <span className="text-[12.5px] font-medium text-[var(--accent-green, #22c55e)]">{scriptSaved}</span>}
          </div>
        </div>
      )}

      {/* ============ USAGE & BILLING ============ */}
      {tab === "Usage & Billing" && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <select className={inputCls} style={{ width: 240 }} value={usageBranch} onChange={(e) => setUsageBranch(e.target.value)}>
              {visibleBranches.map((b) => <option key={b.id} value={b.id}>{b.name} ({b.code})</option>)}
            </select>
            <span className="text-[12px] text-[var(--text-muted)]">Centralized billing: the parent account pays; use these meters to allocate costs per branch.</span>
          </div>
          {usage ? (
            <>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <div className="rounded-[12px] border border-[var(--border)] bg-[var(--bg-secondary)] p-4">
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">Calls this month</div>
                  <div className="mt-1 text-[22px] font-bold text-[var(--text-primary)]">{usage.current_month.calls_made}<span className="ml-1.5 text-[12px] font-medium text-[var(--text-muted)]">/ {usage.limits.monthly_call_limit ?? "∞"}</span></div>
                </div>
                <div className="rounded-[12px] border border-[var(--border)] bg-[var(--bg-secondary)] p-4">
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">Talk time</div>
                  <div className="mt-1 text-[22px] font-bold text-[var(--text-primary)]">{fmtMinutes(usage.current_month.call_seconds)}</div>
                </div>
                <div className="rounded-[12px] border border-[var(--border)] bg-[var(--bg-secondary)] p-4">
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">WhatsApp messages</div>
                  <div className="mt-1 text-[22px] font-bold text-[var(--text-primary)]">{usage.current_month.whatsapp_messages}<span className="ml-1.5 text-[12px] font-medium text-[var(--text-muted)]">/ {usage.limits.monthly_whatsapp_limit ?? "∞"}</span></div>
                </div>
                <div className="rounded-[12px] border border-[var(--border)] bg-[var(--bg-secondary)] p-4">
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">AI voice volume</div>
                  <div className="mt-1 text-[22px] font-bold text-[var(--text-primary)]">{Math.round(usage.current_month.stt_seconds || 0)}s<span className="ml-1.5 text-[12px] font-medium text-[var(--text-muted)]">STT · {usage.current_month.tts_characters || 0} chars TTS</span></div>
                </div>
              </div>
              {usage.history?.length > 0 && (
                <div className="overflow-x-auto rounded-[12px] border border-[var(--border)]">
                  <table className="w-full text-left text-[13px]">
                    <thead>
                      <tr className="border-b border-[var(--border)] bg-[var(--overlay-soft)] text-[11px] uppercase tracking-wide text-[var(--text-muted)]">
                        <th className="px-4 py-2.5">Month</th>
                        <th className="px-4 py-2.5">Calls</th>
                        <th className="px-4 py-2.5">Talk time</th>
                        <th className="px-4 py-2.5">WhatsApp</th>
                      </tr>
                    </thead>
                    <tbody>
                      {usage.history.map((h: any) => (
                        <tr key={h.month} className="border-b border-[var(--border-light)] last:border-0">
                          <td className="px-4 py-2.5 font-semibold text-[var(--text-primary)]">{h.month}</td>
                          <td className="px-4 py-2.5 text-[var(--text-secondary)]">{h.calls_made}</td>
                          <td className="px-4 py-2.5 text-[var(--text-secondary)]">{fmtMinutes(h.call_seconds)}</td>
                          <td className="px-4 py-2.5 text-[var(--text-secondary)]">{h.whatsapp_messages}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          ) : (
            <div className="rounded-[12px] border border-[var(--border)] bg-[var(--bg-secondary)] px-4 py-8 text-center text-[13px] text-[var(--text-muted)]">
              No usage recorded yet — meters fill as this branch makes calls and sends WhatsApp messages.
            </div>
          )}
        </div>
      )}

      {/* ============ MODALS ============ */}
      {editing && (
        <BranchModal
          branch={editing === "new" ? null : (editing as Branch)}
          saving={saving}
          onClose={() => setEditing(null)}
          onSubmit={saveBranch}
        />
      )}
      {editingEmp && (
        <EmployeeModal
          employee={editingEmp === "new" ? null : (editingEmp as AiEmployee)}
          onClose={() => setEditingEmp(null)}
          onSubmit={saveEmployee}
        />
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Branch create/edit modal
// ---------------------------------------------------------------------------

function BranchModal({ branch, saving, onClose, onSubmit }: {
  branch: Branch | null
  saving: boolean
  onClose: () => void
  onSubmit: (form: FormData) => void
}) {
  const isNew = !branch
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div
        className="max-h-[88vh] w-full max-w-2xl overflow-y-auto rounded-[14px] border border-[var(--border)] bg-[var(--bg-primary)] p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 text-[16px] font-bold text-[var(--text-primary)]">{isNew ? "New branch" : `Edit ${branch!.name}`}</div>
        <form
          onSubmit={(e) => { e.preventDefault(); onSubmit(new FormData(e.currentTarget)) }}
          className="space-y-4"
        >
          <section>
            <div className={labelCls}>Identity</div>
            <div className="grid gap-3 sm:grid-cols-3">
              <input name="name" required defaultValue={branch?.name || ""} placeholder="Branch name (Kukatpally)" className={inputCls} />
              <input name="code" required defaultValue={branch?.code || ""} placeholder="Code (KTP)" className={inputCls} disabled={!isNew} />
              <input name="region" defaultValue={branch?.region || ""} placeholder="Region / city" className={inputCls} />
            </div>
          </section>

          <section>
            <div className={labelCls}>Phone (DLT-approved ExoPhone for this branch)</div>
            <div className="grid gap-3 sm:grid-cols-2">
              <input name="exotel_caller_id" defaultValue={branch?.exotel_caller_id || ""} placeholder="Caller ID e.g. 04047198352" className={inputCls} />
              <input name="exotel_sid" defaultValue={branch?.exotel_sid || ""} placeholder="Exotel SID (optional — else company's)" className={inputCls} />
              <input name="exotel_api_key" placeholder={branch?.exotel_api_key_set ? "API key configured — type to replace" : "Exotel API key (optional)"} className={inputCls} />
              <input name="exotel_api_token" placeholder={branch?.exotel_api_token_set ? "API token configured — type to replace" : "Exotel API token (optional)"} className={inputCls} />
              <input name="exotel_flow_app_id" defaultValue={branch?.exotel_flow_app_id || ""} placeholder="Flow app ID (optional)" className={inputCls} />
            </div>
            <p className="mt-1.5 text-[11.5px] text-[var(--text-muted)]">Leave credentials blank to dial from the company's Exotel account with the branch's own number as caller ID.</p>
          </section>

          <section>
            <div className={labelCls}>WhatsApp (branch's own WABA number)</div>
            <div className="grid gap-3 sm:grid-cols-3">
              <input name="whatsapp_phone_number_id" defaultValue={branch?.whatsapp_phone_number_id || ""} placeholder="Phone Number ID" className={inputCls} />
              <input name="whatsapp_token" placeholder={branch?.whatsapp_token_set ? "Token configured — type to replace" : "Permanent System User token"} className={inputCls} />
              <input name="whatsapp_display_name" defaultValue={branch?.whatsapp_display_name || ""} placeholder="Display name" className={inputCls} />
            </div>
          </section>

          <section>
            <div className={labelCls}>White-label (what customers see)</div>
            <div className="grid gap-3 sm:grid-cols-2">
              <input name="brand_name" defaultValue={branch?.brand_name || ""} placeholder="Brand name (overrides company name)" className={inputCls} />
              <input name="brand_logo_url" defaultValue={branch?.brand_logo_url || ""} placeholder="Logo URL" className={inputCls} />
              <div className="flex items-center gap-2">
                <input name="brand_primary_color" type="color" defaultValue={branch?.brand_primary_color || "#4f46e5"} className="h-9 w-14 rounded-[10px] border border-[var(--border)] bg-transparent" />
                <input name="brand_tagline" defaultValue={branch?.brand_tagline || ""} placeholder="Tagline" className={inputCls} />
              </div>
            </div>
          </section>

          <section>
            <div className={labelCls}>Monthly quotas (blank = unlimited)</div>
            <div className="grid gap-3 sm:grid-cols-3">
              <input name="monthly_call_limit" type="number" min={0} defaultValue={branch?.monthly_call_limit ?? ""} placeholder="Calls / month" className={inputCls} />
              <input name="monthly_whatsapp_limit" type="number" min={0} defaultValue={branch?.monthly_whatsapp_limit ?? ""} placeholder="WhatsApp msgs / month" className={inputCls} />
              <input name="max_ai_employees" type="number" min={0} defaultValue={branch?.max_ai_employees ?? ""} placeholder="Max AI Employees" className={inputCls} />
            </div>
          </section>

          <div className="flex justify-end gap-2 pt-1">
            <button type="button" className={btnGhost} onClick={onClose}>Cancel</button>
            <button type="submit" className={btnPrimary} style={{ background: "var(--gradient-brand)" }} disabled={saving}>
              {saving ? "Saving…" : isNew ? "Create branch" : "Save changes"}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// AI Employee create/edit modal
// ---------------------------------------------------------------------------

function EmployeeModal({ employee, onClose, onSubmit }: {
  employee: AiEmployee | null
  onClose: () => void
  onSubmit: (emp: any) => void
}) {
  const isNew = !employee
  const [scope, setScope] = useState<"shared" | "dedicated">(employee?.scope || "dedicated")
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div
        className="w-full max-w-lg rounded-[14px] border border-[var(--border)] bg-[var(--bg-primary)] p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 text-[16px] font-bold text-[var(--text-primary)]">{isNew ? "New AI Employee" : `Edit ${employee!.name}`}</div>
        <form
          onSubmit={(e) => {
            e.preventDefault()
            const f = new FormData(e.currentTarget)
            onSubmit({
              name: f.get("name"), description: f.get("description"),
              voice_provider: f.get("voice_provider"), voice_speaker: f.get("voice_speaker"),
              languages: f.getAll("languages"), scope,
            })
          }}
          className="space-y-4"
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className={labelCls}>Name</label>
              <input name="name" required defaultValue={employee?.name || ""} placeholder="Priya" className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Scope</label>
              <select className={inputCls} value={scope} onChange={(e) => setScope(e.target.value as any)}>
                <option value="dedicated">Dedicated — assigned branches only</option>
                <option value="shared">Shared — every branch</option>
              </select>
            </div>
          </div>
          <div>
            <label className={labelCls}>Description</label>
            <input name="description" defaultValue={employee?.description || ""} placeholder="Telugu-first loan advisor for the Hyderabad branch" className={inputCls} />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className={labelCls}>Voice provider</label>
              <select name="voice_provider" defaultValue={employee?.voice_provider || "sarvam"} className={inputCls}>
                <option value="sarvam">Sarvam Bulbul (Indian voices)</option>
                <option value="cartesia">Cartesia Sonic</option>
              </select>
            </div>
            <div>
              <label className={labelCls}>Voice speaker / ID</label>
              <input name="voice_speaker" defaultValue={employee?.voice_speaker || ""} placeholder="priya  (or a Cartesia voice ID)" className={inputCls} />
            </div>
          </div>
          <div>
            <label className={labelCls}>Languages</label>
            <div className="flex gap-4 text-[13px] text-[var(--text-secondary)]">
              {["english", "hindi", "telugu"].map((l) => (
                <label key={l} className="flex items-center gap-1.5 capitalize">
                  <input type="checkbox" name="languages" value={l} defaultChecked={employee ? employee.languages.includes(l) : true} />
                  {l}
                </label>
              ))}
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <button type="button" className={btnGhost} onClick={onClose}>Cancel</button>
            <button type="submit" className={btnPrimary} style={{ background: "var(--gradient-brand)" }}>{isNew ? "Create" : "Save"}</button>
          </div>
        </form>
      </div>
    </div>
  )
}
