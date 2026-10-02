"use client"
import { useEffect, useState } from "react"
import {
  AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from "recharts"
import { Users, Phone, BadgeCheck, Timer, Mail, CheckCircle2, RotateCcw, PhoneOutgoing, TrendingUp, UserPlus, FileText, BellRing, ClipboardList, MessageCircle, PhoneCall } from "lucide-react"
import { formatPct } from "@/lib/maths"
import OnboardingCard from "./onboarding-card"
import { SkeletonList } from "../ui/skeleton"

// Validated (scripts/validate_palette.js, dark surface) — fixed order, never cycled.
const CAT = { blue: "var(--accent-blue)", aqua: "var(--accent-green)", violet: "var(--accent-violet)" }
const STATUS = { good: "var(--accent-green)", neutral: "var(--text-muted)", serious: "var(--accent-yellow)", critical: "var(--accent-red)" }

type Analytics = {
  callsByDay: { day: string; count: number }[]
  funnel: { new: number; contacted: number; qualified: number; applied: number }
  languageSplit: { language: string; count: number }[]
  sentiment: { sentiment: string; count: number }[]
  callsByHour: { hour: number; count: number }[]
  totals: { total_leads: number; total_calls: number; total_messages: number; qualified_leads: number; avg_duration: number; connected_calls?: number; needs_human?: number; followups_due?: number; new_leads_7d?: number; applications?: number }
  rates: { connectRate: number; resolutionRate: number; conversionRate: number; qualificationToApply: number }
}

const CARD: React.CSSProperties = { background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 14, padding: 20 }
const AXIS_STYLE = { fontSize: 11, fill: "var(--text-mute)" }
const TOOLTIP_STYLE = { background: "var(--bg-secondary)", border: "1px solid var(--border)", borderRadius: 10, fontSize: 12.5 }

function StatTile({ icon: Icon, label, value, tone }: { icon: any; label: string; value: string; tone: string }) {
  return (
    <div style={{ ...CARD, padding: "18px 20px", flex: 1, display: "flex", alignItems: "center", gap: 14 }}>
      <div style={{ width: 40, height: 40, borderRadius: 10, background: `${tone}1f`, border: `1px solid ${tone}33`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
        <Icon size={18} strokeWidth={1.9} style={{ color: tone }} />
      </div>
      <div>
        <div style={{ fontSize: 20, fontWeight: 700, fontVariantNumeric: "tabular-nums", lineHeight: 1.1 }}>{value}</div>
        <div style={{ fontSize: 11.5, color: "var(--text-mute)", marginTop: 3 }}>{label}</div>
      </div>
    </div>
  )
}

export default function AnalyticsView({ role = "admin" }: { role?: "admin" | "agent" | "viewer" | "developer" | "branch_manager" }) {
  const [data, setData] = useState<Analytics | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [sending, setSending] = useState(false)
  const [sentMsg, setSentMsg] = useState<string | null>(null)
  // Owner filters: date range + branch (branch select only for parents).
  const [days, setDays] = useState<7 | 14 | 30>(14)
  const [branchId, setBranchId] = useState<string>("all")
  const [branches, setBranches] = useState<{ id: string; name: string }[]>([])

  useEffect(() => {
    fetch("/api/branches").then(r => (r.ok ? r.json() : null)).then(list => {
      if (Array.isArray(list)) setBranches(list.map((b: any) => ({ id: b.id, name: b.name })))
    }).catch(() => {})
  }, [])

  async function load() {
    setLoading(true)
    try {
      const qs = new URLSearchParams({ days: String(days) })
      if (role === "admin" || role === "developer") qs.set("branch", branchId)
      const res = await fetch(`/api/analytics?${qs.toString()}`)
      if (res.ok) {
        setData(await res.json())
        setLoadError(null)
      } else {
        setLoadError(`Could not load analytics (HTTP ${res.status}).`)
      }
    } catch (e: any) {
      setLoadError(e?.message || "Could not load analytics")
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => { load() }, [days, branchId])

  async function emailReport() {
    setSending(true)
    setSentMsg(null)
    try {
      const res = await fetch("/api/digest/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ period: "daily" }),
      })
      const d = await res.json()
      setSentMsg(res.ok ? "Sent — check the admin inbox." : `Couldn't send: ${d.error || "unknown error"}`)
    } catch (e: any) {
      setSentMsg(`Couldn't send: ${e.message}`)
    }
    setSending(false)
  }

  if (loading) {
    // Skeleton matching the tile+chart layout — the bare "Loading analytics…"
    // text flashed jarringly against the finished dashboard.
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <div style={{ ...CARD, padding: 20 }}><SkeletonList rows={7} /></div>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-[1.6fr_1fr]">
          <div style={{ ...CARD, padding: 20 }}><SkeletonList rows={4} /></div>
          <div style={{ ...CARD, padding: 20 }}><SkeletonList rows={4} /></div>
        </div>
      </div>
    )
  }

  // A failed load must not render as an eternal "Loading analytics…" — say
  // what happened and let the user retry.
  if (loadError) {
    return (
      <div style={{ padding: 60, textAlign: "center", display: "flex", flexDirection: "column", alignItems: "center", gap: 14 }}>
        <div style={{ color: "var(--accent-red)", fontSize: 13.5, fontWeight: 600 }}>{loadError}</div>
        <button onClick={load} className="btn-ghost" style={{ height: 34 }}>
          <RotateCcw size={13} strokeWidth={1.9} /> Try again
        </button>
      </div>
    )
  }

  if (!data) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <div style={{ ...CARD, padding: 20 }}><SkeletonList rows={7} /></div>
      </div>
    )
  }

  const { totals, funnel, rates } = data
  const avgDur = totals.avg_duration || 0
  const funnelSteps = [
    { label: "New", value: funnel.new, tone: STATUS.neutral },
    { label: "Contacted", value: funnel.contacted, tone: CAT.blue },
    { label: "Qualified", value: funnel.qualified, tone: STATUS.good },
    { label: "Applied", value: funnel.applied, tone: CAT.violet },
  ]
  const funnelMax = Math.max(1, ...funnelSteps.map((s) => s.value))

  const languageData = data.languageSplit.map((l, i) => ({
    name: l.language.charAt(0).toUpperCase() + l.language.slice(1),
    value: l.count,
    color: [CAT.blue, CAT.aqua, CAT.violet][i % 3],
  }))

  const sentimentColor: Record<string, string> = { Positive: STATUS.good, Neutral: STATUS.neutral, Negative: STATUS.serious, Frustrated: STATUS.critical }
  const sentimentData = data.sentiment.map((s) => ({ name: s.sentiment, value: s.count, color: sentimentColor[s.sentiment] || STATUS.neutral }))

  const hourData = data.callsByHour.map((h) => ({ hour: `${h.hour}:00`, count: h.count }))

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* Onboarding checklist — "Complete your setup" (auto-hides when done) */}
      <OnboardingCard />

      {/* Header row: filters + digest trigger */}
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 12 }}>
        <div style={{ flex: 1, minWidth: 160, fontSize: 12.5, color: "var(--text-mute)" }}>
          {sentMsg || "Live performance data across calls, leads, and WhatsApp."}
        </div>
        <select
          value={days}
          onChange={e => setDays(Number(e.target.value) as 7 | 14 | 30)}
          aria-label="Date range"
          style={{ height: 34, borderRadius: 10, border: "1px solid var(--border)", background: "var(--bg-secondary)", color: "var(--text-primary)", fontSize: 12.5, padding: "0 10px" }}
        >
          <option value={7}>Last 7 days</option>
          <option value={14}>Last 14 days</option>
          <option value={30}>Last 30 days</option>
        </select>
        {(role === "admin" || role === "developer") && branches.length > 1 && (
          <select
            value={branchId}
            onChange={e => setBranchId(e.target.value)}
            aria-label="Branch filter"
            style={{ height: 34, borderRadius: 10, border: "1px solid var(--border)", background: "var(--bg-secondary)", color: "var(--text-primary)", fontSize: 12.5, padding: "0 10px", maxWidth: 190 }}
          >
            <option value="all">All branches</option>
            {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        )}
        <button onClick={emailReport} disabled={sending} className="btn-ghost" style={{ height: 34 }}>
          {sending ? <CheckCircle2 size={13} strokeWidth={2} /> : <Mail size={13} strokeWidth={1.9} />}
          {sending ? "Sending…" : "Email me this report"}
        </button>
      </div>

      {/* Owner outcome tiles — the business picture first */}
      <div className="grid grid-cols-2 gap-3 md:flex md:flex-wrap md:gap-4">
        <StatTile icon={UserPlus} label="New Leads (7d)" value={String(totals.new_leads_7d ?? 0)} tone={CAT.violet} />
        <StatTile icon={Phone} label="AI Calls" value={String(totals.total_calls)} tone={CAT.blue} />
        <StatTile icon={PhoneOutgoing} label="Answered" value={String(totals.connected_calls ?? 0)} tone={CAT.aqua} />
        <StatTile icon={BadgeCheck} label="Qualified" value={String(totals.qualified_leads)} tone={STATUS.good} />
        <StatTile icon={FileText} label="Applications" value={String(totals.applications ?? 0)} tone={CAT.violet} />
        <StatTile icon={ClipboardList} label="Follow-ups Due" value={String(totals.followups_due ?? 0)} tone={STATUS.serious} />
        <StatTile icon={BellRing} label="Needs Human" value={String(totals.needs_human ?? 0)} tone={STATUS.critical} />
      </div>

      {/* Detail tiles — every figure here comes straight from the analytics
          payload; connect/resolution rates were computed but never shown. */}
      <div className="grid grid-cols-2 gap-3 md:flex md:flex-wrap md:gap-4">
        <StatTile icon={Users} label="Total Leads" value={String(totals.total_leads)} tone={CAT.violet} />
        <StatTile icon={MessageCircle} label="WhatsApp Messages" value={String(totals.total_messages)} tone={CAT.aqua} />
        <StatTile icon={TrendingUp} label="Lead → Qualified" value={formatPct(rates.conversionRate)} tone={CAT.violet} />
        <StatTile icon={PhoneCall} label="Connect Rate" value={formatPct(rates.connectRate)} tone={CAT.blue} />
        <StatTile icon={CheckCircle2} label="Resolution Rate" value={formatPct(rates.resolutionRate)} tone={STATUS.good} />
        <StatTile icon={Timer} label="Avg. Call Length" value={`${Math.floor(avgDur / 60)}m ${avgDur % 60}s`} tone={CAT.aqua} />
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-[1.6fr_1fr] md:gap-4">
        {/* Calls per day */}
        <div style={CARD}>
          <div style={{ fontSize: 13.5, fontWeight: 700, marginBottom: 4 }}>Calls per day</div>
          <div style={{ fontSize: 11.5, color: "var(--text-mute)", marginBottom: 14 }}>Last {days} days</div>
          <ResponsiveContainer width="100%" height={220}>
            <AreaChart data={data.callsByDay} margin={{ left: -20, right: 8 }}>
              <defs>
                <linearGradient id="callsFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={CAT.blue} stopOpacity={0.28} />
                  <stop offset="100%" stopColor={CAT.blue} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="var(--border-light)" vertical={false} />
              <XAxis dataKey="day" tick={AXIS_STYLE} axisLine={false} tickLine={false} interval={1} />
              <YAxis tick={AXIS_STYLE} axisLine={false} tickLine={false} allowDecimals={false} width={28} />
              <Tooltip contentStyle={TOOLTIP_STYLE} labelStyle={{ color: "var(--text-primary)", fontWeight: 600 }} />
              <Area type="monotone" dataKey="count" name="Calls" stroke={CAT.blue} strokeWidth={2} fill="url(#callsFill)" dot={false} activeDot={{ r: 4 }} />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        {/* Funnel */}
        <div style={CARD}>
          <div style={{ fontSize: 13.5, fontWeight: 700, marginBottom: 4 }}>Lead funnel</div>
          <div style={{ fontSize: 11.5, color: "var(--text-mute)", marginBottom: 18 }}>New → contacted → qualified → applied</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            {funnelSteps.map((s) => (
              <div key={s.label}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 5 }}>
                  <span style={{ color: "var(--text-secondary)" }}>{s.label}</span>
                  <span style={{ fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{s.value}</span>
                </div>
                <div style={{ height: 7, borderRadius: 4, background: "var(--overlay-chip)", overflow: "hidden" }}>
                  <div style={{ width: `${(s.value / funnelMax) * 100}%`, height: "100%", background: s.tone, borderRadius: 4, transition: "width 0.4s" }} />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-[1fr_1fr_1.4fr] md:gap-4">
        {/* Language split */}
        <div style={CARD}>
          <div style={{ fontSize: 13.5, fontWeight: 700, marginBottom: 14 }}>Calls by language</div>
          {languageData.length === 0 ? (
            <div style={{ fontSize: 12, color: "var(--text-mute)", padding: "30px 0", textAlign: "center" }}>No calls yet</div>
          ) : (
            <ResponsiveContainer width="100%" height={180}>
              <PieChart>
                <Pie data={languageData} dataKey="value" nameKey="name" innerRadius={45} outerRadius={70} paddingAngle={2}>
                  {languageData.map((d, i) => <Cell key={i} fill={d.color} stroke="var(--bg-card)" strokeWidth={2} />)}
                </Pie>
                <Tooltip contentStyle={TOOLTIP_STYLE} />
                <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11.5 }} />
              </PieChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Sentiment */}
        <div style={CARD}>
          <div style={{ fontSize: 13.5, fontWeight: 700, marginBottom: 14 }}>Call sentiment</div>
          {sentimentData.length === 0 ? (
            <div style={{ fontSize: 12, color: "var(--text-mute)", padding: "30px 0", textAlign: "center" }}>No calls yet</div>
          ) : (
            <ResponsiveContainer width="100%" height={180}>
              <PieChart>
                <Pie data={sentimentData} dataKey="value" nameKey="name" innerRadius={45} outerRadius={70} paddingAngle={2}>
                  {sentimentData.map((d, i) => <Cell key={i} fill={d.color} stroke="var(--bg-card)" strokeWidth={2} />)}
                </Pie>
                <Tooltip contentStyle={TOOLTIP_STYLE} />
                <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11.5 }} />
              </PieChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Busiest hours */}
        <div style={CARD}>
          <div style={{ fontSize: 13.5, fontWeight: 700, marginBottom: 4 }}>Busiest call hours</div>
          <div style={{ fontSize: 11.5, color: "var(--text-mute)", marginBottom: 14 }}>All-time, by hour of day</div>
          <ResponsiveContainer width="100%" height={160}>
            <BarChart data={hourData} margin={{ left: -20, right: 8 }}>
              <CartesianGrid stroke="var(--border-light)" vertical={false} />
              <XAxis dataKey="hour" tick={AXIS_STYLE} axisLine={false} tickLine={false} interval={3} />
              <YAxis tick={AXIS_STYLE} axisLine={false} tickLine={false} allowDecimals={false} width={24} />
              <Tooltip contentStyle={TOOLTIP_STYLE} labelStyle={{ color: "var(--text-primary)", fontWeight: 600 }} />
              <Bar dataKey="count" name="Calls" fill={CAT.aqua} radius={[3, 3, 0, 0]} maxBarSize={16} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  )
}
