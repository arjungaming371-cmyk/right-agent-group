"use client"
import { useState, useEffect } from "react"
import dynamic from "next/dynamic"
import {
  Users, FileText, Phone, MessageCircle, Activity, ShieldCheck, UploadCloud,
  ScrollText, LogOut, Mic, BarChart3, UserCog, Search, Menu, X, BookOpen,
  Building2, Sparkles, Instagram, type LucideIcon,
} from "lucide-react"
import { ToastProvider } from "../ui/toast"
import CommandPalette from "../ui/command-palette"
import LeadsView    from "./leads-view"
import LoanAppsView from "./loan-apps-view"
import VoiceLogsView from "./voice-logs-view"
import WhatsAppView  from "./whatsapp-view"
import InstagramView from "./instagram-view"
import CommLogView   from "./comm-log-view"
import SecurityView  from "./security-view"
import UploadView    from "./upload-view"
import ScriptView    from "./script-view"
import KnowledgeBaseView from "./knowledge-base-view"
// recharts is ~400kB and only the Analytics tab uses it. Statically imported
// it landed in the dashboard bundle for every user, including the ones who
// never open that tab — load it on demand instead.
const AnalyticsView = dynamic(() => import("./analytics-view"), {
  ssr: false,
  loading: () => <div style={{ padding: 24, color: "var(--text-muted)" }}>Loading analytics…</div>,
})
import QuickChat     from "./quick-chat"
import NotificationBell from "./notification-bell"
import ThemeSwitcher from "./theme-switcher"
import DeveloperLogsView from "./developer-logs-view"
import CalendarView from "./calendar-view"
import ProfileModal from "./profile-modal"
import BranchesView from "./branches-view"
import VoiceAssistant from "./voice-assistant"
import { usePolling } from "@/lib/use-poll"

export type ViewKey = "leads" | "loans" | "voice" | "whatsapp" | "instagram" | "comms" | "calendar" | "security" | "upload" | "script" | "knowledge" | "analytics" | "branches" | "dev-logs"
export type Role = "admin" | "agent" | "viewer" | "developer" | "branch_manager"

const ROLE_LABEL: Record<Role, string> = { admin: "Administrator", agent: "Loan Officer", viewer: "Viewer", developer: "Administrator", branch_manager: "Branch Manager" }

type NavItem = { key: ViewKey; label: string; icon: LucideIcon; roles: Role[] }
type NavSection = { title: string; items: NavItem[] }

// roles: who sees this nav item. Module allotment filtering (userAllowedModules)
// governs granular permissions; NAV_SECTIONS roles list the default allowed base roles.
const NAV_SECTIONS: NavSection[] = [
  {
    title: "Overview",
    items: [
      { key: "analytics", label: "Analytics",        icon: BarChart3, roles: ["admin", "agent", "viewer", "branch_manager"] },
      { key: "leads",     label: "Leads",             icon: Users,     roles: ["admin", "agent", "viewer", "branch_manager"] },
      { key: "loans",     label: "Loan Applications", icon: FileText,  roles: ["admin", "agent", "viewer", "branch_manager"] },
    ],
  },
  {
    title: "Engagement",
    items: [
      { key: "voice",    label: "Voice Logs",        icon: Phone,          roles: ["admin", "agent", "viewer", "branch_manager"] },
      { key: "whatsapp", label: "WhatsApp Chat",     icon: MessageCircle,  roles: ["admin", "agent", "viewer", "branch_manager"] },
      { key: "instagram",label: "Instagram Chat",    icon: Instagram,      roles: ["admin", "agent", "viewer", "branch_manager"] },
      { key: "comms",    label: "Communication Log", icon: Activity,       roles: ["admin", "agent", "viewer", "branch_manager"] },
    ],
  },
  {
    title: "System",
    items: [
      { key: "security", label: "Security",       icon: ShieldCheck,  roles: ["admin", "developer"] },
      { key: "upload",   label: "Upload & Data",  icon: UploadCloud,  roles: ["admin", "agent", "viewer", "branch_manager"] },
      { key: "script",   label: "Priya's Script", icon: ScrollText,   roles: ["admin", "agent", "viewer", "branch_manager"] },
      { key: "knowledge",label: "Knowledge Base", icon: BookOpen,     roles: ["admin", "agent", "viewer", "branch_manager"] },
    ],
  },
  {
    title: "Diagnostics",
    items: [
      { key: "dev-logs", label: "Activity Logs", icon: ScrollText,   roles: ["developer"] },
    ],
  },
]

