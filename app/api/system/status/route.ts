import { NextResponse } from "next/server"
import { checkWhatsAppHealth } from "@/lib/whatsapp"
import { checkLLMHealth } from "@/lib/llm"
import { checkDbHealth } from "@/lib/db"

export const dynamic = "force-dynamic"

export async function GET() {
  const [waHealth, llmHealth, dbHealth] = await Promise.all([
    checkWhatsAppHealth(),
    checkLLMHealth(),
    checkDbHealth(),
  ])

  // PUBLIC endpoint (linked from the About page) — booleans only, never the
  // health-check message strings, which can contain config/error details.
  return NextResponse.json({
    whatsapp: { running: waHealth.ok, connected: waHealth.ok },
    llm:      { running: llmHealth.ok },
    db:       { running: dbHealth.ok },
    website:  { running: true },
  })
}
