const assert = require('assert');
const { isCallDisconnectIntent, detectDndIntent, CALL_DISCONNECT_RE, NEGATIVE_DISCONNECT_RE } = require('../lib/voice-conversation.ts');

console.log("=== RUNNING PHASE 2 RELIABILITY UNIT TESTS ===");

// 1. Negative Disconnect Tests
console.log("-> Testing Negation-Aware Disconnect Commands...");

// Telugu Negative Disconnect
assert.strictEqual(isCallDisconnectIntent("cut cheyoddu"), false, "cut cheyoddu must NOT disconnect");
assert.strictEqual(isCallDisconnectIntent("call cut cheyoddu andi"), false, "call cut cheyoddu andi must NOT disconnect");
assert.strictEqual(isCallDisconnectIntent("phone cut cheyakandi"), false, "phone cut cheyakandi must NOT disconnect");
assert.strictEqual(isCallDisconnectIntent("కాల్ కట్ చేయొద్దు"), false, "కాల్ కట్ చేయొద్దు must NOT disconnect");
assert.strictEqual(isCallDisconnectIntent("కట్ చేయకండి వింటున్నాను"), false, "కట్ చేయకండి must NOT disconnect");

// English Negative Disconnect
assert.strictEqual(isCallDisconnectIntent("don't cut the call"), false, "don't cut the call must NOT disconnect");
assert.strictEqual(isCallDisconnectIntent("please do not hang up"), false, "do not hang up must NOT disconnect");
assert.strictEqual(isCallDisconnectIntent("don't disconnect, I have a doubt"), false, "don't disconnect must NOT disconnect");

// Hindi Negative Disconnect
assert.strictEqual(isCallDisconnectIntent("call mat kaato"), false, "call mat kaato must NOT disconnect");
assert.strictEqual(isCallDisconnectIntent("phone mat kaatna"), false, "phone mat kaatna must NOT disconnect");
assert.strictEqual(isCallDisconnectIntent("कॉल मत काटो"), false, "कॉल मत काटो must NOT disconnect");

// Positive Disconnect (Must still disconnect correctly)
assert.strictEqual(isCallDisconnectIntent("call cut cheyandi"), true, "call cut cheyandi MUST disconnect");
assert.strictEqual(isCallDisconnectIntent("phone cut chestunna"), true, "phone cut chestunna MUST disconnect");
assert.strictEqual(isCallDisconnectIntent("please hang up"), true, "hang up MUST disconnect");
assert.strictEqual(isCallDisconnectIntent("call disconnect cheyandi"), true, "call disconnect cheyandi MUST disconnect");
assert.strictEqual(isCallDisconnectIntent("phone kaat do"), true, "phone kaat do MUST disconnect");
console.log("   ✅ Disconnect negation tests passed (Telugu, Hindi, English).");

// 2. DND Intent Detection (> 300 characters check)
console.log("-> Testing DND Detection without 300 character cap...");
const longDndSpeech = "Look madam, I am in a very important hospital meeting and I have told your representatives multiple times earlier also that I am not at all interested in any personal loans or credit cards or banking offers right now. I work in an IT company and I do not need any financial assistance. Please take my number off your list and do not call me again in the future. Thank you very much.";
assert(longDndSpeech.length > 300, `Speech must be > 300 chars, actual: ${longDndSpeech.length}`);
assert.strictEqual(detectDndIntent(longDndSpeech), true, "Long speech with DND intent must be detected!");

const shortTeluguDnd = "నాకు కాల్స్ వద్దు, దయచేసి నెంబర్ తీసేయండి";
assert.strictEqual(detectDndIntent(shortTeluguDnd), true, "Telugu DND must be detected");

const hindiDnd = "दोबारा मुझे कभी कॉल मत करना, नंबर हटा दो";
assert.strictEqual(detectDndIntent(hindiDnd), true, "Hindi DND must be detected");
console.log("   ✅ DND detection tests passed for long & multilingual phrases.");

console.log("\n🎉 ALL PHASE 2 RELIABILITY UNIT TESTS PASSED!");
