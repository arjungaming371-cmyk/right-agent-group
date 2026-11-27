import fs from "fs"
import path from "path"
import { IndexedConversation, RAGQuery, RAGResultItem } from "./types"
import { NaiveRAG } from "./naive-rag"

/**
 * 2. HYBRID RAG + RERANKER
 * Combines:
 * - Sparse Lexical BM25 (token frequencies, IDF, document length normalization, banking term boosts)
 * - Dense Vector Cosine Similarity
 * - Score Fusion (Convex Combination / Reciprocal Rank Fusion)
 * - Second-Stage Reranker (Language, Intent, Objection, Anti-Pattern Penalty)
 */

interface BM25Doc {
  id: string
  docLength: number
  termCounts: Map<string, number>
}

const BANKING_KEYWORD_BOOSTS: Record<string, number> = {
  interest: 1.5,
  roi: 1.8,
  emi: 1.8,
  cibil: 2.0,
  foir: 2.0,
  kfs: 2.5,
  dnd: 2.5,
  processing: 1.5,
  fee: 1.4,
  loan: 1.2,
  bank: 1.2,
  who: 1.6,
  identity: 1.8,
  robot: 2.0,
  ai: 2.0,
  hello: 1.5,
}

const BANNED_CONTRASTIVE_PATTERNS = [
  /absolutely\s+(sir|madam)/i,
  /certainly\s+(sir|madam)/i,
  /thank\s+you\s+for\s+sharing/i,
  /i\s+completely\s+understand\s+your\s+concern/i,
  /we\s+provide\s+the\s+best\s+loans/i,
  /100%\s+guaranteed/i,
]

export class HybridRAG {
  private corpus: IndexedConversation[] = []
  private naiveEngine: NaiveRAG
  private bm25Docs: BM25Doc[] = []
  private docFrequencies: Map<string, number> = new Map()
  private avgDocLength = 0
  private k1 = 1.2
  private b = 0.75
  private isLoaded = false

  constructor() {
    this.naiveEngine = new NaiveRAG()
    this.init()
  }

  private init() {
    if (this.isLoaded) return
    try {
      const dataPath = path.join(process.cwd(), "data", "clean_indexed", "priya_clean_training_8800.json")
      if (!fs.existsSync(dataPath)) return

      const raw = fs.readFileSync(dataPath, "utf-8")
      this.corpus = JSON.parse(raw)

      let totalTokens = 0
      for (const item of this.corpus) {
        const text = `${item.initial_intent} ${item.product} ${item.category} ${item.objections.join(" ")} ${item.first_user_turn} ${item.first_assistant_turn}`
        const tokens = this.tokenize(text)
        totalTokens += tokens.length

        const termCounts = new Map<string, number>()
        const seenInDoc = new Set<string>()

        for (const t of tokens) {
          termCounts.set(t, (termCounts.get(t) || 0) + 1)
          if (!seenInDoc.has(t)) {
            seenInDoc.add(t)
            this.docFrequencies.set(t, (this.docFrequencies.get(t) || 0) + 1)
          }
        }

        this.bm25Docs.push({
          id: item.id,
          docLength: tokens.length,
          termCounts,
        })
      }

      this.avgDocLength = totalTokens / (this.corpus.length || 1)
      this.isLoaded = true
    } catch (err) {
      console.error("[HybridRAG] Error initializing BM25 index:", err)
    }
  }

  private tokenize(text: string): string[] {
    return (text || "")
      .toLowerCase()
      .replace(/[^\w\s\u0C00-\u0C7F\u0900-\u097F]/g, " ")
      .split(/\s+/)
      .filter((t) => t.length > 1)
  }

  private computeBM25Score(qTokens: string[], doc: BM25Doc): number {
    let score = 0
    const N = this.corpus.length || 1

    for (const t of qTokens) {
      const tf = doc.termCounts.get(t) || 0
      if (tf === 0) continue

      const df = this.docFrequencies.get(t) || 1
      const idf = Math.log((N - df + 0.5) / (df + 0.5) + 1)
      const boost = BANKING_KEYWORD_BOOSTS[t] || 1.0

      const numerator = tf * (this.k1 + 1)
      const denominator = tf + this.k1 * (1 - this.b + this.b * (doc.docLength / (this.avgDocLength || 1)))
      score += idf * (numerator / denominator) * boost
    }

    return score
  }

