import { NextRequest, NextResponse } from "next/server"
import { getSessionFromRequest } from "@/lib/auth"
import { META_TEMPLATES_CATALOG, WHATSAPP_QUICK_CHAT_TEMPLATES } from "@/lib/meta-templates"

export const dynamic = "force-dynamic"

export async function GET(req: NextRequest) {
  const session = await getSessionFromRequest(req)
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 })

  const liveStatuses: Record<string, { status: string; category?: string; languages: string[] }> = {}
  const token = process.env.WHATSAPP_TOKEN
  const wabaId = process.env.WHATSAPP_WABA_ID || "1567889064810160"

  if (token && wabaId) {
    try {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), 3500)
      const res = await fetch(
        `https://graph.facebook.com/v21.0/${wabaId}/message_templates?limit=50`,
        { headers: { Authorization: `Bearer ${token}` }, signal: controller.signal }
      )
      clearTimeout(timer)
      if (res.ok) {
        const data: any = await res.json().catch(() => ({}))
        for (const t of data?.data || []) {
          const name = String(t.name || "")
          if (!name) continue
          const st = String(t.status || "").toUpperCase()
          const lang = String(t.language || "")
          const prev = liveStatuses[name]
          if (!prev) {
            liveStatuses[name] = { status: st, category: t.category, languages: lang ? [lang] : [] }
          } else {
            if (lang && !prev.languages.includes(lang)) prev.languages.push(lang)
            // Prefer APPROVED over PENDING if any language is approved
            if (st === "APPROVED") prev.status = "APPROVED"
          }
        }
      }
    } catch {
      // Non-fatal: fall back to catalog without live status
    }
  }

  return NextResponse.json({
    ok: true,
    metaTemplates: META_TEMPLATES_CATALOG,
    quickChatTemplates: WHATSAPP_QUICK_CHAT_TEMPLATES,
    liveStatuses,
  })
}
