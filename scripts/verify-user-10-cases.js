const DND_INTENT_RE = new RegExp([
  '\\b(?:please\\s+)?(?:don\'t|do not|never|stop)\\s+(?:call|contact|ring|message|reach)\\b',
  '\\b(?:please\\s+)?(?:remove|delete|take off)\\s+(?:my\\s+)?(?:number|contact|phone|details|me)\\b',
  '\\b(?:unsubscribe|put me on (?:the )?do not call|don\'t call me again|stop calling me|do not call again|never call me again|take me off your list)\\b',
  '\\b(?:call|calls)\\s+(?:cheyyakandi|cheyoddu|cheyakandi|cheyavaddu|vaddu)\\b',
  '\\b(?:malli|inkosari)\\s+call\\s+(?:cheyyakandi|cheyoddu|cheyakandi)\\b',
  '\\b(?:naaku\\s+)?(?:calls?\\s+)?vaddu\\b',
  '\\b(?:number|na number)\\s+(?:remove|delete|teeseyandi|theeseyandi)\\s*(?:cheyyandi)?\\b',
  'కాల్ చేయకండి|కాల్స్ వద్దు|మళ్లీ కాల్ చేయకండి|నెంబర్ తీసేయండి|కాల్ చేయొద్దు|నాకు వద్దు|ఫోన్ చేయకండి|నా నెంబర్ తీసేయండి',
  '\\b(?:call|phone)\\s+(?:mat|nahi)\\s+(?:karo|karna|kariye)\\b',
  '\\b(?:dobara|phir|kabhi)\\s+call\\s+mat\\s+(?:karo|karna|kariye)\\b',
  '\\bnumber\\s+(?:hatao|delete karo|nikalo)\\b',
  'कॉल मत करो|फोन मत करना|दोबारा कॉल मत करना|नंबर हटा दो|मुझे कॉल मत करो',
].join("|"), "i")

const CONTINUATION_INTENT_RE = new RegExp(
  '\\b(' +
  'doubt|doubts|oka doubt|oka question|small doubt|last doubt|actually|wait|adagali|entha|rate|interest|emi|ela|enduku|cheppandi|cheppu|' +
  'meeru ippudu|ippudu cheppandi|' +
  'kani|kaani|but|okati|ayithe|aithe|inka|malli|' +
  'what|how|why|when|which|can you|tell me|kya|kaise|kitna|lekin|par' +
  ')\\b|\\?|డౌట్|డౌట్స్|ఒక డౌట్|ఒక ప్రశ్న|చిన్న డౌట్|చివరి డౌట్|ఎంత|ఎలా|ఎందుకు|చెప్పండి|కానీ|కాని|ఇంకా|ఇప్పుడు చెప్పండి',
  'i'
)

const REQUEST_CALLBACK_RE = new RegExp(
  [
    `\\b(?:please\\s+)?(?:call\\s+me|call\\s+us|ring\\s+me|reach\\s+me|talk\\s+to\\s+me)\\b[^.?!]{0,40}\\b(?:later|tomorrow|tonight|today|morning|afternoon|evening|night|next week)\\b`,
    `\\b(?:later|tomorrow|tonight|next week)\\b[^.?!]{0,40}\\b(?:please\\s+)?(?:call\\s+me|call\\s+us|ring\\s+me)\\b`,
    `\\b(?:busy|busy right now|can't talk right now|in a meeting)\\b[^.?!]{0,35}\\b(?:call\\s+me|call\\s+later|call\\s+tomorrow)\\b`,
    `\\b(?:repu|tarvata|tarvatha|malli|sayanthram|udayam|evening lo|morning lo)\\b[^.?!]{0,30}\\b(?:call\\s+cheyandi|call\\s+cheyyandi|phone\\s+cheyandi|phone\\s+cheyyandi|matladandi|ring\\s+cheyandi)\\b`,
    `\\b(?:call\\s+cheyandi|call\\s+cheyyandi|phone\\s+cheyandi|matladandi)\\b[^.?!]{0,20}\\b(?:repu|tarvata|sayanthram|udayam)\\b`,
    `\\b(?:busy|busy ga unnanu|meeting lo unnanu)\\b[^.?!]{0,35}\\b(?:tarvata|repu)?\\s*(?:call\\s+cheyandi|call\\s+cheyyandi)\\b`,
    `(?:రేపు|తర్వాత|సాయంత్రం|మళ్ళీ)[^.?!]{0,25}(?:కాల్\\s*చేయండి|ఫోన్\\s*చేయండి|మాట్లాడండి)`,
    `(?:కాల్\\s*చేయండి|ఫోన్\\s*చేయండి|మాట్లాడండి)[^.?!]{0,20}(?:రేపు|తర్వాత|సాయంత్రం)`,
    `\\b(?:kal|baad me|baad mein|shaam ko|subah)\\b[^.?!]{0,30}\\b(?:call\\s+kijiye|call\\s+karna|call\\s+kariyega|phone\\s+kijiye|phone\\s+karna)\\b`,
    `\\b(?:call|phone)\\s+(?:kijiye|karna|kariyega)\\b[^.?!]{0,25}\\b(?:kal|shaam|subah|baad me)\\b`,
    `कल.{0,15}(?:कॉल कीजिए|कॉल करना|फोन करना)|बाद में.{0,15}(?:कॉल कीजिए|कॉल करना)`,
  ].join("|"),
  "i"
)

