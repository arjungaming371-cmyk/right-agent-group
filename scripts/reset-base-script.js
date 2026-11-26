const { Pool } = require('pg');
require('dotenv').config({ path: '.env.local' });
require('dotenv').config({ path: '.env' });

const pool = new Pool(
  process.env.DATABASE_URL
    ? { connectionString: process.env.DATABASE_URL }
    : {
        host: process.env.PG_HOST || 'localhost',
        port: parseInt(process.env.PG_PORT || '5432', 10),
        database: process.env.PG_DATABASE || 'right_agent_group',
        user: process.env.PG_USER || 'postgres',
        password: process.env.PG_PASSWORD,
      }
);

async function run() {
  const res = await pool.query("DELETE FROM ai_scripts WHERE language = 'base'");
  console.log("Deleted ai_scripts base row:", res.rowCount);
  await pool.end();
}

run().catch(e => {
  console.error(e);
  process.exit(1);
});
