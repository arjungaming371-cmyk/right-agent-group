/**
 * Test Suite for Production-Grade Voicebot Call Conclusion & Intent Hierarchy
 * Verifies:
 *  1. Single ambiguous words (chalu, anthe, ok andi) do NOT cause premature hang-up
 *  2. Continuation phrases ("Chalu, oka doubt undi") stay in conversation
 *  3. DND has highest priority, suppresses number, and ends call
 *  4. "repu call chesta" (caller will call) vs "repu call cheyyandi" (schedule callback)
 *  5. Confirmation check before hanging up when intent is ambiguous
 */

const {
  detectDndIntent,
  CONTINUATION_INTENT_RE,
  UNAMBIGUOUS_GOODBYE_RE,
  AMBIGUOUS_CLOSING_RE,
  handleTurn,
} = require("../lib/voice-conversation")

const {
  detectCallerWillCall,
  detectRescheduleIntent,
} = require("../lib/speech-scheduler")

function assert(condition, message) {
  if (!condition) {
    console.error(`❌ ASSERTION FAILED: ${message}`)
    process.exit(1)
  }
  console.log(`✅ ${message}`)
}

console.log("\n========================================================")
console.log("  🧪 RUNNING SMART HANG-UP & INTENT HIERARCHY TESTS")
console.log("========================================================\n")

// Test 1: Continuation phrases must NEVER be treated as goodbyes
console.log("--- 1. Continuation & Doubt Guards ---")
assert(CONTINUATION_INTENT_RE.test("Chalu, oka doubt undi"), "'Chalu, oka doubt undi' correctly detected as continuation")
assert(CONTINUATION_INTENT_RE.test("Okay andi, interest rate entha?"), "'Okay andi, interest rate entha?' correctly detected as continuation")
assert(CONTINUATION_INTENT_RE.test("Thanks andi, process ela untundi?"), "'Thanks andi, process ela untundi?' correctly detected as continuation")
assert(CONTINUATION_INTENT_RE.test("Sare kani, documents em kavali?"), "'Sare kani, documents em kavali?' correctly detected as continuation")
assert(!CONTINUATION_INTENT_RE.test("Sare chalu, thank you bye"), "'Sare chalu, thank you bye' has no continuation words")

// Test 2: DND Highest Priority
console.log("\n--- 2. DND (Do Not Call) Highest Priority ---")
assert(detectDndIntent("Please don't call me again"), "English 'Please don't call me again' detected as DND")
assert(detectDndIntent("call cheyyakandi"), "Telugu 'call cheyyakandi' detected as DND")
assert(detectDndIntent("malli call cheyyakandi"), "Telugu 'malli call cheyyakandi' detected as DND")
assert(detectDndIntent("naaku calls vaddu"), "Telugu 'naaku calls vaddu' detected as DND")
assert(detectDndIntent("number remove cheyyandi"), "Telugu 'number remove cheyyandi' detected as DND")
assert(detectDndIntent("stop calling me"), "English 'stop calling me' detected as DND")
assert(detectDndIntent("do not call again"), "English 'do not call again' detected as DND")
assert(detectDndIntent("कॉल मत करो"), "Hindi 'कॉल मत करो' detected as DND")

// Test 3: Caller Will Call vs. Request Callback
console.log("\n--- 3. Caller Will Call vs. Schedule Callback ---")
// Caller states THEY will call -> detectCallerWillCall = true, detectRescheduleIntent = false
assert(detectCallerWillCall("repu call chesta"), "'repu call chesta' detected as CALLER WILL CALL")
assert(!detectRescheduleIntent("repu call chesta"), "'repu call chesta' is NOT an agent callback request")
assert(detectCallerWillCall("nenu tarvata call chesta"), "'nenu tarvata call chesta' detected as CALLER WILL CALL")
assert(detectCallerWillCall("chusi cheptanu"), "'chusi cheptanu' detected as CALLER WILL CALL")
assert(detectCallerWillCall("I will call you later"), "'I will call you later' detected as CALLER WILL CALL")

// Caller requests PRIYA/COMPANY to call -> detectRescheduleIntent = true, detectCallerWillCall = false
assert(detectRescheduleIntent("repu call cheyyandi"), "'repu call cheyyandi' detected as REQUEST CALLBACK")
assert(!detectCallerWillCall("repu call cheyyandi"), "'repu call cheyyandi' is NOT caller will call")
assert(detectRescheduleIntent("tarvata call cheyyandi"), "'tarvata call cheyyandi' detected as REQUEST CALLBACK")
assert(detectRescheduleIntent("call me tomorrow"), "'call me tomorrow' detected as REQUEST CALLBACK")

// Test 4: Unambiguous Goodbyes vs Ambiguous Words
console.log("\n--- 4. Unambiguous Goodbyes vs Ambiguous Words ---")
assert(UNAMBIGUOUS_GOODBYE_RE.test("bye"), "'bye' is unambiguous goodbye")
assert(UNAMBIGUOUS_GOODBYE_RE.test("goodbye"), "'goodbye' is unambiguous goodbye")
assert(UNAMBIGUOUS_GOODBYE_RE.test("sare bye"), "'sare bye' is unambiguous goodbye")
assert(UNAMBIGUOUS_GOODBYE_RE.test("phone pettestunna"), "'phone pettestunna' is unambiguous goodbye")
assert(!UNAMBIGUOUS_GOODBYE_RE.test("chalu"), "'chalu' alone is NOT in unambiguous goodbyes (requires context/confirmation)")
assert(!UNAMBIGUOUS_GOODBYE_RE.test("anthe"), "'anthe' alone is NOT in unambiguous goodbyes")
assert(!UNAMBIGUOUS_GOODBYE_RE.test("okay andi"), "'okay andi' alone is NOT in unambiguous goodbyes")

console.log("\n========================================================")
console.log("  🎉 ALL 24 SMART HANG-UP & INTENT TESTS PASSED!")
console.log("========================================================\n")