const CALLER_WILL_CALL_RE = new RegExp(
  [
    `\\b(?:nenu|memu)?\\s*(?:repu|tarvata|tarvatha|malli|sayanthram|udayam|evening lo|morning lo)\\b[^.?!]{0,30}\\b(?:call\\s+chesta|call\\s+chestanu|matladathanu|matladathaa|cheptanu|cheptha|vastaanu|vastanu|osthanu)\\b`,
    `\\b(?:nenu|memu)\\s+(?:tarvata|malli|repu)?\\s*(?:call\\s+chesta|call\\s+chestanu|matladathanu)\\b`,
    `\\b(?:chusi|chuse)\\s+(?:cheptanu|cheptha)\\b`,
    `(?:నేను|మేము)?\\s*(?:రేపు|తర్వాత|మళ్ళీ|సాయంత్రం)[^.?!]{0,25}(?:కాల్\\s*చేస్తా|కాల్\\s*చేస్తాను|మాట్లాడతాను|చెప్తాను|చూసి\\s*చెప్తాను|వస్తాను)`,
    `\\b(?:i|i'll|i will|let me|we will)\\s+(?:call|reach out|contact|ring|check and call)\\s+(?:you\\s+)?(?:back|later|tomorrow|tonight|next week)?\\b`,
    `\\b(?:main|hum)\\s+(?:baad me|kal|phir)\\s+(?:call\\s+karunga|call\\s+karenge|baat\\s+karunga)\\b`,
    `मैं.{0,15}(?:कॉल करूँगा|बात करूँगा|फोन करूँगा)`,
  ].join("|"),
  "i"
)

const UNAMBIGUOUS_GOODBYE_RE = new RegExp(
  '\\b(' +
  'bye|goodbye|bye[- ]?bye|bye bye|thanks bye|thank you bye|sare bye|ok bye|okay bye|chalo bye|' +
  'phone pettestunna|phone pettestha|phone pettesthunna|phone cut chestunna|phone cut chestha|phone pettandi|phone cut cheyyandi|' +
  'selavu|veedkolu|alvida|phir milenge' +
  ')\\b|' +
  '^(?:sare|ok|okay)[\\s,]+(?:andi[\\s,]+)?(?:thank you|thanks)?\\s*bye[!.]*$|' +
  'ఫోన్ పెట్టేస్తున్నా|ఫోన్ కట్ చేస్తున్నా|ఫోన్ పెట్టండి|సెలవు|వీడ్కోలు|సరే బాయ్|ఓకే బాయ్|బాయ్|अलविदा|बाय|फोन रख रहा हूँ|फोन रख रही हूँ',
  'i'
)

const AMBIGUOUS_CLOSING_RE = new RegExp(
  '\\b(' +
  'no doubts?|no more doubts?|no questions?|all clear|everything clear|that is all|that\'s all|that is it|that\'s it|' +
  'nothing else|nothing more|no thanks?|no thank you|' +
  'em ledu|emi ledu|em ledhu|emi ledhu|em ledandi|emi ledandi|inka em ledu|inka emi ledu|' +
  'doubts? em levu|doubts? emi levu|doubts? levu|doubts? levandi|doubt em ledu|doubt ledu|' +
  'chalu|chalandi|chalu sir|avunu chalu|saripothundi|saripoddi|' +
  'anthe|anthe andi|anthe sir|anthey|' +
  'untanu|untanu sir|untanandi|untanu mari|sare untanu|inka untanu|' +
  'koi doubt nahi|kuch nahi|sab clear hai|bas itna hi|itna hi|ho gaya' +
  ')\\b|' +
  '^(no|no sir|no madam|ledu|ledu sir|ledandi|ledu andi|nahi|nahi sir|chalu|anthe|untanu|sare andi|ok andi|okay andi|okay|ok)[.!? ]*$|' +
  '^(లేదు|లేదండి|లేదు సర్|ఏం లేదు|ఏమీ లేదు|చాలు|చాలండి|అంతే|ఉంటాను|సరే అండి|సరే సర్|ఓకే)[.!? ]*$|' +
  'ఏం లేదు|ఏమీ లేదు|ఏం లేదండి|ఇంకేం లేదు|డౌట్స్ లేవు|డౌట్ లేదు|చాలు|చాలండి|అంతే|సరిపోతుంది|అంతా క్లియర్|క్లియర్ అయింది|' +
  'कोई डाउट नहीं|कुछ नहीं|बस इतना ही|हो गया',
  'i'
)

