/**
 * 100+ Scenario Comprehensive Voice Intelligence Test Suite
 * Tests:
 * 1. Disconnect Negation & Command Classification (Multilingual)
 * 2. DND Opt-Out Detection (Short, Long, Cross-Language)
 * 3. Callback Scheduling & Relative Duration Parsing
 * 4. In-Call Deterministic Fact Memory & Correction Tracking
 * 5. Voice Intent & Semantic Analysis (Backchannel, Repeat, Hold, Objections)
 * 6. TTS Speech Normalization (Currency, Acronyms, Citations, Numbers, Markdown)
 */

const assert = require("assert")
const {
  isCallDisconnectIntent,
  detectDndIntent,
} = require("../lib/voice-conversation.ts")
const {
  buildReschedule,
  detectCallerWillCall,
} = require("../lib/speech-scheduler.ts")
const {
  extractCallFacts,
  formatInCallFactsBlock,
  resolveSpokenLanguage,
} = require("../lib/call-facts.ts")
const {
  analyzeVoiceSpeech,
} = require("../lib/voice-intent.ts")
const {
  normalizeForTts,
} = require("../server/voice-providers.js")

console.log("===================================================================")
console.log("🚀 RUNNING 100+ SCENARIO VOICE INTELLIGENCE TEST SUITE (PRIYA UPGRADE)")
console.log("===================================================================\n")

let totalPassed = 0

function runTest(category, name, fn) {
  try {
    fn()
    totalPassed++
    // Silent on individual pass to keep output clean, will summary at end
  } catch (err) {
    console.error(`❌ FAILED [${category}] ${name}:`, err.message)
    throw err
  }
}

// ---------------------------------------------------------------------------
// SUITE 1: Negation-Aware Disconnect Commands (Scenarios 1 - 20)
// ---------------------------------------------------------------------------
const disconnectNegationScenarios = [
  // Telugu Negations (must NOT disconnect)
  { text: "cut cheyoddu", expected: false },
  { text: "phone cut cheyoddu andi", expected: false },
  { text: "cut cheyakandi", expected: false },
  { text: "phone cut cheyakandi vinandi", expected: false },
  { text: "కాల్ కట్ చేయొద్దు", expected: false },
  { text: "కట్ చేయకండి వింటున్నాను", expected: false },
  { text: "ఫోన్ పెట్టొద్దు మాట్లాడాలి", expected: false },

  // English Negations (must NOT disconnect)
  { text: "don't cut the call", expected: false },
  { text: "please do not hang up", expected: false },
  { text: "don't hang up yet", expected: false },
  { text: "do not disconnect I have a question", expected: false },
  { text: "wait don't cut", expected: false },

  // Hindi Negations (must NOT disconnect)
  { text: "call mat kaato", expected: false },
  { text: "phone mat kaatna", expected: false },
  { text: "phone mat rakhiye", expected: false },
  { text: "कॉल मत काटो", expected: false },
  { text: "फोन मत काटना", expected: false },

  // Real Positive Disconnects (MUST disconnect)
  { text: "call cut cheyandi", expected: true },
  { text: "phone kaat do", expected: true },
  { text: "hang up the phone now", expected: true },
]

disconnectNegationScenarios.forEach((s, idx) => {
  runTest("Disconnect Commands", `Scenario ${idx + 1}: "${s.text}" -> ${s.expected}`, () => {
    const res = isCallDisconnectIntent(s.text)
    assert.strictEqual(res, s.expected, `Mismatch for "${s.text}"`)
  })
})
console.log(`✅ Suite 1: Disconnect & Negation Commands passed (${disconnectNegationScenarios.length} scenarios)`)

