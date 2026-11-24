import { NextRequest, NextResponse } from "next/server"
import { getSessionFromRequest } from "@/lib/auth"
import { META_TEMPLATES_CATALOG, WHATSAPP_QUICK_CHAT_TEMPLATES } from "@/lib/meta-templates"

export const dynamic = "force-dynamic"

export async function GET(req: NextRequest) {
  const session = await getSessionFromRequest(req)
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 })

  return NextResponse.json({
    ok: true,
    metaTemplates: META_TEMPLATES_CATALOG,
    quickChatTemplates: WHATSAPP_QUICK_CHAT_TEMPLATES,
  })
}
