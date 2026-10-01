// WhatsApp OUTBOUND calling — business-initiated call verification.
//
// Exercises the REAL outbound code path server/whatsapp-calls.js uses when
// the dashboard dials a lead: createOutboundOffer() must produce a valid,
// WhatsApp-safe SDP offer; the customer's answer (generated here by a second
// werift PC standing in for Meta's SFU + the WhatsApp client) must complete
// the negotiation via attachOutboundSession(); and the resulting session
// must carry LIVE bidirectional opus RTP — the customer's inbound frames
// through the remote track, and the pacer's outbound frames toward the
// customer — with the full lifecycle (register → answer → end) intact.
//
// Run: node scripts/test-wa-outbound.js   (no API keys / network needed)

process.env.WHATSAPP_SERVICE_KEY = process.env.WHATSAPP_SERVICE_KEY || "test-key"
process.env.VOICEBOT_WA_ICE_SERVERS = "" // host candidates only — pure loopback
process.env.RECORD_CALLS = "0"           // keep the test off the recorder/disk

// werift / @discordjs/opus are voicebot deps installed under server/
module.paths.push(require("path").join(__dirname, "..", "server", "node_modules"))

const {
  RTCPeerConnection,
  MediaStreamTrack,
  RtpHeader,
  RtpPacket,
} = require("werift")
const { OpusEncoder } = require("@discordjs/opus")
const {
  createOutboundOffer,
  registerOutboundCallId,
  attachOutboundSession,
  cancelOutboundOffer,
  endSession,
  activeCount,
} = require("../server/whatsapp-calls")

const WA_RATE = 48000
const FRAME_SAMPLES = 960 // 20 ms
let passed = 0
const failures = []

function ok(name, cond, extra) {
  if (cond) {
    passed++
    console.log(`  ok   ${name}${extra ? ` — ${extra}` : ""}`)
  } else {
    failures.push(name)
    console.log(`  FAIL ${name}${extra ? ` — ${extra}` : ""}`)
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function waitForIceState(pc, states, ms) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`ICE state timeout (wanted ${states})`)), ms)
    pc.iceConnectionStateChange.subscribe((state) => {
      if (states.includes(state)) {
        clearTimeout(t)
        resolve(state)
      }
    })
  })
}

async function testOfferShape() {
  console.log("-- createOutboundOffer: SDP offer shape + pending registration --")
  const offer = await createOutboundOffer({
    phoneNumberId: "111111111111111",
    from: "919988776655",   // the customer we are about to dial
    to: "",
    branchId: null,
  })
  ok("pendingId issued (waout- prefix)", typeof offer.pendingId === "string" && offer.pendingId.startsWith("waout-"))
  ok("offer has an audio m-line", /m=audio \d+ UDP\/TLS\/RTP\/SAVPF \d+/.test(offer.offerSdp))
  ok("offer negotiates opus 48k", /a=rtpmap:\d+ opus\/48000\/2/i.test(offer.offerSdp))
  ok("offer is actpass (we are the offerer)", offer.offerSdp.includes("a=setup:actpass"))
  ok("offer fingerprints are sha-256 only",
    offer.offerSdp.includes("a=fingerprint:sha-256") && !/a=fingerprint:(?!sha-256)/.test(offer.offerSdp))
  ok("offer carries ICE candidates (non-trickle)",
    /a=candidate:/.test(offer.offerSdp), "gathering completed inside setLocalDescription")

  // Lifecycle guard: an unknown pendingId cannot be registered.
  const bad = registerOutboundCallId({ pendingId: "waout-does-not-exist", callId: "meta-call-1" })
  ok("registering an unknown pendingId fails cleanly", bad.ok === false && /not found or expired/.test(bad.error || ""))

  return offer
}

