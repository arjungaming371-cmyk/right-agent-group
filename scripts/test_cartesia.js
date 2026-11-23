const key = "sk_car_w6SJB6uPLrEoPo6vb4S6ot";
const voiceId = "cf061d8b-a752-4865-81a2-57570a6e0565";

async function test() {
  console.log("Testing Cartesia API with standard key...");
  const res = await fetch("https://api.cartesia.ai/tts/bytes", {
    method: "POST",
    headers: {
      "X-API-Key": key,
      "Cartesia-Version": "2026-08-14",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model_id: "sonic-3.6",
      transcript: "Hello Ajay Kumar garu, this is Priya from Right Agent Group.",
      voice: { id: voiceId },
      language: "te-IN",
      output_format: { container: "wav", encoding: "pcm_s16le", sample_rate: 24000 }
    })
  });

  console.log("Status:", res.status, res.statusText);
  if (res.ok) {
    const buf = Buffer.from(await res.arrayBuffer());
    console.log("SUCCESS! Received audio bytes:", buf.length);
  } else {
    const text = await res.text();
    console.error("Cartesia error response:", text);
  }
}

test().catch(console.error);