const VIEW_TITLES: Record<ViewKey, { title: string; sub: string }> = {
  analytics: { title: "Analytics",         sub: "Performance across calls, leads, and WhatsApp" },
  leads:    { title: "Leads",              sub: "Pipeline and qualified prospects" },
  loans:    { title: "Loan Applications",  sub: "Incoming home & business loan enquiries" },
  voice:    { title: "Voice Logs",         sub: "Voice bot call activity and outcomes" },
  whatsapp: { title: "WhatsApp Chat",      sub: "Live customer conversations" },
  instagram:{ title: "Instagram Chat",     sub: "Direct messages and post comment auto-replies" },
  comms:    { title: "Communication Log",  sub: "Automated calls and WhatsApp activity" },
  calendar: { title: "Calendar",           sub: "Upcoming calls and follow-up callbacks" },
  security: { title: "Security",           sub: "Access control and audit policy" },
  upload:   { title: "Upload & Data",      sub: "Upload contacts, scripts, and files for AI campaigns" },
  script:   { title: "Priya's Script",     sub: "View and edit what Priya says on every call" },
  branches: { title: "Branches & Staff AI", sub: "Sub-accounts, AI Employees, per-branch scripts, quotas, and billing meters" },
  knowledge:{ title: "Knowledge Base",     sub: "Facts Priya can pull into any call or chat, on any turn" },
  "dev-logs": { title: "Activity Logs",   sub: "Your activity, login history, and system events" },
}

