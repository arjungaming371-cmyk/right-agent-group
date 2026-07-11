"use client"
import { useState, useEffect } from "react"
import {
  Users, FileText, Phone, MessageCircle, Activity, ShieldCheck, UploadCloud,
  ScrollText, Search, Bell, LogOut, Mic, BarChart3, type LucideIcon,
} from "lucide-react"
import LeadsView    from "./leads-view"
import LoanAppsView from "./loan-apps-view"
import VoiceLogsView from "./voice-logs-view"
import WhatsAppView  from "./whatsapp-view"
import CommLogView   from "./comm-log-view"
import SecurityView  from "./security-view"
import UploadView    from "./upload-view"
import ScriptView    from "./script-view"
import AnalyticsView from "./analytics-view"
import QuickChat     from "./quick-chat"

export type ViewKey = "leads" | "loans" | "voice" | "whatsapp" | "comms" | "security" | "upload" | "script" | "analytics"

type NavItem = { key: ViewKey; label: string; icon: LucideIcon }
type NavSection = { title: string; items: NavItem[] }

const NAV_SECTIONS: NavSection[] = [
  {
    title: "Overview",
    items: [
      { key: "analytics", label: "Analytics",        icon: BarChart3 },
      { key: "leads",     label: "Leads",             icon: Users },
      { key: "loans",     label: "Loan Applications", icon: FileText },
    ],
  },
  {
    title: "Engagement",
    items: [
      { key: "voice",    label: "Voice Logs",        icon: Phone },
      { key: "whatsapp", label: "WhatsApp Chat",     icon: MessageCircle },
      { key: "comms",    label: "Communication Log", icon: Activity },
    ],
  },
  {
    title: "System",
    items: [
      { key: "security", label: "Security",       icon: ShieldCheck },
      { key: "upload",   label: "Upload & Data",  icon: UploadCloud },
      { key: "script",   label: "Priya's Script", icon: ScrollText },
    ],
  },
]

const VIEW_TITLES: Record<ViewKey, { title: string; sub: string }> = {
  analytics: { title: "Analytics",         sub: "Performance across calls, leads, and WhatsApp" },
  leads:    { title: "Leads",              sub: "Pipeline and qualified prospects" },
  loans:    { title: "Loan Applications",  sub: "Incoming home & business loan enquiries" },
  voice:    { title: "Voice Logs",         sub: "Voice bot call activity and outcomes" },
  whatsapp: { title: "WhatsApp Chat",      sub: "Live customer conversations" },
  comms:    { title: "Communication Log",  sub: "Automated calls and WhatsApp activity" },
  security: { title: "Security",           sub: "Access control and audit policy" },
  upload:   { title: "Upload & Data",      sub: "Upload contacts, scripts, and files for AI campaigns" },
  script:   { title: "Priya's Script",     sub: "View and edit what Priya says on every call" },
}

function StatusPill({ icon: Icon, label }: { icon: LucideIcon; label: string }) {
  return (
    <div className="hidden lg:flex items-center gap-2 rounded-full border border-white/[0.07] bg-white/[0.03] px-3.5 py-[7px]">
      <Icon size={13} strokeWidth={2} className="text-[var(--text-secondary)]" />
      <span className="text-[12.5px] font-medium text-[var(--text-secondary)]">{label}</span>
      <span
        className="ml-0.5 h-[6px] w-[6px] rounded-full bg-[#2dd4a0]"
        style={{ animation: "pulse-dot 2.2s infinite" }}
      />
    </div>
  )
}

