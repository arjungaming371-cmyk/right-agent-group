const { Pool } = require('/var/www/right-agent-group/node_modules/pg');

const pool = new Pool({
  connectionString: 'postgres://postgres:ARJUNGAMING@localhost:5432/right_agent_group'
});

async function main() {
  const fks = await pool.query(`
    SELECT
        tc.table_name, 
        kcu.column_name, 
        ccu.table_name AS foreign_table_name
    FROM 
        information_schema.table_constraints AS tc 
        JOIN information_schema.key_column_usage AS kcu
          ON tc.constraint_name = kcu.constraint_name
        JOIN information_schema.constraint_column_usage AS ccu
          ON ccu.constraint_name = tc.constraint_name
    WHERE tc.constraint_type = 'FOREIGN KEY' AND ccu.table_name = 'leads'
  `);
  console.log("Foreign keys referencing leads:", fks.rows);

  const counts = await pool.query(`
    SELECT 
      (SELECT count(*) FROM leads) as leads,
      (SELECT count(*) FROM lead_memory) as lead_memory,
      (SELECT count(*) FROM lead_interactions) as lead_interactions,
      (SELECT count(*) FROM loan_applications) as loan_applications,
      (SELECT count(*) FROM voice_calls) as voice_calls,
      (SELECT count(*) FROM whatsapp_messages) as whatsapp_messages,
      (SELECT count(*) FROM comm_logs) as comm_logs
  `);
  console.log("Counts:", counts.rows[0]);

  await pool.end();
}

main().catch(console.error);
