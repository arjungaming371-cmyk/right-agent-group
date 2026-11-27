require('dotenv').config();

async function testSarvamTts() {
  const apiKey = process.env.SARVAM_API_KEY;
  console.log('Testing Sarvam TTS Live with speaker priya...');

  try {
    const res = await fetch('https://api.sarvam.ai/text-to-speech', {
      method: 'POST',
      headers: {
        'api-subscription-key': apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        inputs: ['నమస్కారం అజయ్ గారు, నా వాయిస్ వినిపిస్తోందా sir?'],
        target_language_code: 'te-IN',
        speaker: 'priya',
        model: 'bulbul:v3',
        pace: 1.0,
      }),
    });

    console.log('Sarvam TTS Status:', res.status);
    if (!res.ok) {
      const err = await res.text();
      console.error('Sarvam TTS Failed:', err);
    } else {
      const json = await res.json();
      console.log('Sarvam TTS SUCCESS! Audio chunks:', json.audios?.length);
    }
  } catch (e) {
    console.error('Error:', e.message);
  }
}

testSarvamTts();
