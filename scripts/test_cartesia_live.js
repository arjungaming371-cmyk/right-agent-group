require('dotenv').config();
const fs = require('fs');

async function testCartesia() {
  const apiKey = process.env.CARTESIA_API_KEY;
  const voiceId = process.env.CARTESIA_VOICE_ID || 'cf061d8b-a752-4865-81a2-57570a6e0565';
  console.log('Testing Cartesia TTS Live with Voice ID:', voiceId);

  try {
    const res = await fetch('https://api.cartesia.ai/tts/bytes', {
      method: 'POST',
      headers: {
        'X-API-Key': apiKey,
        'Cartesia-Version': '2026-08-14',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model_id: 'sonic-3.6',
        transcript: 'Hello, this is Priya from Right Agent Group.',
        voice: { mode: 'id', id: voiceId },
        output_format: { container: 'wav', encoding: 'pcm_s16le', sample_rate: 24000 },
        language: 'en',
      }),
    });

    console.log('Cartesia HTTP Status:', res.status);
    if (!res.ok) {
      const err = await res.text();
      console.error('Cartesia Failed:', err);
    } else {
      const buffer = await res.arrayBuffer();
      console.log('Cartesia SUCCESS! Received WAV bytes:', buffer.byteLength);
    }
  } catch (e) {
    console.error('Network Error:', e.message);
  }
}

testCartesia();
