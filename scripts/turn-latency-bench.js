#!/usr/bin/env node
// Measures what the per-turn read overlap actually saves.
//
//   node scripts/turn-latency-bench.js        (or: npm run bench:turn)
//
// Before, every call turn read the transcript to completion and THEN started
// the lead brief, knowledge-base search and finance rows. Those three never
// needed the history, so the turn waited for the transcript read plus the
// slowest of the rest. Now all four run together.
//
// SCOPE, so the number isn't over-read: this times DATABASE round-trips only.
// It is not whole-turn latency — STT, the LLM and TTS dominate that and are
// untouched by this change. What it does tell you is exactly how much dead
// air the reordering removed from the front of every turn.
//
// Runs the real queries against the real database, on real rows where any
// exist. Read-only: nothing here writes.

const fs = require("fs")
const path = require("path")
const { Pool } = require("pg")

function loadEnv() {
  const envPath = path.join(__dirname, "..", ".env")
  if (!fs.existsSync(envPath)) { console.error("❌ No .env file"); process.exit(1) }
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*(?:#.*)?$/)
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2]
  }
}

const RUNS = 30

// The four reads a turn issues, in the shapes lib/ actually uses.
const READS = {
  history: (c, { sid }) =>
    c.query(`SELECT transcript FROM voice_calls WHERE twilio_call_sid = $1 LIMIT 1`, [sid]),
  brief: (c, { leadId }) =>
    c.query(
      `SELECT l.id, l.name, l.status,
              (SELECT json_agg(t) FROM (
                 SELECT channel, direction, occurred_at, one_line_summary
                   FROM lead_interactions WHERE lead_id = l.id
                  ORDER BY occurred_at DESC LIMIT 8) t) AS recent
         FROM leads l WHERE l.id = $1`,
      [leadId]
    ),
  knowledgeBase: (c) =>
    c.query(
      `SELECT title, content, ts_rank(search_vector, websearch_to_tsquery('english', $1)) AS rank
         FROM knowledge_base
        WHERE is_active = true AND search_vector @@ websearch_to_tsquery('english', $1)
        ORDER BY rank DESC LIMIT 3`,
      ["what documents do I need for a home loan"]
    ),
  finance: (c, { leadId }) =>
    Promise.all([
      c.query(`SELECT loan_amount, product_interest FROM leads WHERE id = $1`, [leadId]),
      c.query(`SELECT facts FROM lead_memory WHERE lead_id = $1`, [leadId]),
    ]),
}

const ms = () => Number(process.hrtime.bigint() / 1000n) / 1000
const median = (a) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)] }

async function main() {
  loadEnv()
  // A POOL, not a single Client — this is the whole point. One pg Client
  // serializes every query onto one connection, so Promise.all over a Client
  // measures nothing (it just queues them, and warns that it is doing so).
  // lib/db.ts uses a pool with max 25, so parallel reads really do overlap;
  // benchmarking against anything else would measure the wrong program.
  const c = new Pool({
    host: process.env.PG_HOST || "localhost",
    port: parseInt(process.env.PG_PORT || "5432"),
    user: process.env.PG_USER || "postgres",
    password: process.env.PG_PASSWORD || "",
    database: process.env.PG_DATABASE || "right_agent_group",
    max: 25,
  })

  const lead = (await c.query(`SELECT id FROM leads ORDER BY created_at DESC LIMIT 1`)).rows[0]
  const call = (await c.query(`SELECT twilio_call_sid FROM voice_calls ORDER BY created_at DESC LIMIT 1`)).rows[0]
  const ctx = {
    leadId: lead ? lead.id : "00000000-0000-0000-0000-000000000000",
    sid: call ? call.twilio_call_sid : "__none__",
  }
  console.log(`\nAgainst ${lead ? "a real lead" : "no lead (empty table)"} and ${call ? "a real call row" : "no call row"}.`)
  console.log(`${RUNS} runs each, reporting the median.\n`)

  // warm the connection and the plan cache — otherwise run 1 measures parsing
  for (let i = 0; i < 3; i++) {
    await Promise.all(Object.values(READS).map((f) => f(c, ctx)))
  }

  const seq = []
  const par = []
  for (let i = 0; i < RUNS; i++) {
    let t = ms()
    await READS.history(c, ctx)
    await Promise.all([READS.brief(c, ctx), READS.knowledgeBase(c, ctx), READS.finance(c, ctx)])
    seq.push(ms() - t)

    t = ms()
    await Promise.all([READS.history(c, ctx), READS.brief(c, ctx), READS.knowledgeBase(c, ctx), READS.finance(c, ctx)])
    par.push(ms() - t)
  }

  // What each read costs on its own, so the saving is attributable.
  const each = {}
  for (const [name, fn] of Object.entries(READS)) {
    const t = []
    for (let i = 0; i < RUNS; i++) { const s = ms(); await fn(c, ctx); t.push(ms() - s) }
    each[name] = median(t)
  }
  await c.end()

  const before = median(seq)
  const after = median(par)
  const saved = before - after

  console.log("  each read on its own:")
  for (const [n, v] of Object.entries(each)) console.log(`    ${n.padEnd(15)} ${v.toFixed(2)}ms`)
  console.log(`\n  before (transcript, then the rest) : ${before.toFixed(2)}ms`)
  console.log(`  after  (all four together)         : ${after.toFixed(2)}ms`)
  console.log(`  saved per turn                     : ${saved.toFixed(2)}ms  (${((saved / before) * 100).toFixed(0)}% of DB wait)\n`)
  console.log("  Database round-trips only — STT, the LLM and TTS dominate a real")
  console.log("  turn and are unaffected. This is the dead air removed from the")
  console.log("  front of every turn, nothing more.\n")
}

main().catch((e) => {
  console.error("\n❌ bench could not run:", e.message)
  console.error("   (needs the same database as npm run db:check)\n")
  process.exit(1)
})
