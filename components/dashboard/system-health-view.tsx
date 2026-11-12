"use client"
import React, { useCallback, useEffect, useState } from "react"
import { RefreshCw, Circle, Database, Brain, MessageCircle, Phone, Server, Mail, Music } from "lucide-react"
import { SkeletonList } from "../ui/skeleton"
import { usePolling } from "@/lib/use-poll"

// SYSTEM HEALTH — admin view over GET /api/system/health.
// Live reachability + configuration posture + provider failure bookkeeping.
// Shows WHEN something last failed and the provider's own short error —
// never secrets (the API returns configured booleans only).

type Health = {
  checkedAt: string
  database: { ok: boolean; size: string | null; error: string | null }
  llm: { ok: boolean; provider: string; fallback: string | null; sarvamConfigured: boolean; groqConfigured: boolean }
  tts: { primary: string; sarvamConfigured: boolean; cartesiaConfigured: boolean }
  stt: { provider: string; sarvamConfigured: boolean }
  whatsapp: { running: boolean; connected: boolean; envConfigured: boolean }
  telephony: { configured: boolean }
  voicebot: { running: boolean; configured: boolean }
  email: { configured: boolean }
  instagram: { configured: boolean }
  providers: Record<string, { lastOkAt: string | null; lastFailAt: string | null; lastError: string | null; consecutiveFails: number }>
}

function dot(ok: boolean, configured = true) {
  const color = !configured ? "var(--text-muted)" : ok ? "var(--accent-green)" : "var(--accent-yellow)"
  const label = !configured ? "Configuration Required" : ok ? "Operational" : "Degraded"
  return (
    <span className="flex items-center gap-1.5 text-[11.5px] font-semibold" style={{ color }}>
      <Circle size={8} fill={color} strokeWidth={0} /> {label}
    </span>
  )
}

