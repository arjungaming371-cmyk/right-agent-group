"use client"

import { useEffect, useState, useCallback, useMemo } from "react"
import {
  PhoneCall, Phone, MessageCircle, Zap, XCircle, RotateCcw, Download, Play,
  Pause, ListChecks, Clock, ShieldAlert, RefreshCw,
} from "lucide-react"
import { formatDateTime } from "@/lib/utils"
import { usePolling } from "@/lib/use-poll"
import { useToast } from "../ui/toast"
import { statusGroup, isRequeueable, outcomeGroup, STATUS_GROUP_COLORS, dedupeQueueRows, type QueueStatusGroup } from "@/lib/dialer-logic"
import { phoneLast10 } from "@/lib/phone"

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
  outcome: string | null
  outcome_at: string | null
  outcome_detail: string | null
  // "What should Priya talk about?" — the row's agenda (migration
  // 2026-10-01_queue_talking_points); shown under the phone so the operator
  // can verify what Priya will pitch before starting the campaign.
  talking_points?: string | null
  created_at: string
}

// Live runner snapshot — GET /api/outbound/process { run, queue, outcomes }
type RunStatus = {
  runId: string
  running: boolean
  reason: string | null
  claimed: number
  called: number
  failed: number
  skipped: number
  waves: number
  concurrency: number
  current: string[]
  startedAt: number
}

type TabId = QueueStatusGroup

