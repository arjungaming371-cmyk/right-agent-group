require('dotenv').config()
const { Client } = require('pg')

async function dial() {
  const authId = process.env.VOBIZ_AUTH_ID
  const authToken = process.env.VOBIZ_AUTH_TOKEN
  const callerId = process.env.VOBIZ_CALLER_ID
  const to = "+916301689511"
  const leadId = "c0ce489e-0279-47ba-99a7-ac94640fd04c"
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://dosage-sift-mower.ngrok-free.dev"
  const answerUrl = `${appUrl.replace(/\/+$/, '')}/api/calls/vobiz-answer?leadId=${encodeURIComponent(leadId)}&lang=telugu`
  const statusCallback = `${appUrl.replace(/\/+$/, '')}/api/calls/status`

  console.log(`Dialing from ${callerId} to ${to}...`)
  console.log(`Answer URL: ${answerUrl}`)

  const payload = {
    from: callerId,
    to: to,
    answer_url: answerUrl,
    answer_method: "POST",
    status_callback_url: statusCallback,
    status_callback_method: "POST",
  }

  const url = `https://api.vobiz.ai/api/v1/Account/${authId}/Call/`

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "X-Auth-ID": authId,
      "X-Auth-Token": authToken,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  })

  const data = await res.json().catch(() => ({}))
  console.log("Vobiz Response:", JSON.stringify(data, null, 2))

  if (!res.ok) {
    throw new Error(data?.message || data?.error || `Vobiz HTTP ${res.status}`)
  }

  const callSid = data.call_uuid || data.callId || data.request_id || "vobiz_" + Date.now()

  // Save to DB so Priya can associate the turn and conversation with this lead
  const client = new Client({
    host: process.env.PG_HOST,
    port: process.env.PG_PORT,
    database: process.env.PG_DATABASE,
    user: process.env.PG_USER,
    password: process.env.PG_PASSWORD,
  })

  await client.connect()
  try {
    await client.query(`
      INSERT INTO voice_calls (lead_id, twilio_call_sid, direction, status, language, phone)
      VALUES ($1, $2, 'outbound', 'initiated', 'telugu', $3)
    `, [leadId, callSid, to])

    await client.query(`
      INSERT INTO comm_logs (lead_id, type, summary, outcome)
      VALUES ($1, 'call', $2, 'pending')
    `, [leadId, `Outbound call initiated to ${to} via Vobiz`])
    console.log(`Call logged in database: ${callSid}`)
  } finally {
    await client.end()
  }

  return callSid
}

dial().catch(console.error)
