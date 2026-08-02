# Right Agent Group — self-hosted TTS service (Microsoft Edge TTS).
#
# Free, no GPU/API key needed. Voices:
#   Telugu  → te-IN-ShrutiNeural (native voice)
#   Hindi   → hi-IN-SwaraNeural  (native voice)
#   English → en-IN-NeerjaExpressiveNeural
#
# ONE VOICE PER REPLY, ONE SYNTHESIS CALL. That is the whole design, and it is
# a deliberate reversal of what this file used to do.
#
# Priya's call replies arrive in native Telugu/Devanagari script with English
# loanwords in Roman letters (see lib/llm.ts's CALL_LANGUAGE_STYLES). This
# service used to split them on script — English runs to the English voice,
# native runs to the native voice — and stitch the clips back together, on the
# grounds that the native voices mispronounce embedded English words.
#
# They do, somewhat. But the cure was far worse. Each run was a SEPARATE Edge
# TTS request, and Edge TTS generates every request as its own isolated
# utterance with its own intonation contour: "Right Agent Group" ends on a
# falling pitch, then Telugu restarts at a fresh one. Stitch a dozen of those
# together, alternating between two literally different voices (Shruti and
# Neerja), and the caller hears exactly what it is — a spliced recording.
# Verdict from listening to a real 34-second sample: "like combining two or
# three voices". A single greeting cost 16 network round-trips to produce it.
#
# So: the whole reply, in native script, English loanwords and all, goes to the
# native voice in ONE request. Continuous prosody, one speaker, and the first
# word arrives after one round-trip instead of sixteen. English words come out
# in an Indian-language accent, which is how Telugu and Hindi speakers say
# "loan", "bank" and "WhatsApp" anyway.
#
# Returns MP3 audio — ffmpeg in the voicebot auto-detects the container and
# converts to 8kHz PCM for Exotel, so no fixed content-type assumption there.
#
# Setup:
#   pip install -r requirements.txt
#   cd server/tts-service
#   uvicorn app:app --host 127.0.0.1 --port 3004
#
# Production:  pm2 start "venv/bin/uvicorn app:app --host 127.0.0.1 --port 3004" --name tts
#
# Env:
#   TTS_API_KEY    shared secret (falls back to WHATSAPP_SERVICE_KEY)
#   EDGE_TTS_RATE  speaking rate, e.g. "-8%" (default "+0%")
#   EDGE_TTS_PITCH pitch shift, e.g. "+2Hz" (default "+0Hz")

import io
import os
import re
import time

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
    "telugu":  "te-IN-ShrutiNeural",
    "hindi":   "hi-IN-SwaraNeural",
    "english": "en-IN-NeerjaExpressiveNeural",
}

# Acronyms the voices read as ORDINARY WORDS rather than letter by letter.
# Diagnosed by synthesizing each one against the same letters written as a
# normal word: a duration difference of ~0ms means the voice cannot tell them
# apart, i.e. it is saying "pan", not "P A N".
#
#              plain   as a word   verdict
#   PAN        344ms     344ms     reads "pan"  (so: "pan card", on every call)
#   KYC        656ms     656ms     reads "kyc"
#   ID         426ms     426ms     reads "id"
#   EMI        536ms     396ms     already spelled out — left alone
#
# The separator is PER ACRONYM, because no single one is both effective and
# brisk. Measured speech duration (silence trimmed) on each native voice:
#
#              plain  hyphen  space         plain  hyphen  space
#   te  PAN     344     576    896      hi   366     546    676
#   te  KYC     656     656    856      hi   716     716    830
#   te  ID      426     446    506      hi   436     396    506
#
# PAN spells out with a hyphen on both voices, so it uses one: 576ms rather
# than 896ms for the same three letters. Spacing it was correct but laboured —
# 300ms/letter, slower than any agent says it.
#
# KYC and ID ignore hyphens completely (656 -> 656, 426 -> 446: unchanged, and
# hi ID actually gets SHORTER). Only a space moves them, so they take one.
#
# A curated list is acceptable here precisely because it is closed and short:
# it is the set of acronyms lib/llm.ts explicitly tells Priya she may say
# aloud. Anything missing just keeps today's pronunciation.
_SPELL_OUT = {"PAN": "-", "KYC": " ", "ID": " "}
_ACRONYM_RE = re.compile(r"\b(" + "|".join(sorted(_SPELL_OUT)) + r")\b")


