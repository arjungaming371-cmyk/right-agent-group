// Generates ~1 minute Priya voice demo samples for the promo site, using the
// SAME cloud voice as production: Sarvam Bulbul v3, speaker "priya"
// (server/voice-providers.js). The old Edge TTS generator is gone with the
// local voice stack — the whole pipeline is cloud-only now.
//
// Requires: SARVAM_API_KEY in ../.env (or the environment) + ffmpeg on PATH
// (already a hard dependency of the voicebot).
// Run: node scripts/generate-promo-voice.mjs

import path from "node:path"
import fs from "node:fs"
import { execFileSync } from "node:child_process"
import { fileURLToPath } from "node:url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const OUT_DIR = path.join(__dirname, "..", "public", "promo", "audio")
fs.mkdirSync(OUT_DIR, { recursive: true })

// Minimal .env loader (same contract as setup-db.js)
function loadEnv() {
  if (process.env.SARVAM_API_KEY) return
  const envPath = path.join(__dirname, "..", ".env")
  if (!fs.existsSync(envPath)) return
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*(?:#.*)?$/)
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2]
  }
}
loadEnv()

const SARVAM_API_KEY = (process.env.SARVAM_API_KEY || "").trim()
if (!SARVAM_API_KEY) {
  console.error("SARVAM_API_KEY is not set — add it to .env first (dashboard.sarvam.ai).")
  process.exit(1)
}
const SARVAM_BASE = (process.env.SARVAM_URL || "https://api.sarvam.ai").replace(/\/$/, "")
const SARVAM_TTS_MODEL = process.env.SARVAM_TTS_MODEL || "bulbul:v3"
const SARVAM_TTS_SPEAKER = process.env.SARVAM_TTS_SPEAKER || "priya"