export default function DashboardShell() {
  const [view, setView] = useState<ViewKey>("leads")
  const [counts, setCounts] = useState({ leads: 0, loans: 0, whatsapp: 0 })
  const [userEmail, setUserEmail] = useState("")

  useEffect(() => {
    async function loadCounts() {
      try {
        const [l, lo, w] = await Promise.all([
          fetch("/api/leads?count=1").then(r => r.json()),
          fetch("/api/loans?count=1").then(r => r.json()),
          fetch("/api/whatsapp/unread").then(r => r.json()),
        ])
        setCounts({ leads: l.count ?? 0, loans: lo.count ?? 0, whatsapp: w.count ?? 0 })
      } catch {}
    }
    loadCounts()
    fetch("/api/auth/me").then(r => r.json()).then(d => setUserEmail(d.email || "")).catch(() => {})
    const t = setInterval(loadCounts, 30000)
    return () => clearInterval(t)
  }, [])

  async function logout() {
    try { await fetch("/api/auth/logout", { method: "POST" }) } catch {}
    window.location.href = "/login"
  }

  const badgeFor = (key: ViewKey) =>
    key === "leads" ? counts.leads : key === "loans" ? counts.loans : key === "whatsapp" ? counts.whatsapp : 0

  const { title, sub } = VIEW_TITLES[view]
  const initials = userEmail ? userEmail.slice(0, 2).toUpperCase() : "RA"

  return (
    <div className="flex h-screen bg-[var(--bg-primary)]">
      {/* ======= Sidebar ======= */}
      <aside className="flex w-[258px] flex-shrink-0 flex-col border-r border-[var(--border)] bg-[var(--bg-sidebar)]">
        {/* Brand */}
        <div className="flex h-16 items-center gap-3 border-b border-[var(--border-light)] px-5">
          <div
            className="flex h-[34px] w-[34px] flex-shrink-0 items-center justify-center rounded-[10px] text-[15px] font-extrabold text-white"
            style={{ background: "var(--gradient-brand)", boxShadow: "0 4px 16px -4px rgba(91,124,250,0.6), inset 0 1px 0 rgba(255,255,255,0.25)" }}
          >
            R
          </div>
          <div className="min-w-0 leading-tight">
            <div className="truncate text-[13.5px] font-bold tracking-tight text-[var(--text-primary)]">Right Agent Group</div>
            <div className="text-[9.5px] font-semibold tracking-[0.18em] text-[var(--text-muted)]">OPERATIONS CONSOLE</div>
          </div>
        </div>

        {/* Navigation */}
        <nav className="flex-1 overflow-y-auto px-3 pb-4 pt-3" aria-label="Primary">
          {NAV_SECTIONS.map(section => (
            <div key={section.title} className="mb-1">
              <div className="mb-1.5 mt-3 px-3 text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--text-muted)]">
                {section.title}
              </div>
              <div className="flex flex-col gap-[3px]">
                {section.items.map(({ key, label, icon: Icon }) => {
                  const active = view === key
                  const badge = badgeFor(key)
                  return (
                    <button
                      key={key}
                      onClick={() => setView(key)}
                      aria-current={active ? "page" : undefined}
                      className={`group flex h-9 w-full items-center gap-3 rounded-[10px] px-3 text-left text-[13px] transition-colors ${
                        active
                          ? "text-white"
                          : "text-[var(--text-secondary)] hover:bg-white/[0.04] hover:text-[var(--text-primary)]"
                      }`}
                      style={active ? {
                        background: "linear-gradient(90deg, rgba(139,124,255,0.17), rgba(56,189,248,0.06))",
                        border: "1px solid rgba(139,124,255,0.22)",
                        fontWeight: 600,
                      } : { border: "1px solid transparent", fontWeight: 480 }}
                    >
                      <Icon
                        size={16}
                        strokeWidth={active ? 2.2 : 1.8}
                        className={active ? "text-[#a5b0ff]" : "text-[var(--text-muted)] group-hover:text-[var(--text-secondary)]"}
                      />
                      <span className="flex-1 truncate">{label}</span>
                      {badge > 0 && (
                        <span
                          className="min-w-[20px] rounded-md px-1.5 py-px text-center text-[10.5px] font-bold"
                          style={active
                            ? { background: "var(--gradient-brand)", color: "#fff" }
                            : { background: "rgba(255,255,255,0.07)", color: "var(--text-secondary)" }}
                        >
                          {badge}
                        </span>
                      )}
                    </button>
                  )
                })}
              </div>
            </div>
          ))}
        </nav>

        {/* System status */}
        <div className="mx-3 mb-3 rounded-xl border border-[var(--border-light)] bg-white/[0.02] px-3.5 py-3">
          <div className="flex items-center gap-2">
            <span className="h-[7px] w-[7px] rounded-full bg-[#2dd4a0]" style={{ animation: "pulse-dot 2.2s infinite" }} />
            <span className="text-[12px] font-semibold text-[var(--text-primary)]">All systems operational</span>
          </div>
          <div className="mt-0.5 pl-[15px] text-[10.5px] text-[var(--text-muted)]">Voice · WhatsApp · AI Engine</div>
        </div>

        {/* User */}
        <div className="flex items-center gap-2.5 border-t border-[var(--border-light)] px-4 py-3">
          <div
            className="flex h-[30px] w-[30px] flex-shrink-0 items-center justify-center rounded-full text-[10.5px] font-bold text-white"
            style={{ background: "var(--gradient-brand)" }}
          >
            {initials}
          </div>
          <div className="min-w-0 flex-1 leading-tight">
            <div className="text-[12.5px] font-semibold text-[var(--text-primary)]">Ops Administrator</div>
            <div className="truncate text-[10.5px] text-[var(--text-muted)]">{userEmail || "…"}</div>
          </div>
          <button
            onClick={logout}
            aria-label="Sign out"
            title="Sign out"
            className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg text-[var(--text-muted)] hover:bg-white/[0.05] hover:text-[var(--accent-red)]"
          >
            <LogOut size={15} strokeWidth={1.9} />
          </button>
        </div>
      </aside>

      {/* ======= Main ======= */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Topbar */}
        <header className="glass z-10 flex h-16 flex-shrink-0 items-center gap-3 border-b border-[var(--border)] px-6">
          <div className="min-w-0 flex-1 leading-tight">
            <div className="truncate text-[16px] font-bold tracking-tight text-[var(--text-primary)]">{title}</div>
            <div className="truncate text-[12px] text-[var(--text-muted)]">{sub}</div>
          </div>

          <StatusPill icon={Mic} label="Voice Bot" />
          <StatusPill icon={MessageCircle} label="WhatsApp" />

          <div className="mx-1 hidden h-6 w-px bg-[var(--border)] lg:block" />

          <div className="relative hidden md:block">
            <Search size={14} strokeWidth={2} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
            <input
              placeholder="Search"
              aria-label="Search"
              className="!h-9 !w-[210px] !rounded-[10px] !pl-9 !pr-12 !text-[13px]"
            />
            <span className="kbd pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2">⌘K</span>
          </div>

          <button
            aria-label="Notifications"
            className="relative flex h-9 w-9 items-center justify-center rounded-[10px] border border-transparent text-[var(--text-secondary)] hover:border-[var(--border)] hover:bg-white/[0.04] hover:text-[var(--text-primary)]"
          >
            <Bell size={16} strokeWidth={1.9} />
            <span className="absolute right-[8px] top-[8px] block h-[6px] w-[6px] rounded-full bg-[var(--accent-red)] ring-[2.5px] ring-[#0a0e17]" />
          </button>
        </header>

        {/* Content */}
        <main key={view} className="flex-1 overflow-auto p-6" style={{ animation: "fadeInUp 0.25s ease" }}>
          {view === "analytics" && <AnalyticsView />}
          {view === "leads"    && <LeadsView />}
          {view === "loans"    && <LoanAppsView />}
          {view === "voice"    && <VoiceLogsView />}
          {view === "whatsapp" && <WhatsAppView />}
          {view === "comms"    && <CommLogView />}
          {view === "security" && <SecurityView />}
          {view === "upload"   && <UploadView />}
          {view === "script"   && <ScriptView />}
        </main>
      </div>
      <QuickChat />
    </div>
  )
}
