"use client"
import { useState, useEffect } from "react"
import {
  Users, FileText, Phone, MessageCircle, Activity, ShieldCheck, UploadCloud,
  ScrollText, LogOut, Mic, BarChart3, UserCog, Search, Menu, X, type LucideIcon,
} from "lucide-react"
import { ToastProvider } from "../ui/toast"
import CommandPalette from "../ui/command-palette"
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
import NotificationBell from "./notification-bell"

export type ViewKey = "leads" | "loans" | "voice" | "whatsapp" | "comms" | "security" | "upload" | "script" | "analytics"
export type Role = "admin" | "agent" | "viewer"

const ROLE_LABEL: Record<Role, string> = { admin: "Administrator", agent: "Loan Officer", viewer: "Viewer" }

type NavItem = { key: ViewKey; label: string; icon: LucideIcon; roles: Role[] }
type NavSection = { title: string; items: NavItem[] }

// roles: who sees this nav item. Agents/Viewers get the day-to-day working
// views; Security/Upload/Script are admin-only (real system configuration,
// not something a teammate should be able to touch or even see).
const NAV_SECTIONS: NavSection[] = [
  {
    title: "Overview",
    items: [
      { key: "analytics", label: "Analytics",        icon: BarChart3, roles: ["admin", "agent", "viewer"] },
      { key: "leads",     label: "Leads",             icon: Users,     roles: ["admin", "agent", "viewer"] },
      { key: "loans",     label: "Loan Applications", icon: FileText,  roles: ["admin", "agent", "viewer"] },
    ],
  },
  {
    title: "Engagement",
    items: [
      { key: "voice",    label: "Voice Logs",        icon: Phone,          roles: ["admin", "agent", "viewer"] },
      { key: "whatsapp", label: "WhatsApp Chat",     icon: MessageCircle,  roles: ["admin", "agent", "viewer"] },
      { key: "comms",    label: "Communication Log", icon: Activity,       roles: ["admin", "agent", "viewer"] },
    ],
  },
  {
    title: "System",
    items: [
      { key: "security", label: "Security",       icon: ShieldCheck,  roles: ["admin"] },
      { key: "upload",   label: "Upload & Data",  icon: UploadCloud,  roles: ["admin"] },
      { key: "script",   label: "Priya's Script", icon: ScrollText,   roles: ["admin"] },
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
  const [role, setRole] = useState<Role>("viewer") // safest default until the real role loads
  const [paletteOpen, setPaletteOpen] = useState(false)
  // Search text seeded into a view when jumping there from the command palette.
  const [seedSearch, setSeedSearch] = useState<{ view: ViewKey; q: string } | null>(null)
  // Sidebar is a slide-in drawer below the md breakpoint — closed by default.
  const [mobileNavOpen, setMobileNavOpen] = useState(false)

  // Global Ctrl+K / Cmd+K opens the command palette.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault()
        setPaletteOpen(o => !o)
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [])

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
    fetch("/api/auth/me").then(r => r.json()).then(d => {
      setUserEmail(d.email || "")
      if (d.role) setRole(d.role)
    }).catch(() => {})
    const t = setInterval(loadCounts, 30000)
    return () => clearInterval(t)
  }, [])

  async function logout() {
    try { await fetch("/api/auth/logout", { method: "POST" }) } catch {}
    window.location.href = "/login"
  }

  const badgeFor = (key: ViewKey) =>
    key === "leads" ? counts.leads : key === "loans" ? counts.loans : key === "whatsapp" ? counts.whatsapp : 0

  const visibleSections = NAV_SECTIONS.map(s => ({ ...s, items: s.items.filter(i => i.roles.includes(role)) })).filter(s => s.items.length > 0)

  // If the current view isn't visible to this role (e.g. role loaded after
  // mount and it was "security"), fall back to something everyone can see.
  useEffect(() => {
    const allowed = NAV_SECTIONS.some(s => s.items.some(i => i.key === view && i.roles.includes(role)))
    if (!allowed) setView("leads")
  }, [role, view])

  const { title, sub } = VIEW_TITLES[view]
  const initials = userEmail ? userEmail.slice(0, 2).toUpperCase() : "RA"
  const allowedViews = NAV_SECTIONS.flatMap(s => s.items.filter(i => i.roles.includes(role)).map(i => i.key))

  function navigateFromPalette(target: ViewKey, search?: string) {
    setView(target)
    setSeedSearch(search ? { view: target, q: search } : null)
  }

  return (
    <ToastProvider>
    <div className="flex h-screen bg-[var(--bg-primary)] overflow-hidden">
      {/* Backdrop — mobile only, closes the drawer on tap outside it */}
      {mobileNavOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/60 md:hidden"
          onClick={() => setMobileNavOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* ======= Sidebar ======= */}
      {/* Below md: fixed slide-in drawer, off-screen until opened.
          At md+: back in normal flow as a static sidebar, always visible.
          NOTE: the slide uses a plain inline `transform`, not Tailwind's
          translate-x-* utilities — Tailwind v4 compiles those to the CSS
          `translate` property driven by a `--tw-translate-x` custom
          property, and swapping between two utility classes (translate-x-0
          <-> -translate-x-full) updates the custom property correctly but
          the derived `translate` shorthand doesn't reliably recompute
          across the class swap in this environment (verified: `--tw-
          translate-x` reads correctly, `translate` does not). Plain inline
          transform sidesteps that entirely. */}
      <aside
        className="mobile-nav-drawer fixed inset-y-0 left-0 z-50 flex w-[258px] flex-shrink-0 flex-col border-r border-[var(--border)] bg-[var(--bg-sidebar)] md:static"
        style={{ transform: mobileNavOpen ? "translateX(0)" : "translateX(-100%)", transition: "transform 200ms ease-out" }}
      >
        {/* Brand */}
        <div className="flex h-16 items-center gap-3 border-b border-[var(--border-light)] px-5">
          <div
            className="flex h-[34px] w-[34px] flex-shrink-0 items-center justify-center rounded-[10px] text-[15px] font-extrabold text-white"
            style={{ background: "var(--gradient-brand)", boxShadow: "0 4px 16px -4px rgba(91,124,250,0.6), inset 0 1px 0 rgba(255,255,255,0.25)" }}
          >
            R
          </div>
          <div className="min-w-0 flex-1 leading-tight">
            <div className="truncate text-[13.5px] font-bold tracking-tight text-[var(--text-primary)]">Right Agent Group</div>
            <div className="text-[9.5px] font-semibold tracking-[0.18em] text-[var(--text-muted)]">OPERATIONS CONSOLE</div>
          </div>
          <button
            onClick={() => setMobileNavOpen(false)}
            aria-label="Close menu"
            className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg text-[var(--text-muted)] hover:bg-white/[0.05] md:hidden"
          >
            <X size={16} strokeWidth={2} />
          </button>
        </div>

        {/* Navigation */}
        <nav className="flex-1 overflow-y-auto px-3 pb-4 pt-3" aria-label="Primary">
          {visibleSections.map(section => (
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
                      onClick={() => { setView(key); setMobileNavOpen(false) }}
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
          {role === "admin" && (
            <div className="mb-1 mt-3">
              <div className="mb-1.5 px-3 text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--text-muted)]">Team</div>
              <a
                href="/access"
                className="group flex h-9 w-full items-center gap-3 rounded-[10px] px-3 text-left text-[13px] text-[var(--text-secondary)] transition-colors hover:bg-white/[0.04] hover:text-[var(--text-primary)]"
                style={{ border: "1px solid transparent", fontWeight: 480 }}
              >
                <UserCog size={16} strokeWidth={1.8} className="text-[var(--text-muted)] group-hover:text-[var(--text-secondary)]" />
                <span className="flex-1 truncate">Team Access</span>
              </a>
            </div>
          )}
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
            <div className="text-[12.5px] font-semibold text-[var(--text-primary)]">{ROLE_LABEL[role]}</div>
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
        <header className="glass z-10 flex h-16 flex-shrink-0 items-center gap-2 border-b border-[var(--border)] px-3 md:gap-3 md:px-6">
          <button
            onClick={() => setMobileNavOpen(true)}
            aria-label="Open menu"
            className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-[10px] text-[var(--text-secondary)] hover:bg-white/[0.04] md:hidden"
          >
            <Menu size={19} strokeWidth={2} />
          </button>
          <div className="min-w-0 flex-1 leading-tight">
            <div className="truncate text-[15px] font-bold tracking-tight text-[var(--text-primary)] md:text-[16px]">{title}</div>
            <div className="truncate text-[11px] text-[var(--text-muted)] md:text-[12px]">{sub}</div>
          </div>

          <StatusPill icon={Mic} label="Voice Bot" />
          <StatusPill icon={MessageCircle} label="WhatsApp" />

          <div className="mx-1 hidden h-6 w-px bg-[var(--border)] lg:block" />

          {/* Global search — opens the command palette (also Ctrl+K) */}
          <button
            onClick={() => setPaletteOpen(true)}
            aria-label="Search everything"
            className="hidden h-9 items-center gap-2.5 rounded-[10px] border border-[var(--border)] bg-[var(--bg-secondary)] px-3 text-[13px] text-[var(--text-muted)] transition-colors hover:border-[#2b3550] hover:text-[var(--text-secondary)] md:flex"
            style={{ width: 210 }}
          >
            <Search size={14} strokeWidth={2} />
            <span className="flex-1 text-left">Search</span>
            <span className="kbd">Ctrl K</span>
          </button>

          <NotificationBell onNavigate={(view) => setView(view)} />
        </header>

        {/* Content */}
        <main key={view} className="flex-1 overflow-auto p-3 md:p-6" style={{ animation: "fadeInUp 0.25s ease" }}>
          {view === "analytics" && <AnalyticsView />}
          {view === "leads"    && <LeadsView role={role} initialSearch={seedSearch?.view === "leads" ? seedSearch.q : undefined} />}
          {view === "loans"    && <LoanAppsView role={role} initialSearch={seedSearch?.view === "loans" ? seedSearch.q : undefined} />}
          {view === "voice"    && <VoiceLogsView role={role} />}
          {view === "whatsapp" && <WhatsAppView role={role} />}
          {view === "comms"    && <CommLogView />}
          {view === "security" && role === "admin" && <SecurityView />}
          {view === "upload"   && role === "admin" && <UploadView />}
          {view === "script"   && role === "admin" && <ScriptView />}
        </main>
      </div>
      <QuickChat />
      {/* Neutralizes the mobile slide-in transform at md+ so the sidebar is
          always visible on desktop regardless of mobileNavOpen state. */}
      <style>{`@media (min-width: 768px) { .mobile-nav-drawer { transform: none !important; } }`}</style>
      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        onNavigate={navigateFromPalette}
        allowedViews={allowedViews}
      />
    </div>
    </ToastProvider>
  )
}
