# Right Agent Group — self-hosted STT service (replaces Deepgram).
#
# Whisper large-v3 via faster-whisper: best open-source accuracy for
# Telugu, Hindi, and English. Runs on your GPU (float16) with automatic
# CPU fallback (int8).
#
# Setup:
#   cd server/stt-service
#   python3 -m venv venv && source venv/bin/activate
#   pip install -r requirements.txt
#   uvicorn app:app --host 127.0.0.1 --port 3003
#   (first start downloads the model, ~3GB for large-v3)
#
# Production:  pm2 start "venv/bin/uvicorn app:app --host 127.0.0.1 --port 3003" --name stt
#
# Env:
#   STT_MODEL          default: large-v3 on GPU, small on CPU
#   STT_API_KEY        shared secret (same value as WHATSAPP_SERVICE_KEY)
#   STT_FORCE_DEVICE   optional: "cuda" or "cpu" to skip auto-detection

import os
import io
import time

from fastapi import FastAPI, Request, Query, HTTPException
from faster_whisper import WhisperModel
from starlette.concurrency import run_in_threadpool


def _load_project_env() -> None:
    """Load ../../.env so manual/pm2 startup works without exporting vars.
    Real environment variables always win over .env values."""
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
        pass  # no .env found — rely on real environment variables


_load_project_env()

# STT_API_KEY falls back to the shared internal service key
API_KEY = os.environ.get("STT_API_KEY") or os.environ.get("WHATSAPP_SERVICE_KEY", "")

def detect_device() -> str:
    forced = os.environ.get("STT_FORCE_DEVICE", "").strip().lower()
    if forced in ("cuda", "cpu"):
        return forced
    try:
        import ctranslate2
        return "cuda" if ctranslate2.get_cuda_device_count() > 0 else "cpu"
    except Exception:
        return "cpu"

DEVICE = detect_device()
COMPUTE = "float16" if DEVICE == "cuda" else "int8"
MODEL_NAME = os.environ.get("STT_MODEL") or ("large-v3" if DEVICE == "cuda" else "small")

print(f"Loading Whisper {MODEL_NAME} on {DEVICE} ({COMPUTE}) ...")
t0 = time.time()
model = WhisperModel(MODEL_NAME, device=DEVICE, compute_type=COMPUTE)
print(f"Model ready in {time.time() - t0:.1f}s")

LANG_MAP = {"english": "en", "hindi": "hi", "telugu": "te", "en": "en", "hi": "hi", "te": "te"}

app = FastAPI(title="RAG STT", docs_url=None, redoc_url=None)


def check_key(request: Request) -> None:
    if not API_KEY:
        raise HTTPException(500, "STT_API_KEY not configured on server")
    if request.headers.get("x-api-key") != API_KEY:
        raise HTTPException(401, "unauthorized")


@app.get("/health")
async def health(request: Request):
    check_key(request)
    return {"ok": True, "model": MODEL_NAME, "device": DEVICE, "compute": COMPUTE}


# Whisper's built-in Silero VAD is OFF by default here. The voicebot already
# does its own energy-based endpointing before it ever sends audio, so this VAD
# is redundant — and on real 8kHz telephony audio (quiet, noisy) it frequently
# discards the entire utterance as "non-speech", returning an empty transcript
# even though the words are clearly there. That was the live-call failure: clean
# synthetic 8kHz audio transcribed fine, real phone audio came back "". Set
# STT_VAD_FILTER=1 to re-enable it only if you ever feed un-endpointed audio.
VAD_FILTER = os.environ.get("STT_VAD_FILTER", "0").strip().lower() in ("1", "true", "yes")


def _transcribe_sync(audio: bytes, lang: str | None) -> str:
    # faster_whisper's transcribe() is lazy — it returns a generator, and the
    # actual CPU-bound decode work happens when you iterate it. Both steps
    # must run inside the same threadpool call below, or the blocking work
    # still lands back on the event loop the moment the generator is consumed.
    segments, _info = model.transcribe(
        io.BytesIO(audio),
        language=lang,
        beam_size=1,            # greedy: fastest, near-identical accuracy for short utterances
        vad_filter=VAD_FILTER,  # off by default — voicebot already endpoints; see note above
        condition_on_previous_text=False,
        temperature=0.0,
    )
    return " ".join(s.text.strip() for s in segments).strip()


@app.post("/transcribe")
async def transcribe(request: Request, language: str = Query("english")):
    check_key(request)
    audio = await request.body()
    if not audio or len(audio) < 1000:
        return {"text": ""}
    if len(audio) > 10 * 1024 * 1024:
        raise HTTPException(413, "audio too large")

    lang = LANG_MAP.get(language.lower(), None)  # None = auto-detect
    t0 = time.time()
    # Off the event loop and into Starlette's threadpool — without this, one
    # caller's transcription blocks every other simultaneous caller's audio
    # from even starting, since this was a synchronous call inside an async
    # handler with nothing else running the loop.
    text = await run_in_threadpool(_transcribe_sync, audio, lang)
    print(f"[{lang or 'auto'}] {time.time() - t0:.2f}s: {text[:80]!r}")
    return {"text": text}
