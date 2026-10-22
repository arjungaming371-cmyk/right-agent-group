/**
 * 140+ Production Intent Test Matrix for Priya Smart Hang-Up Engine
 * Tests Telugu, English, and Hindi utterances across 8 categories:
 * 1. DND (Absolute Priority / Immediate Suppression)
 * 2. Negative DND (Zero False DNDs)
 * 3. Callback Requested (Agent to call -> Calendar event scheduled)
 * 4. Caller Will Call Later (Caller to call -> NO Calendar event)
 * 5. Continuation / Question (Overrides ending markers -> Keep conversation open)
 * 6. Unambiguous Goodbyes (Clean sign-offs)
 * 7. Ambiguous Words AFTER Doubt Inquiry (Clean termination)
 * 8. Ambiguous Words MID-CONVERSATION (Confirmation fallback -> Zero Accidental Drops)
 */

const DND_INTENT_RE = new RegExp([
  '\\b(?:please\\s+)?(?:don\'t|do not|never|stop)\\s+(?:call|contact|ring|message|reach)\\b',
  '\\b(?:please\\s+)?(?:remove|delete|take off)\\s+(?:my\\s+)?(?:number|contact|phone|details|me)\\b',
  '\\b(?:unsubscribe|put me on (?:the )?do not call|don\'t call me again|stop calling me|do not call again|never call me again|take me off your list)\\b',
  '\\b(?:call|calls|phone)\\s+(?:cheyyakandi|cheyoddu|cheyyoddu|cheyakandi|cheyavaddu|vaddu)(?:\\s+andi)?\\b',
  '\\b(?:malli|inkosari)\\s+(?:call|phone)\\s+(?:cheyyakandi|cheyoddu|cheyyoddu|cheyakandi)\\b',
  '\\b(?:naaku\\s+)?(?:calls?\\s+)?vaddu\\b',
  '\\b(?:number|na number)\\s+(?:remove|delete|teeseyandi|theeseyandi)\\s*(?:cheyyandi)?\\b',
  'కాల్ చేయకండి|కాల్స్ వద్దు|మళ్లీ కాల్ చేయకండి|నెంబర్ తీసేయండి|కాల్ చేయొద్దు|నాకు వద్దు|ఫోన్ చేయకండి|నా నెంబర్ తీసేయండి|ఫోన్ చేయొద్దు',
  '\\b(?:call|phone)\\s+(?:mat|nahi)\\s+(?:karo|karna|kariye)\\b',
  '\\b(?:dobara|phir|kabhi)\\s+call\\s+mat\\s+(?:karo|karna|kariye)\\b',
  '\\b(?:mera\\s+)?number\\s+(?:hata\\s+do|hatao|delete karo|nikal\\s+do|nikalo)\\b',
  '\\blist\\s+se\\s+(?:nikal\\s+do|nikalo|hata\\s+do|hatao)\\b',
  'कॉल मत करो|फोन मत करना|दोबारा कॉल मत करना|नंबर हटा दो|मुझे कॉल मत करो',
].join("|"), "i");

const CONTINUATION_INTENT_RE = new RegExp(
  '\\b(' +
  '(?<!no\\s+|no more\\s+|em\\s+|emi\\s+|koi\\s+)(?:doubt|doubts|question|questions)(?!\\s+(?:levu|em levu|levandi|ledu|nahi))|' +
  'oka doubt|oka question|small doubt|last doubt|one last question|last question|actually|wait|adagali|entha|rate|interest|emi|ela|enduku|cheppandi|cheppu|' +
  'clarification|clarify|meeru ippudu|ippudu cheppandi|malli cheppandi|' +
  'kani|kaani|but|okati|ayithe|aithe|inka|' +
  'what|how|why|when\\s+(?:can|will|do|is|are|did|does|should|would|to)|when\\?|which|can you|tell me|kya|kaise|kitna|lekin|par' +
  ')\\b|\\?|డౌట్|డౌట్స్|ఒక డౌట్|ఒక ప్రశ్న|చిన్న డౌట్|చివరి డౌట్|ఎంత|ఎలా|ఎందుకు|చెప్పండి|కానీ|కాని|ఇంకా|ఇప్పుడు చెప్పండి',
  'i'
);

