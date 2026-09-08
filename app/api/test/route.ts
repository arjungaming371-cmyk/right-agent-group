import { NextResponse } from "next/server"
import { requireRole } from "@/lib/auth"
import { checkLLMHealth } from "@/lib/llm"
import { checkDbHealth } from "@/lib/db"
import { checkTtsHealth } from "@/lib/tts"

export async function GET(req: Request) {
  // This route dumps the whole config surface (PG host/db, Exotel SID, env-var
  // presence, row counts, raw provider errors) — admin eyes only. It still
  // sits behind the session middleware; this is the defense-in-depth re-check
  // every route in this app applies to itself.
  const session = await requireRole(req, ["admin"])
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 })

  const results: Record<string, string> = {}

  results.PG_HOST       = process.env.PG_HOST       ?? "❌ NOT SET"
  results.PG_DATABASE   = process.env.PG_DATABASE   ?? "❌ NOT SET"
  results.GROQ_API_KEY  = process.env.GROQ_API_KEY ? "✅ set" : "❌ NOT SET (AI brain will fail)"
  results.GROQ_MODEL    = process.env.GROQ_MODEL   ?? "llama-3.3-70b-versatile (default)"
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

  // Test Groq
  const llmHealth = await checkLLMHealth()
  results.groq = llmHealth.ok ? `✅ ${llmHealth.message}` : `❌ ${llmHealth.message}`

  // Test Groq generation
  if (llmHealth.ok) {
    try {
      const { chatWithLLM } = await import("@/lib/llm")
      const reply = await chatWithLLM([{ role: "user", content: "Say: Hello I am Priya" }], "english")
      results.groq_test = `✅ Working: "${reply.slice(0, 60)}"`
    } catch (e: any) {
      results.groq_test = `❌ ${e.message}`
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
