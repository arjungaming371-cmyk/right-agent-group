import { NextRequest, NextResponse } from "next/server"
import { query } from "@/lib/db"
import { getSessionFromRequest, requireRole } from "@/lib/auth"
import { apiError } from "@/lib/api-error"

export const dynamic = "force-dynamic"

type RoleDefinition = {
  id: string
  label: string
  desc: string
  color: string
  baseRole: "admin" | "agent" | "viewer" | "branch_manager"
  isDefault?: boolean
  defaultModules?: string[]
}

const ALL_MODULES_LIST = ["analytics", "leads", "loans", "voice", "whatsapp", "comms", "security", "upload", "script", "knowledge"]
const OPERATIONAL_MODULES = ["analytics", "leads", "loans", "voice", "whatsapp", "comms", "knowledge"]

const DEFAULT_ROLES: RoleDefinition[] = [
  {
    id: "admin",
    label: "Admin",
    desc: "Full access, including team access & system settings. Max 2 admins total.",
    color: "var(--accent-violet)",
    baseRole: "admin",
    isDefault: true,
    defaultModules: ALL_MODULES_LIST,
  },
  {
    id: "agent",
    label: "Loan Officer",
    desc: "Leads, loans, calls, WhatsApp, analytics — operational permissions.",
    color: "var(--accent-cyan)",
    baseRole: "agent",
    isDefault: true,
    defaultModules: OPERATIONAL_MODULES,
  },
  {
    id: "viewer",
    label: "Viewer",
    desc: "Same views as Loan Officer, strictly read-only.",
    color: "var(--text-muted)",
    baseRole: "viewer",
    isDefault: true,
    defaultModules: OPERATIONAL_MODULES,
  },
  {
    id: "branch_manager",
    label: "Branch Manager",
    desc: "Runs ONE branch — sees only that branch's data and operations.",
    color: "var(--accent-green)",
    baseRole: "branch_manager",
    isDefault: true,
    defaultModules: OPERATIONAL_MODULES,
  },
  {
    id: "branch_admin",
    label: "Branch Admin",
    desc: "Administers branch operations, team allotments, and leads for a specific branch.",
    color: "var(--accent-blue)",
    baseRole: "branch_manager",
    isDefault: true,
    defaultModules: OPERATIONAL_MODULES,
  },
]

export async function GET(req: NextRequest) {
  // FIX (2026-09-20): GET had no in-route auth (middleware-only) — POST does.
  const session = await getSessionFromRequest(req)
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  try {
    const res = await query(`SELECT config FROM form_configs WHERE id = 'custom_roles_config'`)
    if (res.rowCount && res.rows[0]?.config?.roles) {
      return NextResponse.json({ roles: res.rows[0].config.roles })
    }
  } catch {}
  return NextResponse.json({ roles: DEFAULT_ROLES })
}

export async function POST(req: NextRequest) {
  // FIX (2026-09-20): this config is ORG-GLOBAL (one custom_roles_config row
  // for every branch). A branch manager rewriting it changes role definitions
  // and module access for ALL branches — a privilege-escalation surface.
  // Only admin/developer, the same roles that manage teammates org-wide.
  const session = await requireRole(req, ["admin", "developer"])
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
      defaultModules: Array.isArray(r.defaultModules) ? r.defaultModules.map((m: any) => String(m)) : undefined,
    })).filter(r => r.id && r.label)

    if (session.role === "branch_manager") {
      for (const r of cleanRoles) {
        if (r.baseRole === "admin" || (r as any).baseRole === "developer") {
          return NextResponse.json({ error: "Branch managers cannot create or edit Admin roles." }, { status: 403 })
        }
      }
    }

    await query(
      `INSERT INTO form_configs (id, config, updated_at)
       VALUES ('custom_roles_config', $1, now())
       ON CONFLICT (id) DO UPDATE SET config = $1, updated_at = now()`,
      [JSON.stringify({ roles: cleanRoles })]
    )

    return NextResponse.json({ ok: true, roles: cleanRoles })
  } catch (e: any) {
    return apiError(e)
  }
}
