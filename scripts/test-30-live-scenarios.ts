import { handleTurn } from "../lib/voice-conversation"
import assert from "assert"

const SCENARIOS = [
  { name: "1. Hello (Telugu)", speech: "హలో", lang: "telugu" as const, check: (r: string) => !r.includes("Sure sir,") && !r.includes("మీ loan requirement") && (r.includes("voice") || r.includes("వినిపిస్తోందా") || r.includes("నమస్కారం")) },
  { name: "2. Hello (English)", speech: "Hello", lang: "english" as const, check: (r: string) => !r.includes("Sure sir,") && !r.includes("loan requirement") && (r.includes("hear") || r.includes("Priya") || r.includes("Hello")) },
  { name: "3. Hello (Hindi)", speech: "हेलो", lang: "hindi" as const, check: (r: string) => !r.includes("Sure sir,") && (r.includes("आवाज़") || r.includes("Priya") || r.includes("नमस्ते")) },
  { name: "4. Who are you (Telugu)", speech: "మీరు ఎవరు?", lang: "telugu" as const, check: (r: string) => r.includes("Right Agent Group") && !r.includes("ఎన్ని lakh") },
  { name: "5. Who are you (English)", speech: "Who is this speaking?", lang: "english" as const, check: (r: string) => r.includes("Right Agent Group") && r.includes("Priya") },
  { name: "6. Why are you calling me", speech: "ఎందుకు call చేశారు?", lang: "telugu" as const, check: (r: string) => (r.includes("Right Agent Group") || r.includes("loan") || r.includes("సహాయం")) && !r.includes("Sure sir,") },
  { name: "7. How did you get my number", speech: "నా number ఎక్కడి నుంచి వచ్చింది?", lang: "telugu" as const, check: (r: string) => (r.includes("enquir") || r.includes("contact") || r.includes("details")) && !r.includes("Sure sir,") },
  { name: "8. I already have a loan", speech: "నాకు ఇప్పటికే ఒక లోన్ ఉంది", lang: "telugu" as const, check: (r: string) => !r.includes("Sure sir,") && (r.includes("top-up") || r.includes("transfer") || r.includes("సమస్య లేదు") || r.includes("ప్రాబ్లమ్")) },
  { name: "9. Your interest rate is too high", speech: "వడ్డీ చాలా ఎక్కువగా ఉంది", lang: "telugu" as const, check: (r: string) => (r.includes("20+") || r.includes("banks") || r.includes("తక్కువ") || r.includes("compare")) },
  { name: "10. Difference between personal and home loan", speech: "Personal loan కి Home loan కి తేడా ఏమిటి?", lang: "telugu" as const, check: (r: string) => (r.includes("Home loan") || r.includes("Personal loan")) && (r.includes("rate") || r.includes("tenure") || r.includes("security") || r.includes("వడ్డీ")) },
  { name: "11. Which bank has lower processing fees", speech: "ఏ బ్యాంకులో processing fee తక్కువ ఉంటుంది?", lang: "telugu" as const, check: (r: string) => (r.includes("bank") || r.includes("fee") || r.includes("scheme") || r.includes("తక్కువ") || r.includes("waiver")) },
  { name: "12. Wait, let me finish", speech: "ఒక్క నిమిషం ఆగండి, నేను మాట్లాడాలి", lang: "telugu" as const, check: (r: string) => (r.includes("లైన్") || r.includes("ఉంటాను") || r.includes("తీరిగ్గా") || r.includes("చెప్పండి")) },
  { name: "13. That is not what I asked", speech: "నేను అడిగింది అది కాదు, car loan గురించి అడిగాను", lang: "telugu" as const, check: (r: string) => (r.includes("car") || r.includes("vehicle") || r.includes("వాహన")) },
  { name: "14. I told you already my name is Suresh", speech: "నా పేరు సురేష్ అని ముందే చెప్పాను", lang: "telugu" as const, check: (r: string) => (r.includes("Suresh") || r.includes("సురేష్") || r.includes("గారు") || r.includes("నోట్")) },
  { name: "15. I don't understand", speech: "నాకు అర్థం కాలేదు మళ్ళీ చెప్పండి", lang: "telugu" as const, check: (r: string) => !r.includes("Sure sir,") && r.length < 200 },
  { name: "16. Speak in Telugu", speech: "తెలుగులో మాట్లాడండి", lang: "english" as const, check: (r: string) => /[\u0C00-\u0C7F]/.test(r) },
  { name: "17. Don't cut the call", speech: "కట్ చేయొద్దు వినండి", lang: "telugu" as const, check: (r: string) => (r.includes("వింటున్నాను") || r.includes("చెప్పండి") || r.includes("లైన్")) },
  { name: "18. I am not interested", speech: "నాకు లోన్ వద్దు, ఆసక్తి లేదు", lang: "telugu" as const, check: (r: string) => (r.includes("సరే") || r.includes("ధన్యవాదాలు") || r.includes("day") || r.includes("సమస్య లేదు")) },
  { name: "19. Don't call me again (DND)", speech: "నాకు మళ్ళీ ఎప్పుడూ call చేయొద్దు", lang: "telugu" as const, check: (r: string) => r.includes("DND") || r.includes("remove") || r.includes("చేయము") },
  { name: "20. Office address", speech: "మీ ఆఫీస్ ఎక్కడ ఉంది?", lang: "telugu" as const, check: (r: string) => r.includes("Gandimaisamma") || r.includes("గాండిమైసమ్మ") },
  { name: "21. Education loan starting rate", speech: "Education loan interest rate ఎంత?", lang: "telugu" as const, check: (r: string) => r.includes("7.15") || r.includes("seven point one five") },
  { name: "22. Business loan maximum amount", speech: "Business loan ఎంత వరకు ఇస్తారు?", lang: "telugu" as const, check: (r: string) => r.includes("75") || r.includes("seventy five") },
  { name: "23. Home loan starting rate", speech: "Home loan starting interest rate ఎంత?", lang: "telugu" as const, check: (r: string) => r.includes("7.25") || r.includes("seven point two five") },
  { name: "24. Call me tomorrow at 4 PM", speech: "రేపు ఈవెనింగ్ 4 గంటలకి call చేయండి", lang: "telugu" as const, check: (r: string) => r.includes("నోట్") || r.includes("schedule") || r.includes("టీమ్") || r.includes("చేస్తాము") },
  { name: "25. I am driving right now", speech: "నేను driving లో ఉన్నాను తర్వాత మాట్లాడదాం", lang: "telugu" as const, check: (r: string) => r.includes("సరే") || r.includes("drive") || r.includes("తర్వాత") || r.includes("time") },
  { name: "26. I will ask my father and tell you", speech: "మా నాన్నగారితో మాట్లాడి చెప్తాను", lang: "telugu" as const, check: (r: string) => r.includes("తప్పకుండా") || r.includes("సరే") || r.includes("నిర్ణయం") || r.includes("WhatsApp") },
  { name: "27. No documents available", speech: "నా దగ్గర salary slips లేవు", lang: "telugu" as const, check: (r: string) => r.includes("bank") || r.includes("paperless") || r.includes("help") || r.includes("statement") },
  { name: "28. CIBIL score is 650", speech: "నా CIBIL score 650 మాత్రమే ఉంది", lang: "telugu" as const, check: (r: string) => r.includes("NBFC") || r.includes("options") || r.includes("eligibility") || r.includes("చూద్దాం") },
  { name: "29. Are you a robot?", speech: "నువ్వు మనిషివా రోబోట్ వా?", lang: "telugu" as const, check: (r: string) => r.includes("AI") || r.includes("Priya") || r.includes("assistant") },
  { name: "30. Okay, I have time, tell me", speech: "సరే నాకు time ఉంది, చెప్పండి", lang: "telugu" as const, check: (r: string) => !r.includes("Sure sir, మీ loan requirement") && (r.includes("loan") || r.includes("ఎలాంటి") || r.includes("Thanks")) }
]

