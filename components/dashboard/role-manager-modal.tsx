"use client"

import { useState } from "react"
import { X, Plus, Trash2, Shield, UserCog, Eye, Building2, Palette, Layers, ChevronDown, ChevronUp } from "lucide-react"
import { useToast } from "@/components/ui/toast"
import { ModulePicker, ALL_MODULES } from "./module-picker"

export type RoleDefinition = {
  id: string
  label: string
  desc: string
  color: string
  baseRole: "admin" | "agent" | "viewer" | "branch_manager"
  isDefault?: boolean
  defaultModules?: string[]
}

const COLOR_PALETTE = [
  { name: "Cyan", value: "var(--accent-cyan)" },
  { name: "Blue", value: "var(--accent-blue)" },
  { name: "Violet", value: "var(--accent-violet)" },
  { name: "Green", value: "var(--accent-green)" },
  { name: "Amber", value: "var(--accent-amber)" },
  { name: "Rose", value: "var(--accent-red)" },
]

export function RoleManagerModal({
  isOpen,
  onClose,
  roles,
  onRolesUpdated,
  isBranchManager = false,
}: {
  isOpen: boolean
  onClose: () => void
  roles: RoleDefinition[]
  onRolesUpdated: (roles: RoleDefinition[]) => void
  isBranchManager?: boolean
}) {
  const toast = useToast()
  const [roleList, setRoleList] = useState<RoleDefinition[]>(roles)
  const [newLabel, setNewLabel] = useState("")
  const [newDesc, setNewDesc] = useState("")
  const [newBaseRole, setNewBaseRole] = useState<"admin" | "agent" | "viewer" | "branch_manager">("agent")
  const [newColor, setNewColor] = useState("var(--accent-cyan)")
  const [newRoleModules, setNewRoleModules] = useState<string[] | null>(null)
  const [showAddModulePicker, setShowAddModulePicker] = useState(false)
  const [editingRoleId, setEditingRoleId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  if (!isOpen) return null

  const getIcon = (baseRole: string) => {
    switch (baseRole) {
      case "admin": return Shield
      case "branch_manager": return Building2
      case "viewer": return Eye
      default: return UserCog
    }
  }

  async function persistRoles(updated: RoleDefinition[]) {
    setSaving(true)
    try {
      const res = await fetch("/api/roles-config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ roles: updated }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || "Failed to update roles")
      setRoleList(data.roles)
      onRolesUpdated(data.roles)
      toast.success("Role configurations saved")
    } catch (err: any) {
      toast.error(err.message || "Failed to save")
    } finally {
      setSaving(false)
    }
  }

  async function handleAddRole(e: React.FormEvent) {
    e.preventDefault()
    const label = newLabel.trim()
    if (!label) return

    const id = label.toLowerCase().replace(/[^a-z0-9]+/g, "_")
    if (roleList.some(r => r.id === id || r.label.toLowerCase() === label.toLowerCase())) {
      toast.error("A role with that title already exists")
      return
    }

    const newRole: RoleDefinition = {
      id,
      label,
      desc: newDesc.trim() || `Custom ${newBaseRole} role with specialized title`,
      color: newColor,
      baseRole: newBaseRole,
      isDefault: false,
      defaultModules: newRoleModules ? newRoleModules : ALL_MODULES.map(m => m.key),
    }

    const updated = [...roleList, newRole]
    await persistRoles(updated)
    setNewLabel("")
    setNewDesc("")
    setNewColor("var(--accent-cyan)")
    setNewBaseRole("agent")
    setNewRoleModules(null)
    setShowAddModulePicker(false)
  }

  async function handleUpdateRoleModules(id: string, modules: string[]) {
    const updated = roleList.map(r => r.id === id ? { ...r, defaultModules: modules } : r)
    await persistRoles(updated)
  }

  async function handleDeleteRole(id: string) {
    const updated = roleList.filter(r => r.id !== id)
    await persistRoles(updated)
  }

  return (
    <div style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,0.65)", backdropFilter: "blur(4px)",
      display: "flex", alignItems: "center", justifyContent: "center", zIndex: 110, padding: 16,
    }}>
      <div style={{
        background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 16,
        maxWidth: 580, width: "100%", maxHeight: "90vh", display: "flex", flexDirection: "column",
        boxShadow: "0 20px 40px rgba(0,0,0,0.4)", overflow: "hidden",
      }}>
        {/* Header */}
        <div style={{ padding: "18px 22px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <h2 style={{ fontSize: 16, fontWeight: 700, margin: 0 }}>Manage Job Titles & Roles</h2>
            <p style={{ fontSize: 12, color: "var(--text-muted)", margin: "4px 0 0" }}>
              Add custom job titles to the dropdown list or delete unused ones.
            </p>
          </div>
          <button onClick={onClose} style={{ background: "transparent", border: "none", color: "var(--text-muted)", cursor: "pointer" }}>
            <X size={18} />
          </button>
        </div>

        <div style={{ padding: "20px 22px", overflowY: "auto", flex: 1, display: "flex", flexDirection: "column", gap: 20 }}>
          {/* Add New Role Form */}
          <form onSubmit={handleAddRole} style={{ background: "var(--bg-secondary)", border: "1px solid var(--border)", borderRadius: 12, padding: 16 }}>
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 12, display: "flex", alignItems: "center", gap: 7 }}>
              <Plus size={15} style={{ color: "var(--accent-cyan)" }} /> Add New Role to Dropdown
            </div>
            
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 10 }}>
              <div>
                <label style={{ fontSize: 11, fontWeight: 600, color: "var(--text-muted)", display: "block", marginBottom: 5 }}>Role / Job Title</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Senior Verification Officer"
                  value={newLabel}
                  onChange={e => setNewLabel(e.target.value)}
                  style={{ width: "100%", height: 36, fontSize: 13 }}
                />
              </div>
              <div>
                <label style={{ fontSize: 11, fontWeight: 600, color: "var(--text-muted)", display: "block", marginBottom: 5 }}>Underlying Permission Level</label>
                <select
                  value={newBaseRole}
                  onChange={e => setNewBaseRole(e.target.value as any)}
                  style={{ width: "100%", height: 36, fontSize: 13 }}
                >
                  <option value="agent">Loan Officer (Operative)</option>
                  <option value="viewer">Viewer (Read-Only)</option>
                  {!isBranchManager && <option value="branch_manager">Branch Manager (Branch)</option>}
                  {!isBranchManager && <option value="admin">Admin (Full System)</option>}
                </select>
              </div>
            </div>

            <div style={{ marginBottom: 10 }}>
              <label style={{ fontSize: 11, fontWeight: 600, color: "var(--text-muted)", display: "block", marginBottom: 5 }}>Description / Responsibility</label>
              <input
                type="text"
                placeholder="e.g. Handles KYC and document verification for leads"
                value={newDesc}
                onChange={e => setNewDesc(e.target.value)}
                style={{ width: "100%", height: 36, fontSize: 13 }}
              />
            </div>

            {/* Allotted Modules Toggle for Role */}
            <div style={{ marginBottom: 12 }}>
              <button
                type="button"
                onClick={() => setShowAddModulePicker(!showAddModulePicker)}
                style={{
                  background: "transparent", border: "none", color: "var(--accent-cyan)",
                  fontSize: 11.5, fontWeight: 600, cursor: "pointer", display: "inline-flex",
                  alignItems: "center", gap: 5, padding: "2px 0",
                }}
              >
                <Layers size={13} />
                {showAddModulePicker ? "Hide Allotted Modules" : "Allot Specific Modules to this Role"}
                <span style={{ fontSize: 10.5, background: "rgba(56,189,248,0.15)", padding: "1px 6px", borderRadius: 8 }}>
                  {(newRoleModules?.length ?? ALL_MODULES.length)} / {ALL_MODULES.length} Modules
                </span>
              </button>

              {showAddModulePicker && (
                <div style={{ marginTop: 8 }}>
                  <ModulePicker
                    selectedKeys={newRoleModules}
                    onChange={(keys) => setNewRoleModules(keys)}
                  />
                </div>
              )}
            </div>

            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 12 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{ fontSize: 11, fontWeight: 600, color: "var(--text-muted)", marginRight: 4 }}>Badge Color:</span>
                {COLOR_PALETTE.map(c => (
                  <button
                    key={c.value}
                    type="button"
                    onClick={() => setNewColor(c.value)}
                    style={{
                      width: 22, height: 22, borderRadius: "50%", background: c.value,
                      border: newColor === c.value ? "2px solid #fff" : "2px solid transparent",
                      cursor: "pointer", outline: "none", boxShadow: newColor === c.value ? "0 0 0 2px rgba(255,255,255,0.4)" : "none",
                    }}
                    title={c.name}
                  />
                ))}
              </div>

              <button
                type="submit"
                disabled={saving || !newLabel.trim()}
                className="btn-primary"
                style={{ height: 34, padding: "0 16px", fontSize: 12, opacity: saving ? 0.6 : 1 }}
              >
                <Plus size={14} /> Add Role
              </button>
            </div>
          </form>

          {/* Current Roles List */}
          <div>
            <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase", marginBottom: 8, letterSpacing: "0.04em" }}>
              Active Dropdown Roles ({roleList.length})
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {roleList.map(r => {
                const Icon = getIcon(r.baseRole)
                const isExpanded = editingRoleId === r.id
                const modCount = r.defaultModules ? r.defaultModules.length : ALL_MODULES.length
                return (
                  <div
                    key={r.id}
                    style={{
                      background: "var(--bg-secondary)", border: "1px solid var(--border)",
                      borderRadius: 10, padding: "10px 14px", display: "flex", flexDirection: "column", gap: 10,
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0, flex: 1 }}>
                        <span style={{
                          width: 28, height: 28, borderRadius: 7, background: `${r.color}1c`,
                          border: `1px solid ${r.color}3d`, display: "inline-flex", alignItems: "center",
                          justifyContent: "center", color: r.color, flexShrink: 0,
                        }}>
                          <Icon size={14} />
                        </span>
                        <div style={{ minWidth: 0, flex: 1 }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                            <span style={{ fontSize: 13.5, fontWeight: 600, color: "var(--text-primary)" }}>{r.label}</span>
                            <span style={{ fontSize: 11, padding: "1px 6px", borderRadius: 4, background: "rgba(255,255,255,0.06)", color: "var(--text-muted)" }}>
                              Perm: {r.baseRole}
                            </span>
                            <button
                              type="button"
                              onClick={() => setEditingRoleId(isExpanded ? null : r.id)}
                              style={{
                                background: "rgba(56,189,248,0.1)", border: "1px solid rgba(56,189,248,0.25)",
                                borderRadius: 5, padding: "1px 7px", fontSize: 11, color: "var(--accent-cyan)",
                                cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 4,
                              }}
                            >
                              <Layers size={11} /> {modCount === ALL_MODULES.length ? "All Modules Allotted" : `${modCount}/${ALL_MODULES.length} Modules`}
                              {isExpanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                            </button>
                          </div>
                          <div style={{ fontSize: 11.5, color: "var(--text-muted)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", marginTop: 2 }}>
                            {r.desc}
                          </div>
                        </div>
                      </div>

                      <div>
                        {r.isDefault ? (
                          <span style={{ fontSize: 11, color: "var(--text-muted)", padding: "4px 8px", background: "rgba(255,255,255,0.04)", borderRadius: 6 }}>
                            System Core
                          </span>
                        ) : (
                          <button
                            type="button"
                            onClick={() => handleDeleteRole(r.id)}
                            disabled={saving}
                            title={`Delete ${r.label}`}
                            style={{
                              background: "transparent", border: "1px solid var(--border)", borderRadius: 6,
                              width: 30, height: 30, display: "inline-flex", alignItems: "center", justifyContent: "center",
                              color: "var(--text-muted)", cursor: "pointer",
                            }}
                            onMouseEnter={ev => { ev.currentTarget.style.color = "var(--accent-red)"; ev.currentTarget.style.borderColor = "rgba(251,86,112,0.4)" }}
                            onMouseLeave={ev => { ev.currentTarget.style.color = "var(--text-muted)"; ev.currentTarget.style.borderColor = "var(--border)" }}
                          >
                            <Trash2 size={13} />
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Expanded Module Allotment for Role */}
                    {isExpanded && (
                      <div style={{ borderTop: "1px dashed var(--border)", paddingTop: 10, marginTop: 4 }}>
                        <ModulePicker
                          selectedKeys={r.defaultModules ?? null}
                          onChange={(keys) => handleUpdateRoleModules(r.id, keys)}
                        />
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div style={{ padding: "14px 22px", borderTop: "1px solid var(--border)", display: "flex", justifyContent: "flex-end" }}>
          <button type="button" onClick={onClose} className="btn-ghost" style={{ fontSize: 13, height: 34 }}>
            Done
          </button>
        </div>
      </div>
    </div>
  )
}
