import fs from "fs"
import path from "path"
import { Pool } from "pg"

const envFile = fs.readFileSync(path.join(__dirname, "../.env"), "utf8")
envFile.split("\n").forEach(line => {
  const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*)$/)
  if (m) {
    const val = m[2].trim().replace(/^["']|["']$/g, "")
    process.env[m[1]] = val
  }
})

const pool = new Pool({
  host: process.env.PG_HOST || "localhost",
  port: parseInt(process.env.PG_PORT || "5432"),
  database: process.env.PG_DATABASE || "right_agent_group",
  user: process.env.PG_USER || "postgres",
  password: process.env.PG_PASSWORD || "",
})

async function checkUser() {
  try {
    const res = await pool.query("SELECT email, role, display_name, allowed_modules, branch_id FROM allowed_emails WHERE lower(email) = 'arjungaming371@gmail.com'")
    console.log("USER ROW:", JSON.stringify(res.rows, null, 2))
  } catch (err) {
    console.error(err)
  } finally {
    pool.end()
  }
}

checkUser()
