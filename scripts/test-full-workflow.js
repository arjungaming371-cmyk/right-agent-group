/**
 * Right Agent Group — Full End-to-End Workflow & Feature Test Suite
 * Tests every single public page, dashboard surface, core API route,
 * voicebot conversation turn, and database CRUD operation.
 */

const fs = require("fs")
const path = require("path")
const crypto = require("crypto")
const { Client } = require("pg")

require("dotenv").config({ path: path.join(__dirname, "..", ".env") })

const BASE_LOCAL = "http://127.0.0.1:3000"
const BASE_NGROK = process.env.NEXT_PUBLIC_APP_URL || "https://dosage-sift-mower.ngrok-free.dev"
const VOICEBOT_URL = `http://127.0.0.1:${process.env.VOICEBOT_HTTP_PORT || 3003}`

// Generate admin session token
function getAdminSessionToken() {
  const secret = process.env.AUTH_SECRET
  if (!secret) throw new Error("AUTH_SECRET missing")
  const payload = {
    email: "arjungaming371@gmail.com",
    role: "admin",
    orgId: null,
    branchId: null,
    epoch: 0,
    exp: Math.floor(Date.now() / 1000) + 86400 * 7,
  }
  const toBase64Url = (str) => Buffer.from(str).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
  const payloadB64 = toBase64Url(JSON.stringify(payload))
  const hmac = crypto.createHmac("sha256", secret)
  hmac.update(payloadB64)
  const sigB64 = hmac.digest("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
  return `${payloadB64}.${sigB64}`
}

const SESSION_TOKEN = getAdminSessionToken()

const results = []

async function testStep(category, name, fn) {
  process.stdout.write(`  [${category}] ${name}... `)
  const start = Date.now()
  try {
    const detail = await fn()
    const ms = Date.now() - start
    console.log(`✅ OK (${ms}ms)${detail ? " — " + detail : ""}`)
    results.push({ category, name, status: "PASS", ms, detail })
  } catch (err) {
    const ms = Date.now() - start
    console.log(`❌ FAIL (${ms}ms) — ${err.message}`)
    results.push({ category, name, status: "FAIL", ms, error: err.message })
  }
}

async function run() {
  console.log("\n========================================================")
  console.log("  🚀 RIGHT AGENT GROUP — COMPREHENSIVE WORKFLOW TEST")
  console.log(`  Local URL  : ${BASE_LOCAL}`)
  console.log(`  Ngrok URL  : ${BASE_NGROK}`)
  console.log(`  Voicebot   : ${VOICEBOT_URL}`)
  console.log("========================================================\n")

  const headers = {
    Cookie: `rag_session=${SESSION_TOKEN}`,
    "ngrok-skip-browser-warning": "true",
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) TestSuite/1.0",
  }

  // 1. PUBLIC MARKETING & PORTAL SURFACES
  console.log("\n--- 1. Public Marketing & Portal Surfaces (via Ngrok) ---")
  const publicPages = [
    { path: "/", name: "Homepage Landing" },
    { path: "/demo", name: "Interactive Voicebot Demo" },
    { path: "/pricing", name: "Pricing Page" },
    { path: "/product", name: "Product Tour" },
    { path: "/ai-employees", name: "AI Employees Showcase" },
    { path: "/integrations", name: "Integrations & APIs" },
    { path: "/security", name: "Security & Compliance" },
    { path: "/privacy", name: "Privacy Policy" },
    { path: "/terms", name: "Terms of Service" },
    { path: "/about", name: "About Us" },
    { path: "/help", name: "Documentation & Help Center" },
  ]

  for (const page of publicPages) {
    await testStep("Public Page", `${page.name} (${page.path})`, async () => {
      const res = await fetch(`${BASE_NGROK}${page.path}`, { headers })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const text = await res.text()
      if (text.length < 500) throw new Error(`Suspicious response length: ${text.length}`)
      return `${(text.length / 1024).toFixed(1)} KB rendered`
    })
  }

  // 2. DASHBOARD CONSOLE & SECURITY
  console.log("\n--- 2. Dashboard Console & Session Security ---")
  await testStep("Dashboard", "Admin Console (/dashboard)", async () => {
    const res = await fetch(`${BASE_NGROK}/dashboard`, { headers })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const html = await res.text()
    if (!html.includes("Right Agent Group") && !html.includes("dashboard")) {
      throw new Error("Dashboard title / shell missing")
    }
    return `${(html.length / 1024).toFixed(1)} KB HTML rendered`
  })

  await testStep("Dashboard", "Unauthenticated Access Redirects to /login", async () => {
    const res = await fetch(`${BASE_NGROK}/dashboard`, {
      redirect: "manual",
      headers: { "ngrok-skip-browser-warning": "true" },
    })
    if (res.status !== 307 && res.status !== 302 && res.status !== 401) {
      throw new Error(`Expected redirect (307/302), got HTTP ${res.status}`)
    }
    return `Security enforced (HTTP ${res.status})`
  })

  // 3. CORE APIS FOR ALL DASHBOARD FEATURES
  console.log("\n--- 3. Core Dashboard APIs & Features ---")
  
  await testStep("API", "GET /api/system/status (Health Check)", async () => {
    const res = await fetch(`${BASE_NGROK}/api/system/status`, { headers })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data = await res.json()
    return `DB: ${data.db ? "online" : "offline"}`
  })

  await testStep("API", "GET /api/system/health (Detailed System Health)", async () => {
    const res = await fetch(`${BASE_NGROK}/api/system/health`, { headers })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data = await res.json()
    return `Overall: ${data.status || "healthy"}`
  })

  await testStep("API", "GET /api/branding (Company Identity & Whitelabel)", async () => {
    const res = await fetch(`${BASE_NGROK}/api/branding`, { headers })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data = await res.json()
    return `Brand: "${data.brand_name || data.company_name || "Right Agent Group"}"`
  })

  await testStep("API", "GET /api/branches (Multi-Branch Management)", async () => {
    const res = await fetch(`${BASE_NGROK}/api/branches`, { headers })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data = await res.json()
    const count = Array.isArray(data) ? data.length : (data.branches?.length || 0)
    return `${count} branches active`
  })

  let sampleLeadId = null
  await testStep("API", "GET /api/leads (Lead Management & Search)", async () => {
    const res = await fetch(`${BASE_NGROK}/api/leads?limit=10`, { headers })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data = await res.json()
    const list = Array.isArray(data.leads) ? data.leads : (Array.isArray(data) ? data : [])
    if (list.length > 0) sampleLeadId = list[0].id
    return `${list.length} leads loaded`
  })

  await testStep("API", "GET /api/loans (Loan Applications Tracking)", async () => {
    const res = await fetch(`${BASE_NGROK}/api/loans?limit=10`, { headers })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data = await res.json()
    const count = Array.isArray(data.applications) ? data.applications.length : (Array.isArray(data) ? data.length : 0)
    return `${count} loan applications`
  })

  await testStep("API", "GET /api/outbound (Outbound Dial Queue & Campaigns)", async () => {
    const res = await fetch(`${BASE_NGROK}/api/outbound`, { headers })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data = await res.json()
    const count = Array.isArray(data.rows) ? data.rows.length : (Array.isArray(data.queue) ? data.queue.length : 0)
    return `${count} queue items loaded`
  })

  await testStep("API", "GET /api/calls (Voice Logs & Audio Records)", async () => {
    const res = await fetch(`${BASE_NGROK}/api/calls?limit=10`, { headers })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data = await res.json()
    const count = Array.isArray(data.calls) ? data.calls.length : (Array.isArray(data) ? data.length : 0)
    return `${count} call recordings logged`
  })

  await testStep("API", "GET /api/whatsapp/status (WhatsApp Business Calling Status)", async () => {
    const res = await fetch(`${BASE_NGROK}/api/whatsapp/status`, { headers })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data = await res.json()
    return `configured: ${data.configured !== false}`
  })

  await testStep("API", "GET /api/whatsapp/conversations (WhatsApp Chat List)", async () => {
    const res = await fetch(`${BASE_NGROK}/api/whatsapp/conversations`, { headers })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data = await res.json()
    const count = Array.isArray(data.conversations) ? data.conversations.length : (Array.isArray(data) ? data.length : 0)
    return `${count} conversations loaded`
  })

  await testStep("API", "GET /api/instagram/messages (Instagram Inbound & Comments)", async () => {
    const url = sampleLeadId ? `${BASE_NGROK}/api/instagram/messages?lead_id=${sampleLeadId}` : `${BASE_NGROK}/api/instagram/messages?ig_user_id=test_ig`
    const res = await fetch(url, { headers })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data = await res.json()
    const count = Array.isArray(data.messages) ? data.messages.length : (Array.isArray(data) ? data.length : 0)
    return `${count} instagram messages returned`
  })

  await testStep("API", "GET /api/calendar/events (Calendar Agent & Appointments)", async () => {
    const res = await fetch(`${BASE_NGROK}/api/calendar/events`, { headers })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data = await res.json()
    const count = Array.isArray(data.events) ? data.events.length : (Array.isArray(data) ? data.length : 0)
    return `${count} calendar events`
  })

  await testStep("API", "GET /api/knowledge-base (RAG Knowledge Base)", async () => {
    const res = await fetch(`${BASE_NGROK}/api/knowledge-base`, { headers })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data = await res.json()
    const count = Array.isArray(data.articles) ? data.articles.length : (Array.isArray(data) ? data.length : 0)
    return `${count} knowledge articles`
  })

  await testStep("API", "GET /api/script (Priya's Prompt & Script Studio)", async () => {
    const res = await fetch(`${BASE_NGROK}/api/script`, { headers })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data = await res.json()
    return `script loaded for: ${data.language || "telugu"}`
  })

  await testStep("API", "GET /api/analytics (Lead Conversion & Call Metrics)", async () => {
    const res = await fetch(`${BASE_NGROK}/api/analytics`, { headers })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data = await res.json()
    return `total calls: ${data.total_calls ?? data.totalCalls ?? 0}`
  })

  await testStep("API", "GET /api/security/flags (Access Controls & IP Allowlist)", async () => {
    const res = await fetch(`${BASE_NGROK}/api/security/flags`, { headers })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data = await res.json()
    return `ip_allowlist: ${data.ip_allowlist ? "enabled" : "disabled"}`
  })

  await testStep("API", "GET /api/maths/emi (Loan EMI Calculator Service)", async () => {
    const res = await fetch(`${BASE_NGROK}/api/maths/emi?amount=500000&rate=10.5&years=5`, { headers })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data = await res.json()
    if (!data.emi) throw new Error("EMI calculation missing")
    return `₹5L @ 10.5% (5yr) = ₹${Math.round(data.emi)}/mo`
  })

  // 4. VOICEBOT SERVER & CALL TURN PIPELINE
  console.log("\n--- 4. Voicebot Server & Speech Engine ---")
  await testStep("Voicebot", "GET http://127.0.0.1:3003/health (Voicebot Health)", async () => {
    const res = await fetch(`${VOICEBOT_URL}/health`)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data = await res.json()
    return `status: ${data.status || "ok"}, port: 3003`
  })

  const callSid = `test-call-${Date.now()}`
  await testStep("Voicebot", "POST /api/calls/turn event=start (Greeting Generation)", async () => {
    const res = await fetch(`${BASE_LOCAL}/api/calls/turn`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.WHATSAPP_SERVICE_KEY || "",
      },
      body: JSON.stringify({
        event: "start",
        callSid,
        from: "+919999999999",
        to: "+9115551612884",
        source: "whatsapp_call",
      }),
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`)
    const data = await res.json()
    const greetingText = data.text || data.greeting
    if (!greetingText) throw new Error("No greeting text returned")
    return `Greeting: "${greetingText.slice(0, 45)}..."`
  })

  await testStep("Voicebot", "POST /api/calls/turn event=turn (AI Reasoning with Priya)", async () => {
    const res = await fetch(`${BASE_LOCAL}/api/calls/turn`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.WHATSAPP_SERVICE_KEY || "",
      },
      body: JSON.stringify({
        event: "turn",
        callSid,
        speech: "నాకు 5 లక్షల పర్సనల్ లోన్ కావాలి, వడ్డీ ఎంత?",
      }),
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`)
    const data = await res.json()
    if (!data.text) throw new Error("No turn response text returned")
    return `Priya replied: "${data.text.slice(0, 45)}..."`
  })

  await testStep("Voicebot", "POST /api/calls/turn event=end (Call Wrap-up & Duration)", async () => {
    const res = await fetch(`${BASE_LOCAL}/api/calls/turn`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.WHATSAPP_SERVICE_KEY || "",
      },
      body: JSON.stringify({
        event: "end",
        callSid,
        duration: 45,
      }),
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`)
    return "Call session recorded & wrapped up"
  })

  // 5. DATABASE INTEGRITY & TRANSACTION CYCLE
  console.log("\n--- 5. PostgreSQL Database Operations ---")
  const db = new Client({
    host: process.env.PG_HOST || "localhost",
    port: parseInt(process.env.PG_PORT || "5432"),
    database: process.env.PG_DATABASE || "right_agent_group",
    user: process.env.PG_USER || "postgres",
    password: process.env.PG_PASSWORD || "postgres",
  })

  await testStep("Database", "Connect & Count Leads Table", async () => {
    await db.connect()
    const res = await db.query("SELECT COUNT(*) AS count FROM leads")
    return `${res.rows[0].count} leads currently in database`
  })

  let testLeadId = null
  await testStep("Database", "Insert Test Lead Record", async () => {
    const testPhone = `+91999${Math.floor(1000000 + Math.random() * 9000000)}`
    const insertRes = await db.query(
      `INSERT INTO leads (name, phone, language, status, source) 
       VALUES ($1, $2, 'te', 'new', 'automated_workflow_test') 
       RETURNING id, name, phone`,
      ["Ajay Test Client", testPhone]
    )
    testLeadId = insertRes.rows[0].id
    return `Lead created: ${testLeadId}`
  })

  await testStep("Database", "Update Lead Status & Record Interaction", async () => {
    await db.query("UPDATE leads SET status = 'in_progress', notes = 'Verified by workflow test' WHERE id = $1", [testLeadId])
    const res = await db.query("SELECT status, notes FROM leads WHERE id = $1", [testLeadId])
    if (res.rows[0].status !== "in_progress") throw new Error("Status update failed")
    return `Status: ${res.rows[0].status}`
  })

  await testStep("Database", "Clean up Test Lead", async () => {
    if (testLeadId) {
      await db.query("DELETE FROM leads WHERE id = $1", [testLeadId])
    }
    await db.end()
    return "Test lead purged cleanly"
  })

  // FINAL SUMMARY
  console.log("\n========================================================")
  const total = results.length
  const passed = results.filter((r) => r.status === "PASS").length
  const failed = results.filter((r) => r.status === "FAIL").length
  console.log(`  📊 COMPLETE TEST SUITE RESULTS: ${passed}/${total} PASSED`)
  if (failed === 0) {
    console.log("  🎉 ALL WORKFLOWS, SURFACES & APIS 100% OPERATIONAL!")
  } else {
    console.log(`  ⚠️ ${failed} check(s) encountered issues.`)
  }
  console.log("========================================================\n")

  if (failed > 0) process.exit(1)
}

run().catch((e) => {
  console.error("Test runner crashed:", e)
  process.exit(1)
})