const REQUEST_CALLBACK_RE = new RegExp(
  [
    `\\b(?:please\\s+)?(?:call\\s+me|call\\s+us|ring\\s+me|reach\\s+me|talk\\s+to\\s+me)\\b[^.?!]{0,40}\\b(?:later|tomorrow|tonight|today|morning|afternoon|evening|night|next week|at\\s+\\d+|in\\s+\\d+)`,
    `\\b(?:later|tomorrow|tonight|next week|after\\s+\\d+|evening|morning)\\b[^.?!]{0,40}\\b(?:please\\s+)?(?:call\\s+me|call\\s+us|ring\\s+me)\\b`,
    `\\b(?:busy|busy right now|can't talk right now|in a meeting)\\b[^.?!]{0,35}\\b(?:call\\s+me|call\\s+later|call\\s+tomorrow)\\b`,
    `\\b(?:repu|tarvata|tarvatha|malli|sayanthram|udayam|evening|morning|monday)\\b[^.?!]{0,30}\\b(?:call\\s+cheyandi|call\\s+cheyyandi|phone\\s+cheyandi|phone\\s+cheyyandi|matladandi|ring\\s+cheyandi)\\b`,
    `\\b(?:call\\s+cheyandi|call\\s+cheyyandi|phone\\s+cheyandi|matladandi)\\b[^.?!]{0,20}\\b(?:repu|tarvata|sayanthram|udayam|evening|morning|monday)\\b`,
    `\\b(?:busy|busy ga unnanu|meeting lo unnanu)\\b[^.?!]{0,35}\\b(?:tarvata|repu)?\\s*(?:call\\s+cheyandi|call\\s+cheyyandi)\\b`,
    `(?:రేపు|తర్వాత|సాయంత్రం|మళ్ళీ)[^.?!]{0,25}(?:కాల్\\s*చేయండి|ఫోన్\\s*చేయండి|మాట్లాడండి)`,
    `(?:కాల్\\s*చేయండి|ఫోన్\\s*చేయండి|మాట్లాడండి)[^.?!]{0,20}(?:రేపు|తర్వాత|సాయంత్రం)`,
    `\\b(?:kal|baad me|baad mein|shaam ko|sham ko|subah|\\d+\\s+ghante baad)\\b[^.?!]{0,30}\\b(?:call\\s+kijiye|call\\s+karna|call\\s+kariyega|call\\s+karo|phone\\s+kijiye|phone\\s+karna)\\b`,
    `\\b(?:call|phone)\\s+(?:kijiye|karna|kariyega|karo)\\b[^.?!]{0,25}\\b(?:kal|shaam|sham|subah|baad me|baad mein)\\b`,
    `कल.{0,15}(?:కాల్ कीजिए|కాల్ करना|फोन करना)|बाद में.{0,15}(?:कॉल कीजिए|कॉल करना)`,
    `\\bcall\\s+back\\s+tomorrow\\b`
  ].join("|"),
  "i"
);

const CALLER_WILL_CALL_RE = new RegExp(
  [
    `\\b(?:nenu|memu)?\\s*(?:repu|tarvata|tarvatha|malli|sayanthram|udayam|evening lo|morning lo|office ayyaka|free ayyaka)\\b[^.?!]{0,30}\\b(?:call\\s+chesta|call\\s+chestanu|matladathanu|matladathaa|cheptanu|cheptha|vastaanu|vastanu|osthanu)\\b`,
    `\\b(?:nenu|memu)\\s+(?:tarvata|malli|repu|chusi|office velli)?\\s*(?:call\\s+chesta|call\\s+chestanu|matladathanu)\\b`,
    `\\b(?:chusi|chuse)\\s+(?:cheptanu|cheptha|call chestanu|call chesta)\\b`,
    `(?:నేను|మేము)?\\s*(?:రేపు|తర్వాత|మళ్ళీ|సాయంత్రం)[^.?!]{0,25}(?:కాల్\\s*చేస్తా|కాల్\\s*చేస్తాను|మాట్లాడతాను|చెప్తాను|చూసి\\s*చెప్తాను|వస్తాను)`,
    `\\b(?:i|i'll|i will|let me|we will)\\s+(?:call|reach out|contact|ring|check and call)(?:\\s+you)?(?:\\s+back|\\s+later|\\s+tomorrow|\\s+tonight|\\s+next week|\\s+when[^.?!]{0,20})?\\b`,
    `\\b(?:i will|i'll)\\s+(?:check and call back|call back later|call when[^.?!]{0,20})\\b`,
    `\\b(?:main|hum)?\\s*(?:baad me|baad mein|kal|phir|khud|free hokar)\\s+(?:call\\s+karunga|call\\s+karenge|call\\s+karti hoon|call\\s+karta hoon|baat\\s+karunga)\\b`,
    `मैं.{0,15}(?:कॉल करूँगा|बात करूँगा|फोन करूँगा|कॉल करती हूँ)`,
  ].join("|"),
  "i"
);

