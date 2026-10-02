import { NextRequest, NextResponse } from "next/server"
import { requireRole } from "@/lib/auth"
import { query } from "@/lib/db"
import { getProviderHealth } from "@/lib/provider-health"

export const dynamic = "force-dynamic"

// SYSTEM HEALTH (admin/developer) — the detailed view behind the public
// /api/system/status booleans. Shows what each dependency last did, when it
// last failed, and how the LLM/TTS fallback chain is configured — without
// ever exposing API keys or credentials.
//
// Nothing here returns secret VALUES: only "configured" / "not configured",
// live reachability, and provider health bookkeeping (short error strings).

function configured(...names: string[]): boolean {
  return names.every(n => !!process.env[n])
}

export async function GET(req: NextRequest) {
  const session = await requireRole(req, ["admin"])
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 })

  // Live checks (each guarded — a failure of one check must not fail the page).
  const [dbRes, llmRes] = await Promise.all([
    query(`SELECT now() AS ts, pg_size_pretty(pg_database_size(current_database())) AS db_size`).then(r => ({
      ok: true, ts: r.rows[0]?.ts, dbSize: r.rows[0]?.db_size,
    })).catch((e: any) => ({ ok: false, error: String(e?.message || "").slice(0, 200) })),
    // LLM reachability: the shared health probe (same one the status pill uses).
    import("@/lib/llm").then(m => (m.checkLLMHealth ? m.checkLLMHealth() : Promise.resolve({ ok: true })))
      .then(r => ({ ok: !!(r as any)?.ok }))
      .catch(() => ({ ok: false })),
  ])

  let wa = { ok: false, message: "" }
  try {
    const { checkWhatsAppHealth } = await import("@/lib/whatsapp")
    wa = await checkWhatsAppHealth()
  } catch {}

  const exotelConfigured = configured("EXOTEL_SID", "EXOTEL_API_KEY", "EXOTEL_API_TOKEN", "EXOTEL_CALLER_ID")
  const sarvamConfigured = configured("SARVAM_API_KEY")
  const cartesiaConfigured = configured("CARTESIA_API_KEY")
  const groqConfigured = configured("GROQ_API_KEY")
  const whatsappEnvConfigured = configured("WHATSAPP_TOKEN", "WHATSAPP_PHONE_NUMBER_ID")
  const emailConfigured = configured("SMTP_HOST", "SMTP_USER", "SMTP_PASS")
  const voicebotConfigured = configured("WHATSAPP_SERVICE_KEY")

  // Voicebot bridge: the WhatsApp-call media server runs as a separate pm2
  // process — ping its internal HTTP port the same way the app dials it.
  let voicebot = { running: false }
  try {
    const base = process.env.VOICEBOT_INTERNAL_URL || "http://127.0.0.1:3003"
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), 3000)
    const res = await fetch(`${base}/health`, { signal: ctrl.signal }).catch(() => null)
    clearTimeout(t)
    voicebot = { running: !!res?.ok }
  } catch {}

  const llmProvider = process.env.LLM_PROVIDER === "groq" ? "groq" : "sarvam"

  return NextResponse.json({
    checkedAt: new Date().toISOString(),
    database: { ok: dbRes.ok, size: (dbRes as any).dbSize ?? null, error: (dbRes as any).error ?? null },
    llm: { ok: llmRes.ok, provider: llmProvider, fallback: llmProvider === "sarvam" ? "groq" : null, sarvamConfigured, groqConfigured },
    tts: { primary: "sarvam", sarvamConfigured, cartesiaConfigured },
    stt: { provider: "sarvam", sarvamConfigured },
    whatsapp: { running: !!wa.ok, connected: !!wa.ok, detail: wa.message || null, envConfigured: whatsappEnvConfigured },
    telephony: { configured: exotelConfigured },
    voicebot: { running: voicebot.running, configured: voicebotConfigured },
    email: { configured: emailConfigured },
    instagram: { configured: configured("INSTAGRAM_ACCESS_TOKEN") },
    providers: getProviderHealth(),
  })
}
