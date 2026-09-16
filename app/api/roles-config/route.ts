import { NextRequest, NextResponse } from "next/server"
import { query } from "@/lib/db"
import { requireRole } from "@/lib/auth"

export const dynamic = "force-dynamic"

type RoleDefinition = {
  id: string
  label: string
  desc: string
  color: string
  baseRole: "admin" | "agent" | "viewer" | "branch_manager"
  isDefault?: boolean
}

const DEFAULT_ROLES: RoleDefinition[] = [
  {
    id: "admin",
    label: "Admin",
    desc: "Full access, including team access & system settings. Max 2 admins total.",
    color: "var(--accent-violet)",
    baseRole: "admin",
    isDefault: true,
  },
  {
    id: "agent",
    label: "Loan Officer",
    desc: "Leads, loans, calls, WhatsApp, analytics — operational permissions.",
    color: "var(--accent-cyan)",
    baseRole: "agent",
    isDefault: true,
  },
  {
    id: "viewer",
    label: "Viewer",
    desc: "Same views as Loan Officer, strictly read-only.",
    color: "var(--text-muted)",
    baseRole: "viewer",
    isDefault: true,
  },
  {
    id: "branch_manager",
    label: "Branch Manager",
    desc: "Runs ONE branch — sees only that branch's data and operations.",
    color: "var(--accent-green)",
    baseRole: "branch_manager",
    isDefault: true,
  },
  {
    id: "branch_admin",
    label: "Branch Admin",
    desc: "Administers branch operations, team allotments, and leads for a specific branch.",
    color: "var(--accent-blue)",
    baseRole: "branch_manager",
    isDefault: true,
  },
]

export async function GET() {
  try {
    const res = await query(`SELECT config FROM form_configs WHERE id = 'custom_roles_config'`)
    if (res.rowCount && res.rows[0]?.config?.roles) {
      return NextResponse.json({ roles: res.rows[0].config.roles })
    }
  } catch {}
  return NextResponse.json({ roles: DEFAULT_ROLES })
}

export async function POST(req: NextRequest) {
  const session = await requireRole(req, ["admin", "branch_manager"])
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 })

  try {
    const body = await req.json()
    const roles: RoleDefinition[] = Array.isArray(body?.roles) ? body.roles : []

    // Validate that at least the 4 core roles or valid items are retained
    if (!roles || roles.length === 0) {
      return NextResponse.json({ error: "Roles list cannot be empty" }, { status: 400 })
    }

    const cleanRoles = roles.map((r: any) => ({
      id: String(r.id || "").trim().toLowerCase().replace(/\s+/g, "_"),
      label: String(r.label || "").trim(),
      desc: String(r.desc || "").trim(),
      color: String(r.color || "var(--accent-cyan)").trim(),
      baseRole: ["admin", "agent", "viewer", "branch_manager"].includes(r.baseRole) ? r.baseRole : "agent",
      isDefault: !!r.isDefault,
    })).filter(r => r.id && r.label)

    await query(
      `INSERT INTO form_configs (id, config, updated_at)
       VALUES ('custom_roles_config', $1, now())
       ON CONFLICT (id) DO UPDATE SET config = $1, updated_at = now()`,
      [JSON.stringify({ roles: cleanRoles })]
    )

    return NextResponse.json({ ok: true, roles: cleanRoles })
  } catch (e: any) {
    return NextResponse.json({ error: e.message || "Failed to save roles" }, { status: 500 })
  }
}