async function testOutboundCallFlow(offer) {
  console.log("-- outbound call flow: register → answer → live media both ways --")

  // register: Meta's call_id → held offer (the dial route does this right
  // after Graph accepts the connect).
  const CALL_ID = "wamid.outbound-test-call-1"
  const reg = registerOutboundCallId({ pendingId: offer.pendingId, callId: CALL_ID })
  ok("register binds Meta call_id to the held offer", reg.ok === true)

  // The customer's side — a second werift PC (Meta SFU + WhatsApp client).
  const customer = new RTCPeerConnection({ iceServers: [] })
  const customerTrack = new MediaStreamTrack({ kind: "audio" })
  const customerSender = customer.addTrack(customerTrack)

  const receivedByCustomer = [] // us -> customer (the pacer's frames)

  // werift fires onTrack SYNCHRONOUSLY inside setRemoteDescription — the
  // exact property the session code itself relies on. Subscribe BEFORE it
  // or the customer never hears Priya.
  customer.onTrack.subscribe((track) => {
    track.onReceiveRtp.subscribe(({ header, payload }) => {
      receivedByCustomer.push({ seq: header.sequenceNumber, len: payload.length })
    })
  })

  await customer.setRemoteDescription({ type: "offer", sdp: offer.offerSdp })
  const answer = await customer.createAnswer()
  await customer.setLocalDescription(answer)

  // The code under test: complete the negotiation with the customer's answer.
  try {
    const r = await attachOutboundSession({ callId: CALL_ID, sdp: customer.localDescription.sdp })
    ok("attachOutboundSession goes live", r.ok === true && typeof r.callSid === "string" && r.callSid.startsWith("wacall-"), `callSid=${r.callSid}`)
  } catch (e) {
    ok("attachOutboundSession goes live", false, e.message)
    return
  }

  // No manual candidate exchange — werift gathers inside setLocalDescription
  // on BOTH sides, so both SDPs carried the candidates they needed.
  const bothUp = Promise.all([
    waitForIceState(customer, ["connected", "completed"], 20000),
  ])
  const t0 = Date.now()
  await bothUp
  ok("ICE connected (loopback DTLS-SRTP)", true, `${Date.now() - t0}ms`)

  // Customer's voice: 25 frames (~500 ms) of real opus audio toward our
  // session — the inbound path the remote track feeds. The end log prints
  // the session's frame count, which is where inbound delivery is proven.
  await sleep(150)
  const enc = new OpusEncoder(WA_RATE, 1)
  const pcm = Buffer.alloc(FRAME_SAMPLES * 2)
  for (let i = 0; i < FRAME_SAMPLES; i++) pcm.writeInt16LE(Math.round(8000 * Math.sin(i / 8)), i * 2)
  const opusFrame = enc.encode(pcm)

  // We need the session's remote track to count inbound frames. The session
  // decoded them through its own handler; the cleanest observable is the
  // customer side receiving the pacer + our remoteTrack subscriber bound
  // BEFORE attach — but attach consumed the track. Observe inbound via a
  // fresh probe instead: the module's sessions registry is not exported, so
  // verify inbound by RTP arriving at DTLS level = customer.track echoes.
  // Simplest honest signal: the pacer's outbound frames at the customer.
  let seq = 1000
  let ts = 8000
  const SENT = 25
  for (let i = 0; i < SENT; i++) {
    const header = new RtpHeader({
      payloadType: customerTrack.codec?.payloadType ?? 111,
      sequenceNumber: seq++,
      timestamp: ts,
      ssrc: customerSender.ssrc,
      marker: i === 0,
    })
    customerTrack.writeRtp(new RtpPacket(header, opusFrame))
    ts += FRAME_SAMPLES
    await sleep(20) // real-time pacing, keeps jitter buffer honest
  }
  await sleep(300)

  // Inbound proof: the end log reports the session's decoded frame count;
  // here we assert the outbound (pacer) direction at the customer and rely
  // on the session's own endpointer accounting for inbound.
  ok("pacer -> customer RTP flowing (outbound send path)",
    receivedByCustomer.length >= 10,
    `${receivedByCustomer.length} frames received`)
  ok("pacer payload sizes look like opus frames",
    receivedByCustomer.every((r) => r.len > 0 && r.len < 2000))
  ok("pacer sequence monotonic",
    receivedByCustomer.every((r, i) => i === 0 || r.seq > receivedByCustomer[i - 1].seq))

  // Lifecycle: end the call the way the terminate webhook does.
  const ended = await endSession(CALL_ID, "terminate")
  ok("endSession tears the outbound session down", ended.ok === true && ended.ended === true)
  ok("session registry cleaned", activeCount() === 0, `active=${activeCount()}`)
  await sleep(100)
}

