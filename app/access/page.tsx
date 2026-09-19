"use client"

// Team Access — admin-only page to add/remove teammates, allot branches, and name them.
// Styled to match the operations console design system.

import { useCallback, useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { ArrowLeft, LogOut, Shield, UserCog, Eye, UserPlus, Users, Trash2, Building2, Pencil, Check, X, SlidersHorizontal, Plus, Layers } from "lucide-react"
import { ToastProvider, useToast } from "@/components/ui/toast"
import { SkeletonList } from "@/components/ui/skeleton"
import { RoleManagerModal, type RoleDefinition } from "@/components/dashboard/role-manager-modal"
import { BranchManagerModal, type BranchOption } from "@/components/dashboard/branch-manager-modal"
import { ModulePicker, ALL_MODULES } from "@/components/dashboard/module-picker"
import { VoiceDictation } from "@/components/ui/voice-dictation"
import ThemeSwitcher from "@/components/dashboard/theme-switcher"

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
  allowed_modules?: string[] | null
}

const DEFAULT_ROLE_META: Record<string, { label: string; desc: string; color: string; icon: typeof Shield }> = {
  admin:  { label: "Admin",        desc: "Full access, including this page. Max 2 admins total.",     color: "var(--accent-violet)", icon: Shield },
  agent:  { label: "Loan Officer", desc: "Leads, loans, calls, WhatsApp, analytics — no settings",    color: "var(--accent-cyan)", icon: UserCog },
  viewer: { label: "Viewer",       desc: "Same views as Loan Officer, strictly read-only",            color: "var(--text-muted)", icon: Eye },
  branch_manager: { label: "Branch Manager", desc: "Runs ONE branch — sees only that branch's data",   color: "var(--accent-green)", icon: Building2 },
}

