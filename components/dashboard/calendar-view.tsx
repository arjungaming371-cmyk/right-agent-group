"use client"

type Role = "admin" | "agent" | "viewer" | "developer" | "branch_manager"
import { useEffect, useState } from "react"
import { CalendarClock, ChevronLeft, ChevronRight, Phone, RotateCcw, X } from "lucide-react"
import { useToast } from "../ui/toast"
import { SkeletonList } from "../ui/skeleton"

type Callback = {
  id: string; name: string; phone: string
  callback_at: string; callback_note: string | null
  product_interest: string | null
}
type Lead = { id: string; name: string; phone: string }

const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]

function pad2(n: number): string {
  return n.toString().padStart(2, "0")
}

/** YYYY-MM-DD for a Date, in the browser's local time (matches what a <input type="date"> / datetime-local shows). */
function toDateKey(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
}

export default function CalendarView({ role }: { role: Role }) {
  const canEdit = role !== "viewer"
  const toast = useToast()

  const [monthCursor, setMonthCursor] = useState(() => {
    const d = new Date()
    return new Date(d.getFullYear(), d.getMonth(), 1)
  })
  const [callbacks, setCallbacks] = useState<Callback[]>([])
  const [leads, setLeads] = useState<Lead[]>([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<Callback | null>(null)

  const [scheduling, setScheduling] = useState(false)
  const [scheduleLeadId, setScheduleLeadId] = useState("")
  const [scheduleDateTime, setScheduleDateTime] = useState("")
  const [scheduleNote, setScheduleNote] = useState("")
  const [saving, setSaving] = useState(false)

  async function load() {
    setLoading(true)
    const from = toDateKey(monthCursor)
    const toMonth = new Date(monthCursor.getFullYear(), monthCursor.getMonth() + 1, 1)
    const to = toDateKey(toMonth)
    const [cr, lr] = await Promise.all([
      fetch(`/api/leads/callbacks?from=${from}&to=${to}`),
      fetch("/api/leads"),
    ])
    if (cr.ok) setCallbacks(await cr.json())
    if (lr.ok) setLeads(await lr.json())
    setLoading(false)
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [monthCursor])

  async function saveCallback(leadId: string, callbackAt: string | null, note: string | null) {
    setSaving(true)
    try {
      const res = await fetch(`/api/leads/${leadId}/callback`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ callbackAt, note }),
      })
      if (res.ok) {
        toast.success(callbackAt ? "Callback scheduled" : "Callback cleared")
        setSelected(null)
        setScheduling(false)
        setScheduleLeadId(""); setScheduleDateTime(""); setScheduleNote("")
        load()
      } else {
        const data = await res.json().catch(() => ({}))
        toast.error(data.error || "Could not save callback")
      }
    } catch {
      // Network failure — surface it, the busy state must always reset.
      toast.error("Could not save callback — check your connection and try again")
    } finally {
      setSaving(false)
    }
  }

  // Build the visible grid: pad to full weeks, Sunday-first.
  const firstOfMonth = monthCursor
  const startWeekday = firstOfMonth.getDay()
  const daysInMonth = new Date(monthCursor.getFullYear(), monthCursor.getMonth() + 1, 0).getDate()
  const gridStart = new Date(firstOfMonth)
  gridStart.setDate(gridStart.getDate() - startWeekday)
  const totalCells = Math.ceil((startWeekday + daysInMonth) / 7) * 7
  const cells: Date[] = Array.from({ length: totalCells }, (_, i) => {
    const d = new Date(gridStart)
    d.setDate(d.getDate() + i)
    return d
  })

  const callbacksByDay: Record<string, Callback[]> = {}
  for (const cb of callbacks) {
    const key = toDateKey(new Date(cb.callback_at))
    if (!callbacksByDay[key]) callbacksByDay[key] = []
    callbacksByDay[key].push(cb)
  }

  const todayKey = toDateKey(new Date())
  const monthLabel = monthCursor.toLocaleDateString([], { month: "long", year: "numeric" })

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>

      {/* Header: month nav + schedule button */}
      <div style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 12, padding: "16px 20px", display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <button onClick={() => setMonthCursor(new Date(monthCursor.getFullYear(), monthCursor.getMonth() - 1, 1))} className="btn-ghost" style={{ width: 32, height: 32, padding: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <ChevronLeft size={16} strokeWidth={2} />
          </button>
          <div style={{ fontWeight: 700, fontSize: 16, minWidth: 140, textAlign: "center" }}>{monthLabel}</div>
          <button onClick={() => setMonthCursor(new Date(monthCursor.getFullYear(), monthCursor.getMonth() + 1, 1))} className="btn-ghost" style={{ width: 32, height: 32, padding: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <ChevronRight size={16} strokeWidth={2} />
          </button>
          <button onClick={() => setMonthCursor(new Date(new Date().getFullYear(), new Date().getMonth(), 1))} className="btn-ghost" style={{ height: 32, padding: "0 12px", fontSize: 12 }}>
            Today
          </button>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <button onClick={load} className="btn-ghost" style={{ height: 32, padding: "0 12px", fontSize: 12 }}>
            <RotateCcw size={12.5} strokeWidth={1.9} /> Refresh
          </button>
          {canEdit && (
            <button onClick={() => setScheduling(true)} className="btn-primary" style={{ height: 32, padding: "0 14px", fontSize: 12.5 }}>
              <CalendarClock size={13} strokeWidth={2} /> Schedule Callback
            </button>
          )}
        </div>
      </div>

      {/* Month grid */}
      <div style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 12, overflow: "hidden" }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", borderBottom: "1px solid var(--border)" }}>
          {WEEKDAY_LABELS.map((w) => (
            <div key={w} style={{ padding: "10px 8px", fontSize: 11, fontWeight: 600, color: "var(--text-muted)", textAlign: "center", letterSpacing: "0.05em" }}>
              {w.toUpperCase()}
            </div>
          ))}
        </div>

        {loading && <SkeletonList rows={4} />}

        {!loading && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)" }}>
            {cells.map((d, i) => {
              const key = toDateKey(d)
              const inMonth = d.getMonth() === monthCursor.getMonth()
              const isToday = key === todayKey
              const dayCallbacks = callbacksByDay[key] || []
              return (
                <div
                  key={i}
                  style={{
                    minHeight: 96, padding: 8,
                    borderRight: "1px solid var(--border-light)",
                    borderBottom: "1px solid var(--border-light)",
                    opacity: inMonth ? 1 : 0.35,
                  }}
                >
                  <div style={{
                    fontSize: 12, fontWeight: isToday ? 700 : 500,
                    color: isToday ? "var(--accent-violet)" : "var(--text-secondary)",
                    marginBottom: 6,
                    display: "inline-flex", alignItems: "center", justifyContent: "center",
                    width: isToday ? 22 : "auto", height: isToday ? 22 : "auto",
                    borderRadius: isToday ? "50%" : 0,
                    background: isToday ? "rgba(139,124,255,0.18)" : "transparent",
                  }}>
                    {d.getDate()}
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                    {dayCallbacks.map((cb) => (
                      <button
                        key={cb.id}
                        onClick={() => setSelected(cb)}
                        style={{
                          textAlign: "left", background: "rgba(139,124,255,0.15)", color: "var(--accent-violet)",
                          border: "1px solid rgba(139,124,255,0.3)", borderRadius: 6,
                          padding: "3px 6px", fontSize: 11, cursor: "pointer",
                          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                        }}
                        title={`${cb.name} — ${new Date(cb.callback_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`}
                      >
                        {new Date(cb.callback_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} {cb.name}
                      </button>
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Callback detail modal */}
      {selected && (
        <div
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.75)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }}
          onClick={() => setSelected(null)}
        >
          <div
            style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 16, padding: 28, width: 440 }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
              <div style={{ fontWeight: 700, fontSize: 16 }}>Callback — {selected.name}</div>
              <button onClick={() => setSelected(null)} aria-label="Close" style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", display: "flex" }}>
                <X size={19} strokeWidth={2} />
              </button>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 20 }}>
              <div style={{ background: "var(--bg-secondary)", borderRadius: 8, padding: 12 }}>
                <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 4 }}>Phone</div>
                <div style={{ fontWeight: 600, fontSize: 13 }}>{selected.phone}</div>
              </div>
              <div style={{ background: "var(--bg-secondary)", borderRadius: 8, padding: 12 }}>
                <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 4 }}>Scheduled for</div>
                <div style={{ fontWeight: 600, fontSize: 13 }}>{new Date(selected.callback_at).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}</div>
              </div>
              {selected.product_interest && (
                <div style={{ background: "var(--bg-secondary)", borderRadius: 8, padding: 12 }}>
                  <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 4 }}>Product interest</div>
                  <div style={{ fontWeight: 600, fontSize: 13 }}>{selected.product_interest}</div>
                </div>
              )}
              {selected.callback_note && (
                <div style={{ background: "var(--bg-secondary)", borderRadius: 8, padding: 12 }}>
                  <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 4 }}>Note</div>
                  <div style={{ fontSize: 13 }}>{selected.callback_note}</div>
                </div>
              )}
            </div>

            {canEdit && (
              <div style={{ display: "flex", gap: 10 }}>
                <a href={`tel:${selected.phone}`} className="btn-primary" style={{ flex: 1, height: 36, display: "flex", alignItems: "center", justifyContent: "center", gap: 6, fontSize: 13, textDecoration: "none" }}>
                  <Phone size={13} strokeWidth={2} /> Call now
                </a>
                <button
                  disabled={saving}
                  onClick={() => { if (window.confirm("Clear the scheduled callback for this lead?")) saveCallback(selected.id, null, null) }}
                  className="btn-ghost"
                  style={{ flex: 1, height: 36, fontSize: 13 }}
                >
                  Clear callback
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Schedule new callback modal */}
      {scheduling && (
        <div
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.75)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }}
          onClick={() => setScheduling(false)}
        >
          <div
            style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 16, padding: 28, width: 440 }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
              <div style={{ fontWeight: 700, fontSize: 16 }}>Schedule Callback</div>
              <button onClick={() => setScheduling(false)} aria-label="Close" style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", display: "flex" }}>
                <X size={19} strokeWidth={2} />
              </button>
            </div>

            <label style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 4, display: "block" }}>Lead</label>
            <select value={scheduleLeadId} onChange={(e) => setScheduleLeadId(e.target.value)} style={{ width: "100%", marginBottom: 14 }}>
              <option value="">Select a lead…</option>
              {leads.map((l) => <option key={l.id} value={l.id}>{l.name} — {l.phone}</option>)}
            </select>

            <label style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 4, display: "block" }}>Date & time</label>
            <input
              type="datetime-local"
              value={scheduleDateTime}
              onChange={(e) => setScheduleDateTime(e.target.value)}
              style={{ width: "100%", marginBottom: 14 }}
            />

            <label style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 4, display: "block" }}>Note (optional)</label>
            <textarea
              value={scheduleNote}
              onChange={(e) => setScheduleNote(e.target.value)}
              placeholder="e.g. Wants to confirm EMI before deciding"
              rows={2}
              style={{ width: "100%", background: "var(--bg-card)", border: "1px solid var(--border)", color: "var(--text-primary)", borderRadius: 8, padding: 10, fontSize: 13, resize: "vertical", marginBottom: 16 }}
            />

            <button
              disabled={saving || !scheduleLeadId || !scheduleDateTime}
              onClick={() => saveCallback(scheduleLeadId, new Date(scheduleDateTime).toISOString(), scheduleNote || null)}
              className="btn-primary"
              style={{ width: "100%", height: 38 }}
            >
              {saving ? "Saving…" : "Schedule"}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
