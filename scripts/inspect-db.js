const { Pool } = require('pg');
const pool = new Pool({ host: process.env.PG_HOST || 'localhost', port: parseInt(process.env.PG_PORT || '5432', 10), database: process.env.PG_DATABASE || 'right_agent_group', user: process.env.PG_USER || 'postgres', password: process.env.PG_PASSWORD });

async function getCols() {
  const qCols = await pool.query("SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'outbound_queue'");
  console.log('outbound_queue columns:', qCols.rows.map(r => r.column_name));

  const cCols = await pool.query("SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'calendar_events'");
  console.log('calendar_events columns:', cCols.rows.map(r => r.column_name));

  const qData = await pool.query("SELECT * FROM outbound_queue ORDER BY created_at DESC LIMIT 5");
  console.log('outbound_queue top 5:', qData.rows);

  const cData = await pool.query("SELECT * FROM calendar_events ORDER BY created_at DESC LIMIT 5");
  console.log('calendar_events top 5:', cData.rows);

  pool.end();
}
getCols();