  public retrieve(ragQuery: RAGQuery): RAGResultItem[] {
    if (!this.isLoaded) this.init()
    const topK = ragQuery.topK || 3
    const qText = `${ragQuery.query} ${ragQuery.intent || ""} ${ragQuery.objectionType || ""}`
    const qTokens = this.tokenize(qText)
    if (qTokens.length === 0) return []

    // 1. Get Vector Candidates via Naive RAG
    const vectorCandidates = this.naiveEngine.retrieve({
      ...ragQuery,
      topK: 25,
    })
    const vectorScoreMap = new Map<string, number>()
    vectorCandidates.forEach((c) => vectorScoreMap.set(c.id, c.score))

    // 2. Score with BM25
    const bm25Scored: { id: string; score: number }[] = []
    for (const doc of this.bm25Docs) {
      const bmScore = this.computeBM25Score(qTokens, doc)
      if (bmScore > 0.1 || vectorScoreMap.has(doc.id)) {
        bm25Scored.push({ id: doc.id, score: bmScore })
      }
    }

    // Normalize BM25 scores
    const maxBM25 = Math.max(...bm25Scored.map((s) => s.score), 1)
    const fused: { item: IndexedConversation; fusedScore: number }[] = []
    const itemMap = new Map<string, IndexedConversation>()
    this.corpus.forEach((item) => itemMap.set(item.id, item))

    for (const { id, score: bmScore } of bm25Scored) {
      const item = itemMap.get(id)
      if (!item) continue

      const normBM25 = bmScore / maxBM25
      const normVec = vectorScoreMap.get(id) || 0
      // Linear weighted fusion (60% BM25 keyword matching + 40% dense vector)
      const fusedScore = 0.6 * normBM25 + 0.4 * normVec
      fused.push({ item, fusedScore })
    }

    // 3. Second-Stage Cross-Reranker
    const reranked = fused.map(({ item, fusedScore }) => {
      let rerankMultiplier = 1.0

      // Language alignment boost
      if (ragQuery.language && item.language.toLowerCase() === ragQuery.language.toLowerCase()) {
        rerankMultiplier += 0.35
      }

      // Exact intent alignment boost
      if (ragQuery.intent && item.initial_intent.toLowerCase() === ragQuery.intent.toLowerCase()) {
        rerankMultiplier += 0.4
      }

      // Objection alignment boost
      if (ragQuery.objectionType && item.objections.includes(ragQuery.objectionType)) {
        rerankMultiplier += 0.5
      }

      // Negative Contrastive Penalty (Reject robotic replies)
      for (const t of item.turns) {
        if (t.role === "assistant") {
          for (const pattern of BANNED_CONTRASTIVE_PATTERNS) {
            if (pattern.test(t.content)) {
              rerankMultiplier *= 0.5
              break
            }
          }
        }
      }

      const finalScore = fusedScore * rerankMultiplier
      return { item, finalScore }
    })

    reranked.sort((a, b) => b.finalScore - a.finalScore)
    const selected = reranked.slice(0, topK)

    return selected.map(({ item, finalScore }) => {
      const snippet = item.turns
        .slice(0, 4)
        .map((t) => `${t.role === "assistant" ? "Priya" : "Customer"}: "${t.content}"`)
        .join("\n")

      const briePlaceholders: string[] = []
      item.turns.forEach((t) => {
        if (t.brie) briePlaceholders.push(...t.brie)
      })

      return {
        id: item.id,
        language: item.language,
        product: item.product,
        category: item.category,
        score: Math.round(finalScore * 1000) / 1000,
        matchedIntent: item.initial_intent,
        matchedObjection: item.objections[0],
        dialogueSnippet: snippet,
        assistantBehavior: item.behavior,
        briePlaceholders: Array.from(new Set(briePlaceholders)),
      }
    })
  }
}

export const hybridRAG = new HybridRAG()
