// Run all migrations in chronological order
const fs = require("fs")
const path = require("path")
const { Client } = require("pg")

function loadEnv() {
  const envPath = path.join(__dirname, "..", ".env")
  if (!fs.existsSync(envPath)) {
    console.error("❌ No .env file found.")
    process.exit(1)
  }
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*(?:#.*)?$/)
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2]
  }
}

async function main() {
  loadEnv()

  const host = process.env.PG_HOST || "localhost"
  const port = parseInt(process.env.PG_PORT || "5432")
  const user = process.env.PG_USER || "postgres"
  const password = process.env.PG_PASSWORD || ""
  const database = process.env.PG_DATABASE || "right_agent_group"

  const db = new Client({ host, port, user, password, database })
  await db.connect()

  const migrationsDir = path.join(__dirname, "..", "migrations")
  const files = fs.readdirSync(migrationsDir)
    .filter(f => f.endsWith(".sql") && !f.includes("_rollback"))
    .sort()

  console.log(`Found ${files.length} migrations to check/apply...`)

  for (const file of files) {
    const filePath = path.join(migrationsDir, file)
    console.log(`Running migration: ${file} ...`)
    const sql = fs.readFileSync(filePath, "utf8")
    try {
      await db.query(sql)
      console.log(`✅ Success: ${file}`)
    } catch (err) {
      console.warn(`⚠️ Error or warning on ${file}: ${err.message}`)
    }
  }

  await db.end()
  console.log("All migrations run.")
}

main().catch((e) => {
  console.error("❌ Migration failed:", e.message)
  process.exit(1)
})
