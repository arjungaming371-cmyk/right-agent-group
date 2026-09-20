// Right Agent Group — one-command database setup
// Usage: npm run db:setup
// Reads .env, connects to PostgreSQL, creates the database if needed,
// then runs local-setup.sql (idempotent — safe to re-run).

const fs = require("fs")
const path = require("path")
const { Client } = require("pg")

// Minimal .env loader (no dotenv dependency in the web app root)
function loadEnv() {
  const envPath = path.join(__dirname, "..", ".env")
  if (!fs.existsSync(envPath)) {
    console.error("❌ No .env file found. Copy .env.example to .env and fill it in first.")
    process.exit(1)
  }
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    // FIX (2026-09-20): match dotenv semantics — strip only a SPACED comment
    // (" #..."), keep '#' inside unquoted values (PG_PASSWORD=abc#123 used to
    // silently truncate), and unwrap surrounding quotes.
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/)
    if (!m || m[1] in process.env) continue
    let v = m[2]
    const commentIdx = v.search(/\s#/)
    if (commentIdx !== -1) v = v.slice(0, commentIdx).trim()
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1)
    process.env[m[1]] = v
  }
}

async function main() {
  loadEnv()

  const host = process.env.PG_HOST || "localhost"
  const port = parseInt(process.env.PG_PORT || "5432")
  const user = process.env.PG_USER || "postgres"
  const password = process.env.PG_PASSWORD || ""
  const database = process.env.PG_DATABASE || "right_agent_group"

  // 1. Ensure the database exists (connect to the default 'postgres' db)
  const admin = new Client({ host, port, user, password, database: "postgres" })
  try {
    await admin.connect()
  } catch (e) {
    console.error(`❌ Cannot connect to PostgreSQL at ${host}:${port} — is it running?`)
    console.error(`   ${e.message}`)
    process.exit(1)
  }
  const exists = await admin.query("SELECT 1 FROM pg_database WHERE datname = $1", [database])
  if (exists.rowCount === 0) {
    console.log(`Creating database "${database}" ...`)
    await admin.query(`CREATE DATABASE "${database}"`)
  } else {
    console.log(`Database "${database}" already exists — OK`)
  }
  await admin.end()

  // 2. Run local-setup.sql (idempotent: CREATE IF NOT EXISTS + ALTER ADD IF NOT EXISTS)
  const sqlPath = path.join(__dirname, "..", "local-setup.sql")
  const sql = fs.readFileSync(sqlPath, "utf8")
  const db = new Client({ host, port, user, password, database })
  await db.connect()
  console.log("Running local-setup.sql ...")
  await db.query(sql)

  // 3. Quick sanity check
  const tables = await db.query(
    "SELECT table_name FROM information_schema.tables WHERE table_schema='public' ORDER BY table_name"
  )
  console.log(`\n✅ Done. ${tables.rowCount} tables ready:`)
  console.log("   " + tables.rows.map((r) => r.table_name).join(", "))
  await db.end()
}

main().catch((e) => {
  console.error("❌ Setup failed:", e.message)
  process.exit(1)
})
