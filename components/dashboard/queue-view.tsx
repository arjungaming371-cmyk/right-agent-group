"use client"

import { useEffect, useState, useCallback } from "react"
import {
  PhoneCall, Phone, MessageCircle, Zap, XCircle, RotateCcw, Download, Play, Pause,
  ListChecks, Clock, ShieldAlert, RefreshCw,
} from "lucide-react"
import { timeAgo, formatDateTime } from "@/lib/utils"
import { usePolling } from "@/lib/use-poll"
import { useToast } from "../ui/toast"
import { statusGroup, isRequeueable, STATUS_GROUP_COLORS, type QueueStatusGroup } from "@/lib/dialer-logic"

type Role = "admin" | "agent" | "viewer" | "developer" | "branch_manager"

type QueueItem = {
  id: string
  lead_id: string | null
  name: string | null
  phone: string
  language: string | null
  product_interest: string | null
  status: string
  channel: string | null
  priority: number | null
  retry_count: number | null
  scheduled_at: string | null
  called_at: string | null
  cancelled_at: string | null
  cancelled_by: string | null
  call_sid: string | null
  created_at: string
}

type TabId = "all" | QueueStatusGroup

const TABS: { id: TabId; label: string }[] = [
  { id: "all", label: "All" },
  { id: "pending", label: "Pending" },
  { id: "dialing", label: "Dialing" },
  { id: "called", label: "Completed" },
  { id: "failed", label: "Failed" },
  { id: "skipped", label: "Skipped" },
  { id: "cancelled", label: "Cancelled" },
]

const CHANNEL_META: Record<string, { label: string; icon: any; color: string }> = {
  phone: { label: "Phone", icon: Phone, color: "var(--accent-blue)" },
  whatsapp_voice: { label: "WhatsApp Voice", icon: MessageCircle, color: "var(--accent-green)" },
  auto: { label: "Auto", icon: Zap, color: "var(--accent-violet)" },
}

function channelMeta(ch: string | null) {
  return CHANNEL_META[ch || "phone"] || CHANNEL_META.phone
}

function scheduledLabel(iso: string | null): string {
  if (!iso) return "—"
  const d = new Date(iso)
  const diffMin = Math.round((d.getTime() - Date.now()) / 60000)
  if (diffMin <= 1 && diffMin >= -60) return "Immediate"
  return formatDateTime(iso)
}

