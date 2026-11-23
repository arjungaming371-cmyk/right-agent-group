const { Pool } = require('/var/www/right-agent-group/node_modules/pg');

const pool = new Pool({
  connectionString: 'postgres://postgres:ARJUNGAMING@localhost:5432/right_agent_group'
});

async function main() {
  await pool.query("DELETE FROM dnd_suppression WHERE phone LIKE '%6301689511%'");
  await pool.query("UPDATE leads SET status = 'qualified' WHERE phone LIKE '%6301689511%'");
  await pool.query("UPDATE lead_memory SET stage = 'docs_pending' WHERE lead_id = '35a8b4b2-72fd-493f-a3a1-d35cc176c399'");
  console.log("Successfully cleared DND and reset Ajay Kumar status to qualified");
  await pool.end();
}

main().catch(console.error);
