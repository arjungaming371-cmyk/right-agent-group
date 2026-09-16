"use client"

// Team Access — admin-only page to add/remove teammates, allot branches, and name them.
// Styled to match the operations console design system.

import { useCallback, useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { ArrowLeft, LogOut, Shield, UserCog, Eye, UserPlus, Users, Trash2, Building2, Pencil, Check, X } from "lucide-react"
import { ToastProvider, useToast } from "@/components/ui/toast"
import { SkeletonList } from "@/components/ui/skeleton"

type Role = "admin" | "agent" | "viewer" | "developer" | "branch_manager"
type AllowedEmail = {
  email: string
  added_by: string | null
  role: Role
  created_at: string
  branch_id?: string | null
  branch_name?: string | null
  branch_code?: string | null
  display_name?: string | null
}
type BranchOption = { id: string; name: string; code: string }

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

  // Add form state
  const [newName, setNewName] = useState("")
  const [newEmail, setNewEmail] = useState("")
  const [newRole, setNewRole] = useState<"admin" | "agent" | "viewer" | "branch_manager">("agent")
  const [newBranch, setNewBranch] = useState<string>("")
  const [busy, setBusy] = useState(false)
  const [confirmTarget, setConfirmTarget] = useState<string | null>(null)
  const [profiles, setProfiles] = useState<Record<string, { displayName: string | null; avatarUrl: string | null; phone?: string | null; address?: string | null; age?: number | null }>>({})

  // Edit modal state
  const [editingMember, setEditingMember] = useState<AllowedEmail | null>(null)
  const [editName, setEditName] = useState("")
  const [editRole, setEditRole] = useState<Role>("agent")
  const [editBranch, setEditBranch] = useState<string>("")
  const [savingEdit, setSavingEdit] = useState(false)

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
  }, [router])

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
        body: JSON.stringify({
          email,
          displayName: newName.trim() || undefined,
          role: newRole,
          branch_id: newRole === "branch_manager" ? newBranch : newBranch || undefined,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || "Failed")
      setNewEmail("")
      setNewName("")
      setNewRole("agent")
      setNewBranch("")
      toast.success(`${newName ? newName : email} added as ${ROLE_META[newRole].label}`)
      await load()
    } catch (err: any) {
      toast.error(err.message)
    } finally {
      setBusy(false)
    }
  }

  function startEdit(member: AllowedEmail) {
    const profile = profiles[member.email.toLowerCase()]
    setEditingMember(member)
    setEditName(profile?.displayName || member.display_name || "")
    setEditRole(member.role)
    setEditBranch(member.branch_id || "")
  }

  async function saveEdit(e: React.FormEvent) {
    e.preventDefault()
    if (!editingMember) return
    setSavingEdit(true)
    try {
      const res = await fetch("/api/allowed-emails", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: editingMember.email,
          displayName: editName.trim(),
          role: editRole,
          branch_id: editBranch || null,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || "Failed to update")
      toast.success("Team member details updated successfully")
      setEditingMember(null)
      await load()
    } catch (err: any) {
      toast.error(err.message)
    } finally {
      setSavingEdit(false)
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
      <div style={{ maxWidth: 880, margin: "0 auto", padding: "36px 0 80px" }}>

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
              <h1 style={{ fontSize: 20, fontWeight: 700, letterSpacing: "-0.02em" }}>Team Access & Branch Allotment</h1>
              <p style={{ fontSize: 12.5, color: "var(--text-muted)", marginTop: 1 }}>
                Allot branches to staff, name team members, and customize permissions{you ? <span> · signed in as <span style={{ color: "var(--text-secondary)" }}>{you}</span></span> : null}
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
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12, marginBottom: 20 }}>
          {(Object.keys(ROLE_META) as ("admin" | "agent" | "viewer" | "branch_manager")[]).map(r => {
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
            Add Teammate & Allot Branch
          </div>
          <form onSubmit={addEmail} style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Full Name (e.g. Ramesh Kumar)"
              style={{ flex: "1 1 180px", height: 40 }}
            />
            <input
              type="email"
              required
              value={newEmail}
              onChange={(e) => setNewEmail(e.target.value)}
              placeholder="teammate@gmail.com"
              style={{ flex: "1 1 200px", height: 40 }}
            />
            <select
              value={newRole}
              onChange={(e) => setNewRole(e.target.value as "admin" | "agent" | "viewer" | "branch_manager")}
              style={{ width: 160, height: 40 }}
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
              title="Allot a branch to this teammate"
            >
              <option value="">All Branches / HQ</option>
              {branches.map((b) => <option key={b.id} value={b.id}>{b.name} ({b.code})</option>)}
            </select>
            <button type="submit" disabled={busy} className="btn-primary" style={{ height: 40, padding: "0 22px", opacity: busy ? 0.6 : 1 }}>
              <UserPlus size={14} strokeWidth={2.2} /> Add +
            </button>
          </form>
          <div style={{ fontSize: 11.5, color: "var(--text-muted)", marginTop: 10 }}>
            Set their name as required, assign their role, and allot them to a specific branch so they only manage leads and calls for that branch.
          </div>
        </div>

        {/* Team list */}
        <div style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 12, overflow: "hidden" }}>
          <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--border)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div style={{ fontWeight: 600, fontSize: 14 }}>Team Members & Branch Allotments</div>
            <span style={{ background: "var(--bg-secondary)", border: "1px solid var(--border)", borderRadius: 6, padding: "3px 10px", fontSize: 12, color: "var(--text-muted)" }}>
              {emails.length} {emails.length === 1 ? "person" : "people"}
            </span>
          </div>

          {loading && <SkeletonList rows={3} />}

          {!loading && emails.length === 0 && (
            <div style={{ padding: "36px 20px", textAlign: "center" }}>
              <Users size={30} strokeWidth={1.3} style={{ color: "var(--text-muted)", opacity: 0.6, marginBottom: 10 }} />
              <div style={{ fontSize: 13.5, color: "var(--text-secondary)", fontWeight: 500 }}>No teammates added yet</div>
            </div>
          )}

          {!loading && emails.map((e) => {
            const profile = profiles[e.email.toLowerCase()]
            const displayName = profile?.displayName || e.display_name
            return (
            <div key={e.email} style={{ display: "flex", alignItems: "center", gap: 14, padding: "14px 20px", borderBottom: "1px solid var(--border-light)" }}>
              {profile?.avatarUrl ? (
                <img src={profile.avatarUrl} alt="" style={{ width: 36, height: 36, borderRadius: "50%", flexShrink: 0 }} />
              ) : (
                <div style={{
                  width: 36, height: 36, borderRadius: "50%", flexShrink: 0,
                  background: "var(--gradient-brand)", display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: 12, fontWeight: 700, color: "white",
                }}>
                  {(displayName ? displayName.slice(0, 2) : e.email.slice(0, 2)).toUpperCase()}
                </div>
              )}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13.5, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {displayName || e.email}{e.email === you && <span style={{ color: "var(--text-muted)", fontWeight: 400 }}> (you)</span>}
                </div>
                <div style={{ fontSize: 11.5, color: "var(--text-muted)", marginTop: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {displayName ? e.email : `Added by ${e.added_by || "—"}`}
                </div>
              </div>

              {/* Allotted branch badge */}
              <div style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "3px 9px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--bg-secondary)", fontSize: 11.5, color: "var(--text-secondary)" }}>
                <Building2 size={12} strokeWidth={2} style={{ color: "var(--accent-blue)" }} />
                <span>{e.branch_name ? `${e.branch_name} (${e.branch_code})` : "All Branches (HQ)"}</span>
              </div>

              <RoleBadge role={e.role} />

              <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                {/* Edit member button */}
                <button
                  onClick={() => startEdit(e)}
                  title="Edit name, role, or allotted branch"
                  style={{
                    background: "transparent", border: "1px solid var(--border)", borderRadius: 8,
                    width: 32, height: 32, display: "inline-flex", alignItems: "center", justifyContent: "center",
                    color: "var(--text-secondary)", cursor: "pointer", flexShrink: 0,
                  }}
                  onMouseEnter={ev => { ev.currentTarget.style.color = "var(--accent-violet)"; ev.currentTarget.style.borderColor = "var(--accent-violet)" }}
                  onMouseLeave={ev => { ev.currentTarget.style.color = "var(--text-secondary)"; ev.currentTarget.style.borderColor = "var(--border)" }}
                >
                  <Pencil size={13.5} strokeWidth={2} />
                </button>

                {confirmTarget === e.email ? (
                  <div style={{ display: "flex", gap: 6 }}>
                    <button
                      onClick={() => removeEmail(e.email)}
                      disabled={busy}
                      style={{ background: "rgba(251,86,112,0.14)", border: "1px solid rgba(251,86,112,0.4)", color: "var(--accent-red)", borderRadius: 8, padding: "6px 12px", fontSize: 12, fontWeight: 600 }}
                    >
                      Confirm
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
                    <Trash2 size={13.5} strokeWidth={1.9} />
                  </button>
                )}
              </div>
            </div>
          )})}
        </div>
      </div>

      {/* Edit Teammate Modal */}
      {editingMember && (
        <div style={{
          position: "fixed", inset: 0, background: "rgba(0,0,0,0.65)", backdropFilter: "blur(4px)",
          display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100, padding: 16,
        }}>
          <div style={{
            background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 16,
            maxWidth: 480, width: "100%", padding: 24, boxShadow: "0 20px 40px rgba(0,0,0,0.4)",
          }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 18 }}>
              <div style={{ fontSize: 16, fontWeight: 700 }}>Edit Teammate & Branch</div>
              <button onClick={() => setEditingMember(null)} style={{ background: "transparent", border: "none", color: "var(--text-muted)", cursor: "pointer" }}>
                <X size={18} />
              </button>
            </div>

            <form onSubmit={saveEdit} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <div>
                <label style={{ fontSize: 11, fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase", display: "block", marginBottom: 6 }}>
                  Email Address
                </label>
                <input
                  disabled
                  value={editingMember.email}
                  style={{ width: "100%", height: 38, opacity: 0.7, cursor: "not-allowed" }}
                />
              </div>

              <div>
                <label style={{ fontSize: 11, fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase", display: "block", marginBottom: 6 }}>
                  Custom Name / Title
                </label>
                <input
                  type="text"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  placeholder="e.g. Ramesh Kumar (Senior Loan Manager)"
                  style={{ width: "100%", height: 38 }}
                />
              </div>

              <div>
                <label style={{ fontSize: 11, fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase", display: "block", marginBottom: 6 }}>
                  Role & Permissions
                </label>
                <select
                  value={editRole}
                  onChange={(e) => setEditRole(e.target.value as Role)}
                  style={{ width: "100%", height: 38 }}
                >
                  <option value="agent">Loan Officer</option>
                  <option value="viewer">Viewer</option>
                  <option value="branch_manager">Branch Manager</option>
                  <option value="admin">Admin</option>
                </select>
              </div>

              <div>
                <label style={{ fontSize: 11, fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase", display: "block", marginBottom: 6 }}>
                  Allotted Branch
                </label>
                <select
                  value={editBranch}
                  onChange={(e) => setEditBranch(e.target.value)}
                  style={{ width: "100%", height: 38 }}
                >
                  <option value="">All Branches / HQ Access</option>
                  {branches.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name} ({b.code})
                    </option>
                  ))}
                </select>
                <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4 }}>
                  Pinning an officer or manager to a branch scopes all leads, calls, WhatsApp, and loan applications to that branch.
                </div>
              </div>

              <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 10 }}>
                <button
                  type="button"
                  onClick={() => setEditingMember(null)}
                  className="btn-ghost"
                  style={{ height: 38, padding: "0 16px" }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingEdit}
                  className="btn-primary"
                  style={{ height: 38, padding: "0 20px", opacity: savingEdit ? 0.7 : 1 }}
                >
                  {savingEdit ? "Saving..." : "Save Changes"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
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
