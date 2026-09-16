"use client"
import { useEffect, useRef, useState } from "react"
import { X, Clock, Pencil, Check } from "lucide-react"
import { timeAgo, formatDateTime } from "@/lib/utils"
import { useToast } from "../ui/toast"

type Role = "admin" | "agent" | "viewer" | "developer" | "branch_manager"

type TeamMember = {
  email: string; role: Role
  displayName: string | null; avatarUrl: string | null
  lastLoginAt: string | null; memberSince: string | null
  phone?: string | null; address?: string | null; age?: number | null
}
type ActivityLog = { id: string; action: string; created_at: string }

const ROLE_LABEL: Record<Role, string> = { admin: "Administrator", agent: "Loan Officer", viewer: "Viewer", developer: "Administrator", branch_manager: "Branch Manager" }
const ROLE_COLOR: Record<Role, string> = { admin: "var(--accent-violet)", agent: "var(--accent-cyan)", viewer: "var(--text-muted)", developer: "var(--accent-violet)", branch_manager: "var(--accent-green)" }

// Keeps an uploaded photo small — a profile picture doesn't need to be
// bigger than this to look good in a 64px circle, and it keeps every
// /api/team response from ballooning with full-resolution photos.
const MAX_AVATAR_DIM = 256

function resizeImageToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    const reader = new FileReader()
    reader.onerror = () => reject(new Error("Could not read that file"))
    reader.onload = () => {
      img.onerror = () => reject(new Error("Could not read that image"))
      img.onload = () => {
        const scale = Math.min(1, MAX_AVATAR_DIM / Math.max(img.width, img.height))
        const w = Math.round(img.width * scale)
        const h = Math.round(img.height * scale)
        const canvas = document.createElement("canvas")
        canvas.width = w
        canvas.height = h
        const ctx = canvas.getContext("2d")
        if (!ctx) return reject(new Error("Canvas not supported"))
        ctx.drawImage(img, 0, 0, w, h)
        resolve(canvas.toDataURL("image/jpeg", 0.85))
      }
      img.src = String(reader.result)
    }
    reader.readAsDataURL(file)
  })
}

