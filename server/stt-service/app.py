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

# Matches server/voicebot-server.js's SAMPLE_RATE — the voicebot bridge
# always sends 16-bit signed LE, 8kHz, mono telephony audio.
SAMPLE_RATE = 8000

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


def _pcm_to_wav(pcm: bytes) -> bytes:
    """Wrap raw headerless 16-bit/8kHz/mono PCM in a minimal WAV container.

    Passing io.BytesIO(raw_pcm) directly made faster_whisper hand the bytes
    to PyAV for container probing — but the voicebot bridge sends RAW
    HEADERLESS PCM (no file header for PyAV to detect), so PyAV had to GUESS
    the format and sometimes failed outright (av.error.InvalidDataError ->
    unhandled -> 500, observed live on a real call). Wrapping in a WAV
    header that correctly DECLARES 8kHz/16-bit/mono fixes that crash — PyAV
    identifies the format exactly instead of guessing, and decode_audio()'s
    normal resample-to-16kHz path still runs correctly.
    #
    # This did NOT, on its own, fix the SEPARATE garbled-repetition problem
    # (see _transcribe_sync below) — verified directly against the same
    # real call audio that repeated "నినినినిని..." dozens of times: still
    # garbled with a correct WAV header. That repetition is a genuine
    # Whisper hallucination failure mode on noisy real telephone-line audio,
    # fixed separately via the temperature retry ladder + no_repeat_ngram_size.
    """
    import struct
    n_channels, sampwidth, framerate = 1, 2, SAMPLE_RATE
    byte_rate = framerate * n_channels * sampwidth
    block_align = n_channels * sampwidth
    header = b"RIFF" + struct.pack("<I", 36 + len(pcm)) + b"WAVE"
    header += b"fmt " + struct.pack("<IHHIIHH", 16, 1, n_channels, framerate, byte_rate, block_align, sampwidth * 8)
    header += b"data" + struct.pack("<I", len(pcm))
    return header + pcm


try:
    from indic_transliteration import sanscript
    from indic_transliteration.sanscript import transliterate
    _TRANSLIT_AVAILABLE = True
except ImportError:
    _TRANSLIT_AVAILABLE = False

# Whisper transcribes Telugu/Hindi speech into native Telugu/Devanagari
# script — but Priya's whole script, the LLM's context, and every other
# part of this app are written for Roman-script Tenglish/Hinglish (matches
# how the customer actually types on WhatsApp too). Rather than trust
# Whisper's own noisy attempt at romanizing (forcing language="en" on
# non-English audio produces inconsistent, often wrong phonetic guesses),
# transcribe in the REAL language for best recognition accuracy, then
# transliterate the correct native-script output to Roman script
# ourselves — deterministic and reliable.
_SCRIPT_MAP = {"te": sanscript.TELUGU if _TRANSLIT_AVAILABLE else None, "hi": sanscript.DEVANAGARI if _TRANSLIT_AVAILABLE else None}


def _to_tenglish(text: str, lang: str | None) -> str:
    if not text or not _TRANSLIT_AVAILABLE or lang not in _SCRIPT_MAP:
        return text
    try:
        return transliterate(text, _SCRIPT_MAP[lang], sanscript.ITRANS).lower()
    except Exception:
        return text  # transliteration failure must never lose the transcript


def _transcribe_sync(audio: bytes, lang: str | None) -> str:
    wav_bytes = _pcm_to_wav(audio)

    # faster_whisper's transcribe() is lazy — it returns a generator, and the
    # actual CPU-bound decode work happens when you iterate it. Both steps
    # must run inside the same threadpool call below, or the blocking work
    # still lands back on the event loop the moment the generator is consumed.
    segments, _info = model.transcribe(
        io.BytesIO(wav_bytes),
        language=lang,
        beam_size=1,            # greedy: fastest, near-identical accuracy for short utterances
        vad_filter=VAD_FILTER,  # off by default — voicebot already endpoints; see note above
        condition_on_previous_text=False,
        # Real telephone-line audio (noise, compression) can send Whisper
        # into a repetition loop — observed live: "నినినినిని..." repeated
        # dozens of times, on real call audio that looked completely normal
        # (correct format, no clipping, reasonable volume). A single fixed
        # temperature=0.0 disables Whisper's own built-in escape hatch: it
        # only retries at higher temperatures when a segment's compression
        # ratio / log-prob looks like a failure, and that retry ladder only
        # runs if temperature is a tuple. no_repeat_ngram_size is a second,
        # direct guard against the same loop. Verified against the exact
        # audio that repeated forever: this combination breaks the loop, in
        # ~2s on CPU — beam_size=1 stays unchanged since it wasn't the
        # cause and raising it only adds latency with no extra benefit here.
        temperature=(0.0, 0.2, 0.4, 0.6, 0.8, 1.0),
        no_repeat_ngram_size=3,
        compression_ratio_threshold=2.4,
    )
    text = " ".join(s.text.strip() for s in segments).strip()
    return _to_tenglish(text, lang)


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
    # ascii-safe log: Windows consoles (cp1252) can't print Telugu/Devanagari,
    # and a logging crash must never turn a successful transcription into a
    # 500 — this exact bug silenced Priya on every real Telugu/Hindi call
    # (Whisper transcribed correctly, then this print() crashed the request).
    safe_text = text[:80].encode("ascii", "backslashreplace").decode("ascii")
    print(f"[{lang or 'auto'}] {time.time() - t0:.2f}s: {safe_text!r}")
    return {"text": text}