async function runAll() {
  console.log(`\n===================================================================`)
  console.log(`🧪 RUNNING 30 REAL-WORLD CONVERSATION SCENARIOS`)
  console.log(`===================================================================\n`)

  let passed = 0
  let failed = 0

  for (let i = 0; i < SCENARIOS.length; i++) {
    const s = SCENARIOS[i]
    try {
      const res = await handleTurn({
        leadId: "",
        callSid: `test-call-sid-${i}`,
        speech: s.speech,
        language: s.lang,
        direction: "outbound"
      })
      const ok = s.check(res.text)
      if (ok) {
        console.log(`✅ [PASS] Scenario ${i + 1}: ${s.name}`)
        console.log(`   Reply: "${res.text.slice(0, 90)}${res.text.length > 90 ? "..." : ""}"\n`)
        passed++
      } else {
        console.error(`❌ [FAIL] Scenario ${i + 1}: ${s.name}`)
        console.error(`   Input: "${s.speech}"`)
        console.error(`   Output: "${res.text}"\n`)
        failed++
      }
    } catch (e: any) {
      console.error(`❌ [ERROR] Scenario ${i + 1}: ${s.name} threw:`, e.message)
      failed++
    }
  }

  console.log(`===================================================================`)
  console.log(`SUMMARY: ${passed} PASSED, ${failed} FAILED out of ${SCENARIOS.length} scenarios.`)
  console.log(`===================================================================\n`)

  if (failed > 0) process.exit(1)
}

runAll()
