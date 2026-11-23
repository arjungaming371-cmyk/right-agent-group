const { Pool } = require('/var/www/right-agent-group/node_modules/pg');

const pool = new Pool({
  connectionString: 'postgres://postgres:ARJUNGAMING@localhost:5432/right_agent_group'
});

async function main() {
  const res = await pool.query(
    `SELECT vc.id, vc.phone, vc.twilio_call_sid, vc.direction, vc.status, vc.instructions, 
            vc.transcript, vc.recording_url, vc.created_at, vc.sentiment,
            l.name as lead_name, l.phone as lead_phone
     FROM voice_calls vc
     LEFT JOIN leads l ON l.id = vc.lead_id
     ORDER BY vc.created_at DESC 
     LIMIT 1`
  );
  console.log("=== LATEST CALL ===");
  console.log(JSON.stringify(res.rows[0], null, 2));
  await pool.end();
}

main().catch(console.error);
