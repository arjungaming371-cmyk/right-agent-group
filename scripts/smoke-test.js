// Schema smoke test — catches "code writes a column that doesn't exist" bugs
// BEFORE the client does. Run after any DB or code change:
//   node scripts/smoke-test.js
//
// Exits 0 if everything the app writes/reads exists; exits 1 with a clear
// list of missing columns otherwise.

const fs = require("fs")
const path = require("path")
const { Client } = require("pg")

function loadEnv() {
  const envPath = path.join(__dirname, "..", ".env")
  if (!fs.existsSync(envPath)) { console.error("❌ No .env file"); process.exit(1) }
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*(?:#.*)?$/)
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2]
  }
}

// Every column the application code actually reads or writes.
// If you add a column to a route, add it here too.
const REQUIRED = {
  leads: ["id","name","phone","address","whatsapp_number","email","product_interest","loan_amount","notes","form_completed","status","interested","score","language","source","call_count","last_called_at","created_at","updated_at"],
  voice_calls: ["id","twilio_call_sid","lead_id","phone","direction","status","language","duration","outcome","sentiment","ai_summary","transcript","recording_url","followup_sent","created_at","updated_at"],
  loan_applications: ["id","lead_id","full_name","customer_name","phone","city","email","whatsapp_number","address","loan_type","loan_amount","monthly_income","employment_type","pan_number","form_data","status","submitted_at"],
  form_links: ["token","lead_id","used_at","created_at"],
  whatsapp_messages: ["id","lead_id","wa_message_id","phone_number","direction","content","status","created_at"],
  ai_conversations: ["id","lead_id","role","content","language","created_at"],
  comm_logs: ["id","lead_id","type","summary","outcome","created_at"],
  outbound_queue: ["id","lead_id","name","phone","language","product_interest","notes","status","call_sid","scheduled_at","called_at","created_at"],
  uploaded_files: ["id","filename","file_path","type","row_count","processed","status","uploaded_by","created_at"],
  security_settings: ["key","enabled","updated_at"],
  audit_logs: ["id","action","performed_by","metadata","created_at"],
  allowed_emails: ["email","added_by","created_at"],
  ai_scripts: ["id","language","content","updated_at","updated_by"],
}

async function main() {
  loadEnv()
  const db = new Client({
    host: process.env.PG_HOST || "localhost",
    port: parseInt(process.env.PG_PORT || "5432"),
    user: process.env.PG_USER || "postgres",
    password: process.env.PG_PASSWORD || "",
    database: process.env.PG_DATABASE || "right_agent_group",
  })
  try { await db.connect() } catch (e) {
    console.error(`❌ Cannot connect to PostgreSQL: ${e.message}`)
    process.exit(1)
  }

  const res = await db.query(
    "SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = 'public'"
  )
  const actual = {}
  for (const row of res.rows) {
    ;(actual[row.table_name] ||= new Set()).add(row.column_name)
  }

  let problems = 0
  for (const [table, cols] of Object.entries(REQUIRED)) {
    if (!actual[table]) {
      console.error(`❌ TABLE MISSING: ${table}`)
      problems++
      continue
    }
    const missing = cols.filter((c) => !actual[table].has(c))
    if (missing.length) {
      console.error(`❌ ${table} — missing columns: ${missing.join(", ")}`)
      problems += missing.length
    } else {
      console.log(`✅ ${table} (${cols.length} columns OK)`)
    }
  }
  await db.end()

  if (problems) {
    console.error(`\n❌ ${problems} problem(s). Fix: npm run db:setup (re-runs local-setup.sql migrations)`)
    process.exit(1)
  }
  console.log("\n✅ Schema is fully in sync with the code.")
}

main().catch((e) => { console.error("❌", e.message); process.exit(1) })
