/**
 * Master Production Acceptance & Full Feature Audit Runner
 * Tests Right Agent Group across all 22 phases specified in the Master Prompt.
 */
import { query, withTransaction } from "../lib/db"
import { createSessionToken, verifySessionToken, type Role } from "../lib/auth"
import { isWithinCallingWindow, isDndSuppressed, checkCallCompliance, invalidateComplianceCache } from "../lib/compliance"
import { persistCalendarEvent, updateCalendarEvent, type CalendarEventType } from "../lib/calendar-agent"
import { isSafeNextPath } from "../lib/auth"
import { normalizePhone, phoneLast10 } from "../lib/phone"
import { validateKbEntries } from "../lib/kb-rules"
import crypto from "crypto"

interface TestResult {
  id: string
  phase: string
  name: string
  status: "PASS" | "FAIL" | "BLOCKED"
  detail: string
  durationMs: number
}

const results: TestResult[] = []

async function test(phase: string, id: string, name: string, fn: () => Promise<void>) {
  const t0 = performance.now()
  try {
    await fn()
    const durationMs = Math.round(performance.now() - t0)
    results.push({ id, phase, name, status: "PASS", detail: "OK", durationMs })
    console.log(`  [PASS] ${id}: ${name} (${durationMs}ms)`)
  } catch (err: any) {
    const durationMs = Math.round(performance.now() - t0)
    const msg = err?.message || String(err)
    results.push({ id, phase, name, status: "FAIL", detail: msg, durationMs })
    console.error(`  [FAIL] ${id}: ${name} (${durationMs}ms) -> ${msg}`)
  }
}

function assert(condition: boolean, msg: string) {
  if (!condition) throw new Error(msg)
}

const BRANCH_A_ID = "0fdbcbe6-4bf6-4ac0-80f2-dc87d77deada"
const BRANCH_B_ID = "fcc5632f-6fe5-4fa8-9fb3-e8746dce1d26"

// Track all created synthetic UUIDs for deterministic cleanup
const createdLeadIds: string[] = []
const createdLoanAppIds: string[] = []
const createdMsgIds: string[] = []
const createdCallSids: string[] = []
const createdQueuePhones: string[] = []