export default function QueueView({ role }: { role: Role }) {
  const canOperate = role === "admin" || role === "agent" || role === "branch_manager"
  const toast = useToast()
  const [items, setItems] = useState<QueueItem[]>([])
  const [total, setTotal] = useState(0)
  const [counts, setCounts] = useState<Record<string, number>>({})
  const [settings, setSettings] = useState<{ concurrency: number; autoRetry: boolean; retryDelayMinutes: number; maxRetries: number } | null>(null)
  const [tab, setTab] = useState<TabId>("all")
  const [loading, setLoading] = useState(true)
  const [acting, setActing] = useState(false)
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [autoDialing, setAutoDialing] = useState(false)

  const groupOf = useCallback((s: string) => statusGroup(s), [])
  const shown = tab === "all" ? items : items.filter((i) => groupOf(i.status) === tab)

  const g = (k: QueueStatusGroup) => counts[k] || 0
  const done = g("called") + g("failed") + g("skipped") + g("cancelled")
  const planned = done + g("pending")
  const pct = planned > 0 ? Math.round((done / planned) * 100) : 0

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true)
    try {
      const [listRes, statsRes] = await Promise.all([
        fetch("/api/outbound?limit=200"),
        fetch("/api/outbound?stats=1"),
      ])
      if (listRes.ok) {
        const d = await listRes.json()
        setItems(d.items || [])
        setTotal(d.total || 0)
      }
      if (statsRes.ok) {
        const d = await statsRes.json()
        setCounts(d.counts || {})
      }
    } catch {}
    if (!silent) setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])
  // While a campaign is live (dialing rows exist) refresh fast — the radar
  // and status chips are the operator's eyes during a run.
  usePolling(() => load(true), autoDialing ? 4000 : 10000)

  async function loadSettings() {
    try {
      const res = await fetch("/api/outbound/settings")
      if (res.ok) setSettings(await res.json())
    } catch {}
  }
  useEffect(() => { loadSettings() }, [])

  async function patchSettings(patch: Record<string, unknown>) {
    try {
      const res = await fetch("/api/outbound/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      })
      if (res.ok) {
        const d = await res.json()
        setSettings({ concurrency: d.concurrency, autoRetry: d.autoRetry, retryDelayMinutes: d.retryDelayMinutes, maxRetries: d.maxRetries })
      } else {
        const d = await res.json().catch(() => ({}))
        toast.error(d.error || "Could not save settings")
      }
    } catch {
      toast.error("Could not save settings")
    }
  }

  // One runner invocation = claim + dial up to `limit` DUE rows. The runner
  // itself PAUSES (paused: true) when the calling window is closed — the
  // rows stay pending and resume by themselves later.
  async function runBatch(): Promise<{ paused?: boolean } | null> {
    try {
      const res = await fetch("/api/outbound/process", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ limit: 25 }),
      })
      const d = await res.json()
      if (!res.ok) {
        toast.error(d.error || "Batch calling failed")
        return null
      }
      if (d.paused) return { paused: true }
      return d
    } catch {
      toast.error("Batch calling failed — check your connection and try again")
      return null
    }
  }

  async function startCalling() {
    setActing(true)
    const r = await runBatch()
    await load(true)
    setActing(false)
    if (r?.paused) toast.info("Paused — outside the calling window. Rows stay pending and resume automatically.")
    else if (r && !r.paused) toast.success("Batch dialed — refresh below or keep Auto-dial on")
  }

  async function toggleAutoDial() {
    const next = !autoDialing
    setAutoDialing(next)
    if (!next) return
    toast.info("Auto-dial on — the queue keeps dialing until it's empty or the window closes")
    // Client-driven campaign loop: each cycle triggers one runner batch and
    // refreshes; rows the runner deferred (outside window) end the loop.
    while (true) {
      const r = await runBatch()
      await load(true)
      if (!r || r.paused) break
      const pendingLeft = g("pending")
      if (pendingLeft === 0) {
        toast.success("Queue drained — every due call has been dialed")
        break
      }
      await new Promise((res) => setTimeout(res, 1500))
    }
    setAutoDialing(false)
  }

  async function cancelSelected() {
    if (!selectedIds.length) return
    if (!confirm(`Cancel ${selectedIds.length} queued call(s)? They are kept in history as "cancelled".`)) return
    setActing(true)
    try {
      const res = await fetch("/api/outbound/queue/cancel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: selectedIds }),
      })
      const d = await res.json()
      if (res.ok) toast.success(`Cancelled ${d.cancelledCount} call${d.cancelledCount === 1 ? "" : "s"}`)
      else toast.error(d.error || "Cancel failed")
    } catch {
      toast.error("Cancel failed — check your connection and try again")
    }
    setSelectedIds([])
    await load(true)
    setActing(false)
  }

  async function cancelAllPending() {
    const n = g("pending")
    if (!n) return
    if (!confirm(`EMERGENCY STOP — cancel ALL ${n} pending calls? History is kept; nothing is deleted.`)) return
    setActing(true)
    try {
      const res = await fetch("/api/outbound/queue/cancel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ allPending: true }),
      })
      const d = await res.json()
      if (res.ok) toast.success(`Cancelled ${d.cancelledCount} pending calls`)
      else toast.error(d.error || "Cancel failed")
    } catch {
      toast.error("Cancel failed — check your connection and try again")
    }
    setSelectedIds([])
    await load(true)
    setActing(false)
  }

  async function requeueSelected() {
    const requeueable = selectedIds.filter((id) => {
      const item = items.find((i) => i.id === id)
      return item && isRequeueable(item.status)
    })
    if (!requeueable.length) {
      toast.info("Select failed, cancelled, or skipped rows to re-queue")
      return
    }
    setActing(true)
    try {
      const res = await fetch("/api/outbound/queue/requeue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: requeueable }),
      })
      const d = await res.json()
      if (res.ok) toast.success(`Re-queued ${d.requeuedCount} call${d.requeuedCount === 1 ? "" : "s"}`)
      else toast.error(d.error || "Re-queue failed")
    } catch {
      toast.error("Re-queue failed — check your connection and try again")
    }
    setSelectedIds([])
    await load(true)
    setActing(false)
  }

  async function dialNow(item: QueueItem) {
    if (!item.lead_id) {
      toast.info("This row has no linked lead — queue it again from Leads")
      return
    }
    setActing(true)
    try {
      const res = await fetch("/api/calls/dial", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leadId: item.lead_id, channel: item.channel === "whatsapp_voice" ? "whatsapp" : item.channel === "auto" ? "auto" : "phone" }),
      })
      const d = await res.json()
      if (res.ok) toast.success(`Dialing ${item.name || item.phone} on ${d.channel === "whatsapp" ? "WhatsApp" : "phone"} now`)
      else toast.error(d.error || "Dial failed")
    } catch {
      toast.error("Dial failed — check your connection and try again")
    }
    await load(true)
    setActing(false)
  }

  async function cancelOne(item: QueueItem) {
    setActing(true)
    try {
      const res = await fetch("/api/outbound/queue/cancel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: [item.id] }),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        toast.error(d.error || "Cancel failed")
      } else {
        toast.success("Call cancelled")
      }
    } catch {
      toast.error("Cancel failed")
    }
    await load(true)
    setActing(false)
  }

  const allShownSelected = shown.length > 0 && shown.every((i) => selectedIds.includes(i.id))
  const hasSelection = selectedIds.length > 0

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>

      {/* ── Live campaign radar ─────────────────────────────────────────── */}
      <div style={{ display: "grid", gridTemplateColumns: "1.6fr 1fr", gap: 16 }}>
        <div className="card" style={{ padding: "20px 24px" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
            <div style={{ fontWeight: 700, fontSize: 15, display: "flex", alignItems: "center", gap: 8 }}>
              <ListChecks size={16} strokeWidth={2} style={{ color: "var(--accent-violet)" }} /> Campaign Radar
            </div>
            <div style={{ fontSize: 12, color: "var(--text-muted)" }}>{done.toLocaleString()} / {planned.toLocaleString()} processed ({pct}%)</div>
          </div>
          <div style={{ height: 8, borderRadius: 4, background: "var(--overlay-chip)", overflow: "hidden", marginBottom: 14 }}>
            <div style={{ width: `${pct}%`, height: "100%", background: "var(--gradient-brand)", borderRadius: 4, transition: "width 0.4s ease" }} />
          </div>
          <div style={{ display: "flex", gap: 18, flexWrap: "wrap", fontSize: 12.5 }}>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              <span className={g("dialing") > 0 ? "pulse-dot" : ""} style={{ width: 8, height: 8, borderRadius: 4, background: g("dialing") > 0 ? "var(--accent-blue)" : "var(--text-muted)", display: "inline-block", animation: g("dialing") > 0 ? "pulse-dot 1.4s infinite" : "none" }} />
              <strong style={{ color: "var(--text-primary)" }}>{g("dialing")}</strong> dialing now
            </span>
            <span><strong style={{ color: "var(--accent-green)" }}>{g("called")}</strong> <span style={{ color: "var(--text-muted)" }}>completed</span></span>
            <span><strong style={{ color: "var(--accent-yellow)" }}>{g("pending")}</strong> <span style={{ color: "var(--text-muted)" }}>pending</span></span>
            <span><strong style={{ color: "var(--accent-red)" }}>{g("failed")}</strong> <span style={{ color: "var(--text-muted)" }}>failed</span></span>
            <span><strong style={{ color: "var(--accent-violet)" }}>{g("skipped")}</strong> <span style={{ color: "var(--text-muted)" }}>skipped</span></span>
            <span><strong style={{ color: "var(--text-muted)" }}>{g("cancelled")}</strong> <span style={{ color: "var(--text-muted)" }}>cancelled</span></span>
          </div>
          <div style={{ marginTop: 14, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            {canOperate && (
              <>
                <button onClick={startCalling} disabled={acting || autoDialing || g("pending") === 0} className="btn-primary" style={{ height: 38 }}>
                  <Play size={14} strokeWidth={2} fill="currentColor" /> {acting ? "Dialing…" : `Dial Next Batch (×${settings?.concurrency ?? 1})`}
                </button>
                <button
                  onClick={toggleAutoDial}
                  disabled={acting}
                  style={{
                    height: 38, padding: "0 16px", borderRadius: 10, display: "inline-flex", alignItems: "center", gap: 7,
                    fontSize: 13, fontWeight: 600, cursor: "pointer",
                    border: `1px solid ${autoDialing ? "rgba(239,68,68,0.4)" : "var(--border)"}`,
                    background: autoDialing ? "rgba(239,68,68,0.1)" : "var(--bg-secondary)",
                    color: autoDialing ? "var(--accent-red)" : "var(--text-secondary)",
                  }}
                >
                  {autoDialing ? <><Pause size={14} strokeWidth={2} /> Stop Auto-dial</> : <><RefreshCw size={14} strokeWidth={2} /> Auto-dial until empty</>}
                </button>
                <button onClick={cancelAllPending} disabled={acting || g("pending") === 0} className="btn-ghost" style={{ height: 38, color: "var(--accent-red)" }} title="Emergency stop — cancels every pending call">
                  <ShieldAlert size={14} strokeWidth={2} /> Cancel All Pending ({g("pending")})
                </button>
              </>
            )}
            <div style={{ flex: 1 }} />
            <a href="/api/outbound/export" className="btn-ghost" style={{ height: 38, textDecoration: "none" }}>
              <Download size={14} strokeWidth={2} /> Export CSV
            </a>
          </div>
        </div>

        {/* Concurrency + retry policy (live — the runner reads it every batch) */}
        <div className="card" style={{ padding: "20px 24px" }}>
          <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 12, display: "flex", alignItems: "center", gap: 8 }}>
            <Zap size={16} strokeWidth={2} style={{ color: "var(--accent-yellow)" }} /> Dialer Engine
          </div>
          <label style={{ fontSize: 12, color: "var(--text-muted)", display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
            <span>Simultaneous calls</span><strong style={{ color: "var(--text-primary)" }}>{settings?.concurrency ?? "—"}/10</strong>
          </label>
          <input
            type="range" min={1} max={10} step={1}
            value={settings?.concurrency ?? 1}
            disabled={!canOperate}
            onChange={(e) => setSettings(settings ? { ...settings, concurrency: Number(e.target.value) } : settings)}
            onMouseUp={(e) => canOperate && patchSettings({ concurrency: Number((e.target as HTMLInputElement).value) })}
            onTouchEnd={(e) => canOperate && patchSettings({ concurrency: Number((e.target as HTMLInputElement).value) })}
            style={{ width: "100%", accentColor: "var(--accent-violet)", cursor: canOperate ? "pointer" : "not-allowed", marginBottom: 12 }}
          />
          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, color: "var(--text-secondary)", marginBottom: 8, cursor: canOperate ? "pointer" : "default" }}>
            <input
              type="checkbox" checked={settings?.autoRetry ?? true} disabled={!canOperate}
              onChange={(e) => patchSettings({ autoRetry: e.target.checked })}
              style={{ width: 14, height: 14, accentColor: "var(--accent-violet)" }}
            />
            Auto-redial busy / no-answer
          </label>
          <div style={{ fontSize: 11.5, color: "var(--text-muted)", lineHeight: 1.6 }}>
            Retries after {settings?.retryDelayMinutes ?? 120} min · max {settings?.maxRetries ?? 2} per lead.
            Outside the calling window the queue PAUSES (rows stay pending) and resumes automatically at 8:00 IST — nothing is ever lost.
          </div>
        </div>
      </div>

      {/* ── Queue table ─────────────────────────────────────────────────── */}
      <div style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 12 }}>
        <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--border)", display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
          {TABS.map((t) => {
            const active = tab === t.id
            const n = t.id === "all" ? Object.values(counts).reduce((s, v) => s + v, 0) : g(t.id as QueueStatusGroup)
            return (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                style={{
                  padding: "6px 12px", borderRadius: 8, fontSize: 12.5, fontWeight: 600, cursor: "pointer",
                  border: `1px solid ${active ? "rgba(139,124,255,0.5)" : "var(--border)"}`,
                  background: active ? "rgba(139,124,255,0.12)" : "transparent",
                  color: active ? "var(--accent-violet)" : "var(--text-secondary)",
                  display: "inline-flex", alignItems: "center", gap: 6,
                }}
              >
                {t.label}
                <span style={{ background: active ? "var(--gradient-brand)" : "var(--overlay-chip)", color: active ? "#fff" : "var(--text-secondary)", borderRadius: 5, padding: "0 5px", fontSize: 10.5, fontWeight: 700 }}>{n}</span>
              </button>
            )
          })}
          <div style={{ flex: 1 }} />
          <div style={{ fontSize: 11.5, color: "var(--text-muted)" }}>showing {shown.length} of {total.toLocaleString()}</div>
        </div>

        {hasSelection && canOperate && (
          <div style={{ padding: "10px 16px", borderBottom: "1px solid var(--border)", display: "flex", gap: 10, alignItems: "center", background: "rgba(139,124,255,0.05)" }}>
            <span style={{ fontSize: 12.5, fontWeight: 700 }}>{selectedIds.length} selected</span>
            <button onClick={cancelSelected} disabled={acting} className="btn-ghost" style={{ height: 30, fontSize: 12, color: "var(--accent-red)" }}>
              <XCircle size={12.5} strokeWidth={2} /> Cancel Selected
            </button>
            <button onClick={requeueSelected} disabled={acting} className="btn-ghost" style={{ height: 30, fontSize: 12 }}>
              <RotateCcw size={12.5} strokeWidth={2} /> Re-queue Selected
            </button>
            <button onClick={() => setSelectedIds([])} className="btn-ghost" style={{ height: 30, fontSize: 12 }}>Clear</button>
          </div>
        )}

        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", minWidth: 900, borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ borderBottom: "1px solid var(--border)" }}>
                <th style={{ padding: "12px 8px 12px 16px", width: 40 }}>
                  {canOperate && shown.length > 0 && (
                    <input
                      type="checkbox"
                      checked={allShownSelected}
                      onChange={() => setSelectedIds(allShownSelected ? selectedIds.filter((id) => !shown.some((i) => i.id === id)) : [...new Set([...selectedIds, ...shown.map((i) => i.id)])])}
                      style={{ width: 15, height: 15, cursor: "pointer", accentColor: "var(--accent-violet)" }}
                    />
                  )}
                </th>
                {["RECIPIENT", "CHANNEL", "LANGUAGE", "SCHEDULED", "RETRIES", "STATUS", "ACTIONS"].map((h) => (
                  <th key={h} style={{ padding: "12px 14px", textAlign: "left", fontSize: 11, fontWeight: 600, color: "var(--text-muted)", letterSpacing: "0.05em" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading && Array.from({ length: 5 }).map((_, i) => (
                <tr key={`sk-${i}`} style={{ borderBottom: "1px solid var(--border-light)" }}>
                  <td colSpan={8} style={{ padding: "14px 16px", color: "var(--text-muted)", fontSize: 12 }}>Loading queue…</td>
                </tr>
              ))}
              {!loading && shown.length === 0 && (
                <tr><td colSpan={8} style={{ padding: 40, textAlign: "center", color: "var(--text-muted)" }}>
                  Nothing here yet — select leads in the Leads view and click "Add to Call Queue".
                </td></tr>
              )}
              {shown.map((item) => {
                const group = groupOf(item.status)
                const color = STATUS_GROUP_COLORS[group]
                const ch = channelMeta(item.channel)
                const ChIcon = ch.icon
                const isPending = group === "pending"
                const isDialing = group === "dialing"
                return (
                  <tr key={item.id} style={{ borderBottom: "1px solid var(--border-light)", background: selectedIds.includes(item.id) ? "rgba(139,124,255,0.05)" : undefined }}>
                    {canOperate && (
                      <td style={{ padding: "12px 8px 12px 16px" }}>
                        <input
                          type="checkbox"
                          checked={selectedIds.includes(item.id)}
                          onChange={() => setSelectedIds((prev) => prev.includes(item.id) ? prev.filter((x) => x !== item.id) : [...prev, item.id])}
                          style={{ width: 15, height: 15, cursor: "pointer", accentColor: "var(--accent-violet)" }}
                        />
                      </td>
                    )}
                    <td style={{ padding: "12px 14px" }}>
                      <div style={{ fontWeight: 600, fontSize: 13.5 }}>{item.name || "Unknown"}</div>
                      <div style={{ fontSize: 12, color: "var(--text-muted)" }}>{item.phone}</div>
                    </td>
                    <td style={{ padding: "12px 14px" }}>
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: 600, color: ch.color, background: `${ch.color}14`, border: `1px solid ${ch.color}30`, borderRadius: 6, padding: "3px 8px" }}>
                        <ChIcon size={12} strokeWidth={2} /> {ch.label}
                      </span>
                    </td>
                    <td style={{ padding: "12px 14px", fontSize: 12.5, color: "var(--text-secondary)", textTransform: "capitalize" }}>{item.language || "—"}</td>
                    <td style={{ padding: "12px 14px", fontSize: 12.5, color: "var(--text-secondary)" }}>
                      <div style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
                        {isPending && (item.priority || 0) > 0 && <span title="High priority"><Zap size={11} strokeWidth={2.2} style={{ color: "var(--accent-yellow)" }} /></span>}
                        <Clock size={11} strokeWidth={2} style={{ color: "var(--text-muted)" }} />
                        {scheduledLabel(item.scheduled_at)}
                      </div>
                    </td>
                    <td style={{ padding: "12px 14px", fontSize: 12.5, color: (item.retry_count || 0) > 0 ? "var(--accent-yellow)" : "var(--text-muted)" }}>{item.retry_count || 0}</td>
                    <td style={{ padding: "12px 14px" }}>
                      <span style={{
                        display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11.5, fontWeight: 700,
                        color, background: `${color}14`, border: `1px solid ${color}30`, borderRadius: 6, padding: "3px 9px",
                        textTransform: "uppercase", letterSpacing: "0.04em",
                        animation: isDialing ? "pulse-dot 1.4s infinite" : undefined,
                      }}>
                        {isDialing && <span className="pulse-dot" style={{ width: 6, height: 6, borderRadius: 3, background: color, display: "inline-block" }} />}
                        {group}
                      </span>
                      {group === "skipped" && item.status !== "skipped" && (
                        <div style={{ fontSize: 10.5, color: "var(--text-muted)", marginTop: 2 }}>{item.status.replace("skipped_", "").replace(/_/g, " ")}</div>
                      )}
                      {group === "cancelled" && item.cancelled_by && (
                        <div style={{ fontSize: 10.5, color: "var(--text-muted)", marginTop: 2 }}>by {item.cancelled_by}</div>
                      )}
                    </td>
                    <td style={{ padding: "12px 14px" }}>
                      <div style={{ display: "flex", gap: 6 }}>
                        {canOperate && isPending && (
                          <>
                            <button onClick={() => dialNow(item)} disabled={acting} title="Dial now" style={{ background: "rgba(139,124,255,0.12)", border: "1px solid rgba(139,124,255,0.28)", color: "var(--accent-violet)", borderRadius: 8, width: 30, height: 30, display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
                              <PhoneCall size={13} strokeWidth={2} />
                            </button>
                            <button onClick={() => cancelOne(item)} disabled={acting} title="Cancel" style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.25)", color: "var(--accent-red)", borderRadius: 8, width: 30, height: 30, display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
                              <XCircle size={13} strokeWidth={2} />
                            </button>
                          </>
                        )}
                        {!canOperate && <span style={{ fontSize: 11, color: "var(--text-muted)" }}>View only</span>}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
