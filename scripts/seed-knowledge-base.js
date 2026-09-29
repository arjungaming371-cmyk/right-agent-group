#!/usr/bin/env node
// Seed the knowledge base from the operator's curated CSV
// (kb-right-agent-group.csv — the content that follows the strict rules as
// in the call script). Idempotent: match by normalized title, INSERT what's
// missing, UPDATE what changed, leave everything else (operator-added
// entries, URL imports) untouched. Never deletes.
//
// Every row passes the script-compliance gate (lib/kb-rules.ts) BEFORE it
// can reach the database — a seed that taught Priya a guarantee or a made-up
// phone number would break the script's HARD RULES on live calls.
//
// Usage:
//   node scripts/seed-knowledge-base.js [--dry-run] [--file <path.csv>]
//   npm run seed:kb
//
// Deploy flow: git pull && node scripts/run-migrations.js && npm run seed:kb && pm2 restart all
// (safe to re-run any time — no-ops when everything is in sync)

const fs = require("fs")
const path = require("path")
const os = require("os")
const { execSync } = require("child_process")
const { Client } = require("pg")

const ROOT = path.join(__dirname, "..")
const TSC = path.join(ROOT, "node_modules", ".bin", "tsc")

function loadEnv() {
  const envPath = path.join(ROOT, ".env")
  if (!fs.existsSync(envPath)) {
    console.error("❌ No .env file found.")
    process.exit(1)
  }
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/)
    if (!m || m[1] in process.env) continue
    let v = m[2]
    const commentIdx = v.search(/\s#/)
    if (commentIdx !== -1) v = v.slice(0, commentIdx).trim()
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1)
    process.env[m[1]] = v
  }
}

/** Compile an import-free TS lib with the repo's own tsc and require it. */
function compileLib(tsFile, tmpDir, outName) {
  execSync(
    `"${TSC}" lib/${tsFile} --outDir "${tmpDir}" --module commonjs --target es2020 --esModuleInterop --skipLibCheck`,
    { cwd: ROOT, stdio: "pipe" }
  )
  const p = path.join(tmpDir, outName)
  if (!fs.existsSync(p)) throw new Error(`compiled output missing: ${p}`)
  return require(p)
}

async function main() {
  const args = process.argv.slice(2)
  const dryRun = args.includes("--dry-run")
  const fileIdx = args.indexOf("--file")
  const csvPath = fileIdx !== -1 && args[fileIdx + 1] ? path.resolve(args[fileIdx + 1]) : path.join(ROOT, "kb-right-agent-group.csv")

  console.log(`Seed file: ${csvPath}${dryRun ? "  (DRY RUN — no writes)" : ""}`)

  const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "rag-kb-seed-"))
  const rules = compileLib("kb-rules.ts", TMP, "kb-rules.js")
  const csv = compileLib("csv-parse.ts", TMP, "csv-parse.js")

  if (!fs.existsSync(csvPath)) {
    console.error(`❌ Seed file not found: ${csvPath}`)
    process.exit(1)
  }
  const entries = csv.parseCsvToEntries(fs.readFileSync(csvPath, "utf8"))
  if (entries.length === 0) {
    console.error("❌ No valid rows in the seed CSV (need title/content columns).")
    process.exit(1)
  }
  console.log(`Parsed ${entries.length} entries.`)

  // Script-compliance gate — same rules the API enforces on manual/CSV ingests.
  const { violations, warnings } = rules.validateKbEntries(entries)
  for (const w of warnings) console.warn(`  ⚠️  [${w.rule}] ${w.title}: ${w.message}`)
  if (violations.length > 0) {
    console.error(`\n❌ ${violations.length} script-compliance violation(s) — seed aborted:`)
    for (const v of violations) console.error(`  🚫 [${v.rule}] ${v.title}: ${v.message}`)
    process.exit(1)
  }
  console.log("Compliance: all entries follow the script's strict rules ✓")

  // Unique titles are a precondition for idempotent matching.
  const seen = new Map()
  for (const e of entries) {
    const k = rules.normalizeKbTitle(e.title)
    if (seen.has(k)) {
      console.error(`❌ Duplicate title in seed CSV: "${e.title}"`)
      process.exit(1)
    }
    seen.set(k, e)
  }

  loadEnv()
  const db = new Client({
    host: process.env.PG_HOST || "localhost",
    port: parseInt(process.env.PG_PORT || "5432"),
    user: process.env.PG_USER || "postgres",
    password: process.env.PG_PASSWORD || "",
    database: process.env.PG_DATABASE || "right_agent_group",
  })
  await db.connect()

  const existing = await db.query(`SELECT id, title, content, category FROM knowledge_base`)
  const plan = rules.diffKbPlan(existing.rows, entries)

  console.log(`Plan: ${plan.inserts.length} to insert · ${plan.updates.length} to update · ${plan.unchanged} unchanged (${existing.rows.length} existing rows)`)
  for (const r of plan.inserts) console.log(`  + ${r.title}`)
  for (const r of plan.updates) console.log(`  ~ ${r.title}`)

  if (dryRun) {
    console.log("Dry run — nothing written.")
    await db.end()
    return
  }

  try {
    await db.query("BEGIN")
    for (const r of plan.inserts) {
      await db.query(
        `INSERT INTO knowledge_base (title, content, category, is_active, source_type, source_filename, created_by)
         VALUES ($1, $2, $3, true, 'csv', 'kb-right-agent-group.csv', 'seed:kb')`,
        [r.title, r.content, r.category ?? null]
      )
    }
    for (const r of plan.updates) {
      await db.query(
        `UPDATE knowledge_base SET content = $1, category = $2, updated_at = now() WHERE id = $3`,
        [r.content, r.category ?? null, r.id]
      )
    }
    await db.query("COMMIT")
  } catch (e) {
    await db.query("ROLLBACK").catch(() => {})
    console.error(`❌ Seed failed, rolled back: ${e.message}`)
    process.exitCode = 1
    await db.end()
    return
  }

  console.log(`✅ Seed complete: ${plan.inserts.length} inserted, ${plan.updates.length} updated, ${plan.unchanged} already in sync.`)
  await db.end()
}

if (require.main === module) {
  main().catch((e) => {
    console.error(`❌ Seed crashed: ${e.message}`)
    process.exit(1)
  })
}

// Exported for the test suite (require() from scripts/test-knowledge-base.js)
module.exports = { loadEnv, compileLib }