// ---------------------------------------------------------------------------
// SUITE 2: DND Opt-Out Detection (Scenarios 21 - 35)
// ---------------------------------------------------------------------------
const dndScenarios = [
  { text: "put me on dnd", expected: true },
  { text: "add this number to do not call list", expected: true },
  { text: "stop calling me again and again", expected: true },
  { text: "naaku calls cheyoddu", expected: true },
  { text: "malli call cheyakandi dnd lo pettandi", expected: true },
  { text: "నాకు కాల్స్ వద్దు దయచేసి లిస్ట్ నుండి తీసేయండి", expected: true },
  { text: "dobara phone mat karna", expected: true },
  { text: "mera number dnd me daal do", expected: true },
  { text: "दोबारा मुझे कभी कॉल मत करना, नंबर हटा दो", expected: true },
  {
    text: "Look madam, I am in a very important hospital meeting and I have told your representatives multiple times earlier also that I am not at all interested in any personal loans or credit cards or banking offers right now. I work in an IT company and I do not need any financial assistance. Please take my number off your list and do not call me again in the future. Thank you very much.",
    expected: true,
  },
  {
    text: "చూడండి మేడం, నాకు ఎలాంటి లోన్స్ అవసరం లేదు. నా పర్సనల్ నెంబర్ కి పదే పదే కాల్స్ చేసి విసిగించకండి. నా నెంబర్ మీ డేటాబేస్ నుండి శాశ్వతంగా డిలీట్ చేయండి, ఇంకెప్పుడూ కాల్ చేయవద్దు.",
    expected: true,
  },
  // Non-DND controls (should NOT trigger DND)
  { text: "call me later after 2 hours", expected: false },
  { text: "what is the interest rate for 10 lakhs", expected: false },
  { text: "repu morning call cheyandi", expected: false },
  { text: "send details on whatsapp", expected: false },
]

dndScenarios.forEach((s, idx) => {
  runTest("DND Opt-Out", `Scenario ${20 + idx + 1}: "${s.text.slice(0, 30)}..."`, () => {
    const res = detectDndIntent(s.text)
    assert.strictEqual(res, s.expected, `DND mismatch for "${s.text.slice(0, 40)}"`)
  })
})
console.log(`✅ Suite 2: DND Intent Detection passed (${dndScenarios.length} scenarios)`)

// ---------------------------------------------------------------------------
// SUITE 3: Callback Scheduling & Relative Duration (Scenarios 36 - 50)
// ---------------------------------------------------------------------------
const scheduleScenarios = [
  { text: "call me in two hours", lang: "english", hasTarget: true },
  { text: "call me in 2 hours", lang: "english", hasTarget: true },
  { text: "after 30 minutes call me", lang: "english", hasTarget: true },
  { text: "call me Monday at 6 PM", lang: "english", hasTarget: true },
  { text: "call me tomorrow morning at 10 am", lang: "english", hasTarget: true },
  { text: "repu evening six ki call cheyandi", lang: "telugu", hasTarget: true },
  { text: "repu morning 11 am ki matladadam", lang: "telugu", hasTarget: true },
  { text: "kal shaam 5 baje call karna", lang: "hindi", hasTarget: true },
  { text: "do ghante baad call karo", lang: "hindi", hasTarget: true },
  { text: "call me next Friday at 4 PM", lang: "english", hasTarget: true },
  // Caller will call (NOT agent callback)
  { text: "i will call you later", callerWillCall: true },
  { text: "nene malli call chesta", callerWillCall: true },
  { text: "main baad me call karunga", callerWillCall: true },
  { text: "free ayyaka nene chestale", callerWillCall: true },
  { text: "i will call back tomorrow", callerWillCall: true },
]

scheduleScenarios.forEach((s, idx) => {
  runTest("Scheduling", `Scenario ${35 + idx + 1}: "${s.text}"`, () => {
    if (s.callerWillCall) {
      assert.strictEqual(detectCallerWillCall(s.text), true, `Caller will call failed on "${s.text}"`)
    } else {
      const res = buildReschedule(s.text, s.lang)
      assert(res !== null, `buildReschedule returned null for "${s.text}"`)
      assert(res.whenIso, `whenIso missing for "${s.text}"`)
    }
  })
})
console.log(`✅ Suite 3: Callback Scheduling & Will-Call passed (${scheduleScenarios.length} scenarios)`)

