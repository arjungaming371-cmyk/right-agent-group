# Right Agent Group — self-hosted TTS service (IndicF5).
#
# AI4Bharat's IndicF5 (F5-TTS trained on 11 Indian languages, incl. Telugu,
# Hindi, and Indian-accented English): near-human prosody, and — because it
# clones a reference voice — Priya keeps ONE consistent voice across every
# language instead of switching speakers per language.
#
# The reference voice lives in ref/priya_ref.wav + ref/priya_ref.txt (a ~10s
# Telugu sample; the transcript file must match the audio EXACTLY — F5 uses
# the pair to learn the speaker, so a mismatch degrades every synthesis).
#
# Setup:
#   pip install git+https://github.com/ai4bharat/IndicF5.git soundfile
#   cd server/tts-service
#   uvicorn app:app --host 127.0.0.1 --port 3004
#   (first start downloads the model from HF, ~1.5GB)
#
# Env:
#   TTS_API_KEY        shared secret (falls back to WHATSAPP_SERVICE_KEY)
#   TTS_DEVICE         optional: "cuda" or "cpu" (default: auto-detect)
#
# GPU note: needs ~3GB VRAM. On Kaggle T4 x2 it gets GPU 1 to itself
# (CUDA_VISIBLE_DEVICES set by the launcher). Expect ~2-5s per short
# utterance on a T4 — slower than a cloud API, but natural Telugu.

import io
import os
import time

import numpy as np
import soundfile as sf
from fastapi import FastAPI, HTTPException, Request
from starlette.concurrency import run_in_threadpool


def _load_project_env() -> None:
    """Load ../../.env so manual startup works without exporting vars.
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
        pass


_load_project_env()

API_KEY = os.environ.get("TTS_API_KEY") or os.environ.get("WHATSAPP_SERVICE_KEY", "")

REF_DIR = os.path.join(os.path.dirname(__file__), "ref")
REF_AUDIO = os.path.join(REF_DIR, "priya_ref.wav")
with open(os.path.join(REF_DIR, "priya_ref.txt"), encoding="utf-8") as f:
    REF_TEXT = f.read().strip()

import torch  # noqa: E402

DEVICE = os.environ.get("TTS_DEVICE", "").strip().lower() or ("cuda" if torch.cuda.is_available() else "cpu")

print(f"Loading IndicF5 on {DEVICE} ...")
t0 = time.time()
from transformers import AutoModel  # noqa: E402

model = AutoModel.from_pretrained("ai4bharat/IndicF5", trust_remote_code=True)
# IndicF5 is custom remote code — .to() should move it like any nn.Module, but
# if the wrapper manages devices internally this must not kill the service.
# The warmup timing below exposes a silent CPU fallback immediately (30s+ vs ~3s).
try:
    model = model.to(DEVICE)
except Exception as e:  # noqa: BLE001
    print(f"WARNING: model.to({DEVICE}) failed ({e}) — model may manage its own device")
print(f"Model loaded in {time.time() - t0:.1f}s")


def _synthesize_sync(text: str) -> bytes:
    # IndicF5 inference is synchronous CPU/GPU work — must run inside the
    # threadpool (same reasoning as the STT service: blocking the event loop
    # stalls every concurrent caller's request).
    audio = model(text, ref_audio_path=REF_AUDIO, ref_text=REF_TEXT)
    audio = np.asarray(audio)
    if audio.dtype == np.int16:
        audio = audio.astype(np.float32) / 32768.0
    audio = np.clip(audio.astype(np.float32).squeeze(), -1.0, 1.0)
    buf = io.BytesIO()
    sf.write(buf, audio, samplerate=24000, format="WAV", subtype="PCM_16")
    return buf.getvalue()


# Warm up at import time: the first F5 generation pays one-off setup costs
# (CUDA kernels, vocoder init). Doing it here means the poll loop in the
# launcher only reports "up" once real synthesis actually works — and the
# first caller never eats the cold-start.
print("Warmup synthesis ...")
t0 = time.time()
_warmup = _synthesize_sync("నమస్కారం!")
print(f"Warmup done in {time.time() - t0:.1f}s ({len(_warmup)} bytes)")

app = FastAPI(title="RAG TTS (IndicF5)", docs_url=None, redoc_url=None)


def check_key(request: Request) -> None:
    if not API_KEY:
        raise HTTPException(500, "TTS_API_KEY not configured on server")
    if request.headers.get("x-api-key") != API_KEY:
        raise HTTPException(401, "unauthorized")


@app.get("/health")
async def health(request: Request):
    check_key(request)
    return {"ok": True, "model": "ai4bharat/IndicF5", "device": DEVICE, "voice": "priya (cloned, all languages)"}


@app.post("/synthesize")
async def synthesize(request: Request):
    check_key(request)
    body = await request.json()
    text = str(body.get("text") or "").strip()
    if not text:
        raise HTTPException(400, "text required")
    # Phone replies are two short sentences by script; anything huge is a bug
    # upstream, and F5 generation time scales with output length.
    text = text[:800]

    t0 = time.time()
    wav = await run_in_threadpool(_synthesize_sync, text)
    print(f"synth {time.time() - t0:.2f}s for {len(text)} chars: {text[:60]!r}")
    from starlette.responses import Response

    return Response(content=wav, media_type="audio/wav")
