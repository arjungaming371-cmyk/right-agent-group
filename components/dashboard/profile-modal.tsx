"use client"
import { useEffect, useState } from "react"
import { X, Clock } from "lucide-react"
import { timeAgo, formatDateTime } from "@/lib/utils"

type Role = "admin" | "agent" | "viewer" | "developer"

type TeamMember = {
  email: string; role: Role
  displayName: string | null; avatarUrl: string | null
  lastLoginAt: string | null; memberSince: string | null
}
type ActivityLog = { id: string; action: string; created_at: string }

const ROLE_LABEL: Record<Role, string> = { admin: "Administrator", agent: "Loan Officer", viewer: "Viewer", developer: "Administrator" }
const ROLE_COLOR: Record<Role, string> = { admin: "#8b7cff", agent: "#38bdf8", viewer: "#64708c", developer: "#8b7cff" }

export default function ProfileModal({ email, role, onClose }: { email: string; role: Role; onClose: () => void }) {
  const [profile, setProfile] = useState<TeamMember | null>(null)
  const [activity, setActivity] = useState<ActivityLog[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    (async () => {
      setLoading(true)
      const [tr, ar] = await Promise.all([fetch("/api/team"), fetch("/api/team/activity")])
      if (tr.ok) {
        const team: TeamMember[] = await tr.json()
        setProfile(team.find((t) => t.email.toLowerCase() === email.toLowerCase()) || null)
      }
      if (ar.ok) setActivity(await ar.json())
      setLoading(false)
    })()
  }, [email])

  const initials = email ? email.slice(0, 2).toUpperCase() : "?"
  const roleColor = ROLE_COLOR[role] ?? ROLE_COLOR.agent

  return (
    <div
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.75)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }}
      onClick={onClose}
    >
      <div
        style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 16, padding: 28, width: 440, maxHeight: "85vh", overflowY: "auto" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 4 }}>
          <button onClick={onClose} aria-label="Close" style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", display: "flex" }}>
            <X size={19} strokeWidth={2} />
          </button>
        </div>

        {/* Identity */}
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center", marginBottom: 24 }}>
          {profile?.avatarUrl ? (
            <img src={profile.avatarUrl} alt="" style={{ width: 64, height: 64, borderRadius: "50%", marginBottom: 12 }} />
          ) : (
            <div
              style={{
                width: 64, height: 64, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 22, fontWeight: 700, color: "#fff", marginBottom: 12, background: "var(--gradient-brand)",
              }}
            >
              {initials}
            </div>
          )}
          <div style={{ fontWeight: 700, fontSize: 17 }}>{profile?.displayName || email}</div>
          <div style={{ fontSize: 13, color: "var(--text-muted)", marginTop: 2 }}>{email}</div>
          <span style={{
            display: "inline-flex", alignItems: "center", gap: 6, marginTop: 10,
            background: `${roleColor}1c`, border: `1px solid ${roleColor}42`, color: roleColor,
            borderRadius: 7, padding: "4px 12px", fontSize: 12, fontWeight: 600,
          }}>
            {ROLE_LABEL[role]}
          </span>
        </div>

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
              <div key={a.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 10px", borderRadius: 8, background: "rgba(255,255,255,0.03)" }}>
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