// ---------------------------------------------------------------------------
// SUITE 4: In-Call Fact Memory & Extraction (Scenarios 51 - 65)
// ---------------------------------------------------------------------------
const factScenarios = [
  {
    speech: "my name is Rahul Sharma and I live in Hyderabad",
    verify: (f) => f.name === "Rahul Sharma" && f.area === "Hyderabad",
  },
  {
    speech: "naa peru Venkatesh, Guntur lo untanu",
    verify: (f) => f.name === "Venkatesh" && f.area === "Guntur",
  },
  {
    speech: "I need 25 lakh home loan",
    verify: (f) => f.loanAmount && f.loanAmount.includes("25 lakh") && f.loanType === "home loan",
  },
  {
    speech: "looking for 50 lakhs business loan",
    verify: (f) => f.loanAmount && f.loanAmount.includes("50 lakh") && f.loanType === "business loan",
  },
  {
    speech: "my monthly salary is 85 thousand",
    verify: (f) => f.monthlyIncome === "85 thousand" || f.monthlyIncome === "85",
  },
  {
    speech: "income is 1.5 lakh per month, software job",
    verify: (f) => f.employmentType === "salaried",
  },
  {
    speech: "own business in Ameerpet",
    verify: (f) => f.employmentType === "business" && f.area === "Ameerpet",
  },
  {
    speech: "cibil score is 780",
    verify: (f) => f.cibilScore === "780",
  },
  {
    speech: "studying in Malla Reddy college",
    verify: (f) => f.college && f.college.toLowerCase().includes("malla reddy"),
  },
  // Q&A pairing tests
  {
    history: [{ role: "model", content: "May I have your good name please?" }],
    speech: "Srinivas Rao",
    verify: (f) => f.name === "Srinivas Rao",
  },
  {
    history: [{ role: "model", content: "Which city or area do you currently reside in?" }],
    speech: "Madhapur, Hyderabad",
    verify: (f) => f.area && (f.area.includes("Madhapur") || f.area.includes("Hyderabad")),
  },
  {
    history: [{ role: "model", content: "Is your WhatsApp number the same as this number?" }],
    speech: "Yes, same number",
    verify: (f) => f.whatsappSame === true,
  },
  // Product correction test
  {
    history: [{ role: "user", content: "I was looking for personal loan" }],
    speech: "No, actually not personal, I need home loan only",
    verify: (f) => f.loanType === "home loan" && f.correctionNote && f.correctionNote.includes("corrected loan type"),
  },
  // Formatting block verification
  {
    facts: { name: "Ramesh", area: "Warangal", loanAmount: "15 lakhs", loanType: "home loan", monthlyIncome: "60 thousand", cibilScore: "750" },
    verifyBlock: (b) => b.includes("Ramesh") && b.includes("Warangal") && b.includes("60 thousand") && b.includes("750"),
  },
  {
    facts: { name: "Anand", correctionNote: "Customer explicitly corrected loan type from personal to gold loan" },
    verifyBlock: (b) => b.includes("CORRECTION NOTE") && b.includes("gold loan"),
  },
]

factScenarios.forEach((s, idx) => {
  runTest("Fact Memory", `Scenario ${50 + idx + 1}`, () => {
    if (s.verifyBlock) {
      const block = formatInCallFactsBlock(s.facts)
      assert(s.verifyBlock(block), "formatInCallFactsBlock failed verification")
    } else {
      const facts = extractCallFacts(s.history || [], s.speech)
      assert(s.verify(facts), `Fact extraction failed on: "${s.speech}" - got: ${JSON.stringify(facts)}`)
    }
  })
})
console.log(`✅ Suite 4: In-Call Fact Memory & Extraction passed (${factScenarios.length} scenarios)`)

// ---------------------------------------------------------------------------
// SUITE 5: Voice Intent & Semantic Analysis (Scenarios 66 - 85)
// ---------------------------------------------------------------------------
const semanticScenarios = [
  // Passive backchannels (must NOT trigger interruption)
  { speech: "hmm", intent: "backchannel_listening", interrupt: false },
  { speech: "haan", intent: "backchannel_listening", interrupt: false },
  { speech: "avunu", intent: "backchannel_listening", interrupt: false },
  { speech: "sare", intent: "backchannel_listening", interrupt: false },
  { speech: "theek hai", intent: "backchannel_listening", interrupt: false },
  { speech: "okay", intent: "backchannel_listening", interrupt: false },
  { speech: "వింటున్నాను", intent: "backchannel_listening", interrupt: false },

  // Repeat requests (interruption worthy)
  { speech: "malli cheppandi", intent: "repeat_request", interrupt: true },
  { speech: "can you repeat please", intent: "repeat_request", interrupt: true },
  { speech: "phir se boliye", intent: "repeat_request", interrupt: true },
  { speech: "vinipinchaledu clear ga ledu", intent: "repeat_request", interrupt: true },

  // Wait / Hold requests
  { speech: "oka nimisham aagandi", intent: "wait_hold_request", interrupt: true },
  { speech: "hold on one second", intent: "wait_hold_request", interrupt: true },
  { speech: "ek minute rukiye", intent: "wait_hold_request", interrupt: true },
  { speech: "లైన్ లో ఉండండి", intent: "wait_hold_request", interrupt: true },

  // Categorized Objections
  { speech: "interest rate chaala ekkuva undi", intent: "objection", objection: "high_interest_rate" },
  { speech: "processing fees charges too high", intent: "objection", objection: "processing_fee" },
  { speech: "already running loans unnayi emi undi", intent: "objection", objection: "existing_loan" },
  { speech: "salary slips levu no documents", intent: "objection", objection: "documentation_difficulty" },
  { speech: "meeru evaru fraud company aa", intent: "objection", objection: "trust_identity" },
]