function fmtWhen(iso: string | null): string {
  if (!iso) return "—"
  const s = Math.max(1, Math.floor((Date.now() - new Date(iso).getTime()) / 1000))
  if (s < 60) return `${s}s ago`
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86400)}d ago`
}

function Row({ icon: Icon, title, sub, right, note }: {
  icon: any; title: string; sub: string; right: React.ReactNode; note?: string | null
}) {
  return (
    <div className="flex flex-wrap items-center gap-3 border-b border-[var(--border-light)] px-4 py-3 last:border-b-0">
      <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-[var(--overlay-soft)] text-[var(--text-secondary)]">
        <Icon size={15} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-[13px] font-semibold text-[var(--text-primary)]">{title}</div>
        <div className="truncate text-[11.5px] text-[var(--text-muted)]">{sub}</div>
        {note && <div className="mt-0.5 truncate text-[11px] text-[var(--accent-yellow)]">{note}</div>}
      </div>
      <div className="flex-shrink-0">{right}</div>
    </div>
  )
}

function HealthRow({
  icon: Icon,
  title,
  ok,
  note,
  configured = true,
}: {
  icon: any
  title: string
  ok: boolean
  note?: string | null
  configured?: boolean
}) {
  const color = !configured ? "var(--text-muted)" : ok ? "var(--accent-green)" : "var(--accent-yellow)"
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "8px 0",
        borderBottom: "1px solid var(--border-light)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <Circle size={8} fill={color} strokeWidth={0} style={{ color, flexShrink: 0 }} />
        <Icon size={14} style={{ color: "var(--text-secondary)", flexShrink: 0 }} />
        <span style={{ fontSize: 13, fontWeight: 500, color: "var(--text-primary)" }}>{title}</span>
      </div>
      {note && (
        <span
          style={{
            fontSize: 12,
            color: "var(--text-muted)",
            maxWidth: 160,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {note}
        </span>
      )}
    </div>
  )
}

function ProviderFailures({ providers }: { providers: Health["providers"] }) {
  const entries = Object.entries(providers || {})
  if (entries.length === 0) {
    return (
      <div
        style={{
          marginTop: 12,
          padding: "8px 12px",
          fontSize: 11.5,
          color: "var(--text-muted)",
          background: "var(--bg-secondary)",
          borderRadius: 8,
        }}
      >
        No provider failures recorded.
      </div>
    )
  }
  return (
    <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 6 }}>
      <div style={{ fontSize: 11.5, fontWeight: 600, color: "var(--text-secondary)" }}>Provider activity</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 180, overflowY: "auto" }}>
        {entries.map(([name, p]) => (
          <div
            key={name}
            style={{
              fontSize: 11.5,
              padding: "7px 10px",
              background: "var(--bg-secondary)",
              borderRadius: 6,
              border: "1px solid var(--border-light)",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 500 }}>
              <span style={{ textTransform: "capitalize", color: "var(--text-primary)" }}>{name.replace(/-/g, " ")}</span>
              <span style={{ color: p.consecutiveFails > 0 ? "var(--accent-yellow)" : "var(--accent-green)", fontSize: 11 }}>
                {p.consecutiveFails > 0 ? `${p.consecutiveFails} in a row` : "OK"}
              </span>
            </div>
            <div style={{ fontSize: 10.5, color: "var(--text-muted)", marginTop: 2 }}>
              last ok {fmtWhen(p.lastOkAt)} · last fail {fmtWhen(p.lastFailAt)}
            </div>
            {p.lastError && (
              <div
                style={{
                  fontSize: 10.5,
                  color: "var(--accent-yellow)",
                  marginTop: 2,
                  wordBreak: "break-word",
                }}
              >
                {p.lastError}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

export default function SystemHealthView({ compact = false }: { compact?: boolean }) {
  const [health, setHealth] = useState<Health | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [open, setOpen] = useState(false)

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/system/health")
      if (!res.ok) throw new Error()
      setHealth(await res.json())
      setError(null)
    } catch {
      setError("Could not load system health.")
    }
  }, [])

  useEffect(() => { refresh() }, [refresh])
  usePolling(refresh, 60000)

  if (compact) {
    if (!health) {
      return (
        <div>
          {error && (
            <div style={{ marginBottom: 10, fontSize: 12, color: "var(--accent-yellow)" }}>{error}</div>
          )}
          <SkeletonList rows={6} />
        </div>
      )
    }

    return (
      <div>
        {error && (
          <div style={{ marginBottom: 8, fontSize: 11.5, color: "var(--accent-yellow)" }}>{error}</div>
        )}
        {/* six dot rows */}
        <HealthRow icon={Database}      title="Database"  ok={health.database.ok}  note={health.database.size || (health.database.ok ? "OK" : "Error")} />
        <HealthRow icon={Brain}         title="AI brain"  ok={health.llm.ok}       note={health.llm.provider} />
        <HealthRow icon={Music}         title="Voice"     ok={!!health.tts.sarvamConfigured} note={health.tts.primary} />
        <HealthRow icon={Server}        title="Speech"    ok={!!health.stt.sarvamConfigured} note={health.stt.provider} />
        <HealthRow icon={MessageCircle} title="WhatsApp"  ok={health.whatsapp.connected}    note={health.whatsapp.running ? "running" : "offline"} />
        <HealthRow icon={Phone}         title="Telephony" ok={health.voicebot.running}      note={health.telephony.configured ? "Exotel" : "not configured"} />

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 12 }}>
          <span style={{ fontSize: 11.5, color: "var(--text-muted)" }}>Checked {fmtWhen(health.checkedAt)}</span>
          <div style={{ display: "flex", gap: 10 }}>
            <button
              type="button"
              onClick={() => setOpen(!open)}
              className="btn-ghost"
              style={{ fontSize: 11.5, padding: "3px 10px", height: 26 }}
            >
              {open ? "Hide details" : "Details"}
            </button>
            <button
              type="button"
              onClick={refresh}
              className="icon-btn"
              title="Refresh"
              style={{ width: 26, height: 26 }}
            >
              <RefreshCw size={13} />
            </button>
          </div>
        </div>
        {open && <ProviderFailures providers={health.providers} />}
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <h2 className="text-[15px] font-bold text-[var(--text-primary)]">System Health</h2>
          <p className="text-[12px] text-[var(--text-secondary)]">
            Live status of every dependency. Secrets are never shown — only reachability and configuration.
          </p>
        </div>
        <button
          onClick={refresh}
          aria-label="Refresh health"
          className="flex h-8 items-center gap-1.5 rounded-lg border border-[var(--border)] px-2.5 text-[12px] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
        >
          <RefreshCw size={13} /> Refresh
        </button>
      </div>

      {error && (
        <div className="mb-3 rounded-lg border border-[rgba(234,179,8,0.35)] bg-[rgba(234,179,8,0.08)] px-3 py-2 text-[12.5px] text-[var(--accent-yellow)]">{error}</div>
      )}

      {!health ? (
        <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-5"><SkeletonList rows={6} /></div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--bg-card)]">
          <Row icon={Database} title="Database" sub={`PostgreSQL${health.database.size ? ` — ${health.database.size}` : ""}`}
            right={dot(health.database.ok)} note={health.database.error || undefined} />
          <Row icon={Brain} title={`AI Engine (LLM) — ${health.llm.provider}`}
            sub={health.llm.fallback ? `Fallback: ${health.llm.fallback}` : "Primary provider"}
            right={dot(health.llm.ok, health.llm.sarvamConfigured || health.llm.groqConfigured)} />
          <Row icon={Music} title="Speech (STT + TTS)" sub={`STT ${health.stt.provider} · TTS primary ${health.tts.primary}${health.tts.cartesiaConfigured ? " · Cartesia fallback" : ""}`}
            right={dot(true, health.tts.sarvamConfigured)} />
          <Row icon={MessageCircle} title="WhatsApp" sub={health.whatsapp.envConfigured ? "Cloud API credentials present" : "Cloud API credentials missing"}
            right={dot(health.whatsapp.connected, health.whatsapp.envConfigured)} />
          <Row icon={Phone} title="Telephony (Exotel)" sub={health.telephony.configured ? "Account credentials present" : "EXOTEL_* environment variables missing"}
            right={dot(true, health.telephony.configured)} />
          <Row icon={Server} title="Voice Server" sub="WhatsApp-call media bridge (pm2 process, loopback)"
            right={dot(health.voicebot.running, health.voicebot.configured)} />
          <Row icon={Mail} title="Email (SMTP)" sub={health.email.configured ? "Configured — confirmations and alerts send" : "Not configured — email features are skipped"}
            right={dot(true, health.email.configured)} />
          <Row icon={MessageCircle} title="Instagram" sub={health.instagram.configured ? "Graph API token present" : "Not configured — the Instagram module stays hidden"}
            right={dot(true, health.instagram.configured)} />
        </div>
      )}

      {health && Object.keys(health.providers).length > 0 && (
        <div className="mt-5">
          <h3 className="mb-2 text-[13px] font-bold text-[var(--text-primary)]">Recent provider activity</h3>
          <div className="overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--bg-card)]">
            {Object.entries(health.providers).map(([name, p]) => (
              <div key={name} className="flex flex-wrap items-center gap-3 border-b border-[var(--border-light)] px-4 py-2.5 last:border-b-0">
                <span className="w-28 flex-shrink-0 text-[12.5px] font-semibold capitalize text-[var(--text-primary)]">{name.replace(/-/g, " ")}</span>
                <span className="text-[11.5px] text-[var(--text-secondary)]">
                  last ok {fmtWhen(p.lastOkAt)} · last fail {fmtWhen(p.lastFailAt)}
                  {p.consecutiveFails > 0 && <span className="ml-1 font-semibold text-[var(--accent-yellow)]">({p.consecutiveFails} in a row)</span>}
                </span>
                {p.lastError && <span className="min-w-0 flex-1 truncate text-[11px] text-[var(--text-muted)]" title={p.lastError}>{p.lastError}</span>}
              </div>
            ))}
          </div>
          <p className="mt-2 text-[11px] text-[var(--text-muted)]">
            Fallback chains (Sarvam→Groq LLM, Sarvam→Cartesia TTS) activate automatically; repeated failures are visible here instead of silent.
          </p>
        </div>
      )}
    </div>
  )
}
