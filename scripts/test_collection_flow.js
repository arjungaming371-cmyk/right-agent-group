const DND_INTENT_RE = new RegExp(
  [
    `\\b(?:please\\s+)?(?:don't|do not|never|stop)\\s+(?:call|contact|ring|message|reach)\\b`,
    `\\b(?:please\\s+)?(?:remove|delete|take off)\\s+(?:my\\s+)?(?:number|contact|phone|details|me)\\b`,
    `\\b(?:unsubscribe|put me on (?:the )?do not call|don't call me again|stop calling me|do not call again|never call me again|take me off your list)\\b`,
    `\\b(?:call|calls|phone)\\s+(?:cheyyakandi|cheyoddu|cheyyoddu|cheyakandi|cheyavaddu|vaddu)(?:\\s+andi)?\\b`,
    `\\b(?:malli|inkosari)\\s+(?:call|phone)\\s+(?:cheyyakandi|cheyoddu|cheyyoddu|cheyakandi)\\b`,
    `\\b(?:naaku\\s+calls?\\s+vaddu|calls?\\s+vaddu|malli\\s+(?:call\\s+)?vaddu)\\b`,
    `\\b(?:number|na number)\\s+(?:remove|delete|teeseyandi|theeseyandi)\\s*(?:cheyyandi)?\\b`,
    `కాల్ చేయకండి|కాల్స్ వద్దు|మళ్లీ కాల్ చేయకండి|నెంబర్ తీసేయండి|కాల్ చేయొద్దు|నాకు కాల్స్ వద్దు|ఫోన్ చేయకండి|నా నెంబర్ తీసేయండి|ఫోన్ చేయొద్దు`,
    `\\b(?:call|phone)\\s+(?:mat|nahi)\\s+(?:karo|karna|kariye)\\b`,
    `\\b(?:dobara|phir|kabhi)\\s+call\\s+mat\\s+(?:karo|karna|kariye)\\b`,
    `\\b(?:mera\\s+)?number\\s+(?:hata\\s+do|hatao|delete karo|nikal\\s+do|nikalo)\\b`,
    `\\blist\\s+se\\s+(?:nikal\\s+do|nikalo|hata\\s+do|hatao)\\b`,
    `कॉल मत करो|फोन मत करना|दोबारा कॉल मत करना|नंबर हटा दो|मुझे कॉल मत करो`,
  ].join("|"),
  "i"
);

function detectDndIntent(speech) {
  if (!speech || speech.length > 300) return false;
  return DND_INTENT_RE.test(speech);
}

console.log("'Inkem vaddu, sare andi' -> DND?", detectDndIntent("Inkem vaddu, sare andi"));
console.log("'naaku calls vaddu' -> DND?", detectDndIntent("naaku calls vaddu"));
console.log("'call cheyyakandi' -> DND?", detectDndIntent("call cheyyakandi"));