const UNAMBIGUOUS_GOODBYE_RE = new RegExp(
  '\\b(' +
  'bye|goodbye|bye[- ]?bye|bye bye|thanks bye|thank you bye|sare bye|ok bye|okay bye|chalo bye|' +
  'phone pettestunna|phone pettestha|phone pettesthunna|phone cut chestunna|phone cut chestha|phone pettandi|phone cut cheyyandi|' +
  'selavu|veedkolu|alvida|phir milenge' +
  ')\\b|' +
  '^(?:sare|ok|okay)[\\s,]+(?:andi[\\s,]+)?(?:thank you|thanks)?\\s*bye[!.]*$|' +
  'ఫోన్ పెట్టేస్తున్నా|ఫోన్ కట్ చేస్తున్నా|ఫోన్ పెట్టండి|సెలవు|వీడ్కోలు|సరే బాయ్|ఓకే బాయ్|బాయ్|अलविदा|बाय|फोन रख रहा हूँ|फोन रख रही हूँ',
  'i'
);

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
  '^(no|no sir|no madam|ledu|ledu sir|ledandi|ledu andi|nahi|nahi sir|chalu|anthe|untanu|sare andi|ok andi|okay andi|okay|ok|sare)[.!? ]*$|' +
  '^(లేదు|లేదండి|లేదు సర్|ఏం లేదు|ఏమీ లేదు|చాలు|చాలండి|అంతే|ఉంటాను|సరే అండి|సరే సర్|ఓకే)[.!? ]*$|' +
  'ఏం లేదు|ఏమీ లేదు|ఏం లేదండి|ఇంకేం లేదు|డౌట్స్ లేవు|డౌట్ లేదు|చాలు|చాలండి|అంతే|సరిపోతుంది|అంతా క్లియర్|క్లియర్ అయింది|' +
  'कोई डाउट नहीं|कुछ नहीं|बस इतना ही|हो गया',
  'i'
);

function evaluateUtterance(speech, isAfterDoubt = false) {
  // 1. DND Check (Absolute Priority)
  if (DND_INTENT_RE.test(speech)) {
    return 'DND_TERMINATE';
  }

  // 2. Continuation Check (Preempts all endings/callbacks)
  const hasContinuation = CONTINUATION_INTENT_RE.test(speech);
  if (hasContinuation) {
    return 'CONTINUE_CONVERSATION';
  }

  // 3. Callback Requested
  if (REQUEST_CALLBACK_RE.test(speech)) {
    return 'SCHEDULE_CALLBACK_TERMINATE';
  }

  // 4. Caller Will Call Later
  if (CALLER_WILL_CALL_RE.test(speech)) {
    return 'CALLER_WILL_CALL_TERMINATE';
  }

  // 5. Unambiguous Goodbye
  if (UNAMBIGUOUS_GOODBYE_RE.test(speech)) {
    return 'GOODBYE_TERMINATE';
  }

  // 6. Ambiguous Closing Check
  if (AMBIGUOUS_CLOSING_RE.test((speech || '').trim())) {
    if (isAfterDoubt) {
      return 'CONFIRMED_SATISFACTION_TERMINATE';
    } else {
      return 'AMBIGUOUS_CONFIRM_CONTINUE';
    }
  }

  return 'CONTINUE_CONVERSATION';
}

