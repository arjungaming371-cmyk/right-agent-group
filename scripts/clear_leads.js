const { Pool } = require('/var/www/right-agent-group/node_modules/pg');

const pool = new Pool({
  connectionString: 'postgres://postgres:ARJUNGAMING@localhost:5432/right_agent_group'
});

async function main() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    console.log("Clearing leads and all related child tables...");

    await client.query("DELETE FROM loan_application_edit_requests");
    await client.query("DELETE FROM loan_applications");
    await client.query("DELETE FROM lead_memory");
    await client.query("DELETE FROM lead_interactions");
    await client.query("DELETE FROM form_links");
    await client.query("DELETE FROM link_sends");
    await client.query("DELETE FROM calendar_events");
    await client.query("DELETE FROM comm_logs");
    await client.query("DELETE FROM outbound_queue");
    await client.query("DELETE FROM dnd_suppression");
    await client.query("DELETE FROM voice_calls");
    await client.query("DELETE FROM whatsapp_messages");
    await client.query("DELETE FROM ai_conversations");
    await client.query("DELETE FROM notifications WHERE type IN ('whatsapp_message', 'lead', 'loan_application', 'call')");
    await client.query("DELETE FROM leads");

    await client.query("COMMIT");
    console.log("Successfully cleared all leads data and associated records.");
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Error clearing leads data:", err);
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(console.error);
