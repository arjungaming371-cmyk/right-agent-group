const { Pool } = require('/var/www/right-agent-group/node_modules/pg');

const pool = new Pool({
  connectionString: 'postgres://postgres:ARJUNGAMING@localhost:5432/right_agent_group'
});

async function main() {
  const callRes = await pool.query(
    `SELECT instructions, transcript FROM voice_calls WHERE id = 'fb337c39-08b0-4d36-b851-b4948c5e103f'`
  );
  console.log("Instructions in DB:", callRes.rows[0]?.instructions);
  await pool.end();
}

main().catch(console.error);
