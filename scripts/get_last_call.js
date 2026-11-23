const { Client } = require('/var/www/right-agent-group/node_modules/pg');

async function main() {
  const c = new Client({ connectionString: 'postgres://postgres:ARJUNGAMING@localhost:5432/right_agent_group' });
  await c.connect();
  const res = await c.query('SELECT id, phone, twilio_call_sid, direction, duration, status, outcome, sentiment, recording_url, transcript FROM voice_calls ORDER BY created_at DESC LIMIT 1');
  console.log(JSON.stringify(res.rows[0], null, 2));
  await c.end();
}

main().catch(console.error);
