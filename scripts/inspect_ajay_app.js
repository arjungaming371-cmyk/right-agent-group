const { Pool } = require('/var/www/right-agent-group/node_modules/pg');

const pool = new Pool({
  connectionString: 'postgres://postgres:ARJUNGAMING@localhost:5432/right_agent_group'
});

async function main() {
  try {
    const apps = await pool.query(
      `SELECT la.*, l.name as lead_name, l.phone as lead_phone 
       FROM loan_applications la 
       LEFT JOIN leads l ON l.id = la.lead_id 
       WHERE la.phone LIKE '%6301689511%' OR l.phone LIKE '%6301689511%'`
    );
    console.log("=== LOAN APPLICATIONS ===");
    console.log(JSON.stringify(apps.rows, null, 2));

    const lead = await pool.query(
      `SELECT id, name, phone, product_interest, loan_amount, form_completed, created_at, updated_at 
       FROM leads 
       WHERE phone LIKE '%6301689511%'`
    );
    console.log("=== LEADS ===");
    console.log(JSON.stringify(lead.rows, null, 2));

    const interactions = await pool.query(
      `SELECT li.* FROM lead_interactions li 
       JOIN leads l ON l.id = li.lead_id 
       WHERE l.phone LIKE '%6301689511%' 
       ORDER BY li.occurred_at ASC`
    );
    console.log("=== INTERACTIONS ===");
    console.log(JSON.stringify(interactions.rows, null, 2));

    const calls = await pool.query(
      `SELECT id, call_sid, phone_number, direction, status, sentiment, created_at 
       FROM voice_calls 
       WHERE phone_number LIKE '%6301689511%' 
       ORDER BY created_at ASC`
    );
    console.log("=== VOICE CALLS ===");
    console.log(JSON.stringify(calls.rows, null, 2));

  } catch (err) {
    console.error("Error:", err);
  } finally {
    await pool.end();
  }
}

main();