const SAMPLES = [
  {
    file: "priya-english",
    language_code: "en-IN",
    text: `Namaste! I'm Priya, your AI voice agent from Right Agent Group. I call, listen, and understand your customers' loan needs — home loans, personal loans, business loans, and more — in a natural, warm conversation, just like a real relationship manager. I qualify leads instantly, answer questions about interest rates and eligibility, and I never get tired, never take a day off, and never miss a follow-up. I work around the clock, in English, Hindi, and Telugu, switching languages mid-conversation exactly the way your customers speak. Every call I make gets logged, scored, and handed to your team the moment a customer says yes. Banks and NBFCs use me to call thousands of leads a day, at a fraction of the cost of a full call center — with sentiment tracking, compliance built in, and a WhatsApp follow-up sent automatically after every call. I'm not a recording. I listen, I adapt, and I close. Ready to put me to work for your business? Apply today, and let's grow your loan book together.`,
  },
  {
    file: "priya-hindi",
    language_code: "hi-IN",
    text: `नमस्ते! मैं प्रिया हूँ, राइट एजेंट ग्रुप की एआई वॉइस एजेंट। मैं आपके ग्राहकों को कॉल करती हूँ, उनकी बात ध्यान से सुनती हूँ, और होम लोन, पर्सनल लोन, बिज़नेस लोन जैसी उनकी ज़रूरतों को समझती हूँ — बिल्कुल एक असली रिलेशनशिप मैनेजर की तरह, गर्मजोशी से बातचीत करते हुए। मैं तुरंत लीड को क्वालिफाई करती हूँ, ब्याज दर और पात्रता से जुड़े सवालों के जवाब देती हूँ, और मैं कभी थकती नहीं, कभी छुट्टी नहीं लेती, और कभी कोई फॉलो-अप नहीं भूलती। मैं दिन-रात काम करती हूँ, अंग्रेज़ी, हिंदी और तेलुगु में — जैसे आपका ग्राहक बात करता है वैसे ही भाषा बदल लेती हूँ। हर कॉल का रिकॉर्ड रखा जाता है, स्कोर किया जाता है, और जैसे ही ग्राहक हाँ कहता है, आपकी टीम को तुरंत सौंप दिया जाता है। बैंक और एनबीएफसी हर दिन हज़ारों लीड्स के लिए मुझे इस्तेमाल करते हैं, कॉल सेंटर की लागत के एक हिस्से में, सेंटीमेंट ट्रैकिंग और कंप्लायंस के साथ, और हर कॉल के बाद खुद-ब-खुद व्हाट्सएप फॉलो-अप भेजते हुए। मैं कोई रिकॉर्डिंग नहीं हूँ। मैं सुनती हूँ, समझती हूँ, और डील पक्की करती हूँ। आज ही अप्लाई करें और अपने लोन बिज़नेस को साथ मिलकर आगे बढ़ाएं।`,
  },
  {
    file: "priya-telugu",
    language_code: "te-IN",
    text: `నమస్తే! నేను ప్రియ, రైట్ ఏజెంట్ గ్రూప్ యొక్క ఏఐ వాయిస్ ఏజెంట్‌ని. నేను మీ కస్టమర్లకు కాల్ చేసి, వారి మాట శ్రద్ధగా విని, హోమ్ లోన్, పర్సనల్ లోన్, బిజినెస్ లోన్ లాంటి వారి అవసరాలను అర్థం చేసుకుంటాను — ఖచ్చితంగా ఒక నిజమైన రిలేషన్‌షిప్ మేనేజర్ లాగా, స్నేహపూర్వకంగా మాట్లాడుతూ. నేను వెంటనే లీడ్‌ను క్వాలిఫై చేస్తాను, వడ్డీ రేట్లు మరియు అర్హత గురించి ప్రశ్నలకు సమాధానం ఇస్తాను, మరియు నేను ఎప్పుడూ అలసిపోను, సెలవు తీసుకోను, ఫాలో-అప్ మర్చిపోను. నేను రోజంతా పని చేస్తాను, ఇంగ్లీష్, హిందీ, తెలుగు భాషల్లో — మీ కస్టమర్ ఎలా మాట్లాడితే అలా భాష మార్చుకుంటాను. ప్రతి కాల్ రికార్డ్ అవుతుంది, స్కోర్ చేయబడుతుంది, కస్టమర్ ఒప్పుకోగానే వెంటనే మీ టీమ్‌కి అందిస్తాను. బ్యాంకులు మరియు ఎన్‌బీఎఫ్‌సీలు ప్రతిరోజూ వేలాది లీడ్స్ కోసం నన్ను వాడుతున్నాయి, కాల్ సెంటర్ ఖర్చులో కొంత భాగంలోనే, సెంటిమెంట్ ట్రాకింగ్ మరియు కంప్లయన్స్‌తో పాటు, ప్రతి కాల్ తర్వాత ఆటోమేటిక్‌గా వాట్సాప్ ఫాలో-అప్ పంపిస్తూ. నేను ఒక రికార్డింగ్ని కాదు. నేను వింటాను, అర్థం చేసుకుంటాను, డీల్ క్లోజ్ చేస్తాను. ఈరోజే అప్లై చేయండి, మీ లోన్ వ్యాపారాన్ని కలిసి ముందుకు తీసుకెళ్దాం.`,
  },
]

async function synthOne({ file, language_code, text }) {
  const res = await fetch(`${SARVAM_BASE}/text-to-speech`, {
    method: "POST",
    headers: { "api-subscription-key": SARVAM_API_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({
      text,
      model: SARVAM_TTS_MODEL,
      language_code,
      speaker: SARVAM_TTS_SPEAKER,
      output_audio_codec: "wav",
    }),
    signal: AbortSignal.timeout(120000),
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text().catch(() => "")).slice(0, 200)}`)
  const data = await res.json()
  const wav = Buffer.from(Array.isArray(data?.audios) ? data.audios.join("") : "", "base64")
  if (wav.length < 1000) throw new Error("Sarvam returned empty audio")

  // The promo site serves .mp3 at fixed paths — convert via ffmpeg (keeps the
  // URLs in app/apply/page.tsx unchanged).
  const dest = path.join(OUT_DIR, `${file}.mp3`)
  const tmp = dest + ".tmp.wav"
  fs.writeFileSync(tmp, wav)
  try {
    execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-i", tmp,
      "-codec:a", "libmp3lame", "-b:a", "96k", dest], { stdio: "inherit" })
  } finally {
    fs.rmSync(tmp, { force: true })
  }
  console.log(`✓ ${dest} (${(fs.statSync(dest).size / 1024).toFixed(0)} KB)`)
}

for (const sample of SAMPLES) {
  await synthOne(sample)
}
console.log("Done.")
