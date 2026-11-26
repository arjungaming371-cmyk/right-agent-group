const assert = require('assert');
// Test the TypeScript output directly via ts-node or tsx or transpiled
const { parseRescheduleTime, buildReschedule, detectRescheduleIntent } = require('../lib/speech-scheduler.ts');

console.log("Testing speech scheduler...");

// Test 1: Monday at 6 PM
const t1 = parseRescheduleTime("Call me Monday at 6 PM");
assert(t1, "Should parse Monday at 6 PM");
console.log("1. Monday at 6 PM:", t1.desc.english, t1.when.toISOString());
assert(t1.desc.english.toLowerCase().includes("monday") && t1.desc.english.includes("6:00 pm"), "Must include Monday and 6:00 pm");

// Test 2: Repu evening six ki call cheyandi
const t2 = parseRescheduleTime("Repu evening six ki call cheyandi");
assert(t2, "Should parse Repu evening six ki");
console.log("2. Repu evening six ki:", t2.desc.telugu, t2.when.toISOString());
assert(t2.desc.telugu.includes("రేపు") && t2.desc.telugu.includes("6:00"), "Must include tomorrow and 6:00");

// Test 3: Call me in two hours
const t3 = parseRescheduleTime("Call me in two hours");
assert(t3, "Should parse relative duration: in two hours");
console.log("3. Call me in two hours:", t3.desc.english, t3.when.toISOString());
assert(t3.desc.english.includes("in 2 hours"), "Must be in 2 hours");
const diffHours = (t3.when.getTime() - Date.now()) / (1000 * 60 * 60);
assert(Math.abs(diffHours - 2) < 0.05, "Timestamp must be ~2 hours from now");

// Test 4: Kal shaam ko call karna
const t4 = parseRescheduleTime("Kal shaam ko call karna");
assert(t4, "Should parse Kal shaam ko call karna");
console.log("4. Kal shaam ko call karna:", t4.desc.hindi, t4.when.toISOString());
assert(t4.desc.hindi.includes("कल शाम"), "Must be tomorrow evening");

// Test 5: Call me next Friday at 10 AM
const t5 = parseRescheduleTime("Call me next Friday at 10 AM");
assert(t5, "Should parse next Friday at 10 AM");
console.log("5. Call me next Friday at 10 AM:", t5.desc.english, t5.when.toISOString());
assert(t5.desc.english.toLowerCase().includes("friday") && t5.desc.english.includes("10:00 am"), "Must include Friday and 10:00 am");

console.log("✅ All speech scheduler unit tests passed!");