export default function ProfileModal({ email, role, onClose }: { email: string; role: Role; onClose: () => void }) {
  const toast = useToast()
  const [profile, setProfile] = useState<TeamMember | null>(null)
  const [activity, setActivity] = useState<ActivityLog[]>([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState({ displayName: "", phone: "", address: "", age: "", avatarUrl: "" })
  const fileInputRef = useRef<HTMLInputElement>(null)

  async function load() {
    setLoading(true)
    const [tr, ar] = await Promise.all([fetch("/api/team"), fetch("/api/team/activity")])
    if (tr.ok) {
      const team: TeamMember[] = await tr.json()
      const mine = team.find((t) => t.email.toLowerCase() === email.toLowerCase()) || null
      setProfile(mine)
      setForm({
        displayName: mine?.displayName || "",
        phone: mine?.phone || "",
        address: mine?.address || "",
        age: mine?.age != null ? String(mine.age) : "",
        avatarUrl: mine?.avatarUrl || "",
      })
    }
    if (ar.ok) setActivity(await ar.json())
    setLoading(false)
  }

  useEffect(() => { load() }, [email]) // eslint-disable-line react-hooks/exhaustive-deps

  async function handleAvatarPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ""
    if (!file) return
    if (!file.type.startsWith("image/")) {
      toast.error("Please choose an image file")
      return
    }
    try {
      const dataUrl = await resizeImageToDataUrl(file)
      setForm((f) => ({ ...f, avatarUrl: dataUrl }))
    } catch (err: any) {
      toast.error(err.message || "Could not process that image")
    }
  }

  async function save() {
    setSaving(true)
    try {
      const res = await fetch("/api/team/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          displayName: form.displayName,
          phone: form.phone,
          address: form.address,
          age: form.age === "" ? null : Number(form.age),
          avatarUrl: form.avatarUrl,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || "Could not save changes")
      toast.success("Profile updated")
      setEditing(false)
      await load()
    } catch (err: any) {
      toast.error(err.message)
    } finally {
      setSaving(false)
    }
  }

  const initials = email ? email.slice(0, 2).toUpperCase() : "?"
  const roleColor = ROLE_COLOR[role] ?? ROLE_COLOR.agent
  const avatarPreview = form.avatarUrl || profile?.avatarUrl

  return (
    <div
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.75)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }}
      onClick={onClose}
    >
      <div
        style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 16, padding: 28, width: 440, maxHeight: "85vh", overflowY: "auto" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
          {!editing ? (
            <button
              onClick={() => setEditing(true)}
              style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", display: "flex", alignItems: "center", gap: 6, fontSize: 12.5 }}
            >
              <Pencil size={13} strokeWidth={2} /> Edit
            </button>
          ) : <span />}
          <button onClick={onClose} aria-label="Close" style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", display: "flex" }}>
            <X size={19} strokeWidth={2} />
          </button>
        </div>

        {/* Identity */}
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center", marginBottom: 24 }}>
          <div style={{ position: "relative", marginBottom: 12 }}>
            {avatarPreview ? (
              <img src={avatarPreview} alt="" style={{ width: 64, height: 64, borderRadius: "50%", objectFit: "cover" }} />
            ) : (
              <div style={{
                width: 64, height: 64, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 22, fontWeight: 700, color: "#fff", background: "var(--gradient-brand)",
              }}>
                {initials}
              </div>
            )}
            {editing && (
              <button
                onClick={() => fileInputRef.current?.click()}
                title="Change photo"
                style={{
                  position: "absolute", bottom: -2, right: -2, width: 24, height: 24, borderRadius: "50%",
                  background: "var(--gradient-brand)", border: "2px solid var(--bg-card)", color: "#fff",
                  display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer",
                }}
              >
                <Pencil size={11} strokeWidth={2.2} />
              </button>
            )}
            <input ref={fileInputRef} type="file" accept="image/*" onChange={handleAvatarPick} style={{ display: "none" }} />
          </div>

          {!editing ? (
            <>
              <div style={{ fontWeight: 700, fontSize: 17 }}>{profile?.displayName || email}</div>
              <div style={{ fontSize: 13, color: "var(--text-muted)", marginTop: 2 }}>{email}</div>
            </>
          ) : (
            <>
              <input
                value={form.displayName}
                onChange={(e) => setForm((f) => ({ ...f, displayName: e.target.value }))}
                placeholder="Your name"
                style={{ width: "100%", textAlign: "center", fontWeight: 700, fontSize: 15, marginTop: 4 }}
              />
              <div style={{ fontSize: 13, color: "var(--text-muted)", marginTop: 6 }}>{email}</div>
            </>
          )}

          <span style={{
            display: "inline-flex", alignItems: "center", gap: 6, marginTop: 10,
            background: `${roleColor}1c`, border: `1px solid ${roleColor}42`, color: roleColor,
            borderRadius: 7, padding: "4px 12px", fontSize: 12, fontWeight: 600,
          }}>
            {ROLE_LABEL[role]}
          </span>
        </div>

        {/* Editable details */}
        {editing ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 20 }}>
            <div>
              <label style={{ fontSize: 11.5, color: "var(--text-muted)", display: "block", marginBottom: 4 }}>Phone number</label>
              <input value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} placeholder="+91 98765 43210" style={{ width: "100%" }} />
            </div>
            <div>
              <label style={{ fontSize: 11.5, color: "var(--text-muted)", display: "block", marginBottom: 4 }}>Address</label>
              <input value={form.address} onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))} placeholder="City, area" style={{ width: "100%" }} />
            </div>
            <div>
              <label style={{ fontSize: 11.5, color: "var(--text-muted)", display: "block", marginBottom: 4 }}>Age</label>
              <input
                type="number" min={16} max={100}
                value={form.age} onChange={(e) => setForm((f) => ({ ...f, age: e.target.value }))}
                placeholder="e.g. 28" style={{ width: "100%" }}
              />
            </div>
            <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
              <button onClick={save} disabled={saving} className="btn-primary" style={{ flex: 1, height: 36 }}>
                <Check size={14} strokeWidth={2.2} /> {saving ? "Saving…" : "Save"}
              </button>
              <button
                onClick={() => { setEditing(false); load() }}
                disabled={saving}
                className="btn-ghost"
                style={{ flex: 1, height: 36 }}
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          (profile?.phone || profile?.address || profile?.age) && (
            <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 20 }}>
              {profile?.phone && (
                <div style={{ background: "var(--bg-secondary)", borderRadius: 8, padding: 12 }}>
                  <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 2 }}>Phone</div>
                  <div style={{ fontWeight: 600, fontSize: 13 }}>{profile.phone}</div>
                </div>
              )}
              {profile?.address && (
                <div style={{ background: "var(--bg-secondary)", borderRadius: 8, padding: 12 }}>
                  <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 2 }}>Address</div>
                  <div style={{ fontWeight: 600, fontSize: 13 }}>{profile.address}</div>
                </div>
              )}
              {profile?.age != null && (
                <div style={{ background: "var(--bg-secondary)", borderRadius: 8, padding: 12 }}>
                  <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 2 }}>Age</div>
                  <div style={{ fontWeight: 600, fontSize: 13 }}>{profile.age}</div>
                </div>
              )}
            </div>
          )
        )}

        {/* Stats */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 20 }}>
          <div style={{ background: "var(--bg-secondary)", borderRadius: 8, padding: 12 }}>
            <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 4 }}>Member since</div>
            <div style={{ fontWeight: 600, fontSize: 13 }}>{profile?.memberSince ? formatDateTime(profile.memberSince) : "—"}</div>
          </div>
          <div style={{ background: "var(--bg-secondary)", borderRadius: 8, padding: 12 }}>
            <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 4 }}>Last login</div>
            <div style={{ fontWeight: 600, fontSize: 13 }}>{profile?.lastLoginAt ? `${timeAgo(profile.lastLoginAt)}` : "—"}</div>
          </div>
        </div>

        {/* Recent activity */}
        <div>
          <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 12, fontWeight: 600, letterSpacing: "0.05em" }}>RECENT ACTIVITY</div>
          {loading && <div style={{ fontSize: 13, color: "var(--text-muted)" }}>Loading…</div>}
          {!loading && activity.length === 0 && <div style={{ fontSize: 13, color: "var(--text-muted)" }}>No recent activity.</div>}
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {activity.map((a) => (
              <div key={a.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 10px", borderRadius: 8, background: "var(--overlay-soft)" }}>
                <Clock size={12} style={{ color: "var(--text-muted)", flexShrink: 0 }} />
                <div style={{ flex: 1, fontSize: 13 }}>{a.action}</div>
                <div style={{ fontSize: 11, color: "var(--text-muted)", flexShrink: 0 }}>{timeAgo(a.created_at)}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
