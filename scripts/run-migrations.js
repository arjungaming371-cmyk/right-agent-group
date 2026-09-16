// Run all migrations in chronological order, tracked and transactional.
//
// 2026-09 reliability pass — the old runner:
//   * had NO tracking table, so re-running re-applied everything (relying on
//     every file being perfectly idempotent — one unguarded ADD CONSTRAINT
//     in 2026-07-20_loan_edit_requests.sql made every re-run "warn");
//   * caught EVERY per-file error, printed a warning and exited 0 — a
//     genuinely failed migration was indistinguishable from a skipped one;
//   * ran each file without a transaction, so a mid-file failure left a
//     partially-applied migration behind.
// Now: a schema_migrations table records applied files, each file runs in
// its own transaction (Postgres transactional DDL makes this safe), and any
// failure stops the run and exits non-zero.
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

  // Tracking table — records exactly which migration files this database
  // has applied. Pre-existing databases that ran the old (untracked) runner
  // may see "already applied" files re-run once; every migration file in
  // this repo is written to be re-runnable (IF NOT EXISTS / guarded), so the
  // one-time re-check is harmless and self-corrects.
  await db.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename   TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `)

  const migrationsDir = path.join(__dirname, "..", "migrations")
  const files = fs.readdirSync(migrationsDir)
    .filter(f => f.endsWith(".sql") && !f.includes("_rollback"))
    .sort()

  console.log(`Found ${files.length} migrations to check/apply...`)

  let applied = 0
  let skipped = 0
  let failed = 0

  for (const file of files) {
    const already = await db.query(`SELECT 1 FROM schema_migrations WHERE filename = $1`, [file])
    if (already.rowCount > 0) {
      skipped++
      continue
    }

    const filePath = path.join(migrationsDir, file)
    const sql = fs.readFileSync(filePath, "utf8")
    console.log(`Running migration: ${file} ...`)
    try {
      // Transactional DDL: either the whole file applies or none of it —
      // no more partially-applied migrations.
      await db.query("BEGIN")
      await db.query(sql)
      await db.query(`INSERT INTO schema_migrations (filename) VALUES ($1)`, [file])
      await db.query("COMMIT")
      applied++
      console.log(`✅ Success: ${file}`)
    } catch (err) {
      await db.query("ROLLBACK").catch(() => {})
      failed++
      console.error(`❌ FAILED: ${file} — ${err.message}`)
      console.error(`   Stopping. Fix the migration (or restore from backup), then re-run.`)
      break
    }
  }

  await db.end()
  console.log(`Migrations complete: ${applied} applied, ${skipped} already applied, ${failed} failed.`)
  if (failed > 0) process.exit(1)
}

main().catch((e) => {
  console.error("❌ Migration failed:", e.message)
  process.exit(1)
})