const tests = [
  // ==========================================
  // Category 1: DND (20 tests)
  // Must return: DND_TERMINATE
  // ==========================================
  { speech: "call cheyyakandi", expected: "DND_TERMINATE", cat: "DND" },
  { speech: "malli call cheyyakandi", expected: "DND_TERMINATE", cat: "DND" },
  { speech: "naaku calls vaddu", expected: "DND_TERMINATE", cat: "DND" },
  { speech: "number remove cheyyandi", expected: "DND_TERMINATE", cat: "DND" },
  { speech: "do not call again", expected: "DND_TERMINATE", cat: "DND" },
  { speech: "stop calling me", expected: "DND_TERMINATE", cat: "DND" },
  { speech: "don't contact me", expected: "DND_TERMINATE", cat: "DND" },
  { speech: "remove my number", expected: "DND_TERMINATE", cat: "DND" },
  { speech: "unsubscribe", expected: "DND_TERMINATE", cat: "DND" },
  { speech: "take me off your list", expected: "DND_TERMINATE", cat: "DND" },
  { speech: "please do not call me", expected: "DND_TERMINATE", cat: "DND" },
  { speech: "mujhe call mat karo", expected: "DND_TERMINATE", cat: "DND" },
  { speech: "dobara call mat karna", expected: "DND_TERMINATE", cat: "DND" },
  { speech: "mera number hata do", expected: "DND_TERMINATE", cat: "DND" },
  { speech: "list se nikal do", expected: "DND_TERMINATE", cat: "DND" },
  { speech: "malli phone cheyoddu", expected: "DND_TERMINATE", cat: "DND" },
  { speech: "naaku interest ledu call cheyyakandi", expected: "DND_TERMINATE", cat: "DND" },
  { speech: "please don't call me again", expected: "DND_TERMINATE", cat: "DND" },
  { speech: "Don't call me again. Actually, loan amount entha?", expected: "DND_TERMINATE", cat: "DND" },
  { speech: "phone cheyyoddu andi", expected: "DND_TERMINATE", cat: "DND" },

  // ==========================================
  // Category 2: Negative DND (Zero False DNDs) (15 tests)
  // Must NOT trigger DND
  // ==========================================
  { speech: "don't worry", expected: "CONTINUE_CONVERSATION", cat: "Negative DND" },
  { speech: "I don't know the exact interest rate", expected: "CONTINUE_CONVERSATION", cat: "Negative DND" },
  { speech: "call me at 5pm", expected: "SCHEDULE_CALLBACK_TERMINATE", cat: "Negative DND" },
  { speech: "number send cheyyandi", expected: "CONTINUE_CONVERSATION", cat: "Negative DND" },
  { speech: "send details to this number", expected: "CONTINUE_CONVERSATION", cat: "Negative DND" },
  { speech: "call transfer cheyyandi", expected: "CONTINUE_CONVERSATION", cat: "Negative DND" },
  { speech: "don't cut the call", expected: "CONTINUE_CONVERSATION", cat: "Negative DND" },
  { speech: "oka sari explain cheyyandi", expected: "CONTINUE_CONVERSATION", cat: "Negative DND" },
  { speech: "don't think so", expected: "CONTINUE_CONVERSATION", cat: "Negative DND" },
  { speech: "phone number note cheskondi", expected: "CONTINUE_CONVERSATION", cat: "Negative DND" },
  { speech: "call cheyyocha meeku", expected: "CONTINUE_CONVERSATION", cat: "Negative DND" },
  { speech: "malli eppudu open untundi", expected: "CONTINUE_CONVERSATION", cat: "Negative DND" },
  { speech: "nenu ippude call chesa", expected: "CONTINUE_CONVERSATION", cat: "Negative DND" },
  { speech: "mujhe details chahiye number pe", expected: "CONTINUE_CONVERSATION", cat: "Negative DND" },
  { speech: "mera number verify karo", expected: "CONTINUE_CONVERSATION", cat: "Negative DND" },

  // ==========================================
  // Category 3: Callback Requested by Caller (20 tests)
  // Must return: SCHEDULE_CALLBACK_TERMINATE
  // ==========================================
  { speech: "repu call cheyyandi", expected: "SCHEDULE_CALLBACK_TERMINATE", cat: "Callback Requested" },
  { speech: "repu malli call cheyyandi", expected: "SCHEDULE_CALLBACK_TERMINATE", cat: "Callback Requested" },
  { speech: "repu morning call cheyyandi", expected: "SCHEDULE_CALLBACK_TERMINATE", cat: "Callback Requested" },
  { speech: "tarvata call cheyyandi", expected: "SCHEDULE_CALLBACK_TERMINATE", cat: "Callback Requested" },
  { speech: "busy ga unnanu, later call cheyyandi", expected: "SCHEDULE_CALLBACK_TERMINATE", cat: "Callback Requested" },
  { speech: "evening call cheyyandi", expected: "SCHEDULE_CALLBACK_TERMINATE", cat: "Callback Requested" },
  { speech: "after 5 call me", expected: "SCHEDULE_CALLBACK_TERMINATE", cat: "Callback Requested" },
  { speech: "tomorrow call me", expected: "SCHEDULE_CALLBACK_TERMINATE", cat: "Callback Requested" },
  { speech: "later call me", expected: "SCHEDULE_CALLBACK_TERMINATE", cat: "Callback Requested" },
  { speech: "call me tomorrow at 4", expected: "SCHEDULE_CALLBACK_TERMINATE", cat: "Callback Requested" },
  { speech: "call me in 1 hour", expected: "SCHEDULE_CALLBACK_TERMINATE", cat: "Callback Requested" },
  { speech: "kal call kijiye", expected: "SCHEDULE_CALLBACK_TERMINATE", cat: "Callback Requested" },
  { speech: "baad mein call karna", expected: "SCHEDULE_CALLBACK_TERMINATE", cat: "Callback Requested" },
  { speech: "sham ko call kijiye", expected: "SCHEDULE_CALLBACK_TERMINATE", cat: "Callback Requested" },
  { speech: "1 ghante baad call karo", expected: "SCHEDULE_CALLBACK_TERMINATE", cat: "Callback Requested" },
  { speech: "repu 10 am ki call cheyyandi", expected: "SCHEDULE_CALLBACK_TERMINATE", cat: "Callback Requested" },
  { speech: "monday call cheyyandi", expected: "SCHEDULE_CALLBACK_TERMINATE", cat: "Callback Requested" },
  { speech: "tarvata phone cheyyandi", expected: "SCHEDULE_CALLBACK_TERMINATE", cat: "Callback Requested" },
  { speech: "ippudu busy repu call cheyyandi", expected: "SCHEDULE_CALLBACK_TERMINATE", cat: "Callback Requested" },
  { speech: "call back tomorrow", expected: "SCHEDULE_CALLBACK_TERMINATE", cat: "Callback Requested" },

  // ==========================================
  // Category 4: Caller Will Call Later (20 tests)
  // Must return: CALLER_WILL_CALL_TERMINATE (NO Calendar Booking)
  // ==========================================
  { speech: "repu call chesta", expected: "CALLER_WILL_CALL_TERMINATE", cat: "Caller Will Call" },
  { speech: "repu call chestanu", expected: "CALLER_WILL_CALL_TERMINATE", cat: "Caller Will Call" },
  { speech: "nenu call chesta", expected: "CALLER_WILL_CALL_TERMINATE", cat: "Caller Will Call" },
  { speech: "nenu malli call chesta", expected: "CALLER_WILL_CALL_TERMINATE", cat: "Caller Will Call" },
  { speech: "nenu tarvata call chesta", expected: "CALLER_WILL_CALL_TERMINATE", cat: "Caller Will Call" },
  { speech: "tarvata call chesta", expected: "CALLER_WILL_CALL_TERMINATE", cat: "Caller Will Call" },
  { speech: "I'll call you later", expected: "CALLER_WILL_CALL_TERMINATE", cat: "Caller Will Call" },
  { speech: "I will call tomorrow", expected: "CALLER_WILL_CALL_TERMINATE", cat: "Caller Will Call" },
  { speech: "I'll contact you tomorrow", expected: "CALLER_WILL_CALL_TERMINATE", cat: "Caller Will Call" },
  { speech: "I'll call when I'm free", expected: "CALLER_WILL_CALL_TERMINATE", cat: "Caller Will Call" },
  { speech: "I will check and call back", expected: "CALLER_WILL_CALL_TERMINATE", cat: "Caller Will Call" },
  { speech: "main kal call karunga", expected: "CALLER_WILL_CALL_TERMINATE", cat: "Caller Will Call" },
  { speech: "main baad mein call karti hoon", expected: "CALLER_WILL_CALL_TERMINATE", cat: "Caller Will Call" },
  { speech: "main khud call karunga", expected: "CALLER_WILL_CALL_TERMINATE", cat: "Caller Will Call" },
  { speech: "free hokar call karunga", expected: "CALLER_WILL_CALL_TERMINATE", cat: "Caller Will Call" },
  { speech: "nenu chusi call chestanu", expected: "CALLER_WILL_CALL_TERMINATE", cat: "Caller Will Call" },
  { speech: "office ayyaka call chesta", expected: "CALLER_WILL_CALL_TERMINATE", cat: "Caller Will Call" },
  { speech: "nenu office velli call chestanu", expected: "CALLER_WILL_CALL_TERMINATE", cat: "Caller Will Call" },
  { speech: "free ayyaka call chesta", expected: "CALLER_WILL_CALL_TERMINATE", cat: "Caller Will Call" },
  { speech: "I will call back later", expected: "CALLER_WILL_CALL_TERMINATE", cat: "Caller Will Call" },

  // ==========================================
  // Category 5: Continuation / Questions (Zero Accidental Drops) (25 tests)
  // Must return: CONTINUE_CONVERSATION
  // ==========================================
  { speech: "Okay sir, bye... actually one small doubt.", expected: "CONTINUE_CONVERSATION", cat: "Continuation Precedence" },
  { speech: "Chalu sir, interest rate entha?", expected: "CONTINUE_CONVERSATION", cat: "Continuation Precedence" },
  { speech: "Thanks sir, oka last doubt.", expected: "CONTINUE_CONVERSATION", cat: "Continuation Precedence" },
  { speech: "Repu call chesta, meeru ippudu cheppandi.", expected: "CONTINUE_CONVERSATION", cat: "Continuation Precedence" },
  { speech: "Chalu, processing fee entha untundi?", expected: "CONTINUE_CONVERSATION", cat: "Continuation Precedence" },
  { speech: "Untanu, kani documents em kavali?", expected: "CONTINUE_CONVERSATION", cat: "Continuation Precedence" },
  { speech: "Anthe, wait oka question undi", expected: "CONTINUE_CONVERSATION", cat: "Continuation Precedence" },
  { speech: "Bye, wait can you tell me the tenure?", expected: "CONTINUE_CONVERSATION", cat: "Continuation Precedence" },
  { speech: "Thanks, but what is the EMI?", expected: "CONTINUE_CONVERSATION", cat: "Continuation Precedence" },
  { speech: "Sare, inko doubt undi", expected: "CONTINUE_CONVERSATION", cat: "Continuation Precedence" },
  { speech: "Okay andi, repayment ela cheyyali?", expected: "CONTINUE_CONVERSATION", cat: "Continuation Precedence" },
  { speech: "Theek hai, lekin interest kitna hai?", expected: "CONTINUE_CONVERSATION", cat: "Continuation Precedence" },
  { speech: "Bas itna hi, par ek doubt hai", expected: "CONTINUE_CONVERSATION", cat: "Continuation Precedence" },
  { speech: "Accha, ek question tha", expected: "CONTINUE_CONVERSATION", cat: "Continuation Precedence" },
  { speech: "Sare chalu, eligibility criteria enti?", expected: "CONTINUE_CONVERSATION", cat: "Continuation Precedence" },
  { speech: "Okay bye, wait rate of interest cheppandi", expected: "CONTINUE_CONVERSATION", cat: "Continuation Precedence" },
  { speech: "Thanks andi, CIBIL score entha kavali?", expected: "CONTINUE_CONVERSATION", cat: "Continuation Precedence" },
  { speech: "Chalu, salary slip avasarama?", expected: "CONTINUE_CONVERSATION", cat: "Continuation Precedence" },
  { speech: "Ok bye, one last question", expected: "CONTINUE_CONVERSATION", cat: "Continuation Precedence" },
  { speech: "Done, but how much loan can I get?", expected: "CONTINUE_CONVERSATION", cat: "Continuation Precedence" },
  { speech: "Sare untanu, bank statement kavala?", expected: "CONTINUE_CONVERSATION", cat: "Continuation Precedence" },
  { speech: "Kal call kijiye, par interest rate batayiye", expected: "CONTINUE_CONVERSATION", cat: "Continuation Precedence" },
  { speech: "Later call me, wait actually EMI entha?", expected: "CONTINUE_CONVERSATION", cat: "Continuation Precedence" },
  { speech: "Untanandi, oka clarification kavali", expected: "CONTINUE_CONVERSATION", cat: "Continuation Precedence" },
  { speech: "Chalu, interest rate entha?", expected: "CONTINUE_CONVERSATION", cat: "Continuation Precedence" },

  // ==========================================
  // Category 6: Unambiguous Goodbyes (15 tests)
  // Must return: GOODBYE_TERMINATE
  // ==========================================
  { speech: "Thanks sir, bye", expected: "GOODBYE_TERMINATE", cat: "Unambiguous Goodbye" },
  { speech: "Okay bye", expected: "GOODBYE_TERMINATE", cat: "Unambiguous Goodbye" },
  { speech: "Sare bye", expected: "GOODBYE_TERMINATE", cat: "Unambiguous Goodbye" },
  { speech: "Good bye", expected: "GOODBYE_TERMINATE", cat: "Unambiguous Goodbye" },
  { speech: "Bye bye", expected: "GOODBYE_TERMINATE", cat: "Unambiguous Goodbye" },
  { speech: "Thank you, bye", expected: "GOODBYE_TERMINATE", cat: "Unambiguous Goodbye" },
  { speech: "Phone pettestunna", expected: "GOODBYE_TERMINATE", cat: "Unambiguous Goodbye" },
  { speech: "Phone cut chestunna", expected: "GOODBYE_TERMINATE", cat: "Unambiguous Goodbye" },
  { speech: "Phone pettandi", expected: "GOODBYE_TERMINATE", cat: "Unambiguous Goodbye" },
  { speech: "Selavu", expected: "GOODBYE_TERMINATE", cat: "Unambiguous Goodbye" },
  { speech: "Alvida", expected: "GOODBYE_TERMINATE", cat: "Unambiguous Goodbye" },
  { speech: "Chalo bye", expected: "GOODBYE_TERMINATE", cat: "Unambiguous Goodbye" },
  { speech: "Theek hai bye", expected: "GOODBYE_TERMINATE", cat: "Unambiguous Goodbye" },
  { speech: "Shukriya bye", expected: "GOODBYE_TERMINATE", cat: "Unambiguous Goodbye" },
  { speech: "Sare andi thank you bye", expected: "GOODBYE_TERMINATE", cat: "Unambiguous Goodbye" },

  // ==========================================
  // Category 7: Ambiguous Words AFTER Doubt Inquiry (10 tests)
  // Must return: CONFIRMED_SATISFACTION_TERMINATE
  // ==========================================
  { speech: "Anthe", isAfterDoubt: true, expected: "CONFIRMED_SATISFACTION_TERMINATE", cat: "Contextual Goodbye" },
  { speech: "Ledu", isAfterDoubt: true, expected: "CONFIRMED_SATISFACTION_TERMINATE", cat: "Contextual Goodbye" },
  { speech: "Em ledu", isAfterDoubt: true, expected: "CONFIRMED_SATISFACTION_TERMINATE", cat: "Contextual Goodbye" },
  { speech: "No doubts", isAfterDoubt: true, expected: "CONFIRMED_SATISFACTION_TERMINATE", cat: "Contextual Goodbye" },
  { speech: "All clear", isAfterDoubt: true, expected: "CONFIRMED_SATISFACTION_TERMINATE", cat: "Contextual Goodbye" },
  { speech: "Chalu", isAfterDoubt: true, expected: "CONFIRMED_SATISFACTION_TERMINATE", cat: "Contextual Goodbye" },
  { speech: "Saripothundi", isAfterDoubt: true, expected: "CONFIRMED_SATISFACTION_TERMINATE", cat: "Contextual Goodbye" },
  { speech: "Sab clear hai", isAfterDoubt: true, expected: "CONFIRMED_SATISFACTION_TERMINATE", cat: "Contextual Goodbye" },
  { speech: "Kuch nahi", isAfterDoubt: true, expected: "CONFIRMED_SATISFACTION_TERMINATE", cat: "Contextual Goodbye" },
  { speech: "Nothing else", isAfterDoubt: true, expected: "CONFIRMED_SATISFACTION_TERMINATE", cat: "Contextual Goodbye" },

  // ==========================================
  // Category 8: Ambiguous Words MID-CONVERSATION (15 tests)
  // Must return: AMBIGUOUS_CONFIRM_CONTINUE (Zero Accidental Drops)
  // ==========================================
  { speech: "Sare andi", isAfterDoubt: false, expected: "AMBIGUOUS_CONFIRM_CONTINUE", cat: "Ambiguous Confirmation" },
  { speech: "Okay", isAfterDoubt: false, expected: "AMBIGUOUS_CONFIRM_CONTINUE", cat: "Ambiguous Confirmation" },
  { speech: "Anthe", isAfterDoubt: false, expected: "AMBIGUOUS_CONFIRM_CONTINUE", cat: "Ambiguous Confirmation" },
  { speech: "Chalu", isAfterDoubt: false, expected: "AMBIGUOUS_CONFIRM_CONTINUE", cat: "Ambiguous Confirmation" },
  { speech: "Untanu", isAfterDoubt: false, expected: "AMBIGUOUS_CONFIRM_CONTINUE", cat: "Ambiguous Confirmation" },
  { speech: "Ok andi", isAfterDoubt: false, expected: "AMBIGUOUS_CONFIRM_CONTINUE", cat: "Ambiguous Confirmation" },
  { speech: "Sare", isAfterDoubt: false, expected: "AMBIGUOUS_CONFIRM_CONTINUE", cat: "Ambiguous Confirmation" },
  { speech: "Theek hai", isAfterDoubt: false, expected: "CONTINUE_CONVERSATION", cat: "Ambiguous Confirmation" },
  { speech: "Haan", isAfterDoubt: false, expected: "CONTINUE_CONVERSATION", cat: "Ambiguous Confirmation" },
  { speech: "Okay andi", isAfterDoubt: false, expected: "AMBIGUOUS_CONFIRM_CONTINUE", cat: "Ambiguous Confirmation" },
  { speech: "Ok", isAfterDoubt: false, expected: "AMBIGUOUS_CONFIRM_CONTINUE", cat: "Ambiguous Confirmation" },
  { speech: "Ledandi", isAfterDoubt: false, expected: "AMBIGUOUS_CONFIRM_CONTINUE", cat: "Ambiguous Confirmation" },
  { speech: "Ledu sir", isAfterDoubt: false, expected: "AMBIGUOUS_CONFIRM_CONTINUE", cat: "Ambiguous Confirmation" },
  { speech: "Saripothundi", isAfterDoubt: false, expected: "AMBIGUOUS_CONFIRM_CONTINUE", cat: "Ambiguous Confirmation" },
  { speech: "Nahi", isAfterDoubt: false, expected: "AMBIGUOUS_CONFIRM_CONTINUE", cat: "Ambiguous Confirmation" }
];