function StatusPill({ icon: Icon, label }: { icon: LucideIcon; label: string }) {
  return (
    <div className="hidden lg:flex items-center gap-2 rounded-full border border-[var(--overlay-line)] bg-[var(--overlay-soft)] px-3.5 py-[7px]">
      <Icon size={13} strokeWidth={2} className="text-[var(--text-secondary)]" />
      <span className="text-[12.5px] font-medium text-[var(--text-secondary)]">{label}</span>
      <span
        className="ml-0.5 h-[6px] w-[6px] rounded-full bg-[var(--accent-green)]"
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
  const [roleTitle, setRoleTitle] = useState("")
  const [userAllowedModules, setUserAllowedModules] = useState<string[] | null>(null)
  const [sessionBranchId, setSessionBranchId] = useState<string | null>(null)
  const [allBranches, setAllBranches] = useState<{ id: string; name: string; code: string }[]>([])
  const [canSwitch, setCanSwitch] = useState(false)
  const [showProfile, setShowProfile] = useState(false)
  const [paletteOpen, setPaletteOpen] = useState(false)
  // Search text seeded into a view when jumping there from the command palette.
  const [seedSearch, setSeedSearch] = useState<{ view: ViewKey; q: string } | null>(null)
  // Sidebar is a slide-in drawer below the md breakpoint — closed by default.
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  const [voiceAssistantOpen, setVoiceAssistantOpen] = useState(false)

  // Global shortcuts: Ctrl+K for palette, Alt+V for Personal Voice Assistant
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault()
        setPaletteOpen(o => !o)
      }
      if (e.altKey && e.key.toLowerCase() === "v") {
        e.preventDefault()
        setVoiceAssistantOpen(o => !o)
      }
    }
    function onOpenVoice() {
      setVoiceAssistantOpen(true)
    }
    window.addEventListener("keydown", onKey)
    window.addEventListener("rag:open-voice-assistant", onOpenVoice)
    return () => {
      window.removeEventListener("keydown", onKey)
      window.removeEventListener("rag:open-voice-assistant", onOpenVoice)
    }
  }, [])

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

  useEffect(() => {
    loadCounts()
    fetch("/api/auth/me").then(r => r.json()).then(d => {
      setUserEmail(d.email || "")
      if (d.role) setRole(d.role)
      if (d.roleTitle) setRoleTitle(d.roleTitle)
      if (Array.isArray(d.allowedModules)) setUserAllowedModules(d.allowedModules)
      setSessionBranchId(d.branchId ?? null)
      setCanSwitch(!!d.canSwitchBranch)
      // Branch switcher options for the parent account.
      if (d.canSwitchBranch || d.branchId) {
        fetch("/api/branches").then(r => r.json()).then(list => {
          if (Array.isArray(list)) setAllBranches(list.map((b: any) => ({ id: b.id, name: b.name, code: b.code })))
        }).catch(() => {})
      }
    }).catch(() => {})
  }, [])

  async function switchBranch(id: string | null) {
    await fetch("/api/auth/branch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ branchId: id }),
    })
    // The new scope is signed into the session cookie — reload so every
    // view refetches with the new branch filter.
    window.location.reload()
  }

  // Matches the 15s poll used by leads-view/loan-apps-view so the sidebar
  // badges don't lag a full extra cycle behind the visible lists.
  usePolling(loadCounts, 15000)

  // Live system status for the sidebar pill — replaces the old hardcoded
  // "All systems operational" (which lied whenever a service was down).
  // Lightweight: one public endpoint, on mount + every 60s, paused while
  // the tab is hidden like every other poll in the console. null until the
  // first check lands, so the pill never claims health before it knows.
  const [systemOk, setSystemOk] = useState<boolean | null>(null)

  async function loadSystemStatus() {
    try {
      const res = await fetch("/api/system/status")
      if (!res.ok) { setSystemOk(false); return }
      const d = await res.json()
      setSystemOk(!!(d?.llm?.running && d?.db?.running && d?.website?.running))
    } catch {
      setSystemOk(false)
    }
  }

  useEffect(() => { loadSystemStatus() }, [])
  usePolling(loadSystemStatus, 60000)

  async function logout() {
    try { await fetch("/api/auth/logout", { method: "POST" }) } catch {}
    window.location.href = "/login"
  }

  const badgeFor = (key: ViewKey) =>
    key === "leads" ? counts.leads : key === "loans" ? counts.loans : key === "whatsapp" ? counts.whatsapp : 0

  // Full-access role sees every nav item unless specific allowedModules list is set.
  const canSee = (key: ViewKey, itemRoles: Role[]) => {
    if (userAllowedModules !== null) {
      return userAllowedModules.includes(key)
    }
    return itemRoles.includes(role) || role === "developer"
  }

  const visibleSections = NAV_SECTIONS.map(s => ({ ...s, items: s.items.filter(i => canSee(i.key, i.roles)) })).filter(s => s.items.length > 0)

  // If the current view isn't visible to this role (e.g. role loaded after
  // mount and it was "security"), fall back to something everyone can see.
  useEffect(() => {
    const allowed = NAV_SECTIONS.some(s => s.items.some(i => i.key === view && canSee(i.key, i.roles)))
    if (!allowed) {
      const firstAvailable = visibleSections[0]?.items[0]?.key || "leads"
      setView(firstAvailable)
    }
  }, [role, view, userAllowedModules])

  const { title, sub } = VIEW_TITLES[view] || { title: "Dashboard", sub: "Right Agent Group" }
  const initials = userEmail ? userEmail.slice(0, 2).toUpperCase() : "RA"
  const allowedViews = NAV_SECTIONS.flatMap(s => s.items.filter(i => canSee(i.key, i.roles)).map(i => i.key))

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
        <div className="flex h-16 items-center justify-between border-b border-[var(--border-light)] px-4">
          <button
            onClick={() => { setView("leads"); setMobileNavOpen(false) }}
            className="flex items-center gap-2.5 min-w-0 flex-1 text-left cursor-pointer hover:opacity-90 transition-opacity"
            title="Right Agent Group — Operations Console"
          >
            <img
              src="/logo.png"
              alt="Right Agent Group"
              className="h-10 w-auto max-w-[195px] object-contain drop-shadow-[0_2px_8px_rgba(56,189,248,0.15)]"
            />
          </button>
          <button
            onClick={() => setMobileNavOpen(false)}
            aria-label="Close menu"
            className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg text-[var(--text-muted)] hover:bg-[var(--overlay-hover)] md:hidden"
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
                          ? "text-[var(--text-primary)]"
                          : "text-[var(--text-secondary)] hover:bg-[var(--overlay-hover)] hover:text-[var(--text-primary)]"
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
                        className={active ? "text-[var(--accent-violet)]" : "text-[var(--text-muted)] group-hover:text-[var(--text-secondary)]"}
                      />
                      <span className="flex-1 truncate">{label}</span>
                      {badge > 0 && (
                        <span
                          className="min-w-[20px] rounded-md px-1.5 py-px text-center text-[10.5px] font-bold"
                          style={active
                            ? { background: "var(--gradient-brand)", color: "#fff" }
                            : { background: "var(--overlay-chip)", color: "var(--text-secondary)" }}
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
          {(role === "admin" || role === "branch_manager") && (
            <div className="mb-1 mt-3">
              <div className="mb-1.5 px-3 text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--text-muted)]">Team</div>
              <a
                href="/access"
                className="group flex h-9 w-full items-center gap-3 rounded-[10px] px-3 text-left text-[13px] text-[var(--text-secondary)] transition-colors hover:bg-[var(--overlay-hover)] hover:text-[var(--text-primary)]"
                style={{ border: "1px solid transparent", fontWeight: 480 }}
              >
                <UserCog size={16} strokeWidth={1.8} className="text-[var(--text-muted)] group-hover:text-[var(--text-secondary)]" />
                <span className="flex-1 truncate">{role === "branch_manager" ? "Branch Team" : "Team Access"}</span>
              </a>
            </div>
          )}
        </nav>

        {/* System status — live from /api/system/status, not hardcoded */}
        <div className="mx-3 mb-3 rounded-xl border border-[var(--border-light)] bg-[var(--overlay-soft)] px-3.5 py-3">
          <div className="flex items-center gap-2">
            <span
              className="h-[7px] w-[7px] rounded-full"
              style={{
                background: systemOk === null ? "var(--text-muted)" : systemOk ? "var(--accent-green)" : "var(--accent-yellow)",
                // pulse-dot's halo is hardcoded green in globals.css — only
                // pulse while actually green, so degraded doesn't glow green.
                animation: systemOk ? "pulse-dot 2.2s infinite" : "none",
              }}
            />
            <span
              className="text-[12px] font-semibold"
              style={{ color: systemOk === false ? "var(--accent-yellow)" : "var(--text-primary)" }}
            >
              {systemOk === null ? "Checking status…" : systemOk ? "All systems operational" : "Service degraded — check System"}
            </span>
          </div>
          <div className="mt-0.5 pl-[15px] text-[10.5px] text-[var(--text-muted)]">Voice · WhatsApp · AI Engine</div>
        </div>

        {/* User */}
        <div className="flex items-center gap-2.5 border-t border-[var(--border-light)] px-4 py-3">
          <button
            onClick={() => setShowProfile(true)}
            aria-label="View profile"
            title="View profile"
            className="flex min-w-0 flex-1 items-center gap-2.5 text-left"
          >
            <div
              className="flex h-[30px] w-[30px] flex-shrink-0 items-center justify-center rounded-full text-[10.5px] font-bold text-white"
              style={{ background: "var(--gradient-brand)" }}
            >
              {initials}
            </div>
            <div className="min-w-0 flex-1 leading-tight">
              <div className="text-[12.5px] font-semibold text-[var(--text-primary)]">{roleTitle || ROLE_LABEL[role] || role}</div>
              <div className="truncate text-[10.5px] text-[var(--text-muted)]">{userEmail || "…"}</div>
            </div>
          </button>
          <button
            onClick={logout}
            aria-label="Sign out"
            title="Sign out"
            className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg text-[var(--text-muted)] hover:bg-[var(--overlay-hover)] hover:text-[var(--accent-red)]"
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
            className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-[10px] text-[var(--text-secondary)] hover:bg-[var(--overlay-hover)] md:hidden"
          >
            <Menu size={19} strokeWidth={2} />
          </button>
          <div className="min-w-0 flex-1 leading-tight">
            <div className="truncate text-[15px] font-bold tracking-tight text-[var(--text-primary)] md:text-[16px]">{title}</div>
            <div className="truncate text-[11px] text-[var(--text-muted)] md:text-[12px]">{sub}</div>
          </div>

          <StatusPill icon={Mic} label="Voice Bot" />
          <StatusPill icon={MessageCircle} label="WhatsApp" />

          {/* Personal Voice Assistant trigger button */}
          <button
            onClick={() => setVoiceAssistantOpen(true)}
            title="Open Personal Voice Assistant (Alt+V)"
            aria-label="Open Personal Voice Assistant"
            className="flex h-9 items-center gap-2 rounded-[10px] px-3 text-[12.5px] font-semibold text-white transition-all hover:opacity-95 shadow-sm"
            style={{
              background: "linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)",
              border: "1px solid rgba(139, 92, 246, 0.4)",
              boxShadow: "0 0 14px rgba(99, 102, 241, 0.35)",
            }}
          >
            <Sparkles size={14} className="animate-pulse text-yellow-300" />
            <span className="font-semibold hidden sm:inline">Voice Assistant</span>
            <span className="sm:hidden font-semibold">Voice</span>
            <span className="hidden lg:inline text-[10px] bg-white/20 px-1.5 py-0.5 rounded font-mono font-normal">Alt V</span>
          </button>

          {/* Global search — opens the command palette (also Ctrl+K) */}
          <button
            onClick={() => setPaletteOpen(true)}
            aria-label="Search everything"
            className="hidden h-9 items-center gap-2.5 rounded-[10px] border border-[var(--border)] bg-[var(--bg-secondary)] px-3 text-[13px] text-[var(--text-muted)] transition-colors hover:border-[var(--border)] hover:text-[var(--text-secondary)] md:flex"
            style={{ width: 210 }}
          >
            <Search size={14} strokeWidth={2} />
            <span className="flex-1 text-left">Search</span>
            <span className="kbd">Ctrl K</span>
          </button>

          <ThemeSwitcher />
          <NotificationBell onNavigate={(view) => setView(view)} />
        </header>

        {/* Content */}
        <main key={view} className="flex-1 overflow-auto p-3 md:p-6" style={{ animation: "fadeInUp 0.25s ease" }}>
          {view === "analytics" && <AnalyticsView />}
          {view === "leads"    && <LeadsView role={role} initialSearch={seedSearch?.view === "leads" ? seedSearch.q : undefined} />}
          {view === "loans"    && <LoanAppsView role={role} initialSearch={seedSearch?.view === "loans" ? seedSearch.q : undefined} />}
          {view === "voice"    && <VoiceLogsView role={role} />}
          {view === "whatsapp" && <WhatsAppView role={role} />}
          {view === "instagram" && <InstagramView initialSearch={seedSearch?.view === "instagram" ? seedSearch.q : undefined} />}
          {view === "comms"    && <CommLogView />}
          {view === "calendar" && <CalendarView role={role} />}
          {view === "security" && <SecurityView role={role} />}
          {view === "upload"   && <UploadView />}
          {view === "script"   && <ScriptView />}
          {view === "branches" && <BranchesView role={role} branchId={sessionBranchId} />}
          {view === "knowledge" && <KnowledgeBaseView role={role} />}
          {view === "dev-logs" && role === "developer" && <DeveloperLogsView userEmail={userEmail} />}
        </main>
      </div>
      {/* Floating QuickChat removed */}
      <VoiceAssistant
        isOpen={voiceAssistantOpen}
        onClose={() => setVoiceAssistantOpen(false)}
        userEmail={userEmail}
        role={role}
      />
      {showProfile && <ProfileModal email={userEmail} role={role} onClose={() => setShowProfile(false)} />}
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
