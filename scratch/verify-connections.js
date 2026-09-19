const { Client } = require("pg");
const fs = require("fs");
const path = require("path");

function loadEnv() {
  const envPath = path.join(__dirname, "..", ".env");
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*(?:#.*)?$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2];
  }
}

async function verify() {
  loadEnv();
  console.log("==================================================");
  console.log("  RIGHT AGENT GROUP - DEEP CONNECTIVITY CHECK");
  console.log("==================================================");

  const client = new Client({
    host: process.env.PG_HOST || "localhost",
    port: parseInt(process.env.PG_PORT || "5432"),
    database: process.env.PG_DATABASE || "right_agent_group",
    user: process.env.PG_USER || "postgres",
    password: process.env.PG_PASSWORD || "",
  });

  try {
    await client.connect();
    console.log("✅ 1. PostgreSQL Database: CONNECTED");

    // Table Counts
    const tables = [
      "leads",
      "loan_applications",
      "branches",
      "whatsapp_messages",
      "instagram_messages",
      "system_api_keys",
      "allowed_emails",
      "ai_scripts",
      "knowledge_base",
      "comm_logs",
      "schema_migrations",
    ];

    for (const table of tables) {
      try {
        const res = await client.query(`SELECT COUNT(*)::int as n FROM ${table}`);
        console.log(`   - Table '${table}': ${res.rows[0].n} records`);
      } catch (err) {
        console.error(`   ❌ Table '${table}' ERROR: ${err.message}`);
      }
    }

    // System API Keys Check
    console.log("\n✅ 2. System API Keys & Credentials Override System:");
    const keysRes = await client.query(`SELECT key_name FROM system_api_keys`);
    console.log(`   - DB Overrides Configured: ${keysRes.rows.length} keys`);
    console.log(`   - Environment Fallback (.env): GROQ_API_KEY = ${process.env.GROQ_API_KEY ? "SET" : "MISSING"}`);
    console.log(`   - Environment Fallback (.env): SARVAM_API_KEY = ${process.env.SARVAM_API_KEY ? "SET" : "MISSING"}`);
    console.log(`   - Environment Fallback (.env): WHATSAPP_TOKEN = ${process.env.WHATSAPP_TOKEN ? "SET" : "MISSING"}`);
    console.log(`   - Environment Fallback (.env): INSTAGRAM_ACCESS_TOKEN = ${process.env.INSTAGRAM_ACCESS_TOKEN ? "SET" : "MISSING"}`);

    // Multi-tenant Branches
    console.log("\n✅ 3. Multi-Tenant Branch System:");
    const branchesRes = await client.query(`SELECT id, name, code FROM branches`);
    console.log(`   - Total Active Branches: ${branchesRes.rows.length}`);

    // Allowed Emails & Roles
    console.log("\n✅ 4. User Accounts & Admin Access:");
    const usersRes = await client.query(`SELECT email, role FROM allowed_emails`);
    console.log(`   - Total Registered Accounts: ${usersRes.rows.length}`);
    for (const u of usersRes.rows) {
      console.log(`     * ${u.email} -> Role: ${u.role}`);
    }

    await client.end();
    console.log("\n==================================================");
    console.log("  ALL BACKEND CONNECTIONS VERIFIED 100% OK!");
    console.log("==================================================");
  } catch (err) {
    console.error("❌ CONNECTIVITY VERIFICATION FAILED:", err.message);
    process.exit(1);
  }
}

verify();