function evaluateUtterance(speech, isAfterDoubtInquiry = false) {
  // 1. DND / STOP CONTACT (Absolute override)
  if (DND_INTENT_RE.test(speech)) {
    return "DND_TERMINATE"
  }

  // 2. Explicit continuation / question?
  const hasContinuation = CONTINUATION_INTENT_RE.test(speech)
  if (hasContinuation) {
    return "CONTINUE_CONVERSATION"
  }

  // 3. Callback requested?
  if (REQUEST_CALLBACK_RE.test(speech)) {
    return "SCHEDULE_CALLBACK_TERMINATE"
  }

  // 4. Caller will call later?
  if (CALLER_WILL_CALL_RE.test(speech)) {
    return "CALLER_WILL_CALL_TERMINATE"
  }

  // 5. Explicit goodbye?
  if (UNAMBIGUOUS_GOODBYE_RE.test(speech)) {
    return "GOODBYE_TERMINATE"
  }

  // 6. Contextual no doubts or ambiguous closing
  if (AMBIGUOUS_CLOSING_RE.test(speech.trim())) {
    if (isAfterDoubtInquiry) {
      return "CONFIRMED_SATISFACTION_TERMINATE"
    } else {
      return "AMBIGUOUS_CONFIRM_CONTINUE"
    }
  }

  // 7. Normal conversation turn
  return "CONTINUE_CONVERSATION"
}

// TEST THE 10 REAL-WORLD CASES
const cases = [
  { name: "Case 1: Okay sir, bye... actually one small doubt.", speech: "Okay sir, bye... actually one small doubt.", isAfterDoubt: false, expected: "CONTINUE_CONVERSATION" },
  { name: "Case 2: Chalu sir, interest rate entha?", speech: "Chalu sir, interest rate entha?", isAfterDoubt: false, expected: "CONTINUE_CONVERSATION" },
  { name: "Case 3: Thanks sir, bye.", speech: "Thanks sir, bye.", isAfterDoubt: false, expected: "GOODBYE_TERMINATE" },
  { name: "Case 4: Thanks sir, oka last doubt.", speech: "Thanks sir, oka last doubt.", isAfterDoubt: false, expected: "CONTINUE_CONVERSATION" },
  { name: "Case 5: Don't call me again. Actually, loan amount entha?", speech: "Don't call me again. Actually, loan amount entha?", isAfterDoubt: false, expected: "DND_TERMINATE" },
  { name: "Case 6: Repu call chesta, meeru ippudu cheppandi.", speech: "Repu call chesta, meeru ippudu cheppandi.", isAfterDoubt: false, expected: "CONTINUE_CONVERSATION" },
  { name: "Case 7: Repu call cheyyandi, ippudu busy ga unnanu.", speech: "Repu call cheyyandi, ippudu busy ga unnanu.", isAfterDoubt: false, expected: "SCHEDULE_CALLBACK_TERMINATE" },
  { name: "Case 8: Sare andi.", speech: "Sare andi.", isAfterDoubt: false, expected: "AMBIGUOUS_CONFIRM_CONTINUE" },
  { name: "Case 9: Okay.", speech: "Okay.", isAfterDoubt: false, expected: "AMBIGUOUS_CONFIRM_CONTINUE" },
  { name: "Case 10a: Anthe (after doubt inquiry)", speech: "Anthe.", isAfterDoubt: true, expected: "CONFIRMED_SATISFACTION_TERMINATE" },
  { name: "Case 10b: Anthe... (during rate discussion)", speech: "Anthe...", isAfterDoubt: false, expected: "AMBIGUOUS_CONFIRM_CONTINUE" },
]

console.log("Evaluating the 10 User Cases:\n")
let passed = 0
for (const c of cases) {
  const actual = evaluateUtterance(c.speech, c.isAfterDoubt)
  const ok = actual === c.expected
  if (ok) passed++
  console.log(`${ok ? "✅" : "❌"} ${c.name} -> Got: ${actual} (Expected: ${c.expected})`)
}

console.log(`\nResult: ${passed}/${cases.length} passed!`)
if (passed !== cases.length) process.exit(1)