def _spell_acronyms(text: str) -> str:
    """Force letter-by-letter reading of acronyms the voice mistakes for words."""
    return _ACRONYM_RE.sub(lambda m: _SPELL_OUT[m.group(1)].join(m.group(1)), text)


app = FastAPI(title="RAG TTS (edge-tts)", docs_url=None, redoc_url=None)


def check_key(request: Request) -> None:
    if not API_KEY:
        raise HTTPException(500, "TTS_API_KEY not configured on server")
    if request.headers.get("x-api-key") != API_KEY:
        raise HTTPException(401, "unauthorized")


# Default rate is Edge TTS's normal reading pace. Override per-deployment
# without a code change if needed — these voices have no expressive style
# option (checked: only "General" content category, no "cheerful" like some
# English voices get), so rate/pitch is the only real tuning lever available.
EDGE_TTS_RATE = os.environ.get("EDGE_TTS_RATE", "+0%")
EDGE_TTS_PITCH = os.environ.get("EDGE_TTS_PITCH", "+0Hz")


async def _synthesize_one(text: str, voice: str) -> bytes:
    import edge_tts
    communicate = edge_tts.Communicate(text, voice, rate=EDGE_TTS_RATE, pitch=EDGE_TTS_PITCH)
    buf = io.BytesIO()
    async for chunk in communicate.stream():
        if chunk["type"] == "audio":
            buf.write(chunk["data"])
    return buf.getvalue()


_TELUGU_RE = re.compile(r"[ఀ-౿]")
_DEVANAGARI_RE = re.compile(r"[ऀ-ॿ]")


def _voice_for(text: str, language: str) -> str:
    """Pick the voice, letting the TEXT overrule the declared language.

    A Hindi sentence must never come out of the Telugu voice, and vice versa.
    Trusting the `language` field alone could not guarantee that: it used to
    fall back to the TELUGU voice for any value it did not recognise, so a
    missing, misspelled or stale language on a Hindi call meant Devanagari
    read aloud by a Telugu speaker.

    The script is unambiguous evidence and cannot be stale — Devanagari is
    Hindi, Telugu script is Telugu — so it decides whenever it is present. The
    declared language is only consulted for text with no native script at all
    (English replies, or Roman Tenglish), and an unrecognised language then
    lands on English rather than Telugu, since Latin text is far likelier to
    be English than romanised Telugu.
    """
    telugu_chars = len(_TELUGU_RE.findall(text))
    devanagari_chars = len(_DEVANAGARI_RE.findall(text))
    if telugu_chars or devanagari_chars:
        # Mixed scripts in one reply shouldn't happen, but if it does, the
        # dominant script wins rather than whichever appeared first.
        return VOICE_MAP["telugu"] if telugu_chars >= devanagari_chars else VOICE_MAP["hindi"]
    return VOICE_MAP.get(language, VOICE_MAP["english"])


async def _synthesize_edge(text: str, language: str) -> tuple[bytes, str]:
    """One request, one voice, one continuous utterance.

    No splitting, no stitching, no pydub, no gap tuning — all of that is gone
    deliberately (see the module docstring). Everything that made the output
    sound spliced lived in the seams between clips, so the fix was to stop
    producing seams, not to make them smaller.

    A knock-on worth having: a greeting used to cost 16 network round-trips to
    Edge TTS before the caller heard a word. It now costs one.
    """
    return await _synthesize_one(_spell_acronyms(text), _voice_for(text, language)), "audio/mpeg"


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
    audio, media_type = await _synthesize_edge(text, language)

    # ascii-safe log: Windows consoles (cp1252) can't print Telugu/Devanagari,
    # and a logging crash must never turn a successful synthesis into a 500.
    print(f"synth {time.time() - t0:.2f}s  {language}  {len(text)}ch: "
          + text[:60].encode("ascii", "backslashreplace").decode("ascii"))
    return Response(content=audio, media_type=media_type)