semanticScenarios.forEach((s, idx) => {
  runTest("Semantic Intent", `Scenario ${65 + idx + 1}: "${s.speech}"`, () => {
    const analysis = analyzeVoiceSpeech(s.speech)
    assert.strictEqual(analysis.intent, s.intent, `Expected intent ${s.intent}, got ${analysis.intent} for "${s.speech}"`)
    if (s.interrupt !== undefined) {
      assert.strictEqual(analysis.isInterruptionWorthy, s.interrupt, `Interruption mismatch for "${s.speech}"`)
    }
    if (s.objection) {
      assert.strictEqual(analysis.objectionType, s.objection, `Objection mismatch for "${s.speech}"`)
    }
  })
})
console.log(`✅ Suite 5: Semantic Intent & Objection Intelligence passed (${semanticScenarios.length} scenarios)`)

// ---------------------------------------------------------------------------
// SUITE 6: TTS Speech Normalization (Scenarios 86 - 105)
// ---------------------------------------------------------------------------
const ttsScenarios = [
  // Financial Currency Normalization
  { input: "Your loan amount is ₹16 lakh.", mustInclude: "sixteen lakh rupees", mustNotInclude: "₹" },
  { input: "Eligible for ₹2 crore limit.", mustInclude: "two crore rupees", mustNotInclude: "₹" },
  { input: "Monthly EMI is ₹14,500.", mustInclude: "fourteen thousand five hundred rupees", mustNotInclude: "₹" },
  { input: "Total ₹50 lakh home loan.", mustInclude: "fifty lakh rupees" },

  // Bank & Financial Acronyms
  { input: "We compare SBI and HDFC bank rates.", mustInclude: "S B I and H D F C" },
  { input: "ICICI and PNB offer good schemes.", mustInclude: "I C I C I and P N B" },
  { input: "Your CIBIL score is checked for APR calculation.", mustInclude: "Cibil score is checked for A P R" },
  { input: "Submit PAN card and latest ITR copy.", mustInclude: "Pan card and latest I T R" },
  { input: "Applicable GST on processing fee.", mustInclude: "G S T" },

  // Markdown, URL and Citation Stripping
  { input: "Check details at https://rightagentgroup.com/loans immediately.", mustNotInclude: "http" },
  { input: "Visit our [Website](https://rightagentgroup.com) for details.", mustInclude: "Website", mustNotInclude: "https" },
  { input: "The interest rate is 8.5% [VERIFIED: SBI Circular 2026].", mustInclude: "eight point five percent", mustNotInclude: "VERIFIED" },
  { input: "Moratorium period available [1].", mustNotInclude: "[1]" },
  { input: "• First point\n• Second point", mustNotInclude: "•" },
  { input: "* Feature one\n* Feature two", mustNotInclude: "*" },

  // Phone numbers spelled out
  { input: "Contact our officer at 9876543210 today.", mustInclude: "nine eight seven six five four three two one zero" },

  // Ranges and percentages
  { input: "Interest rate from 8.5% to 10.5%.", mustInclude: "eight point five percent to ten point five percent" },
  { input: "We work with 20+ partner banks.", mustInclude: "twenty plus partner banks" },
  { input: "Tenure between 15-20 years.", mustInclude: "fifteen to twenty years" },
  { input: "Time is 6:30 PM.", mustInclude: "six thirty p m" },
]

ttsScenarios.forEach((s, idx) => {
  runTest("TTS Normalization", `Scenario ${85 + idx + 1}: "${s.input}"`, () => {
    const normalized = normalizeForTts(s.input)
    if (s.mustInclude) {
      assert(normalized.includes(s.mustInclude), `Expected "${s.mustInclude}" in "${normalized}"`)
    }
    if (s.mustNotInclude) {
      assert(!normalized.includes(s.mustNotInclude), `Did not expect "${s.mustNotInclude}" in "${normalized}"`)
    }
  })
})
console.log(`✅ Suite 6: TTS Normalization & Articulation passed (${ttsScenarios.length} scenarios)`)

console.log("\n===================================================================")
console.log(`🎉 100+ SCENARIO VOICE INTELLIGENCE TEST SUITE PASSED! (${totalPassed} tests)`)
console.log("===================================================================")
process.exit(0)
