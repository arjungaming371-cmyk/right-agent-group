// Knowledge base — grounds Priya's answers to arbitrary caller/chat
// questions ("what documents do I need", "what's the minimum loan
// amount") instead of only what's in the static script or a lead's own
// Lead Brain facts. Postgres full-text search (websearch_to_tsquery +
// ts_rank) — no vector DB, no embeddings, plenty for a few hundred
// FAQ/policy entries at call-turn latency.
//
// AGENTIC RAG: this is a small bounded agent loop, not a single fixed
// query. On every turn:
//   1. GATE (free)      — skip entirely for turns that plainly aren't
//                          fact questions (greetings, "ok", digits being
//                          read out, etc.) so we're not hitting Postgres
//                          on every single turn like before.
//   2. RETRIEVE (cheap) — search with the raw caller text.
//   3. GRADE (free)     — is the top hit actually relevant (ts_rank above
//                          a floor)? If yes, stop here — this is the
//                          common case and costs zero extra LLM calls.
//   4. REFORMULATE (1 LLM call, only when step 3 failed) — raw speech is
//                          often indirect or STT-garbled and never matches
//                          FAQ wording. Ask the model to decide if this is
//                          really a fact question and, if so, rewrite it
//                          into a clean keyword query.
//   5. RETRIEVE again, once — bounded to a single extra hop so a bad
//                          match can never cost more than one extra model
//                          call + one extra indexed query.
// Never throws; always degrades to "" (no KB context injected).

import { query } from "./db"
import { rewriteKnowledgeQuery, canAffordExtraCompletion } from "./ollama"

const MAX_SNIPPET = 300 // richer than Lead Brain's 90-char clip — these are factual answers, not brief mentions
const MAX_RESULTS = 3
const MIN_RANK = 0.02 // ts_rank floor below which a "match" is treated as noise, not a real hit

function clip(s: string, n: number): string {
  const t = (s || "").replace(/\s+/g, " ").trim()
  return t.length > n ? t.slice(0, n) + "…" : t
}

// Cheap pre-filter before touching Postgres at all. Errs toward searching
// (false positives just cost one indexed query) — it only needs to catch
// the obvious non-questions: greetings, acknowledgements, digit strings
// (numbers/addresses being read out), and very short turns.
const SKIP_PATTERNS =
  /^(hi|hello|hey|yes|yeah|no|nope|ok|okay|sure|thanks|thank you|bye|goodbye|namaste|haan|theek hai|sare|avunu)\.?$/i

function looksLikeQuestion(q: string): boolean {
  const t = q.trim()
  if (t.length < 4) return false
  if (SKIP_PATTERNS.test(t)) return false
  if (/^[\d\s\-+()]+$/.test(t)) return false // pure digits — a phone number, not a question
  return true
}

type KbHit = { title: string; content: string; rank: number }

async function ftsSearch(q: string): Promise<KbHit[]> {
  const res = await query(
    `SELECT title, content, ts_rank(search_vector, websearch_to_tsquery('english', $1)) AS rank
     FROM knowledge_base
     WHERE is_active = true AND search_vector @@ websearch_to_tsquery('english', $1)
     ORDER BY rank DESC
     LIMIT $2`,
    [q, MAX_RESULTS]
  )
  return res.rows.map((r: any) => ({ title: r.title, content: r.content, rank: Number(r.rank) || 0 }))
}

function formatHits(hits: KbHit[]): string {
  const lines = hits.map((h) => `${h.title}: ${clip(h.content, MAX_SNIPPET)}`)
  return `KNOWLEDGE BASE — relevant facts for what the customer just said (use naturally to answer, do not recite verbatim, never mention "knowledge base"):\n${lines.join("\n")}`
}

/**
 * Agentic KB retrieval for one conversation turn. See module header for the
 * gate → retrieve → grade → reformulate → retrieve loop. Returns "" (never
 * throws) if nothing relevant was found, the turn wasn't a question, or the
 * DB/model calls failed — no point injecting empty or noisy context.
 */
export async function searchKnowledgeBase(userQuery: string): Promise<string> {
  const q = (userQuery || "").trim()
  if (!looksLikeQuestion(q)) return ""

  try {
    const firstPass = await ftsSearch(q)
    if (firstPass.length > 0 && firstPass[0].rank >= MIN_RANK) {
      return formatHits(firstPass)
    }

    // First pass was empty or weak — one bounded reformulation hop, but only
    // where it's actually cheap (Groq/GPU). On CPU-only Ollama this would
    // compete with the SAME slot the live call's main reply needs next —
    // not worth the lag risk for an FAQ lookup.
    if (!canAffordExtraCompletion()) return ""
    const rewritten = await rewriteKnowledgeQuery(q)
    if (!rewritten) return ""

    const secondPass = await ftsSearch(rewritten)
    if (secondPass.length > 0 && secondPass[0].rank >= MIN_RANK) {
      console.log(`KB agentic retry hit: "${q}" -> "${rewritten}"`)
      return formatHits(secondPass)
    }

    return ""
  } catch (e: any) {
    console.error("searchKnowledgeBase error:", e.message)
    return ""
  }
}
