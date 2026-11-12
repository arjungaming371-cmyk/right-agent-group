require('dotenv').config()
const { Client } = require('pg')
const c = new Client({
  host: process.env.PG_HOST,
  port: process.env.PG_PORT,
  database: process.env.PG_DATABASE,
  user: process.env.PG_USER,
  password: process.env.PG_PASSWORD
})
async function run() {
  await c.connect()
  const res = await c.query("UPDATE voice_calls SET status = 'busy', outcome = 'missed' WHERE status IN ('initiated', 'ringing', 'in-progress') AND created_at < now() - interval '2 minutes'")
  console.log('Cleared stuck calls: ' + res.rowCount)
  await c.end()
}
run().catch(console.error)