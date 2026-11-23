const { Client } = require('/var/www/right-agent-group/node_modules/pg');

async function main() {
  const c = new Client({ connectionString: 'postgres://postgres:ARJUNGAMING@localhost:5432/right_agent_group' });
  await c.connect();

  // 1. Update the call sentiment to Positive (matching Lead Brain's true AI analysis)
  await c.query("UPDATE voice_calls SET sentiment = 'Positive' WHERE id = '086df564-b9f5-4197-8385-5436a00b7495'");
  console.log("Updated voice_calls 086df564... sentiment to Positive");

  // 2. Fetch lead data
  const leadRes = await c.query("SELECT * FROM leads WHERE phone = '+916301689511'");
  const lead = leadRes.rows[0];

  // 3. Compute score: baseline 20, interested 30 (or 0), sentiment Positive +20, loan_amount 16L +10, call_count 2*5=+10, recency +10
  // Lead Brain marked stage: docs_pending, which means interested!
  let score = 20;
  score += 30; // Customer requested 16L education loan, docs pending
  score += 20; // Positive sentiment
  score += 10; // 16 Lakh loan amount
  score += Math.min(Number(lead.call_count || 2) * 5, 20); // 10
  score += 10; // Called today
  score = Math.min(100, Math.max(0, score));

  await c.query("UPDATE leads SET score = $1, status = 'qualified', interested = 'interested', updated_at = now() WHERE id = $2", [score, lead.id]);
  console.log(`Updated lead Ajay Kumar score to ${score} and status to qualified`);

  const updatedLead = await c.query("SELECT id, name, phone, score, status, product_interest, loan_amount FROM leads WHERE id = $1", [lead.id]);
  console.log("New Lead Data:", updatedLead.rows[0]);

  const updatedCall = await c.query("SELECT id, sentiment, recording_url FROM voice_calls WHERE id = '086df564-b9f5-4197-8385-5436a00b7495'");
  console.log("New Call Data:", updatedCall.rows[0]);

  await c.end();
}

main().catch(console.error);
