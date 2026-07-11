import { NextResponse } from "next/server"
import { checkOllamaHealth } from "@/lib/ollama"
import { checkDbHealth } from "@/lib/db"
import { checkTtsHealth } from "@/lib/tts"

export async function GET() {
  const results: Record<string, string> = {}

  results.PG_HOST       = process.env.PG_HOST       ?? "❌ NOT SET"
  results.PG_DATABASE   = process.env.PG_DATABASE   ?? "❌ NOT SET"
  results.OLLAMA_URL    = process.env.OLLAMA_URL     ?? "❌ NOT SET"
  results.OLLAMA_MODEL  = process.env.OLLAMA_MODEL   ?? "❌ NOT SET"
  results.OLLAMA_GPU    = process.env.OLLAMA_GPU     ?? "false"
  results.CALL_PROVIDER = "exotel"
  results.EXOTEL_SID    = process.env.EXOTEL_SID ? "✅ set" : "❌ NOT SET"
  results.EXOTEL_CALLER = process.env.EXOTEL_CALLER_ID ?? "❌ NOT SET"
  results.APP_URL       = process.env.NEXT_PUBLIC_APP_URL ?? "❌ NOT SET"
  results.EDGE_TTS      = "free Microsoft neural voices (no key needed)"
  results.STT_SERVICE   = process.env.STT_SERVICE_URL ?? "http://127.0.0.1:3003 (default)"
  results.EXOTEL_FLOW   = process.env.EXOTEL_FLOW_APP_ID ? "✅ set" : "❌ NOT SET (outbound calls will fail)"
  results.WHATSAPP_API  = process.env.WHATSAPP_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID ? "✅ Cloud API configured" : "❌ WHATSAPP_TOKEN / WHATSAPP_PHONE_NUMBER_ID NOT SET"
  results.INTERNAL_KEY  = process.env.WHATSAPP_SERVICE_KEY ? "✅ key set" : "❌ WHATSAPP_SERVICE_KEY NOT SET (voicebot/STT will reject requests)"
  results.GOOGLE_LOGIN  = process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET ? "✅ set" : "❌ GOOGLE_CLIENT_ID / SECRET NOT SET (login will fail)"
  results.AUTH_SECRET   = process.env.AUTH_SECRET ? "✅ set" : "❌ NOT SET (sessions will fail)"

  // Test PostgreSQL
  const dbHealth = await checkDbHealth()
  results.postgresql = dbHealth.ok ? `✅ ${dbHealth.message}` : `❌ ${dbHealth.message}`

  // Test Ollama
  const ollamaHealth = await checkOllamaHealth()
  results.ollama = ollamaHealth.ok ? `✅ ${ollamaHealth.message}` : `❌ ${ollamaHealth.message}`

  // Test Ollama generation
  if (ollamaHealth.ok) {
    try {
      const { chatWithOllama } = await import("@/lib/ollama")
      const reply = await chatWithOllama([{ role: "user", content: "Say: Hello I am Priya" }], "english")
      results.ollama_test = `✅ Working: "${reply.slice(0, 60)}"`
    } catch (e: any) {
      results.ollama_test = `❌ ${e.message}`
    }
  }

  // Test Edge TTS
  const ttsHealth = await checkTtsHealth()
  results.tts = ttsHealth.ok ? `✅ ${ttsHealth.message}` : `❌ ${ttsHealth.message}`

  // Test DB tables
  try {
    const { db } = await import("@/lib/db")
    const { count: lc } = await db.from("leads").select("*", { count: "exact", head: true })
    const { count: vc } = await db.from("voice_calls").select("*", { count: "exact", head: true })
    const { count: la } = await db.from("loan_applications").select("*", { count: "exact", head: true })
    const { count: fl } = await db.from("form_links").select("*", { count: "exact", head: true })
    results.db_leads            = `✅ ${lc} leads`
    results.db_voice_calls      = `✅ ${vc} calls`
    results.db_loan_applications= `✅ ${la} applications`
    results.db_form_links       = `✅ ${fl} form links`
  } catch (e: any) {
    results.db_tables = `❌ ${e.message} — run: npm run db:setup (or psql -f local-setup.sql)`
  }

  return NextResponse.json(results, { status: 200 })
}
