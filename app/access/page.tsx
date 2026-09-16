"use client"

// Team Access — admin-only page to add/remove teammates and set their role.
// Styled to match the operations console design system. The API enforces
// admin-only server-side; this page also redirects non-admins so they don't
// land on a page full of 401s.

import { useCallback, useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { ArrowLeft, LogOut, Shield, UserCog, Eye, UserPlus, Users, Trash2, Building2 } from "lucide-react"
import { ToastProvider, useToast } from "@/components/ui/toast"
import { SkeletonList } from "@/components/ui/skeleton"

type Role = "admin" | "agent" | "viewer" | "developer" | "branch_manager"
type AllowedEmail = { email: string; added_by: string | null; role: Role; created_at: string; branch_id?: string | null; branch_name?: string | null; branch_code?: string | null }
type BranchOption = { id: string; name: string; code: string }

// Only roles assignable/visible through this page — a separate full-access
// role exists but is deliberately not surfaced here.
const ROLE_META: Record<"admin" | "agent" | "viewer" | "branch_manager", { label: string; desc: string; color: string; icon: typeof Shield }> = {
  admin:  { label: "Admin",        desc: "Full access, including this page. Max 2 admins total.",     color: "var(--accent-violet)", icon: Shield },
  agent:  { label: "Loan Officer", desc: "Leads, loans, calls, WhatsApp, analytics — no settings",    color: "var(--accent-cyan)", icon: UserCog },
  viewer: { label: "Viewer",       desc: "Same views as Loan Officer, strictly read-only",            color: "var(--text-muted)", icon: Eye },
  branch_manager: { label: "Branch Manager", desc: "Runs ONE branch — sees only that branch's data",   color: "var(--accent-green)", icon: Building2 },
}

function RoleBadge({ role }: { role: Role }) {
  const meta = ROLE_META[role as "admin" | "agent" | "viewer" | "branch_manager"] ?? ROLE_META.agent
  const Icon = meta.icon
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 6,
      background: `${meta.color}1c`, border: `1px solid ${meta.color}42`, color: meta.color,
      borderRadius: 7, padding: "4px 10px", fontSize: 12, fontWeight: 600,
    }}>
      <Icon size={12} strokeWidth={2.1} />
      {meta.label}
    </span>
  )
}