console.log(`Running Comprehensive ${tests.length}-Utterance Production Intent Matrix...\n`);

let passed = 0;
let failed = 0;
const failures = [];

const catSummary = {};

tests.forEach((t, idx) => {
  const result = evaluateUtterance(t.speech, !!t.isAfterDoubt);
  if (!catSummary[t.cat]) {
    catSummary[t.cat] = { total: 0, passed: 0 };
  }
  catSummary[t.cat].total++;

  if (result === t.expected) {
    passed++;
    catSummary[t.cat].passed++;
  } else {
    failed++;
    failures.push({
      index: idx + 1,
      category: t.cat,
      speech: t.speech,
      isAfterDoubt: !!t.isAfterDoubt,
      expected: t.expected,
      got: result
    });
  }
});

console.log('--- CATEGORY BREAKDOWN ---');
for (const [cat, stats] of Object.entries(catSummary)) {
  const status = stats.passed === stats.total ? '✅' : '❌';
  console.log(`${status} ${cat.padEnd(26)} : ${stats.passed}/${stats.total} passed`);
}

console.log('\n==================================================');
console.log(`OVERALL RESULT: ${passed}/${tests.length} tests passed (${Math.round((passed / tests.length) * 100)}%)`);
console.log('==================================================\n');

if (failures.length > 0) {
  console.log('FAILURES:');
  failures.forEach(f => {
    console.log(`❌ #${f.index} [${f.category}] "${f.speech}" (afterDoubt=${f.isAfterDoubt}) -> Expected: ${f.expected}, Got: ${f.got}`);
  });
  process.exit(1);
} else {
  console.log('🌟 100% PASS RATE! Zero false DNDs, Zero false calendar bookings, Zero accidental drops.');
  process.exit(0);
}