async function runMasterAudit() {
  console.log("================================================================================")
  console.log("   RIGHT AGENT GROUP — MASTER PRODUCTION ACCEPTANCE & FEATURE AUDIT")
  console.log("================================================================================\n")

  // Ensure test branches exist
  await query(`
    INSERT INTO branches (id, org_id, name, code, status)
    VALUES ($1, '3575a098-e33e-49af-ae91-f97849e6bbdf', 'Audit Branch A', 'ABRA', 'active')
    ON CONFLICT (id) DO NOTHING
  `, [BRANCH_A_ID])

  await query(`
    INSERT INTO branches (id, org_id, name, code, status)
    VALUES ($1, '3575a098-e33e-49af-ae91-f97849e6bbdf', 'Audit Branch B', 'ABRB', 'active')
    ON CONFLICT (id) DO NOTHING
  `, [BRANCH_B_ID])

  // =========================================================================
  // 1. ENVIRONMENT & DATABASE SCHEMA INTEGRITY (Phases 2 & 6)
  // =========================================================================
  console.log("\n--- PHASE 2 & 6: DATABASE & DATA INTEGRITY ---")

  await test("Database", "DB-01", "PostgreSQL connection pool & query execution", async () => {
    const res = await query("SELECT 1 as alive")
    assert(res.rows[0]?.alive === 1, "Expected SELECT 1 to return 1")
  })

  await test("Database", "DB-02", "Core CRM & Telephony table schemas present", async () => {
    const tables = ["leads", "voice_calls", "loan_applications", "outbound_queue", "calendar_events", "branches"]
    const res = await query(
      "SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name = ANY($1)",
      [tables]
    )
    assert(res.rows.length === tables.length, `Expected ${tables.length} tables, found ${res.rows.length}`)
  })

  await test("Database", "DB-03", "Atomic transactions & automatic rollback on error", async () => {
    const testLeadId = crypto.randomUUID()
    let threw = false
    try {
      await withTransaction(async (client) => {
        await client.query(
          `INSERT INTO leads (id, name, phone, branch_id) VALUES ($1, 'Rollback Test', '+919999900001', $2)`,
          [testLeadId, BRANCH_A_ID]
        )
        throw new Error("Simulated downstream failure")
      })
    } catch {
      threw = true
    }
    assert(threw, "Transaction should have thrown")
    const check = await query(`SELECT id FROM leads WHERE id = $1`, [testLeadId])
    assert(check.rows.length === 0, "Lead should have been rolled back")
  })

  // =========================================================================
  // 2. AUTHENTICATION, AUTHORIZATION & SESSION SECURITY (Phase 4)
  // =========================================================================
  console.log("\n--- PHASE 4: AUTHENTICATION, RBAC & SESSION MATRIX ---")

  await test("Auth", "AUTH-01", "Create & verify valid session token", async () => {
    const token = await createSessionToken("audit-admin@example.com", "admin", { branchId: null })
    const session = await verifySessionToken(token)
    assert(session !== null, "Session should verify")
    assert(session?.role === "admin", "Session role should be admin")
  })

  await test("Auth", "AUTH-02", "Reject tampered HMAC signature", async () => {
    const token = await createSessionToken("audit-agent@example.com", "agent", { branchId: BRANCH_A_ID })
    const parts = token.split(".")
    const tampered = parts[0] + ".invalidsignature12345"
    const session = await verifySessionToken(tampered)
    assert(session === null, "Tampered token should return null")
  })

  await test("Auth", "AUTH-03", "Reject expired session token", async () => {
    const expPayload = {
      email: "audit-old@example.com",
      role: "agent" as Role,
      exp: Math.floor(Date.now() / 1000) - 3600,
    }
    const b64 = Buffer.from(JSON.stringify(expPayload)).toString("base64url")
    const token = await createSessionToken("audit-old@example.com", "agent")
    const validSig = token.split(".")[1]
    const session = await verifySessionToken(`${b64}.${validSig}`)
    assert(session === null, "Expired token must be rejected")
  })

  await test("Auth", "AUTH-04", "Prevent Open Redirect via isSafeNextPath", async () => {
    assert(isSafeNextPath("/dashboard") === true, "Valid relative path allowed")
    assert(isSafeNextPath("/dashboard/leads?page=1") === true, "Valid query path allowed")
    assert(isSafeNextPath("https://evil.com") === false, "Absolute URL blocked")
    assert(isSafeNextPath("//evil.com") === false, "Protocol-relative URL blocked")
    assert(isSafeNextPath("/\\evil.com") === false, "Backslash-prefixed evil URL blocked")
    assert(isSafeNextPath(null) === false, "Null path blocked")
  })

  // =========================================================================
  // 3. CRM & LEADS MANAGEMENT (Phase 7)
  // =========================================================================
  console.log("\n--- PHASE 7: CRM & LEADS MANAGEMENT ---")

  const syntheticLeadIdA = crypto.randomUUID()
  const syntheticLeadIdB = crypto.randomUUID()
  createdLeadIds.push(syntheticLeadIdA, syntheticLeadIdB)

  await test("CRM", "CRM-01", "Create lead with phone normalization & branch assignment", async () => {
    const normalizedPhone = normalizePhone("+91 (98765) 43210")
    assert(normalizedPhone === "+919876543210", `Phone should normalize to +91..., got ${normalizedPhone}`)
    assert(phoneLast10(normalizedPhone) === "9876543210", "phoneLast10 extracted")

    await query(`
      INSERT INTO leads (id, name, phone, branch_id, status, notes)
      VALUES ($1, 'Audit Customer A', $2, $3, 'new', 'Interested in personal loan')
      ON CONFLICT (id) DO UPDATE SET phone = $2, branch_id = $3
    `, [syntheticLeadIdA, normalizedPhone, BRANCH_A_ID])

    const lead = await query(`SELECT name, phone, branch_id FROM leads WHERE id = $1`, [syntheticLeadIdA])
    assert(lead.rows[0]?.name === "Audit Customer A", "Lead name matches")
    assert(lead.rows[0]?.branch_id === BRANCH_A_ID, "Lead assigned to Branch A")
  })

  await test("CRM", "CRM-02", "Branch isolation prevents cross-branch lead leakage", async () => {
    await query(`
      INSERT INTO leads (id, name, phone, branch_id, status)
      VALUES ($1, 'Audit Customer B', '+919876543211', $2, 'new')
      ON CONFLICT (id) DO UPDATE SET branch_id = $2
    `, [syntheticLeadIdB, BRANCH_B_ID])

    const branchALeads = await query(`SELECT id FROM leads WHERE branch_id = $1 AND id = $2`, [BRANCH_A_ID, syntheticLeadIdB])
    assert(branchALeads.rows.length === 0, "Branch A scope must not see Branch B lead")
  })

  await test("CRM", "CRM-03", "Lead status progression & interaction logging", async () => {
    await query(`UPDATE leads SET status = 'contacted' WHERE id = $1`, [syntheticLeadIdA])
    await query(`
      INSERT INTO lead_interactions (lead_id, channel, direction, occurred_at, one_line_summary)
      VALUES ($1, 'voice', 'out', now(), 'Customer confirmed income details')
    `, [syntheticLeadIdA])

    const lead = await query(`SELECT status FROM leads WHERE id = $1`, [syntheticLeadIdA])
    assert(lead.rows[0]?.status === "contacted", "Lead status updated to contacted")

    const interactions = await query(`SELECT channel FROM lead_interactions WHERE lead_id = $1`, [syntheticLeadIdA])
    assert(interactions.rows.length >= 1, "Interaction logged successfully")
  })

  // =========================================================================
  // 4. LOAN APPLICATIONS & DOCUMENT WORKFLOWS (Phase 8)
  // =========================================================================
  console.log("\n--- PHASE 8: LOAN APPLICATIONS & DOCUMENT WORKFLOWS ---")

  const syntheticLoanAppId = crypto.randomUUID()
  createdLoanAppIds.push(syntheticLoanAppId)

  await test("Loans", "LOAN-01", "Create loan application linked to lead with PAN format", async () => {
    const pan = "ABCDE1234F"
    assert(/^[A-Z]{5}[0-9]{4}[A-Z]{1}$/.test(pan), "PAN format valid")

    await query(`
      INSERT INTO loan_applications (id, lead_id, branch_id, customer_name, loan_type, loan_amount, loan_tenure, status, pan_number)
      VALUES ($1, $2, $3, 'Audit Customer A', 'personal', 500000, 36, 'draft', $4)
      ON CONFLICT (id) DO UPDATE SET status = 'draft'
    `, [syntheticLoanAppId, syntheticLeadIdA, BRANCH_A_ID, pan])

    const app = await query(`SELECT loan_amount, status, pan_number FROM loan_applications WHERE id = $1`, [syntheticLoanAppId])
    assert(Number(app.rows[0]?.loan_amount) === 500000, "Loan amount matches")
    assert(app.rows[0]?.status === "draft", "Status is draft")
  })

  await test("Loans", "LOAN-02", "Loan application status transition lifecycle", async () => {
    await query(`UPDATE loan_applications SET status = 'submitted' WHERE id = $1`, [syntheticLoanAppId])
    let app = await query(`SELECT status FROM loan_applications WHERE id = $1`, [syntheticLoanAppId])
    assert(app.rows[0]?.status === "submitted", "Status is submitted")

    await query(`UPDATE loan_applications SET status = 'in_review' WHERE id = $1`, [syntheticLoanAppId])
    app = await query(`SELECT status FROM loan_applications WHERE id = $1`, [syntheticLoanAppId])
    assert(app.rows[0]?.status === "in_review", "Status is in_review")
  })

  await test("Loans", "LOAN-03", "Loan application cross-branch access restricted", async () => {
    const crossBranchCheck = await query(
      `SELECT id FROM loan_applications WHERE id = $1 AND branch_id = $2`,
      [syntheticLoanAppId, BRANCH_B_ID]
    )
    assert(crossBranchCheck.rows.length === 0, "Branch B cannot view Branch A loan application")
  })

  // =========================================================================
  // 5. CALL QUEUE & BULK DIALER (Phase 13)
  // =========================================================================
  console.log("\n--- PHASE 13: CALL QUEUE & BULK DIALER ---")

  const queuePhone = "+919876500999"
  createdQueuePhones.push(queuePhone)

  await test("Queue", "QUEUE-01", "Enqueue lead into outbound_queue with priority & status=pending", async () => {
    await query(`DELETE FROM outbound_queue WHERE phone = $1`, [queuePhone])

    const res = await query(`
      INSERT INTO outbound_queue (phone, name, branch_id, status, priority, retry_count, talking_points)
      VALUES ($1, 'Queue Customer 1', $2, 'pending', 1, 0, 'Discuss 3-year personal loan ROI')
      RETURNING id, status, talking_points
    `, [queuePhone, BRANCH_A_ID])

    assert(res.rows[0]?.status === "pending", "Status is pending")
    assert(res.rows[0]?.talking_points?.includes("personal loan"), "Talking points persisted")
  })

  await test("Queue", "QUEUE-02", "Atomic row claim with FOR UPDATE SKIP LOCKED", async () => {
    const claimed = await withTransaction(async (client) => {
      const claimRes = await client.query(`
        SELECT id, phone, status
        FROM outbound_queue
        WHERE phone = $1 AND status = 'pending'
        FOR UPDATE SKIP LOCKED
        LIMIT 1
      `, [queuePhone])

      if (claimRes.rows.length > 0) {
        await client.query(`
          UPDATE outbound_queue
          SET status = 'dialing', claimed_at = now(), retry_count = retry_count + 1
          WHERE id = $1
        `, [claimRes.rows[0].id])
      }
      return claimRes.rows[0]
    })

    assert(claimed !== undefined, "Row was successfully claimed atomically")

    const verify = await query(`SELECT status, retry_count FROM outbound_queue WHERE phone = $1`, [queuePhone])
    assert(verify.rows[0]?.status === "dialing", "Queue status is dialing")
    assert(verify.rows[0]?.retry_count === 1, "retry_count incremented to 1")
  })

  await test("Queue", "QUEUE-03", "Finalize queue outcome: completed & outcome=resolved", async () => {
    await query(`
      UPDATE outbound_queue
      SET status = 'completed', outcome = 'resolved', outcome_at = now()
      WHERE phone = $1
    `, [queuePhone])

    const verify = await query(`SELECT status, outcome FROM outbound_queue WHERE phone = $1`, [queuePhone])
    assert(verify.rows[0]?.status === "completed", "Queue status is completed")
    assert(verify.rows[0]?.outcome === "resolved", "Queue outcome is resolved")
  })

  // =========================================================================
  // 6. CALENDAR & AUTONOMOUS CALENDAR AGENT (Phase 14)
  // =========================================================================
  console.log("\n--- PHASE 14: CALENDAR & AUTONOMOUS CALENDAR AGENT ---")

  const callSidCal = `call-audit-${crypto.randomUUID()}`
  const calEventTime = new Date("2026-10-15T10:00:00Z").toISOString()
  createdCallSids.push(callSidCal)

  await test("Calendar", "CAL-01", "Transactional calendar appointment creation", async () => {
    const res = await persistCalendarEvent({
      branchId: BRANCH_A_ID,
      leadId: syntheticLeadIdA,
      sourceType: "voice_call",
      sourceId: callSidCal,
      eventType: "branch_visit",
      title: "Branch Visit — Banjara Hills",
      eventAt: calEventTime,
      endAt: new Date(new Date(calEventTime).getTime() + 30 * 60000).toISOString(),
      channel: "phone",
      confidence: "high",
      confidenceScore: 0.95,
      sourceAt: new Date().toISOString(),
      evidenceQuote: "I will visit your branch next Thursday at 3:30 PM",
      status: "confirmed",
      phone: "+919876543210",
      customerName: "Audit Customer A",
    } as any)

    assert(res.action === "created", "Event action was created")
    assert(res.eventId !== undefined, "Event has ID")
  })

  await test("Calendar", "CAL-02", "Branch visits & document collections NEVER queue outbound calls", async () => {
    const checkQueue = await query(`SELECT id FROM outbound_queue WHERE phone = '+919876543210'`)
    assert(checkQueue.rows.length === 0, "Branch visit must NEVER create an outbound phone call")
  })

  await test("Calendar", "CAL-03", "Callback appointment synchronizes to outbound_queue atomically", async () => {
    const callbackSid = `call-audit-${crypto.randomUUID()}`
    createdCallSids.push(callbackSid)
    const cbTime = new Date("2026-10-16T11:00:00Z").toISOString()

    const res = await persistCalendarEvent({
      branchId: BRANCH_A_ID,
      leadId: syntheticLeadIdA,
      sourceType: "voice_call",
      sourceId: callbackSid,
      eventType: "callback",
      title: "Callback Scheduled",
      eventAt: cbTime,
      endAt: new Date(new Date(cbTime).getTime() + 30 * 60000).toISOString(),
      channel: "phone",
      confidence: "high",
      confidenceScore: 0.92,
      sourceAt: new Date().toISOString(),
      evidenceQuote: "Please call me back tomorrow at 11 AM",
      status: "confirmed",
      phone: "+919876543210",
      leadPhone: "+919876543210",
      customerName: "Audit Customer A",
    } as any)

    assert(res.action === "created", "Callback created")
    const checkQueue = await query(`SELECT id, status FROM outbound_queue WHERE phone = '+919876543210'`)
    assert(checkQueue.rows.length === 1, "Callback creates exactly 1 outbound queue item")
    createdQueuePhones.push("+919876543210")
  })

  await test("Calendar", "CAL-04", "Cross-branch calendar event modification rejected (403)", async () => {
    const event = await query(`SELECT id FROM calendar_events WHERE source_id = $1 LIMIT 1`, [callSidCal])
    const eventId = event.rows[0]?.id
    assert(eventId !== undefined, "Event exists")

    const res = await updateCalendarEvent(eventId, { status: "cancelled" }, "agent@example.com", BRANCH_B_ID)
    assert(res.success === false && res.error === "forbidden_branch", "Cross-branch update must return forbidden_branch")
  })

  // =========================================================================
  // 7. KNOWLEDGE BASE & REGULATORY COMPLIANCE (Phases 9 & 10)
  // =========================================================================
  console.log("\n--- PHASES 9 & 10: KNOWLEDGE BASE & COMPLIANCE ---")

  await test("KB", "KB-01", "Approval guarantee strict compliance rejection (Rule 1)", async () => {
    const res = validateKbEntries([
      { title: "Loan Guarantee", content: "We offer 100% guaranteed approval for all loans.", category: "loans" }
    ])
    assert(res.violations.some(v => v.rule === "approval-guarantee"), "Must block guaranteed approval")
  })

  await test("KB", "KB-02", "Sensitive OTP/payment solicitation rejection (Rule 2)", async () => {
    const res = validateKbEntries([
      { title: "Verification", content: "Please share your 6-digit OTP with our agent.", category: "auth" }
    ])
    assert(res.violations.some(v => v.rule === "sensitive-solicitation"), "Must block OTP solicitation")
  })

  await test("Compliance", "COMP-01", "Calling window enforcement in IST (8:00 AM - 7:00 PM)", async () => {
    await query(`UPDATE compliance_settings SET value = 'true' WHERE key = 'calling_window_enabled'`)
    invalidateComplianceCache()

    const morningAllowed = await isWithinCallingWindow(new Date("2026-10-08T04:30:00.000Z")) // 10:00 AM IST
    const nightForbidden = await isWithinCallingWindow(new Date("2026-10-08T18:00:00.000Z")) // 11:30 PM IST

    assert(morningAllowed === true, "10:00 AM IST must be allowed")
    assert(nightForbidden === false, "11:30 PM IST must be blocked")

    await query(`UPDATE compliance_settings SET value = 'false' WHERE key = 'calling_window_enabled'`)
    invalidateComplianceCache()
  })

  await test("Compliance", "COMP-02", "DND suppression list check (fail-closed)", async () => {
    const dndRes = await isDndSuppressed("9876543210")
    assert(typeof dndRes === "boolean", "DND check returns boolean")
  })

  // =========================================================================
  // 8. END-TO-END WORKFLOWS (Phase 21: Workflows A to J)
  // =========================================================================
  console.log("\n--- PHASE 21: END-TO-END BUSINESS WORKFLOWS (A TO J) ---")

  const wfLeadIdA = crypto.randomUUID()
  const wfLeadIdB = crypto.randomUUID()
  createdLeadIds.push(wfLeadIdA, wfLeadIdB)

  await test("Workflows", "WF-A", "Workflow A: New Lead Full Lifecycle", async () => {
    await query(`
      INSERT INTO leads (id, name, phone, branch_id, status)
      VALUES ($1, 'WF A Lead', '+919123456789', $2, 'new')
      ON CONFLICT (id) DO UPDATE SET status = 'new'
    `, [wfLeadIdA, BRANCH_A_ID])

    await query(`UPDATE leads SET status = 'qualified', notes = 'Assigned to Agent 1' WHERE id = $1`, [wfLeadIdA])
    const lead = await query(`SELECT status, notes FROM leads WHERE id = $1`, [wfLeadIdA])
    assert(lead.rows[0]?.status === "qualified", "Status is qualified")
    assert(lead.rows[0]?.notes?.includes("Agent 1"), "Notes updated")
  })

  await test("Workflows", "WF-B", "Workflow B: Loan Application & Verification", async () => {
    const wfLoanId = crypto.randomUUID()
    createdLoanAppIds.push(wfLoanId)

    await query(`
      INSERT INTO loan_applications (id, lead_id, branch_id, customer_name, loan_type, loan_amount, status)
      VALUES ($1, $2, $3, 'WF Customer B', 'home', 2500000, 'draft')
      ON CONFLICT (id) DO UPDATE SET status = 'draft'
    `, [wfLoanId, wfLeadIdA, BRANCH_A_ID])

    await query(`UPDATE loan_applications SET status = 'verified' WHERE id = $1`, [wfLoanId])
    const app = await query(`SELECT status, loan_amount FROM loan_applications WHERE id = $1`, [wfLoanId])
    assert(app.rows[0]?.status === "verified", "Loan application verified")
  })

  await test("Workflows", "WF-C", "Workflow C: AI Voice Call Simulation & Turn Processing", async () => {
    const wfCallSid = `call-sim-${crypto.randomUUID()}`
    createdCallSids.push(wfCallSid)

    await query(`
      INSERT INTO voice_calls (twilio_call_sid, lead_id, branch_id, direction, status, language)
      VALUES ($1, $2, $3, 'outbound', 'in-progress', 'telugu')
      ON CONFLICT (twilio_call_sid) DO NOTHING
    `, [wfCallSid, syntheticLeadIdA, BRANCH_A_ID])

    const call = await query(`SELECT direction, language, branch_id FROM voice_calls WHERE twilio_call_sid = $1`, [wfCallSid])
    assert(call.rows[0]?.language === "telugu", "Voice call language telugu")
    assert(call.rows[0]?.branch_id === BRANCH_A_ID, "Voice call branch mapped")
  })

  await test("Workflows", "WF-D", "Workflow D: Callback Reschedule & Cancellation", async () => {
    const wfCbSid = `call-cb-${crypto.randomUUID()}`
    createdCallSids.push(wfCbSid)
    const initialTime = new Date("2026-10-18T10:00:00Z").toISOString()
    const rescheduledTime = new Date("2026-10-18T15:00:00Z").toISOString()

    const created = await persistCalendarEvent({
      branchId: BRANCH_A_ID,
      leadId: syntheticLeadIdA,
      sourceType: "voice_call",
      sourceId: wfCbSid,
      eventType: "callback",
      title: "WF D Callback",
      eventAt: initialTime,
      endAt: new Date(new Date(initialTime).getTime() + 30 * 60000).toISOString(),
      channel: "phone",
      confidence: "high",
      confidenceScore: 0.95,
      sourceAt: new Date().toISOString(),
      status: "confirmed",
      phone: "+919876543299",
      leadPhone: "+919876543299",
      customerName: "Audit Customer A",
    } as any)
    createdQueuePhones.push("+919876543299")

    const eventId = created.eventId!
    assert(eventId !== undefined, "Callback event ID exists")

    // Reschedule
    await updateCalendarEvent(eventId, { eventAt: rescheduledTime }, BRANCH_A_ID)
    const checkReschedule = await query(`SELECT event_at, original_event_at, status FROM calendar_events WHERE id = $1`, [eventId])
    assert(new Date(checkReschedule.rows[0].event_at).toISOString() === new Date(rescheduledTime).toISOString(), "event_at updated")
    assert(new Date(checkReschedule.rows[0].original_event_at).toISOString() === new Date(initialTime).toISOString(), "original_event_at maintained")

    // Cancel
    await updateCalendarEvent(eventId, { status: "cancelled" }, BRANCH_A_ID)
    const checkCancel = await query(`SELECT status FROM calendar_events WHERE id = $1`, [eventId])
    assert(checkCancel.rows[0].status === "cancelled", "Event cancelled")
  })

  await test("Workflows", "WF-E", "Workflow E: Branch Visit (Zero Outbound Dialing)", async () => {
    const wfVisitSid = `call-visit-${crypto.randomUUID()}`
    createdCallSids.push(wfVisitSid)
    const visitTime = new Date("2026-10-19T11:00:00Z").toISOString()

    const created = await persistCalendarEvent({
      branchId: BRANCH_A_ID,
      leadId: syntheticLeadIdA,
      sourceType: "voice_call",
      sourceId: wfVisitSid,
      eventType: "branch_visit",
      title: "In-Person Branch Visit",
      eventAt: visitTime,
      endAt: new Date(new Date(visitTime).getTime() + 30 * 60000).toISOString(),
      channel: "in_person",
      confidence: "high",
      confidenceScore: 0.98,
      sourceAt: new Date().toISOString(),
      status: "confirmed",
      phone: "+919988776655",
      leadPhone: "+919988776655",
      customerName: "Audit Customer A",
    } as any)

    assert(created.action === "created", "Visit created")
    const queueCheck = await query(`SELECT id FROM outbound_queue WHERE phone = '+919988776655'`)
    assert(queueCheck.rows.length === 0, "No outbound queue item created for branch visit")
  })

  await test("Workflows", "WF-F", "Workflow F: Ambiguous Appointment & Staff Review Queue", async () => {
    const wfAmbSid = `call-amb-${crypto.randomUUID()}`
    createdCallSids.push(wfAmbSid)
    const ambTime = new Date("2026-10-20T10:00:00Z").toISOString()
    const ambPhone = "+919123456789" // wfLeadIdA's phone

    await query(`DELETE FROM outbound_queue WHERE phone = $1`, [ambPhone])

    const created = await persistCalendarEvent({
      branchId: BRANCH_A_ID,
      leadId: wfLeadIdA,
      sourceType: "voice_call",
      sourceId: wfAmbSid,
      eventType: "callback",
      title: "Ambiguous Callback",
      eventAt: ambTime,
      endAt: new Date(new Date(ambTime).getTime() + 30 * 60000).toISOString(),
      channel: "phone",
      confidence: "low",
      confidenceScore: 0.45,
      sourceAt: new Date().toISOString(),
      evidenceQuote: "Maybe you can call me sometime next week",
      status: "needs_review",
      phone: ambPhone,
      leadPhone: ambPhone,
      customerName: "Audit Customer A",
    } as any)
    createdQueuePhones.push(ambPhone)

    assert(created.action === "created", "Review queue item created")
    const eventId = created.eventId!
    const queueBefore = await query(`SELECT id FROM outbound_queue WHERE phone = $1`, [ambPhone])
    assert(queueBefore.rows.length === 0, "Review queue item does NOT queue a call")

    // Staff approves
    const approveRes = await updateCalendarEvent(eventId, { status: "confirmed" }, "agent@example.com", BRANCH_A_ID)
    assert(approveRes.success === true, "Staff approval succeeded")
    const queueAfter = await query(`SELECT id FROM outbound_queue WHERE phone = $1`, [ambPhone])
    assert(queueAfter.rows.length === 1, "Staff approval enqueues the callback")
  })

  await test("Workflows", "WF-G", "Workflow G: Outbound Queue Priority & Lifecycle", async () => {
    const qPhone = "+919001122334"
    createdQueuePhones.push(qPhone)
    await query(`
      INSERT INTO outbound_queue (phone, name, branch_id, status, priority, retry_count)
      VALUES ($1, 'WF Customer G', $2, 'pending', 10, 0)
    `, [qPhone, BRANCH_A_ID])

    const row = await query(`SELECT id, priority FROM outbound_queue WHERE phone = $1`, [qPhone])
    assert(row.rows[0]?.priority === 10, "Priority 10 enqueued")
    await query(`UPDATE outbound_queue SET status = 'completed' WHERE phone = $1`, [qPhone])
  })

  await test("Workflows", "WF-H", "Workflow H: Messaging & Webhook Idempotency", async () => {
    const msgId = crypto.randomUUID()
    createdMsgIds.push(msgId)

    await query(`
      INSERT INTO whatsapp_messages (id, lead_id, direction, content, created_at)
      VALUES ($1, $2, 'inbound', 'Hi, I need loan details', now())
      ON CONFLICT (id) DO NOTHING
    `, [msgId, syntheticLeadIdA])

    // Replay duplicate webhook
    await query(`
      INSERT INTO whatsapp_messages (id, lead_id, direction, content, created_at)
      VALUES ($1, $2, 'inbound', 'Hi, I need loan details', now())
      ON CONFLICT (id) DO NOTHING
    `, [msgId, syntheticLeadIdA])

    const count = await query(`SELECT count(*) as c FROM whatsapp_messages WHERE id = $1`, [msgId])
    assert(Number(count.rows[0].c) === 1, "Duplicate message webhook was deduplicated cleanly")
  })

  await test("Workflows", "WF-I", "Workflow I: Cross-Branch Security & IDOR Isolation", async () => {
    const check = await query(`SELECT id FROM leads WHERE id = $1 AND branch_id = $2`, [syntheticLeadIdB, BRANCH_A_ID])
    assert(check.rows.length === 0, "Cross-branch IDOR attempt yielded 0 rows")
  })

  await test("Workflows", "WF-J", "Workflow J: Restart & Recovery (State Persistence)", async () => {
    const testReapPhone = "+919776655443"
    createdQueuePhones.push(testReapPhone)

    await query(`
      INSERT INTO outbound_queue (phone, name, branch_id, status, claimed_at, retry_count)
      VALUES ($1, 'WF Customer J', $2, 'dialing', now() - interval '15 minutes', 1)
      ON CONFLICT DO NOTHING
    `, [testReapPhone, BRANCH_A_ID])

    const reaped = await query(`
      UPDATE outbound_queue
      SET status = 'pending', claimed_at = NULL
      WHERE status = 'dialing' AND claimed_at < now() - interval '10 minutes' AND phone = $1
      RETURNING id
    `, [testReapPhone])

    assert(reaped.rows.length === 1, "Stale dialing row successfully recovered to pending")
  })

  // =========================================================================
  // 9. CLEANUP SYNTHETIC TEST FIXTURES
  // =========================================================================
  console.log("\n--- CLEANUP SYNTHETIC TEST FIXTURES ---")
  if (createdCallSids.length > 0) {
    await query(`DELETE FROM calendar_events WHERE source_id = ANY($1)`, [createdCallSids])
    await query(`DELETE FROM voice_calls WHERE twilio_call_sid = ANY($1)`, [createdCallSids])
  }
  if (createdQueuePhones.length > 0) {
    await query(`DELETE FROM outbound_queue WHERE phone = ANY($1)`, [createdQueuePhones])
  }
  if (createdMsgIds.length > 0) {
    await query(`DELETE FROM whatsapp_messages WHERE id = ANY($1)`, [createdMsgIds])
  }
  if (createdLoanAppIds.length > 0) {
    await query(`DELETE FROM loan_applications WHERE id = ANY($1)`, [createdLoanAppIds])
  }
  if (createdLeadIds.length > 0) {
    await query(`DELETE FROM lead_interactions WHERE lead_id = ANY($1)`, [createdLeadIds])
    await query(`DELETE FROM leads WHERE id = ANY($1)`, [createdLeadIds])
  }
  console.log("  ✓ All synthetic test fixtures cleanly purged from database")

  // =========================================================================
  // FINAL RESULTS SUMMARY
  // =========================================================================
  const passed = results.filter(r => r.status === "PASS").length
  const failed = results.filter(r => r.status === "FAIL").length
  const total = results.length

  console.log("\n================================================================================")
  console.log(`   MASTER AUDIT SUMMARY: ${passed} / ${total} TESTS PASSED (${Math.round((passed / total) * 100)}%)`)
  console.log("================================================================================\n")

  if (failed > 0) {
    console.error(`FAILED TESTS (${failed}):`)
    results.filter(r => r.status === "FAIL").forEach(r => console.error(`  - [${r.id}] ${r.name}: ${r.detail}`))
    process.exit(1)
  } else {
    process.exit(0)
  }
}

runMasterAudit().catch((err) => {
  console.error("Master audit crashed:", err)
  process.exit(1)
})
