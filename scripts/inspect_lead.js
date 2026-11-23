const { Client } = require('/var/www/right-agent-group/node_modules/pg');

async function main() {
  const c = new Client({ connectionString: 'postgres://postgres:ARJUNGAMING@localhost:5432/right_agent_group' });
  await c.connect();
  
  const leadRes = await c.query("SELECT id, name, phone, score, status, product_interest, loan_amount, notes, callback_at FROM leads WHERE phone = '+916301689511'");
  console.log("=== LEAD ===");
  console.log(JSON.stringify(leadRes.rows[0], null, 2));

  const memRes = await c.query("SELECT * FROM lead_memory WHERE lead_id = $1", [leadRes.rows[0]?.id]);
  console.log("=== LEAD MEMORY ===");
  console.log(JSON.stringify(memRes.rows[0], null, 2));

  const callRes = await c.query("SELECT id, phone, duration, sentiment, outcome, status, created_at FROM voice_calls WHERE phone = '+916301689511' ORDER BY created_at DESC");
  console.log("=== CALLS ===");
  console.log(JSON.stringify(callRes.rows, null, 2));

  await c.end();
}

main().catch(console.error);