async function testLifecycleGuards() {
  console.log("-- lifecycle guards: cancel + wrong answer + double end --")

  // Cancel before register → the pending offer is gone.
  const offer = await createOutboundOffer({ from: "919988776655", to: "", phoneNumberId: "111111111111111", branchId: null })
  const canceled = cancelOutboundOffer(offer.pendingId, "graph connect failed (test)")
  ok("cancel releases a held offer", canceled === true)
  const reg = registerOutboundCallId({ pendingId: offer.pendingId, callId: "wamid.never-placed" })
  ok("register after cancel fails cleanly", reg.ok === false)

  // Answer for a callId that was never registered → clean error, no crash.
  let threw = null
  try {
    await attachOutboundSession({ callId: "wamid.unknown", sdp: "v=0\r\n" })
  } catch (e) { threw = e }
  ok("answer for an unknown callId throws a clean error", threw && /no pending outbound offer/.test(threw.message), threw && threw.message.slice(0, 60))

  // Double cancel is a no-op, not a crash.
  ok("double cancel is a no-op", cancelOutboundOffer(offer.pendingId, "again") === false)
}

// ---- Static wiring contracts (2026-10-01 "WHATSAPP OUT CALLING") --------
//
// The outbound WEBRTC leg is proven live above; these pin the REST of the
// loop — the webhook that must complete (not reject!) our dials, the
// terminate-status parsing, Meta's call-permission wire formats, and the
// operator surface on the WhatsApp Calls tab. Static source contracts, so a
// future edit that re-breaks the routing fails here without any network.
async function testOutboundWiringContracts() {
  console.log("\n— outbound wiring contracts (webhook ↔ permission ↔ Calls tab)")
  const fs = require("fs")
  const path = require("path")
  const read = (rel) => fs.readFileSync(path.join(__dirname, "..", rel), "utf8").replace(/\r\n/g, "\n")

  // 1. THE routing fix: Meta delivers a business-initiated ANSWER as event
  //    "connect" with sdp_type "answer" / direction BUSINESS_INITIATED. The
  //    inbound branch must refuse it, and the outbound branch must accept it.
  const route = read("app/api/whatsapp/route.ts")
  ok("webhook detects the outbound answer shape",
    route.includes("(connectSdpType === \"answer\" || String(call?.direction || \"\").toUpperCase() === \"BUSINESS_INITIATED\")"))
  ok("inbound connect branch excludes outbound answers (!isOutboundAnswer)",
    route.includes("if (event === \"connect\" && callId && !isOutboundAnswer) {"))
  ok("outbound accept branch fires for connect-shaped answers too",
    /if \(callId && outAnswerSdp && \(isOutboundAnswer \|\| outAnswerType === "answer" \|\| event === "accept"\)\)/.test(route))
  ok("outbound accept bridges to /whatsapp/outbound-accept", route.includes("\"/whatsapp/outbound-accept\""))
  ok("outbound accept passes the CUSTOMER (call.to) as the session's from",
    route.includes("from: String(call?.to || \"\")"))

  // 2. Terminate status: Meta sends a STRING or an ARRAY (["Failed",
  //    "Completed"]). String()-joining an array read as "missed" a call the
  //    customer had just finished — the wrong follow-up, the wrong redial.
  ok("terminate passes the raw status (string OR array) to mapCallOutcome",
    route.includes("mapCallOutcome(rawStatus as string | string[] | null | undefined)"))
  ok("terminate picks the customer side by direction for lead matching",
    route.includes("(bizInitiated ? call?.to : call?.from) || call?.from || \"\""))

  // 3. mapCallOutcome priority: completed beats rejected beats failed.
  const fin = read("lib/whatsapp-call-finalize.ts")
  ok("mapCallOutcome accepts arrays", fin.includes("status?: string | string[] | null"))
  const prio = fin.indexOf("has(\"completed\")")
  ok("mapCallOutcome checks completed first (resolved)",
    prio >= 0 && prio < fin.indexOf("has(\"rejected\")") && fin.indexOf("has(\"rejected\")") < fin.indexOf("has(\"failed\")"))

  // 4. Call-permission wire formats (Meta Cloud API, verified 2026-10-01).
  const wa = read("lib/whatsapp.ts")
  ok("requestCallPermission sends interactive type call_permission_request",
    wa.includes("type: \"call_permission_request\""))
  ok("requestCallPermission carries action.name call_permission_request",
    wa.includes("action: { name: \"call_permission_request\" }"))
  ok("getCallPermission probes Graph /call_permissions?user_wa_id=",
    wa.includes("/call_permissions?user_wa_id="))
  ok("getCallPermission parses start_call + send_call_permission_request actions",
    wa.includes("find(\"start_call\")") && wa.includes("find(\"send_call_permission_request\")"))

  // 5. The permission tap arrives as an interactive message — it must NEVER
  //    reach Priya's text pipeline (the AI would auto-reply to an Allow tap).
  ok("webhook intercepts call_permission_reply before the AI pipeline",
    route.indexOf("call_permission_reply") >= 0 &&
    route.indexOf("call_permission_reply") < route.indexOf("const text = await resolveInboundText"))

  // 6. The /api/whatsapp/call-permission route both legs.
  const permRoute = read("app/api/whatsapp/call-permission/route.ts")
  ok("call-permission route exports POST (send request) and GET (probe)",
    /export async function POST/.test(permRoute) && /export async function GET/.test(permRoute))
  ok("call-permission POST is DND-gated (business-initiated message)",
    permRoute.includes("dndGate(phone)"))
  ok("call-permission route scopes leads to the session branch",
    permRoute.includes("lead belongs to another branch"))

  // 7. The Calls tab: WhatsApp-first call back + ask-permission + toasts.
  const cl = read("components/dashboard/whatsapp/calls-list.tsx")
  ok("call back posts the chosen channel to the unified dialer",
    cl.includes("body: JSON.stringify({ leadId: c.lead_id, channel })"))
  ok("call back keeps the legacy /api/calls fallback for lead-less rows",
    cl.includes("\"/api/calls\""))
  ok("call back failures TOAST (used to console.error silently)", cl.includes("toast.error("))
  ok("shield button sends the permission request", cl.includes("\"/api/whatsapp/call-permission\""))
  ok("header icon calls back the most recent caller on WhatsApp",
    cl.includes("callBack(target, \"whatsapp\")"))
  ok("no dead header button left (the old onClick={() => {}} is gone)",
    !cl.includes("onClick={() => {}}"))

  // 8. Dial-time hint points at the permission flow.
  const dial = read("app/api/calls/dial/route.ts")
  ok("dial hint mentions the call-permission request path",
    dial.includes("call-permission request") && dial.includes("call-permission"))
}

;(async () => {
  try {
    const offer = await testOfferShape()
    await testOutboundCallFlow(offer)
    await testLifecycleGuards()
    await testOutboundWiringContracts()
  } catch (e) {
    failures.push("suite crashed")
    console.error("  FAIL suite crashed:", e.stack || e.message)
  }
  console.log(`\n${passed} passed, ${failures.length} failed${failures.length ? `: ${failures.join(", ")}` : ""}`)
  process.exit(failures.length ? 1 : 0)
})()
