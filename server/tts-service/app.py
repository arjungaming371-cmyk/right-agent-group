# Right Agent Group — self-hosted TTS service (Microsoft Edge TTS).
#
# Free, no GPU/API key needed. Voices:
#   Telugu  → te-IN-ShrutiNeural (native voice)
#   Hindi   → hi-IN-SwaraNeural  (native voice)
#   English → en-IN-NeerjaExpressiveNeural
#
# Priya's replies for calls arrive in native Telugu/Devanagari script mixed
# with English loanwords in Roman letters (matches real code-switched
# speech — see lib/llm.ts's CALL_LANGUAGE_STYLES). The native-script voices
# mispronounce embedded English words rather than switching accent cleanly
# (confirmed by listening to real output), so English loanword runs are
# synthesized separately with the English voice and stitched into the native
# audio — see _segments_for_synthesis / _synthesize_edge below.
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

import asyncio
import io
import os
import re
import time

from fastapi import FastAPI, HTTPException, Request
from starlette.concurrency import run_in_threadpool
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

# Languages whose voice speaks native script (Telugu/Devanagari) rather than
# English — these are the ones that need English-word segments split out
# and spoken separately (see _segments_for_synthesis below).
_NATIVE_SCRIPT_LANGUAGES = {"telugu", "hindi"}

_WORD_RE = re.compile(r"[A-Za-z]+|[^A-Za-z]+")

# Acronyms the English voice reads as ORDINARY WORDS rather than letter by
# letter. Measured against the same letters written as a normal word — a
# duration difference of 0ms means the voice cannot tell them apart:
#
#   PAN 496ms vs "Pan" 496ms   -> "pan"   (so: "pan card")
#   KYC 706ms vs "Kyc" 706ms   -> "kyc"
#   ID  496ms vs "Id"  496ms   -> "id"
#   EMI 606ms vs "Emi" 546ms   -> 60ms apart, already spelled out; left alone
#
# All three are said constantly on loan calls, so this is not cosmetic.
# Hyphens rather than spaces or periods: measured 626ms for "P-A-N" against
# 824ms for "P A N" (letter-by-letter either way, but the hyphen form is
# brisker, closer to how an agent actually says it) and, unlike "P.A.N.", it
# adds no sentence-final punctuation that would shift the intonation
# mid-sentence. _ENGLISH_CONNECTOR_RE below keeps the hyphens inside one
# English segment, so this stays a single synthesis call.
#
# This is a curated list, which _segments_for_synthesis deliberately avoids
# for language detection — the difference is that this list is closed and
# short: it is the set of acronyms lib/llm.ts explicitly tells Priya she may
# say aloud. A word missing from it just keeps today's pronunciation.
_SPELL_OUT = {"PAN", "KYC", "ID"}
_ACRONYM_RE = re.compile(r"\b(" + "|".join(sorted(_SPELL_OUT)) + r")\b")


def _spell_acronyms(text: str) -> str:
    """Force letter-by-letter reading of acronyms the voice mistakes for words."""
    return _ACRONYM_RE.sub(lambda m: "-".join(m.group(1)), text)
# Whitespace/hyphen/apostrophe between two English words — kept attached to
# an English segment instead of forced to the native voice, so "best
# interest rate" or "tie-up" stay ONE synthesis call instead of three.
_ENGLISH_CONNECTOR_RE = re.compile(r"^[\s\-']+$")


def _segments_for_synthesis(text: str, language: str) -> list[tuple[str, str]]:
    """Split text into (segment_text, voice) runs so English words are
    spoken by the English voice and everything else by the native voice.

    Calls send native-script text with intentional English words/loanwords
    mixed in (see lib/llm.ts's CALL_LANGUAGE_STYLES) — any run of Latin
    letters is therefore treated as an intentional English word, not
    guessed at via a fixed word list. A curated list is always incomplete:
    any word not on it got force-transliterated into a mangled phonetic
    guess (e.g. "tie-up", "best" -> "తిए-उप్", "बेस्त्" — observed live).
    Treating every Latin run as English, unconditionally, fixes that for
    any word, not just ones someone remembered to list.

    Adjacent runs assigned the same voice are merged so consecutive English
    words become ONE synthesis call, not one per word — a real reply with
    several loanwords was fragmenting into ~19 separate clips, each with
    Edge TTS's own silence padding, making a 2-sentence reply take 36
    seconds and sound choppy at every word boundary."""
    native_voice = VOICE_MAP.get(language, VOICE_MAP["telugu"])
    english_voice = VOICE_MAP["english"]
    if language not in _NATIVE_SCRIPT_LANGUAGES:
        return [(text, native_voice)]

    parts = _WORD_RE.findall(text)
    segments: list[tuple[str, str]] = []
    for part in parts:
        if part.isalpha() and part.isascii():
            voice, content = english_voice, part
        elif segments and segments[-1][1] == english_voice and _ENGLISH_CONNECTOR_RE.match(part):
            segments[-1] = (segments[-1][0] + part, english_voice)
            continue
        else:
            voice, content = native_voice, part
        if segments and segments[-1][1] == voice:
            segments[-1] = (segments[-1][0] + content, voice)
        else:
            segments.append((content, voice))
    return segments


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


