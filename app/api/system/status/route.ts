import { NextResponse } from "next/server"
import { checkWhatsAppHealth } from "@/lib/whatsapp"
import { checkOllamaHealth } from "@/lib/ollama"

export const dynamic = "force-dynamic"

export async function GET() {
  const [waHealth, llmHealth] = await Promise.all([checkWhatsAppHealth(), checkOllamaHealth()])

  return NextResponse.json({
    whatsapp: { running: waHealth.ok, connected: waHealth.ok },
    ollama:   { running: llmHealth.ok, message: llmHealth.message },
    website:  { running: true },
  })
}
