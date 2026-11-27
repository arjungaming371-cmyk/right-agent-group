require('dotenv').config();

async function testLlmTurn2() {
  const apiKey = process.env.SARVAM_API_KEY;

  const systemPrompt = `You are Priya, a warm, polite, and sharp loan advisor at Right Agent Group, Hyderabad.
You are in a live phone call with the customer.
Talk like a REAL HELPFUL PERSON, never like a robotic call center script.
Speak in short, natural sentences (1-2 sentences at a time).
The customer speaks Telugu. Reply in natural spoken Telugu using Telugu script with common English loanwords.

CRITICAL HUMAN DIALOGUE RULE:
- When the customer asks who is calling ("evaru" / "who is this" / "evarandi"):
  State politely in ONE sentence who you are and ask if you can speak for a minute:
  "Right Agent Group నుంచి Priya మాట్లాడుతున్నాను sir, మీతో ఒక నిమిషం మాట్లాడవచ్చా?"
- DO NOT launch into any loan amount question or sales pitch! STOP and wait for them.`;

  const messages = [
    { role: 'system', content: systemPrompt },
    { role: 'assistant', content: 'నమస్కారం Ajay garu, Right Agent Group నుంచి Priya మాట్లాడుతున్నాను sir. మాట్లాడటానికి ఒక నిమిషం time ఉందా?' },
    { role: 'user', content: 'Evarandi meeru?' }
  ];

  try {
    const res = await fetch('https://api.sarvam.ai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'api-subscription-key': apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'sarvam-105b-conversations',
        messages: messages,
        temperature: 0.5,
        max_tokens: 150,
      }),
    });

    const data = await res.json();
    console.log('LLM Output for Evarandi meeru?:', data.choices?.[0]?.message?.content);
  } catch (e) {
    console.error('Error:', e.message);
  }
}

testLlmTurn2();
