import { NextResponse } from "next/server"
import { checkWhatsAppHealth } from "@/lib/whatsapp"

export const dynamic = "force-dynamic"

async function checkOllama(): Promise<boolean> {
  try {
    const url = process.env.OLLAMA_URL || "http://localhost:11434"
    const res = await fetch(`${url}/api/tags`, { signal: AbortSignal.timeout(2000) })
    return res.ok
  } catch { return false }
}

export async function GET() {
  const [waHealth, ollama] = await Promise.all([checkWhatsAppHealth(), checkOllama()])

  return NextResponse.json({
    whatsapp: { running: waHealth.ok, connected: waHealth.ok },
    ollama:   { running: ollama },
    website:  { running: true },
  })
}
