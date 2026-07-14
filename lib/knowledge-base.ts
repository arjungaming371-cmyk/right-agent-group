// Knowledge base — grounds Priya's answers to arbitrary caller/chat
// questions ("what documents do I need", "what's the minimum loan
// amount") instead of only what's in the static script or a lead's own
// Lead Brain facts. Same Postgres full-text search pattern already proven
// on leads/loan_applications (lib/lead-brain.ts, app/api/leads/route.ts) —
// no vector DB, no embeddings, just websearch_to_tsquery + ts_rank, which
// is plenty for a few hundred FAQ/policy entries at call-turn latency.

import { query } from "./db"

const MAX_SNIPPET = 300 // richer than Lead Brain's 90-char clip — these are factual answers, not brief mentions
const MAX_RESULTS = 3

function clip(s: string, n: number): string {
  const t = (s || "").replace(/\s+/g, " ").trim()
  return t.length > n ? t.slice(0, n) + "…" : t
}

/**
 * Searches active KB entries against what the customer just said. Called
 * on EVERY turn (not just the first couple, unlike Lead Brain's brief) —
 * questions can land at any point in a conversation, and a single indexed
 * GIN query is cheap enough not to need first-turns-only gating.
 * Returns "" (never throws) if nothing relevant matched or the query is
 * too short to search meaningfully — no point injecting empty noise.
 */
export async function searchKnowledgeBase(userQuery: string): Promise<string> {
  const q = (userQuery || "").trim()
  if (q.length < 3) return ""
  try {
    const res = await query(
      `SELECT title, content
       FROM knowledge_base
       WHERE is_active = true AND search_vector @@ websearch_to_tsquery('english', $1)
       ORDER BY ts_rank(search_vector, websearch_to_tsquery('english', $1)) DESC
       LIMIT $2`,
      [q, MAX_RESULTS]
    )
    if (res.rows.length === 0) return ""
    const lines = res.rows.map((r: any) => `${r.title}: ${clip(r.content, MAX_SNIPPET)}`)
    return `KNOWLEDGE BASE — relevant facts for what the customer just said (use naturally to answer, do not recite verbatim, never mention "knowledge base"):\n${lines.join("\n")}`
  } catch (e: any) {
    console.error("searchKnowledgeBase error:", e.message)
    return ""
  }
}
