# Right Agent Group — self-hosted TTS service (Edge TTS / Microsoft neural voices).
#
# Uses Microsoft Edge TTS — free, no API key, no GPU needed, runs on any CPU.
# Voices used:
#   Telugu (Tenglish, Roman script)  → en-IN-NeerjaNeural
#   Hindi (Hinglish, Roman script)   → en-IN-NeerjaNeural
#   English                          → en-IN-NeerjaNeural
# One voice for all three: Priya now speaks Hinglish/Tenglish written in
# English letters, which the Indian-English voice pronounces naturally —
# and the caller hears the same consistent voice in every language.
#
# Returns MP3 audio — ffmpeg in the voicebot converts to 8kHz PCM for Exotel.
#
# Setup:
#   pip install edge-tts fastapi uvicorn
#   cd server/tts-service
#   uvicorn app:app --host 127.0.0.1 --port 3004
#
# Env:
#   TTS_API_KEY   shared secret (falls back to WHATSAPP_SERVICE_KEY)

import asyncio
import io
import os
import time

import edge_tts
from fastapi import FastAPI, HTTPException, Request
from starlette.responses import Response


def _load_project_env() -> None:
    env_path = os.path.join(os.path.dirname(__file__), "..", "..", ".env")
    try:
        with open(env_path, encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                key, _, val = line.partition("=")
                key = key.strip()
                val = val.split("#", 1)[0].strip().strip('"').strip("'")
                if key and val and key not in os.environ:
                    os.environ[key] = val
    except OSError:
        pass


_load_project_env()

API_KEY = os.environ.get("TTS_API_KEY") or os.environ.get("WHATSAPP_SERVICE_KEY", "")

VOICE_MAP = {
    "telugu":  "en-IN-NeerjaNeural",
    "hindi":   "en-IN-NeerjaNeural",
    "english": "en-IN-NeerjaNeural",
}

app = FastAPI(title="RAG TTS (Edge TTS)", docs_url=None, redoc_url=None)


def check_key(request: Request) -> None:
    if not API_KEY:
        raise HTTPException(500, "TTS_API_KEY not configured on server")
    if request.headers.get("x-api-key") != API_KEY:
        raise HTTPException(401, "unauthorized")


async def _synthesize(text: str, language: str) -> bytes:
    voice = VOICE_MAP.get(language, VOICE_MAP["telugu"])
    communicate = edge_tts.Communicate(text, voice)
    buf = io.BytesIO()
    async for chunk in communicate.stream():
        if chunk["type"] == "audio":
            buf.write(chunk["data"])
    return buf.getvalue()


@app.get("/health")
async def health(request: Request):
    check_key(request)
    return {"ok": True, "engine": "edge-tts", "voices": VOICE_MAP}


@app.post("/synthesize")
async def synthesize(request: Request):
    check_key(request)
    body = await request.json()
    text = str(body.get("text") or "").strip()
    language = str(body.get("language") or "telugu").strip().lower()
    if not text:
        raise HTTPException(400, "text required")
    text = text[:800]

    t0 = time.time()
    mp3 = await _synthesize(text, language)
    # ascii-safe log: Windows consoles (cp1252) can't print Telugu/Devanagari,
    # and a logging crash must never turn a successful synthesis into a 500.
    print(f"synth {time.time() - t0:.2f}s  {language}  {len(text)}ch: "
          + text[:60].encode("ascii", "backslashreplace").decode("ascii"))
    return Response(content=mp3, media_type="audio/mpeg")