const TABS: { id: TabId; label: string }[] = [
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

// What actually happened to a dialed row (outcome feedback loop,
// 2026-10-01). status 'called' only ever meant "we dialed" — the outcome
// columns carry the terminal webhook's verdict. The chip shows the truth
// instead of counting every dial as "completed".
const OUTCOME_META: Record<string, { label: string; color: string }> = {
  answered: { label: "Answered", color: "var(--accent-green)" },
  no_answer: { label: "No answer", color: "var(--accent-yellow)" },
  declined: { label: "Declined", color: "var(--accent-violet)" },
  dial_failed: { label: "Dial failed", color: "var(--accent-red)" },
}

function outcomeMeta(outcome: string | null | undefined) {
  const g = outcomeGroup(outcome)
  return (g && OUTCOME_META[g]) || { label: "Dialed", color: "var(--text-muted)" }
}

export default function QueueView({ role }: { role: Role }) {
  // Row-level operations (dial now, cancel, requeue, bulk select) — agents
  // are allowed; the cancel/requeue/dial APIs all accept agent.
  const canOperate = role === "admin" || role === "agent" || role === "branch_manager"
  // Campaign-level controls (Start/Stop runner, dialer settings) — the APIs
  // are admin/branch_manager only (POST /api/outbound/process,
  // PATCH /api/outbound/settings); showing them to agents just bought 401
  // toasts (2026-09-26 audit).
  const canRunCampaign = role === "admin" || role === "branch_manager"
  const toast = useToast()
  const [items, setItems] = useState<QueueItem[]>([])
  const [total, setTotal] = useState(0)
  const [counts, setCounts] = useState<Record<string, number>>({})
  const [outcomes, setOutcomes] = useState<Record<string, number>>({})
  // FIX (2026-10-01): the API groups the 'called' rows by the RAW stamped
  // outcome (resolved / missed / rejected / failed / dialed) — the radar used
  // to read answered / no_answer, keys the server never sends, so "✓ N
  // answered" was permanently 0 and no-answer rows were invisible. Translate
  // once here with the same outcomeGroup() the row chips use.
  const outcomeChips = useMemo(() => {
    const m: Record<string, number> = { answered: 0, no_answer: 0, declined: 0, dial_failed: 0, dialed: 0 }
    for (const [k, v] of Object.entries(outcomes || {})) {
      const key = k === "dialed" ? "dialed" : outcomeGroup(k)
      if (key) m[key] = (m[key] || 0) + (v || 0)
    }
    return m
  }, [outcomes])
  const [run, setRun] = useState<RunStatus | null>(null)
  const [settings, setSettings] = useState<{ concurrency: number; autoRetry: boolean; retryDelayMinutes: number; maxRetries: number } | null>(null)
  const [tab, setTab] = useState<TabId>("pending")
  const [loading, setLoading] = useState(true)
  const [acting, setActing] = useState(false)
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  // Duplicate handling: the queue keeps one row per campaign add / retry /
  // re-queue, so a number can legitimately appear several times in terminal
  // tabs. The default view shows ONE row per phone (the newest — the listing
  // arrives priority DESC, created_at DESC); "Show history" reveals every
  // entry for the full audit trail. Nothing is deleted from the database.
  const [showAll, setShowAll] = useState(false)
  // "What should Priya talk about?" — the campaign agenda. Sent on Start
  // Campaign: the server stamps it across every pending row BEFORE the
  // runner claims them, so a new offer can be pushed to an existing queue
  // without re-uploading the CSV. Left blank → rows keep the agenda they
  // were queued with.
  const [talkPoints, setTalkPoints] = useState("")

  const shown = items.filter((i) => statusGroup(i.status) === tab)
  const g = (k: QueueStatusGroup) => counts[k] || 0
  const done = g("called") + g("failed") + g("skipped") + g("cancelled")
  const planned = done + g("pending")
  const pct = planned > 0 ? Math.round((done / planned) * 100) : 0
  const running = !!run?.running

  // Live ETA for the radar: average wave time so far × remaining waves.
  // Deliberately conservative arithmetic from REAL throughput (waves actually
  // completed), not wishful per-call estimates — dialing pauses, human
  // handoffs and window closures all slow waves and the ETA follows.
  const etaMin = useMemo(() => {
    if (!running || !run || run.waves < 1 || !run.startedAt) return null
    const pending = g("pending")
    if (pending <= 0) return null
    const elapsedMin = (Date.now() - run.startedAt) / 60000
    if (!(elapsedMin > 0.2)) return null // <12s in: no meaningful rate yet
    const avgWaveMin = elapsedMin / run.waves
    const remainingWaves = Math.ceil(pending / Math.max(1, run.concurrency))
    const eta = Math.ceil(remainingWaves * avgWaveMin)
    if (!Number.isFinite(eta) || eta <= 0) return null
    return Math.min(eta, 24 * 60)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running, run, counts])

  // Per-contact counts keyed by LAST-10 digits — raw phone strings differ by
  // formatting ("+91 98765 43210" vs "9876543210" are the same contact), so
  // the old raw-string key missed real duplicates. Counts cover the WHOLE
  // current view, including rows hidden by the deduplicated default, so the
  // ×N badge always reflects the contact's full history in this tab.
  const phoneCounts = useMemo(() => {
    const m = new Map<string, number>()
    for (const i of shown) {
      const k = phoneLast10(i.phone)
      m.set(k, (m.get(k) || 0) + 1)
    }
    return m
  }, [shown])

  // Deduplicated default: one row per contact, newest entry wins (same rule
  // the requeue API enforces server-side, from lib/dialer-logic so both
  // cannot drift). Hidden rows stay in the database and reappear with the
  // "Show history" toggle above the table.
  const { unique: visibleRows, hidden: hiddenDupes } = useMemo(
    () => (showAll ? { unique: shown, hidden: 0 } : dedupeQueueRows(shown)),
    [shown, showAll]
  )

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true)
    try {
      // Runner snapshot + authoritative per-status counts in ONE call;
      // rows come filtered from the paginated listing.
      const [runRes, listRes] = await Promise.all([
        fetch("/api/outbound/process"),
        fetch(`/api/outbound?status=${tab}&limit=200`),
      ])
      if (runRes.ok) {
        const d = await runRes.json()
        setRun(d.run || null)
        setCounts(d.queue || {})
        setOutcomes(d.outcomes || {})
      }
      if (listRes.ok) {
        const d = await listRes.json()
        // The listing route returns a BARE ARRAY when no status filter is set
        // (the Upload console consumes it that way) and an { items, total }
        // envelope for filtered calls — the "All" tab used to read .items off
        // the array and render an empty queue forever.
        const rows = Array.isArray(d) ? d : d.items || []
        setItems(rows)
        setTotal(Array.isArray(d) ? d.length : d.total ?? rows.length)
      }
    } catch { /* transient — next poll catches up */ }
    if (!silent) setLoading(false)
  }, [tab])

  useEffect(() => { load() }, [load])
  // While a campaign is live the radar IS the operator's eyes — fast poll.
  usePolling(() => load(true), running ? 4000 : 12000)

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

  // Campaign protocol on the background runner: start drains the ENTIRE
  // pending queue wave-by-wave (progress via the 4s poll); stop lets the
  // in-flight wave finish and leaves the rest pending. Outside the calling
  // window the server refuses to start — { paused: true } — and the rows
  // stay pending, resuming automatically at 8:00 IST.
  async function campaign(action: "start" | "stop") {
    try {
      const res = await fetch("/api/outbound/process", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          action === "start"
            ? { action, concurrency: settings?.concurrency, talking_points: talkPoints.trim() || undefined }
            : { action }
        ),
      })
      const d = await res.json()
      if (!res.ok) {
        toast.error(d.error || "Campaign command failed")
        return
      }
      if (d.paused) {
        toast.info(d.reason || "Paused — outside the calling window. Rows stay pending and resume automatically.")
        return
      }
      if (action === "start") toast.success(`Campaign started — ${d.concurrency} call${d.concurrency === 1 ? "" : "s"} at a time${d.talkingPointsStamped ? ` · agenda applied to ${d.talkingPointsStamped} call${d.talkingPointsStamped === 1 ? "" : "s"}` : ""}`)
      else toast.info("Stop requested — the current wave finishes, the rest stay pending")
      await load(true)
    } catch {
      toast.error("Campaign command failed — check your connection")
    }
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

  // Shared re-queue worker: takes explicit queue-row ids, pushes them back
  // to pending (the server re-validates every status), reports the honest
  // count from the response.
  async function requeueIds(ids: string[]) {
    if (!ids.length) return
    setActing(true)
    try {
      const res = await fetch("/api/outbound/queue/requeue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids }),
      })
      const d = await res.json()
      if (res.ok) {
        const dup = Number(d.skippedDuplicate) || 0
        toast.success(`Re-queued ${d.requeuedCount} call${d.requeuedCount === 1 ? "" : "s"}${dup > 0 ? ` · ${dup} duplicate${dup === 1 ? "" : "s"} skipped (number already queued)` : ""}`)
      }
      else toast.error(d.error || "Re-queue failed")
    } catch {
      toast.error("Re-queue failed — check your connection and try again")
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
    await requeueIds(requeueable)
  }

  // "Resume" path for a drained queue: when nothing is pending, a silently
  // disabled Start button teaches nothing — offer the one-click bulk
  // re-queue of every requeueable row already loaded. The listing fetch is
  // capped at 200 rows, so this acts on exactly what the table shows; click
  // again after reload for any remainder beyond the cap.
  // Bulk re-queue acts on the NEWEST row per phone only — the server refuses
  // duplicates anyway (active-stack guard), so including history rows would
  // just inflate the confirm count with rows that get refused.
  const requeueableItems = useMemo(
    () => dedupeQueueRows(items.filter((i) => isRequeueable(i.status))).unique,
    [items]
  )
  async function requeueAllLoaded() {
    if (!requeueableItems.length) return
    if (!confirm(`Re-queue ${requeueableItems.length} failed/cancelled/skipped call(s)? They go back to pending in scheduled order.`)) return
    await requeueIds(requeueableItems.map((i) => i.id))
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
        // Dial now keeps the row's agenda — a manual one-off dial of a queued
        // contact must pitch the same thing the campaign would have.
        body: JSON.stringify({ leadId: item.lead_id, channel: item.channel === "whatsapp_voice" ? "whatsapp" : item.channel === "auto" ? "auto" : "phone", instructions: item.talking_points || undefined }),
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

  const allShownSelected = visibleRows.length > 0 && visibleRows.every((i) => selectedIds.includes(i.id))

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>

      {/* ── Live campaign radar ─────────────────────────────────────── */}
      <div style={{ display: "grid", gridTemplateColumns: "1.6fr 1fr", gap: 16 }}>
        <div className="card" style={{ padding: "20px 24px" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12, flexWrap: "wrap", gap: 8 }}>
            <div style={{ fontWeight: 700, fontSize: 15, display: "flex", alignItems: "center", gap: 8 }}>
              <ListChecks size={16} strokeWidth={2} style={{ color: "var(--accent-violet)" }} /> Campaign Radar
              {running && (
                <span style={{ fontSize: 11, fontWeight: 700, color: "var(--accent-green)", background: "rgba(34,197,94,0.12)", border: "1px solid rgba(34,197,94,0.3)", borderRadius: 6, padding: "2px 8px", textTransform: "uppercase", letterSpacing: "0.04em", animation: "pulse-dot 1.6s infinite" }}>
                  ● RUNNING · wave {run?.waves ?? 0} · ×{run?.concurrency ?? 0}
                </span>
              )}
              {!running && run?.reason && run.reason !== "drained" && (
                <span style={{ fontSize: 11, fontWeight: 600, color: "var(--text-muted)" }}>{run.reason}</span>
              )}
            </div>
            <div style={{ fontSize: 12, color: "var(--text-muted)" }}>{done.toLocaleString()} / {planned.toLocaleString()} processed ({pct}%)</div>
          </div>
          <div style={{ height: 8, borderRadius: 4, background: "var(--overlay-chip)", overflow: "hidden", marginBottom: 14 }}>
            <div style={{ width: `${pct}%`, height: "100%", background: "var(--gradient-brand)", borderRadius: 4, transition: "width 0.4s ease" }} />
          </div>
          <div style={{ display: "flex", gap: 18, flexWrap: "wrap", fontSize: 12.5 }}>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              <span style={{ width: 8, height: 8, borderRadius: 4, background: g("dialing") > 0 || running ? "var(--accent-blue)" : "var(--text-muted)", display: "inline-block", animation: g("dialing") > 0 || running ? "pulse-dot 1.4s infinite" : "none" }} />
              <strong style={{ color: "var(--text-primary)" }}>{g("dialing")}</strong> <span style={{ color: "var(--text-muted)" }}>dialing now</span>
            </span>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              <strong style={{ color: "var(--accent-green)" }}>{g("called")}</strong> <span style={{ color: "var(--text-muted)" }}>dialed</span>
              {/* Outcome feedback loop (2026-10-01): "dialed" no longer hides
                  the truth — the terminal webhooks stamp each row and the
                  radar splits dialed into answered / no-answer / declined. */}
              {(outcomeChips.answered || outcomeChips.no_answer || outcomeChips.declined || outcomeChips.dial_failed || outcomeChips.dialed) ? (
                <span style={{ display: "inline-flex", gap: 8, alignItems: "center", fontSize: 11.5 }}>
                  <span title="answered — a human talked" style={{ color: "var(--accent-green)" }}>✓ {outcomeChips.answered} answered</span>
                  {outcomeChips.no_answer > 0 && <span title="rang out / busy" style={{ color: "var(--accent-yellow)" }}>{outcomeChips.no_answer} no-answer</span>}
                  {outcomeChips.declined > 0 && <span title="lead declined the call" style={{ color: "var(--accent-violet)" }}>{outcomeChips.declined} declined</span>}
                  {outcomeChips.dial_failed > 0 && <span title="call never went out (provider/network)" style={{ color: "var(--accent-red)" }}>{outcomeChips.dial_failed} failed</span>}
                  {outcomeChips.dialed > 0 && <span title="still waiting for the terminal webhook" style={{ color: "var(--text-muted)" }}>{outcomeChips.dialed} in flight</span>}
                </span>
              ) : null}
            </span>
            <span><strong style={{ color: "var(--accent-yellow)" }}>{g("pending")}</strong> <span style={{ color: "var(--text-muted)" }}>pending</span></span>
            {etaMin !== null && <span title="estimated from real waves-per-minute throughput so far"><strong style={{ color: "var(--text-primary)" }}>~{etaMin >= 60 ? `${(etaMin / 60).toFixed(etaMin % 60 === 0 ? 0 : 1)}h` : `${etaMin}m`}</strong> <span style={{ color: "var(--text-muted)" }}>left</span></span>}
            <span><strong style={{ color: "var(--accent-red)" }}>{g("failed")}</strong> <span style={{ color: "var(--text-muted)" }}>failed</span></span>
            <span><strong style={{ color: "var(--accent-violet)" }}>{g("skipped")}</strong> <span style={{ color: "var(--text-muted)" }}>skipped</span></span>
            <span><strong style={{ color: "var(--text-muted)" }}>{g("cancelled")}</strong> <span style={{ color: "var(--text-muted)" }}>cancelled</span></span>
          </div>
          {(run?.current?.length ?? 0) > 0 && (
            <div style={{ marginTop: 10, display: "flex", gap: 6, flexWrap: "wrap" }}>
              {run!.current.slice(0, 6).map((p) => (
                <span key={p} style={{ fontSize: 11, fontFamily: "ui-monospace, monospace", color: "var(--accent-blue)", background: "rgba(56,189,248,0.1)", border: "1px solid rgba(56,189,248,0.25)", borderRadius: 6, padding: "2px 8px", animation: "pulse-dot 1.4s infinite" }}>
                  ●●● {p.replace(/\d(?=\d{4})/g, "•")}
                </span>
              ))}
            </div>
          )}
          {/* "What should Priya talk about?" — the campaign agenda box */}
          {canRunCampaign && !running && (
            <div style={{ marginBottom: 12 }}>
              <label style={{ fontSize: 12, fontWeight: 600, color: "var(--text-secondary)", display: "block", marginBottom: 4 }}>
                What should Priya talk about? <span style={{ fontWeight: 400, color: "var(--text-muted)" }}>(optional)</span>
              </label>
              <textarea
                value={talkPoints}
                onChange={(e) => setTalkPoints(e.target.value.slice(0, 1000))}
                rows={2}
                maxLength={1000}
                placeholder="e.g. Introduce our new 8.5% home-loan balance-transfer offer, ask if their current EMI feels heavy, offer a free eligibility check — don't pitch personal loans"
                style={{ width: "100%", fontSize: 13, lineHeight: 1.5, padding: "8px 10px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--bg-secondary)", color: "var(--text-primary)", resize: "vertical" }}
              />
              <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 3 }}>
                Priya opens with this agenda on every call in this run. Leave blank to keep the talking points set when the numbers were queued ({talkPoints.length}/1000).
              </div>
            </div>
          )}
          <div style={{ marginTop: 14, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            {canRunCampaign && (
              running ? (
                <button onClick={() => campaign("stop")} className="btn-ghost" style={{ height: 38, color: "var(--accent-red)" }}>
                  <Pause size={14} strokeWidth={2} /> Stop Campaign
                </button>
              ) : (
                <>
                  <button
                    onClick={() => campaign("start")}
                    disabled={acting || g("pending") === 0}
                    className="btn-primary"
                    style={{ height: 38 }}
                    title={g("pending") === 0 ? "Nothing pending to dial" : undefined}
                  >
                    <Play size={14} strokeWidth={2} fill="currentColor" /> Start Campaign (×{settings?.concurrency ?? 1})
                  </button>
                  {g("pending") === 0 && canOperate && requeueableItems.length > 0 && (
                    <button onClick={requeueAllLoaded} disabled={acting} className="btn-primary" style={{ height: 38 }} title="Push failed/cancelled/skipped calls back to pending, then Start Campaign">
                      <RotateCcw size={14} strokeWidth={2} /> Re-queue {requeueableItems.length} call{requeueableItems.length === 1 ? "" : "s"}
                    </button>
                  )}
                  {g("pending") === 0 && requeueableItems.length === 0 && (
                    <span style={{ fontSize: 12, color: "var(--text-muted)" }}>Nothing pending — add leads from the Leads view or upload a CSV</span>
                  )}
                </>
              )
            )}
            {canOperate && (
              <button onClick={cancelAllPending} disabled={acting || g("pending") === 0} className="btn-ghost" style={{ height: 38, color: "var(--accent-red)" }} title="Emergency stop — cancels every pending call">
                <ShieldAlert size={14} strokeWidth={2} /> Cancel All Pending ({g("pending")})
              </button>
            )}
            <div style={{ flex: 1 }} />
            <a href="/api/outbound/export" className="btn-ghost" style={{ height: 38, textDecoration: "none" }}>
              <Download size={14} strokeWidth={2} /> Export CSV
            </a>
          </div>
        </div>

        {/* Dialer engine — persisted settings, read live by the runner */}
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
            disabled={!canRunCampaign}
            onChange={(e) => setSettings(settings ? { ...settings, concurrency: Number(e.target.value) } : settings)}
            onMouseUp={(e) => canRunCampaign && patchSettings({ concurrency: Number((e.target as HTMLInputElement).value) })}
            onTouchEnd={(e) => canRunCampaign && patchSettings({ concurrency: Number((e.target as HTMLInputElement).value) })}
            style={{ width: "100%", accentColor: "var(--accent-violet)", cursor: canRunCampaign ? "pointer" : "not-allowed", marginBottom: 8 }}
          />
          <div style={{ fontSize: 11.5, color: "var(--text-muted)", lineHeight: 1.55, marginBottom: 12 }}>
            ×N = calls dialed at the same time. Higher drains the queue faster, but holds N live provider lines at once (each billed per minute) and can flood you with simultaneous human handoffs — 1–3 is a sane start.
          </div>
          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, color: "var(--text-secondary)", marginBottom: 8, cursor: canRunCampaign ? "pointer" : "default" }}>
            <input
              type="checkbox" checked={settings?.autoRetry ?? true} disabled={!canRunCampaign}
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

      {/* ── Queue table ─────────────────────────────────────────────── */}
      <div style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 12 }}>
        <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--border)", display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
          {TABS.map((t) => {
            const active = tab === t.id
            const n = g(t.id)
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
          <label
            style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11.5, color: "var(--text-secondary)", cursor: "pointer" }}
            title="Earlier adds, retries and re-queues of the same number are hidden by default — tick to see every entry (full audit trail)"
          >
            <input
              type="checkbox"
              checked={showAll}
              onChange={() => setShowAll((v) => !v)}
              style={{ width: 13, height: 13, cursor: "pointer", accentColor: "var(--accent-violet)" }}
            />
            Show history{!showAll && hiddenDupes > 0 ? ` (${hiddenDupes} duplicate${hiddenDupes === 1 ? "" : "s"} hidden)` : ""}
          </label>
          <div style={{ fontSize: 11.5, color: "var(--text-muted)" }}>showing {visibleRows.length} of {total.toLocaleString()}</div>
        </div>

        {selectedIds.length > 0 && canOperate && (
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
                  {canOperate && visibleRows.length > 0 && (
                    <input
                      type="checkbox"
                      checked={allShownSelected}
                      onChange={() => setSelectedIds(allShownSelected ? selectedIds.filter((id) => !visibleRows.some((i) => i.id === id)) : [...new Set([...selectedIds, ...visibleRows.map((i) => i.id)])])}
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
              {loading && (
                <tr><td colSpan={8} style={{ padding: "14px 16px", color: "var(--text-muted)", fontSize: 12 }}>Loading queue…</td></tr>
              )}
              {!loading && visibleRows.length === 0 && (
                <tr><td colSpan={8} style={{ padding: 40, textAlign: "center", color: "var(--text-muted)" }}>
                  Nothing here yet — select leads in the Leads view and click "Add to Call Queue", or upload a CSV in Upload & Data.
                </td></tr>
              )}
              {visibleRows.map((item) => {
                const group = statusGroup(item.status)
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
                      <div style={{ fontWeight: 600, fontSize: 13.5, display: "flex", alignItems: "center", gap: 6 }}>
                        {item.name || "Unknown"}
                        {(phoneCounts.get(phoneLast10(item.phone)) || 0) > 1 && (
                          <span
                            title={`${phoneCounts.get(phoneLast10(item.phone))} entries for this number in the current view — showing the latest; the older ones are audit history. Tick "Show history" (top right) to see every entry.`}
                            style={{ fontSize: 10, fontWeight: 700, color: "var(--accent-yellow)", background: "rgba(234,179,8,0.10)", border: "1px solid rgba(234,179,8,0.28)", borderRadius: 5, padding: "1px 5px", flexShrink: 0 }}
                          >
                            ×{phoneCounts.get(phoneLast10(item.phone))}
                          </span>
                        )}
                      </div>
                      <div style={{ fontSize: 12, color: "var(--text-muted)" }}>{item.phone}</div>
                      {item.talking_points && (
                        <div title={item.talking_points} style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 3, maxWidth: 260, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          Talk: {item.talking_points}
                        </div>
                      )}
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
                        {isDialing && <span style={{ width: 6, height: 6, borderRadius: 3, background: color, display: "inline-block" }} />}
                        {group}
                      </span>
                      {group === "skipped" && item.status !== "skipped" && (
                        <div style={{ fontSize: 10.5, color: "var(--text-muted)", marginTop: 2 }}>{item.status.replace("skipped_", "").replace(/_/g, " ")}</div>
                      )}
                      {group === "cancelled" && item.cancelled_by && (
                        <div style={{ fontSize: 10.5, color: "var(--text-muted)", marginTop: 2 }}>by {item.cancelled_by}</div>
                      )}
                      {group === "called" && (() => {
                        const om = outcomeMeta(item.outcome)
                        return (
                          <div style={{ marginTop: 2 }}>
                            <span
                              title={[
                                item.outcome ? `Terminal result: ${item.outcome}` : "Dialed — waiting for the terminal webhook",
                                item.outcome_at ? `reported ${formatDateTime(item.outcome_at)}` : null,
                                item.outcome_detail || null,
                              ].filter(Boolean).join(" · ")}
                              style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 10.5, fontWeight: 700, color: om.color, background: `${om.color}14`, border: `1px solid ${om.color}30`, borderRadius: 5, padding: "1px 6px", textTransform: "uppercase", letterSpacing: "0.03em" }}
                            >
                              {om.label}
                            </span>
                          </div>
                        )
                      })()}
                      {group === "failed" && item.outcome_detail && (
                        <div title={item.outcome_detail} style={{ fontSize: 10.5, color: "var(--text-muted)", marginTop: 2, maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.outcome_detail}</div>
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
