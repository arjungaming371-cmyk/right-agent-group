const { Pool } = require('/var/www/right-agent-group/node_modules/pg');

const pool = new Pool({
  connectionString: 'postgres://postgres:ARJUNGAMING@localhost:5432/right_agent_group'
});

async function main() {
  const leadRes = await pool.query(
    `SELECT l.id, l.name, l.phone, l.form_completed, l.product_interest, l.loan_amount,
            la.id as app_id, la.status as app_status, la.loan_type, la.loan_amount as app_amount
     FROM leads l
     LEFT JOIN loan_applications la ON la.lead_id = l.id
     WHERE l.phone LIKE '%6301689511%'`
  );
  console.log("=== AJAY KUMAR STATE ===");
  console.log(leadRes.rows[0]);
  await pool.end();
}

main().catch(console.error);
