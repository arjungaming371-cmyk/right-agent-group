"use client"

import { useState } from "react"
import { X, Plus, Trash2, Building2 } from "lucide-react"
import { useToast } from "@/components/ui/toast"

export type BranchOption = { id: string; name: string; code: string; region?: string | null }

export function BranchManagerModal({
  isOpen,
  onClose,
  branches,
  onBranchesUpdated,
}: {
  isOpen: boolean
  onClose: () => void
  branches: BranchOption[]
  onBranchesUpdated: () => void
}) {
  const toast = useToast()
  const [name, setName] = useState("")
  const [code, setCode] = useState("")
  const [region, setRegion] = useState("")
  const [saving, setSaving] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  if (!isOpen) return null

  async function handleAddBranch(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim() || !code.trim()) return

    setSaving(true)
    try {
      const res = await fetch("/api/branches", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          code: code.trim().toUpperCase(),
          region: region.trim() || null,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || "Failed to create branch")
      toast.success(`Branch ${data.name} (${data.code}) created successfully`)
      setName("")
      setCode("")
      setRegion("")
      onBranchesUpdated()
    } catch (err: any) {
      toast.error(err.message || "Failed to create branch")
    } finally {
      setSaving(false)
    }
  }

  async function handleDeleteBranch(id: string, branchName: string) {
    setDeletingId(id)
    try {
      const res = await fetch(`/api/branches/${id}`, {
        method: "DELETE",
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || "Failed to delete branch")
      toast.success(`Branch ${branchName} removed`)
      onBranchesUpdated()
    } catch (err: any) {
      toast.error(err.message || "Failed to delete branch")
    } finally {
      setDeletingId(null)
    }
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
            <h2 style={{ fontSize: 16, fontWeight: 700, margin: 0 }}>Manage Branches</h2>
            <p style={{ fontSize: 12, color: "var(--text-muted)", margin: "4px 0 0" }}>
              Add new branch locations or remove existing branches from the system.
            </p>
          </div>
          <button onClick={onClose} style={{ background: "transparent", border: "none", color: "var(--text-muted)", cursor: "pointer" }}>
            <X size={18} />
          </button>
        </div>

        <div style={{ padding: "20px 22px", overflowY: "auto", flex: 1, display: "flex", flexDirection: "column", gap: 20 }}>
          {/* Add New Branch Form */}
          <form onSubmit={handleAddBranch} style={{ background: "var(--bg-secondary)", border: "1px solid var(--border)", borderRadius: 12, padding: 16 }}>
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 12, display: "flex", alignItems: "center", gap: 7 }}>
              <Plus size={15} style={{ color: "var(--accent-green)" }} /> Add New Branch
            </div>
            
            <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 10, marginBottom: 10 }}>
              <div>
                <label style={{ fontSize: 11, fontWeight: 600, color: "var(--text-muted)", display: "block", marginBottom: 5 }}>Branch Name</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Mumbai Andheri Branch"
                  value={name}
                  onChange={e => setName(e.target.value)}
                  style={{ width: "100%", height: 36, fontSize: 13 }}
                />
              </div>
              <div>
                <label style={{ fontSize: 11, fontWeight: 600, color: "var(--text-muted)", display: "block", marginBottom: 5 }}>Branch Code</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. MUM"
                  value={code}
                  onChange={e => setCode(e.target.value.toUpperCase())}
                  style={{ width: "100%", height: 36, fontSize: 13 }}
                />
              </div>
            </div>

            <div style={{ display: "flex", gap: 10, alignItems: "flex-end" }}>
              <div style={{ flex: 1 }}>
                <label style={{ fontSize: 11, fontWeight: 600, color: "var(--text-muted)", display: "block", marginBottom: 5 }}>Region / City (Optional)</label>
                <input
                  type="text"
                  placeholder="e.g. Western Maharashtra"
                  value={region}
                  onChange={e => setRegion(e.target.value)}
                  style={{ width: "100%", height: 36, fontSize: 13 }}
                />
              </div>

              <button
                type="submit"
                disabled={saving || !name.trim() || !code.trim()}
                className="btn-primary"
                style={{ height: 36, padding: "0 18px", fontSize: 12, opacity: saving ? 0.6 : 1 }}
              >
                <Plus size={14} /> Add Branch
              </button>
            </div>
          </form>

          {/* Current Branches List */}
          <div>
            <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase", marginBottom: 8, letterSpacing: "0.04em" }}>
              Registered Branches ({branches.length})
            </div>
            {branches.length === 0 ? (
              <div style={{ padding: 20, textAlign: "center", color: "var(--text-muted)", fontSize: 13 }}>
                No branches registered yet. Add one above!
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {branches.map(b => (
                  <div
                    key={b.id}
                    style={{
                      background: "var(--bg-secondary)", border: "1px solid var(--border)",
                      borderRadius: 10, padding: "10px 14px", display: "flex", alignItems: "center",
                      justifyContent: "space-between", gap: 12,
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0, flex: 1 }}>
                      <span style={{
                        width: 28, height: 28, borderRadius: 7, background: "rgba(52, 211, 153, 0.12)",
                        border: "1px solid rgba(52, 211, 153, 0.3)", display: "inline-flex", alignItems: "center",
                        justifyContent: "center", color: "var(--accent-green)", flexShrink: 0,
                      }}>
                        <Building2 size={14} />
                      </span>
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <span style={{ fontSize: 13.5, fontWeight: 600, color: "var(--text-primary)" }}>{b.name}</span>
                          <span style={{ fontSize: 11, padding: "1px 6px", borderRadius: 4, background: "rgba(255,255,255,0.06)", color: "var(--text-secondary)", fontWeight: 600 }}>
                            {b.code}
                          </span>
                        </div>
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() => handleDeleteBranch(b.id, b.name)}
                      disabled={deletingId === b.id}
                      title={`Delete ${b.name}`}
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
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div style={{ padding: "14px 22px", borderTop: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
          <div style={{ fontSize: 11.5, color: "var(--text-muted)" }}>
            Tip: Configure Phone Numbers (Caller ID) & WhatsApp for each branch in <strong style={{ color: "var(--text-secondary)" }}>Branches & Staff AI</strong> in the main sidebar.
          </div>
          <button type="button" onClick={onClose} className="btn-ghost" style={{ fontSize: 13, height: 34 }}>
            Done
          </button>
        </div>
      </div>
    </div>
  )
}