function AccessPageInner() {
  const router = useRouter()
  const toast = useToast()
  const [checking, setChecking] = useState(true)
  const [loading, setLoading] = useState(true)
  const [emails, setEmails] = useState<AllowedEmail[]>([])
  const [you, setYou] = useState("")
  const [branches, setBranches] = useState<BranchOption[]>([])
  const [newEmail, setNewEmail] = useState("")
  const [newRole, setNewRole] = useState<"admin" | "agent" | "viewer" | "branch_manager">("agent")
  const [newBranch, setNewBranch] = useState<string>("")
  const [busy, setBusy] = useState(false)
  const [confirmTarget, setConfirmTarget] = useState<string | null>(null)
  const [profiles, setProfiles] = useState<Record<string, { displayName: string | null; avatarUrl: string | null; phone?: string | null; address?: string | null; age?: number | null }>>({})

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/allowed-emails")
      if (res.status === 401) {
        router.replace("/dashboard")
        return
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      setEmails(data.emails || [])
      setYou(data.you || "")
      setBranches(data.branches || [])
      setLoading(false)

      // Name/avatar per person — captured automatically from Google at
      // login (see app/api/auth/google/callback), separate from the
      // access-control data above.
      fetch("/api/team").then(async (r) => {
        if (!r.ok) return
        const team = await r.json()
        const map: Record<string, { displayName: string | null; avatarUrl: string | null; phone?: string | null; address?: string | null; age?: number | null }> = {}
        for (const t of team) map[t.email.toLowerCase()] = { displayName: t.displayName, avatarUrl: t.avatarUrl, phone: t.phone, address: t.address, age: t.age }
        setProfiles(map)
      }).catch(() => {})
    } catch {
      toast.error("Could not load the access list")
      setLoading(false)
    } finally {
      setChecking(false)
    }
  }, [router]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { load() }, [load])

  async function addEmail(e: React.FormEvent) {
    e.preventDefault()
    const email = newEmail.trim().toLowerCase()
    if (!email) return
    setBusy(true)
    try {
      const res = await fetch("/api/allowed-emails", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, role: newRole, branch_id: newRole === "branch_manager" ? newBranch : newBranch || undefined }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || "Failed")
      setNewEmail("")
      setNewRole("agent")
      setNewBranch("")
      toast.success(`${email} can now log in as ${ROLE_META[newRole].label}`)
      await load()
    } catch (err: any) {
      toast.error(err.message)
    } finally {
      setBusy(false)
    }
  }

  async function removeEmail(email: string) {
    setBusy(true)
    setConfirmTarget(null)
    try {
      const res = await fetch(`/api/allowed-emails?email=${encodeURIComponent(email)}`, { method: "DELETE" })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || "Failed")
      toast.success(`${email} removed`)
      await load()
    } catch (err: any) {
      toast.error(err.message)
    } finally {
      setBusy(false)
    }
  }

  if (checking) return null

  return (
    <main style={{ minHeight: "100vh", padding: "0 20px" }}>
      <div style={{ maxWidth: 860, margin: "0 auto", padding: "36px 0 80px" }}>

        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 28, flexWrap: "wrap", gap: 14 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <div style={{
              width: 40, height: 40, borderRadius: 11, flexShrink: 0,
              background: "var(--gradient-brand)",
              boxShadow: "0 4px 16px -4px rgba(91,124,250,0.6), inset 0 1px 0 rgba(255,255,255,0.25)",
              display: "flex", alignItems: "center", justifyContent: "center", color: "white",
            }}>
              <Users size={19} strokeWidth={2} />
            </div>
            <div>
              <h1 style={{ fontSize: 20, fontWeight: 700, letterSpacing: "-0.02em" }}>Team Access</h1>
              <p style={{ fontSize: 12.5, color: "var(--text-muted)", marginTop: 1 }}>
                Who can sign in and what they can do{you ? <span> · signed in as <span style={{ color: "var(--text-secondary)" }}>{you}</span></span> : null}
              </p>
            </div>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <a href="/dashboard" className="btn-ghost" style={{ textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 7 }}>
              <ArrowLeft size={14} strokeWidth={2} /> Dashboard
            </a>
            <form action="/api/auth/logout" method="POST" style={{ display: "inline-flex" }}>
              <button className="btn-ghost" style={{ display: "inline-flex", alignItems: "center", gap: 7 }}>
                <LogOut size={13.5} strokeWidth={2} /> Log out
              </button>
            </form>
          </div>
        </div>

        {/* Role legend */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12, marginBottom: 20 }}>
          {(Object.keys(ROLE_META) as ("admin" | "agent" | "viewer")[]).map(r => {
            const meta = ROLE_META[r]
            const Icon = meta.icon
            return (
              <div key={r} style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 12, padding: "14px 16px", display: "flex", gap: 12, alignItems: "flex-start" }}>
                <span style={{ width: 30, height: 30, borderRadius: 8, background: `${meta.color}1c`, border: `1px solid ${meta.color}3d`, display: "inline-flex", alignItems: "center", justifyContent: "center", color: meta.color, flexShrink: 0 }}>
                  <Icon size={14} strokeWidth={2} />
                </span>
                <div>
                  <div style={{ fontSize: 13.5, fontWeight: 600 }}>{meta.label}</div>
                  <div style={{ fontSize: 11.5, color: "var(--text-muted)", marginTop: 2, lineHeight: 1.45 }}>{meta.desc}</div>
                </div>
              </div>
            )
          })}
        </div>

        {/* Add teammate */}
        <div style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 12, padding: "18px 20px", marginBottom: 20 }}>
          <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 12, display: "flex", alignItems: "center", gap: 8 }}>
            <UserPlus size={15} strokeWidth={2} style={{ color: "var(--text-secondary)" }} />
            Add a teammate
          </div>
          <form onSubmit={addEmail} style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <input
              type="email"
              required
              value={newEmail}
              onChange={(e) => setNewEmail(e.target.value)}
              placeholder="teammate@gmail.com"
              style={{ flex: "1 1 240px", height: 40 }}
            />
            <select
              value={newRole}
              onChange={(e) => setNewRole(e.target.value as "admin" | "agent" | "viewer" | "branch_manager")}
              style={{ width: 170, height: 40 }}
            >
              <option value="agent">Loan Officer</option>
              <option value="viewer">Viewer</option>
              <option value="branch_manager">Branch Manager</option>
              <option value="admin">Admin</option>
            </select>
            <select
              value={newBranch}
              onChange={(e) => setNewBranch(e.target.value)}
              style={{ width: 180, height: 40 }}
              title="Pin this teammate to a branch (optional for officers, required for branch managers)"
            >
              <option value="">All branches / HQ</option>
              {branches.map((b) => <option key={b.id} value={b.id}>{b.name} ({b.code})</option>)}
            </select>
            <button type="submit" disabled={busy} className="btn-primary" style={{ height: 40, padding: "0 22px", opacity: busy ? 0.6 : 1 }}>
              <UserPlus size={14} strokeWidth={2.2} /> Add
            </button>
          </form>
          <div style={{ fontSize: 11.5, color: "var(--text-muted)", marginTop: 10 }}>
            They sign in with Google using this exact Gmail address. You can change a role later by re-adding the same email with the new role. Pin a teammate to a branch so they only ever see that branch's data (required for Branch Managers).
          </div>
        </div>

        {/* Team list */}
        <div style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 12, overflow: "hidden" }}>
          <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--border)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div style={{ fontWeight: 600, fontSize: 14 }}>Team members</div>
            <span style={{ background: "var(--bg-secondary)", border: "1px solid var(--border)", borderRadius: 6, padding: "3px 10px", fontSize: 12, color: "var(--text-muted)" }}>
              {emails.length} {emails.length === 1 ? "person" : "people"}
            </span>
          </div>

          {loading && <SkeletonList rows={3} />}

          {!loading && emails.length === 0 && (
            <div style={{ padding: "36px 20px", textAlign: "center" }}>
              <Users size={30} strokeWidth={1.3} style={{ color: "var(--text-muted)", opacity: 0.6, marginBottom: 10 }} />
              <div style={{ fontSize: 13.5, color: "var(--text-secondary)", fontWeight: 500 }}>No teammates added yet</div>
              <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 4 }}>
                The admin email from the server config can always log in as Admin.
              </div>
            </div>
          )}

          {!loading && emails.map((e) => {
            const profile = profiles[e.email.toLowerCase()]
            return (
            <div key={e.email} style={{ display: "flex", alignItems: "center", gap: 14, padding: "14px 20px", borderBottom: "1px solid var(--border-light)" }}>
              {profile?.avatarUrl ? (
                <img src={profile.avatarUrl} alt="" style={{ width: 34, height: 34, borderRadius: "50%", flexShrink: 0 }} />
              ) : (
                <div style={{
                  width: 34, height: 34, borderRadius: "50%", flexShrink: 0,
                  background: "var(--gradient-brand)", display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: 11.5, fontWeight: 700, color: "white",
                }}>
                  {e.email.slice(0, 2).toUpperCase()}
                </div>
              )}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13.5, fontWeight: 550, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {profile?.displayName || e.email}{e.email === you && <span style={{ color: "var(--text-muted)", fontWeight: 400 }}> (you)</span>}
                </div>
                <div style={{ fontSize: 11.5, color: "var(--text-muted)", marginTop: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {profile?.displayName ? e.email : `Added by ${e.added_by || "—"}`}
                </div>
                {(profile?.phone || profile?.address || profile?.age != null) && (
                  <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {[profile?.phone, profile?.address, profile?.age != null ? `${profile.age} yrs` : null].filter(Boolean).join(" · ")}
                  </div>
                )}
              </div>
              <RoleBadge role={e.role} />
              {e.branch_name && (
                <span style={{ fontSize: 11, fontWeight: 600, color: "var(--text-muted)", border: "1px solid var(--border)", borderRadius: 6, padding: "3px 8px", whiteSpace: "nowrap" }}>
                  {e.branch_name}
                </span>
              )}
              {confirmTarget === e.email ? (
                <div style={{ display: "flex", gap: 6 }}>
                  <button
                    onClick={() => removeEmail(e.email)}
                    disabled={busy}
                    style={{ background: "rgba(251,86,112,0.14)", border: "1px solid rgba(251,86,112,0.4)", color: "var(--accent-red)", borderRadius: 8, padding: "6px 12px", fontSize: 12, fontWeight: 600 }}
                  >
                    Confirm remove
                  </button>
                  <button
                    onClick={() => setConfirmTarget(null)}
                    style={{ background: "transparent", border: "1px solid var(--border)", color: "var(--text-secondary)", borderRadius: 8, padding: "6px 12px", fontSize: 12 }}
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => setConfirmTarget(e.email)}
                  disabled={busy || e.email === you}
                  title={e.email === you ? "You cannot remove yourself" : "Remove access"}
                  aria-label={`Remove ${e.email}`}
                  style={{
                    background: "transparent", border: "1px solid var(--border)", borderRadius: 8,
                    width: 32, height: 32, display: "inline-flex", alignItems: "center", justifyContent: "center",
                    color: e.email === you ? "var(--border)" : "var(--text-muted)",
                    cursor: e.email === you ? "not-allowed" : "pointer", flexShrink: 0,
                  }}
                  onMouseEnter={ev => { if (e.email !== you) { ev.currentTarget.style.color = "var(--accent-red)"; ev.currentTarget.style.borderColor = "rgba(251,86,112,0.4)" } }}
                  onMouseLeave={ev => { ev.currentTarget.style.color = e.email === you ? "var(--border)" : "var(--text-muted)"; ev.currentTarget.style.borderColor = "var(--border)" }}
                >
                  <Trash2 size={14} strokeWidth={1.9} />
                </button>
              )}
            </div>
          )})}
        </div>
      </div>
    </main>
  )
}

export default function AccessPage() {
  return (
    <ToastProvider>
      <AccessPageInner />
    </ToastProvider>
  )
}