function RoleBadge({ role, customRole }: { role: string; customRole?: RoleDefinition }) {
  const isBuiltin = ["admin", "agent", "viewer", "developer", "branch_manager"].includes(role)
  let label = role
  let color = "var(--accent-cyan)"
  let Icon = UserCog

  if (customRole) {
    label = customRole.label
    color = customRole.color
    Icon = customRole.baseRole === "admin" ? Shield : customRole.baseRole === "branch_manager" ? Building2 : customRole.baseRole === "viewer" ? Eye : UserCog
  } else if (isBuiltin) {
    const meta = DEFAULT_ROLE_META[role] || DEFAULT_ROLE_META.agent
    label = meta.label
    color = meta.color
    Icon = meta.icon
  } else {
    label = role
    color = "var(--accent-violet)"
    Icon = UserCog
  }

  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 6,
      background: `${color}1c`, border: `1px solid ${color}42`, color: color,
      borderRadius: 7, padding: "4px 10px", fontSize: 12, fontWeight: 600,
    }}>
      <Icon size={12} strokeWidth={2.1} />
      {label}
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
  const [roles, setRoles] = useState<RoleDefinition[]>([])
  const [isRoleModalOpen, setIsRoleModalOpen] = useState(false)
  const [isBranchModalOpen, setIsBranchModalOpen] = useState(false)

  // Add form state
  const [newName, setNewName] = useState("")
  const [newEmail, setNewEmail] = useState("")
  const [newRoleTitle, setNewRoleTitle] = useState("Loan Officer")
  const [newBaseRole, setNewBaseRole] = useState<Role>("agent")
  const [newBranch, setNewBranch] = useState<string>("")
  const [newAllowedModules, setNewAllowedModules] = useState<string[] | null>(null)
  const [showAddModulePicker, setShowAddModulePicker] = useState(true)
  const [busy, setBusy] = useState(false)
  const [confirmTarget, setConfirmTarget] = useState<string | null>(null)
  const [isBranchManager, setIsBranchManager] = useState(false)
  const [profiles, setProfiles] = useState<Record<string, { displayName: string | null; avatarUrl: string | null; phone?: string | null; address?: string | null; age?: number | null }>>({})

  // Edit modal state
  const [editingMember, setEditingMember] = useState<AllowedEmail | null>(null)
  const [editName, setEditName] = useState("")
  const [editRoleTitle, setEditRoleTitle] = useState("Loan Officer")
  const [editBaseRole, setEditBaseRole] = useState<Role>("agent")
  const [editBranch, setEditBranch] = useState<string>("")
  const [editAllowedModules, setEditAllowedModules] = useState<string[] | null>(null)
  const [savingEdit, setSavingEdit] = useState(false)

  const load = useCallback(async () => {
    try {
      const [emailRes, rolesRes] = await Promise.all([
        fetch("/api/allowed-emails"),
        fetch("/api/roles-config").catch(() => null),
      ])

      if (emailRes.status === 401) {
        router.replace("/dashboard")
        return
      }
      if (!emailRes.ok) throw new Error(`HTTP ${emailRes.status}`)
      const data = await emailRes.json()
      setEmails(data.emails || [])
      setYou(data.you || "")
      setBranches(data.branches || [])
      setIsBranchManager(!!data.isBranchManager)
      if (data.isBranchManager && data.branches?.[0]?.id) {
        setNewBranch(data.branches[0].id)
      }

      if (rolesRes && rolesRes.ok) {
        const rolesData = await rolesRes.json()
        if (Array.isArray(rolesData.roles)) {
          setRoles(rolesData.roles)
        }
      }

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

    const roleTitle = newRoleTitle.trim() || "Loan Officer"
    const lowerRole = roleTitle.toLowerCase()
    const baseRole: Role = lowerRole === "admin" ? "admin" : lowerRole.includes("branch manager") ? "branch_manager" : "agent"

    let finalDisplayName = newName.trim()

    setBusy(true)
    try {
      const finalModules = newAllowedModules === null ? ALL_MODULES.map(m => m.key) : newAllowedModules
      const res = await fetch("/api/allowed-emails", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          displayName: finalDisplayName || undefined,
          role: roleTitle,
          baseRole: baseRole,
          branch_id: baseRole === "branch_manager" ? newBranch : newBranch || undefined,
          allowed_modules: finalModules,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || "Failed")
      setNewEmail("")
      setNewName("")
      setNewRoleTitle("Loan Officer")
      setNewBranch(isBranchManager && branches?.[0]?.id ? branches[0].id : "")
      setNewAllowedModules(null)
      toast.success(`${finalDisplayName ? finalDisplayName : email} added as ${roleTitle}`)
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
    setEditRoleTitle(member.role || "Loan Officer")
    setEditBranch(member.branch_id || "")
    setEditAllowedModules(member.allowed_modules ?? ALL_MODULES.map(m => m.key))
  }

  async function saveEdit(e: React.FormEvent) {
    e.preventDefault()
    if (!editingMember) return
    setSavingEdit(true)

    const roleTitle = editRoleTitle.trim() || "Loan Officer"
    const lowerRole = roleTitle.toLowerCase()
    const baseRole: Role = lowerRole === "admin" ? "admin" : lowerRole.includes("branch manager") ? "branch_manager" : "agent"

    try {
      const finalModules = editAllowedModules === null ? ALL_MODULES.map(m => m.key) : editAllowedModules
      const res = await fetch("/api/allowed-emails", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: editingMember.email,
          displayName: editName.trim(),
          role: roleTitle,
          baseRole: baseRole,
          branch_id: editBranch || null,
          allowed_modules: finalModules,
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
            <a href="/dashboard" style={{ display: "flex", alignItems: "center", textDecoration: "none" }} title="Back to Dashboard">
              <img
                src="/logo.png"
                alt="Right Agent Group"
                style={{ height: 42, width: "auto", objectFit: "contain", borderRadius: 8 }}
              />
            </a>
            <div>
              <h1 style={{ fontSize: 20, fontWeight: 700, letterSpacing: "-0.02em", color: "var(--text-primary)" }}>
                Team Access & Staff Permissions
              </h1>
              <p style={{ fontSize: 12.5, color: "var(--text-muted)", marginTop: 2 }}>
                Write custom roles, assign branches, and allot work modules
                {you ? <span> · signed in as <strong style={{ color: "var(--text-secondary)", fontWeight: 600 }}>{you}</strong></span> : null}
              </p>
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <ThemeSwitcher />
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

        {/* Add teammate */}
        <div style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 12, padding: "20px 22px", marginBottom: 24 }}>
          <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 16, display: "flex", alignItems: "center", justifyContent: "space-between", color: "var(--text-primary)", flexWrap: "wrap", gap: 10 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <UserPlus size={16} strokeWidth={2} style={{ color: "var(--accent-blue)" }} />
              Add Teammate & Allot Work
            </div>
          </div>

          <form onSubmit={addEmail} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <div style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))",
              gap: 14,
              alignItems: "end"
            }}>
              {/* Full Name */}
              <div>
                <label style={{ fontSize: 11.5, fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase", display: "block", marginBottom: 6 }}>
                  Full Name
                </label>
                <div style={{ position: "relative" }}>
                  <input
                    type="text"
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    placeholder="Full Name (e.g. Ramesh Kumar)"
                    style={{ width: "100%", height: 42, paddingRight: 38 }}
                  />
                  <div style={{ position: "absolute", right: 6, top: "50%", transform: "translateY(-50%)" }}>
                    <VoiceDictation
                      onTranscript={(t: string) => setNewName((prev) => (prev ? `${prev} ${t}` : t))}
                      size={14}
                      style={{ width: 28, height: 28, border: "none", background: "transparent" }}
                      title="Dictate name"
                    />
                  </div>
                </div>
              </div>

              {/* Email Address */}
              <div>
                <label style={{ fontSize: 11.5, fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase", display: "block", marginBottom: 6 }}>
                  Email Address
                </label>
                <input
                  type="email"
                  required
                  value={newEmail}
                  onChange={(e) => setNewEmail(e.target.value)}
                  placeholder="teammate@gmail.com"
                  style={{ width: "100%", height: 42 }}
                />
              </div>

              {/* Custom Role Name / Designation */}
              <div style={{ gridColumn: "span 1" }}>
                <label style={{ fontSize: 11.5, fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase", display: "block", marginBottom: 6 }}>
                  Role Name / Designation
                </label>
                <div style={{ position: "relative" }}>
                  <input
                    type="text"
                    required
                    value={newRoleTitle}
                    onChange={(e) => setNewRoleTitle(e.target.value)}
                    placeholder="Write custom role (e.g. Telecaller, Risk Analyst)"
                    style={{ width: "100%", height: 42, paddingRight: 38 }}
                  />
                  <div style={{ position: "absolute", right: 6, top: "50%", transform: "translateY(-50%)" }}>
                    <VoiceDictation
                      onTranscript={(t: string) => setNewRoleTitle((prev) => (prev ? `${prev} ${t}` : t))}
                      size={14}
                      style={{ width: 28, height: 28, border: "none", background: "transparent" }}
                      title="Dictate role title"
                    />
                  </div>
                </div>
              </div>

              {/* Allotted Branch (if branches exist) */}
              {branches.length > 0 && !isBranchManager && (
                <div>
                  <label style={{ fontSize: 11.5, fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase", display: "block", marginBottom: 6 }}>
                    Allotted Branch
                  </label>
                  <select
                    value={newBranch}
                    onChange={(e) => setNewBranch(e.target.value)}
                    style={{ width: "100%", height: 42 }}
                  >
                    <option value="">All Branches (HQ)</option>
                    {branches.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.name} ({b.code})
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {/* Submit Button */}
              <div>
                <button
                  type="submit"
                  disabled={busy}
                  className="btn-primary"
                  style={{
                    width: "100%",
                    height: 42,
                    padding: "0 22px",
                    opacity: busy ? 0.6 : 1,
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 8,
                    fontSize: 13,
                    fontWeight: 600,
                  }}
                >
                  <UserPlus size={15} strokeWidth={2.2} /> Add Teammate
                </button>
              </div>
            </div>



            {/* Granular Module Allotment Toggle for Add Form */}
            <div style={{ background: "var(--bg-secondary)", border: "1px solid var(--border)", borderRadius: 10, padding: "14px 16px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                <div style={{ display: "inline-flex", alignItems: "center", gap: 6, fontWeight: 600, fontSize: 13, color: "var(--text-primary)" }}>
                  <Layers size={15} style={{ color: "var(--accent-cyan)" }} />
                  Allot Work Modules & Feature Permissions
                </div>
                {newAllowedModules !== null && (
                  <span style={{ fontSize: 11, background: "rgba(56,189,248,0.15)", border: "1px solid rgba(56,189,248,0.3)", color: "var(--accent-cyan)", padding: "2px 8px", borderRadius: 10, fontWeight: 600 }}>
                    {newAllowedModules.length} / {ALL_MODULES.length} Selected
                  </span>
                )}
              </div>
              <ModulePicker
                selectedKeys={newAllowedModules}
                onChange={(keys) => setNewAllowedModules(keys)}
              />
            </div>

            <div style={{ fontSize: 11.5, color: "var(--text-muted)" }}>
              Teammates can sign in via Google or Email OTP with their assigned role and module permissions.
            </div>
          </form>
        </div>

        {/* Team list */}
        <div style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 12, overflow: "hidden" }}>
          <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--border)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div style={{ fontWeight: 600, fontSize: 14 }}>
              Team Members
            </div>
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
            const customRole = roles.find(r => r.id === e.role || r.label.toLowerCase() === (e.role || "").toLowerCase())
            const moduleCount = e.allowed_modules ? e.allowed_modules.length : ALL_MODULES.length
            return (
            <div key={e.email} style={{ display: "flex", alignItems: "center", gap: 14, padding: "14px 20px", borderBottom: "1px solid var(--border-light)", flexWrap: "wrap" }}>
              {profile?.avatarUrl ? (
                <img src={profile.avatarUrl} alt="" style={{ width: 36, height: 36, borderRadius: "50%", flexShrink: 0 }} />
              ) : (
                <div style={{
                  width: 36, height: 36, borderRadius: "50%", background: "var(--bg-secondary)",
                  border: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: 13, fontWeight: 700, color: "var(--text-secondary)", flexShrink: 0
                }}>
                  {(displayName || e.email).slice(0, 2).toUpperCase()}
                </div>
              )}

              <div style={{ flex: 1, minWidth: 200 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontWeight: 600, fontSize: 14, color: "var(--text-primary)" }}>
                    {displayName || e.email.split("@")[0]}
                  </span>
                  {e.email === you && (
                    <span style={{ fontSize: 10, background: "rgba(56,189,248,0.12)", color: "var(--accent-cyan)", border: "1px solid rgba(56,189,248,0.25)", padding: "1px 6px", borderRadius: 4, fontWeight: 600 }}>
                      YOU
                    </span>
                  )}
                </div>
                <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 2, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                  <span>{e.email}</span>
                  {e.branch_name && (
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 4, color: "var(--accent-green)", fontWeight: 500 }}>
                      <Building2 size={11} /> {e.branch_name} ({e.branch_code})
                    </span>
                  )}
                  <span style={{ color: "var(--text-muted)" }}>
                    {moduleCount} / {ALL_MODULES.length} modules allotted
                  </span>
                </div>
              </div>

              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <RoleBadge role={e.role} customRole={customRole} />

                <button
                  type="button"
                  onClick={() => startEdit(e)}
                  className="btn-ghost"
                  style={{ height: 32, padding: "0 10px", fontSize: 12, display: "inline-flex", alignItems: "center", gap: 5 }}
                  title="Edit role & permissions"
                >
                  <Pencil size={13} /> Edit
                </button>

                {confirmTarget === e.email ? (
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <button
                      onClick={() => removeEmail(e.email)}
                      disabled={busy}
                      style={{ background: "var(--accent-red)", color: "#fff", border: "none", borderRadius: 6, padding: "4px 10px", fontSize: 12, fontWeight: 600, cursor: "pointer" }}
                    >
                      Confirm
                    </button>
                    <button
                      onClick={() => setConfirmTarget(null)}
                      style={{ background: "transparent", border: "1px solid var(--border)", color: "var(--text-muted)", borderRadius: 6, padding: "4px 8px", fontSize: 12, cursor: "pointer" }}
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => setConfirmTarget(e.email)}
                    disabled={busy || e.email === you}
                    style={{
                      background: "transparent", border: "none", color: "var(--text-muted)",
                      opacity: e.email === you ? 0.3 : 0.7, cursor: e.email === you ? "not-allowed" : "pointer",
                      padding: 6, borderRadius: 6, display: "inline-flex", alignItems: "center"
                    }}
                    title={e.email === you ? "Cannot remove yourself" : "Remove team member"}
                  >
                    <Trash2 size={14} />
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
          position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", backdropFilter: "blur(4px)",
          display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: 20
        }}>
          <div style={{
            background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 14,
            maxWidth: 600, width: "100%", maxHeight: "90vh", overflowY: "auto", padding: 24, boxShadow: "0 20px 50px rgba(0,0,0,0.4)"
          }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18 }}>
              <div style={{ fontWeight: 700, fontSize: 16, color: "var(--text-primary)" }}>
                Edit Teammate & Allot Work
              </div>
              <button onClick={() => setEditingMember(null)} style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer" }}>
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
                  Full Name / Display Name
                </label>
                <div style={{ position: "relative" }}>
                  <input
                    type="text"
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    placeholder="e.g. Ramesh Kumar"
                    style={{ width: "100%", height: 38, paddingRight: 36 }}
                  />
                  <div style={{ position: "absolute", right: 6, top: "50%", transform: "translateY(-50%)" }}>
                    <VoiceDictation onTranscript={(t: string) => setEditName((prev) => (prev ? `${prev} ${t}` : t))} title="Dictate name" />
                  </div>
                </div>
              </div>

              <div>
                <label style={{ fontSize: 11, fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase", display: "block", marginBottom: 6 }}>
                  Role Name / Designation
                </label>
                <div style={{ position: "relative" }}>
                  <input
                    type="text"
                    required
                    value={editRoleTitle}
                    onChange={(e) => setEditRoleTitle(e.target.value)}
                    placeholder="Write custom role (e.g. Telecaller, Risk Analyst)"
                    style={{ width: "100%", height: 38, paddingRight: 36 }}
                  />
                  <div style={{ position: "absolute", right: 6, top: "50%", transform: "translateY(-50%)" }}>
                    <VoiceDictation onTranscript={(t: string) => setEditRoleTitle((prev) => (prev ? `${prev} ${t}` : t))} title="Dictate role title" />
                  </div>
                </div>
              </div>

              {/* Allotted Branch in Edit Modal */}
              {branches.length > 0 && !isBranchManager && (
                <div>
                  <label style={{ fontSize: 11, fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase", display: "block", marginBottom: 6 }}>
                    Allotted Branch
                  </label>
                  <select
                    value={editBranch}
                    onChange={(e) => setEditBranch(e.target.value)}
                    style={{ width: "100%", height: 38 }}
                  >
                    <option value="">All Branches (HQ)</option>
                    {branches.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.name} ({b.code})
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {/* Module Allotment Selector inside Edit Modal */}
              <div>
                <label style={{ fontSize: 11, fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase", display: "block", marginBottom: 6 }}>
                  Allotted Work Modules & Features
                </label>
                <ModulePicker
                  selectedKeys={editAllowedModules}
                  onChange={(keys) => setEditAllowedModules(keys)}
                />
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

      {/* Role Manager Modal */}
      <RoleManagerModal
        isOpen={isRoleModalOpen}
        onClose={() => setIsRoleModalOpen(false)}
        roles={roles}
        isBranchManager={isBranchManager}
        onRolesUpdated={(updated) => {
          setRoles(updated)
        }}
      />

      {/* Branch Manager Modal */}
      <BranchManagerModal
        isOpen={isBranchModalOpen}
        onClose={() => setIsBranchModalOpen(false)}
        branches={branches}
        onBranchesUpdated={() => load()}
      />
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