def _trim_silence(seg, silence_thresh_db: int = -40):
    """Strip Edge TTS's own lead-in/trail-out silence from a clip. Measured
    live: a single word like "sir" synthesized alone came back as a 1.78s
    clip — almost entirely silence padding, not speech. Concatenating many
    un-trimmed segments (a real reply with several loanwords produced 17
    segments) stacked that padding into ~25+ extra seconds on top of the
    actual speech, dragging a 2-sentence reply out to 36 seconds of audio."""
    from pydub import silence
    start_trim = silence.detect_leading_silence(seg, silence_threshold=silence_thresh_db)
    end_trim = silence.detect_leading_silence(seg.reverse(), silence_threshold=silence_thresh_db)
    return seg[start_trim: len(seg) - end_trim]


# Gap inserted between two stitched clips.
#
# A flat 120ms everywhere was the wrong model of speech: segments split on
# SCRIPT, not on meaning, so "mee best interest rate" becomes four clips and
# got a pause at every single boundary — a stutter at each English word, in
# the middle of a phrase where a real speaker doesn't pause at all.
#
# Where the pause belongs is where the punctuation is. So: a short gap
# mid-phrase, just enough that adjacent words don't run together, and the
# full pause only where the text actually ends a clause or a sentence.
_PHRASE_GAP_MS = 40
_CLAUSE_GAP_MS = 120
_CLAUSE_ENDING = tuple(",;:।॥.!?…")


def _gap_after(text: str) -> int:
    """How long to pause after this segment, judged by how it ends."""
    stripped = text.rstrip()
    return _CLAUSE_GAP_MS if stripped.endswith(_CLAUSE_ENDING) else _PHRASE_GAP_MS


def _stitch_clips(clips: list[bytes], texts: list[str]) -> bytes:
    """Decode, trim silence, and concatenate MP3 clips, pausing between them
    according to the punctuation at each boundary (see _gap_after) — exporting
    WAV instead of re-encoding back to MP3 (the voicebot's ffmpeg step
    auto-detects the container either way, see module docstring), so
    re-encoding to MP3 here was pure wasted latency. Runs in a threadpool (see
    caller) since pydub shells out to ffmpeg — blocking, CPU-bound work that
    must not sit on the event loop."""
    from pydub import AudioSegment
    trimmed = [_trim_silence(AudioSegment.from_file(io.BytesIO(clip), format="mp3")) for clip in clips]
    combined = trimmed[0]
    for i, seg in enumerate(trimmed[1:]):
        combined += AudioSegment.silent(duration=_gap_after(texts[i])) + seg
    out = io.BytesIO()
    combined.export(out, format="wav")
    return out.getvalue()


async def _synthesize_edge(text: str, language: str) -> tuple[bytes, str]:
    # Before segmentation: the hyphens this inserts are kept inside the
    # English segment by _ENGLISH_CONNECTOR_RE, so an acronym still costs
    # exactly one synthesis call.
    text = _spell_acronyms(text)
    segments = _segments_for_synthesis(text, language)
    # A punctuation-only segment (e.g. a lone "?" left stranded after an
    # English-word segment split off the preceding text) has nothing for
    # Edge TTS to speak and makes it raise NoAudioReceived — require at
    # least one actual letter/digit, not just non-whitespace.
    speakable = [(seg_text, voice) for seg_text, voice in segments if any(c.isalnum() for c in seg_text)]
    # Each segment is a separate network round-trip to Edge TTS — awaiting
    # them one at a time serialized the latency (a multi-segment reply took
    # 47s in testing, unusable for a live call). asyncio.gather runs them
    # concurrently and preserves input order in its results, so the clips
    # still concatenate in the right sequence.
    clips = list(await asyncio.gather(*(_synthesize_one(t, v) for t, v in speakable)))
    if len(clips) <= 1:
        return (clips[0] if clips else b""), "audio/mpeg"

    combined = await run_in_threadpool(_stitch_clips, clips, [t for t, _ in speakable])
    return combined, "audio/wav"


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
