import { query, withTransaction } from '../lib/db'

async function main() {
  console.log("Applying production-grade database schema improvements...")

  await withTransaction(async (client) => {
    // 1. Drop old constraint and add updated check constraint on calendar_events
    console.log("Updating calendar_events_event_type_check...")
    await client.query(`
      ALTER TABLE calendar_events 
      DROP CONSTRAINT IF EXISTS calendar_events_event_type_check;
    `)
    await client.query(`
      ALTER TABLE calendar_events 
      ADD CONSTRAINT calendar_events_event_type_check 
      CHECK (event_type = ANY (ARRAY['branch_visit'::text, 'proposed_visit'::text, 'callback'::text, 'document_deadline'::text, 'reminder'::text, 'interested_lead'::text]));
    `)

    // 2. Make event_at nullable for tentative/proposed visits
    console.log("Making calendar_events.event_at nullable for open invitations...")
    await client.query(`
      ALTER TABLE calendar_events 
      ALTER COLUMN event_at DROP NOT NULL;
    `)
    await client.query(`
      ALTER TABLE calendar_events 
      ALTER COLUMN original_event_at DROP NOT NULL;
    `)

    // 3. High-performance indexes for 10,000+ lead scaling
    console.log("Adding high-performance indexes...")
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_calendar_events_active_tasks 
      ON calendar_events (status, event_type, event_at) 
      WHERE status IN ('confirmed', 'needs_review', 'rescheduled');
    `)

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_comm_logs_unresolved_alerts 
      ON comm_logs (type, outcome, created_at DESC) 
      WHERE type = 'alert' AND outcome IN ('needs_human', 'loan_confirmed');
    `)

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_loan_applications_unresolved 
      ON loan_applications (status, submitted_at DESC) 
      WHERE status IN ('pending', 'submitted', 'in_review');
    `)

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_leads_lookup_composite 
      ON leads (id, phone, status, created_at DESC);
    `)

    // 4. Clean up Ajay Kumar's event to have null event_at since it was an open invitation
    console.log("Synchronizing Ajay Kumar's tentative visit...")
    await client.query(`
      UPDATE calendar_events 
      SET event_type = 'proposed_visit',
          event_at = NULL,
          end_at = NULL,
          original_event_at = NULL,
          status = 'needs_review'
      WHERE lead_id = '9f91c21a-d9e2-4ee6-96e9-7e52c97206d6'
        AND event_type = 'branch_visit'
        AND (notes ILIKE '%open invitation%' OR review_reason ILIKE '%without confirming%');
    `)
  })

  console.log("Database migration completed successfully!")
}

main().catch(e => {
  console.error("Migration failed:", e)
  process.exit(1)
})
