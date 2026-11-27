import fs from "fs"
import path from "path"
import { IndexedConversation, RAGQuery, RAGResultItem } from "./types"

/**
 * 1. NAIVE RAG (Basic Vector Cosine Retrieval)
 * Lightweight, zero-external-dependency, sub-5ms in-memory vector index.
 * Uses term-frequency normalized sparse vectors over dialogue turns & intents.
 */
export class NaiveRAG {
  private corpus: IndexedConversation[] = []
  private vocabulary: Map<string, number> = new Map()
  private docVectors: Map<string, Map<number, number>> = new Map()
  private docMagnitudes: Map<string, number> = new Map()
  private isLoaded = false

  constructor() {
    this.init()
  }

  private init() {
    if (this.isLoaded) return
    try {
      const dataPath = path.join(process.cwd(), "data", "clean_indexed", "priya_clean_training_8800.json")
      if (!fs.existsSync(dataPath)) {
        return
      }
      const raw = fs.readFileSync(dataPath, "utf-8")
      this.corpus = JSON.parse(raw)

      let vocabIndex = 0
      for (const item of this.corpus) {
        const text = `${item.initial_intent} ${item.product} ${item.category} ${item.first_user_turn} ${item.first_assistant_turn}`
        const tokens = this.tokenize(text)
        const vec = new Map<number, number>()

        for (const token of tokens) {
          let idx = this.vocabulary.get(token)
          if (idx === undefined) {
            idx = vocabIndex++
            this.vocabulary.set(token, idx)
          }
          vec.set(idx, (vec.get(idx) || 0) + 1)
        }

        let sumSquares = 0
        for (const count of vec.values()) {
          sumSquares += count * count
        }
        const magnitude = Math.sqrt(sumSquares) || 1

        this.docVectors.set(item.id, vec)
        this.docMagnitudes.set(item.id, magnitude)
      }
      this.isLoaded = true
    } catch (err) {
      console.error("[NaiveRAG] Error initializing vector index:", err)
    }
  }

  private tokenize(text: string): string[] {
    return (text || "")
      .toLowerCase()
      .replace(/[^\w\s\u0C00-\u0C7F\u0900-\u097F]/g, " ")
      .split(/\s+/)
      .filter((t) => t.length > 1)
  }

  public retrieve(ragQuery: RAGQuery): RAGResultItem[] {
    if (!this.isLoaded) this.init()
    const topK = ragQuery.topK || 3
    const qTokens = this.tokenize(`${ragQuery.query} ${ragQuery.intent || ""} ${ragQuery.language || ""}`)
    if (qTokens.length === 0) return []

    // Build query vector
    const qVec = new Map<number, number>()
    for (const t of qTokens) {
      const idx = this.vocabulary.get(t)
      if (idx !== undefined) {
        qVec.set(idx, (qVec.get(idx) || 0) + 1)
      }
    }

    let qSumSquares = 0
    for (const count of qVec.values()) {
      qSumSquares += count * count
    }
    const qMagnitude = Math.sqrt(qSumSquares) || 1

    const scored: { item: IndexedConversation; score: number }[] = []

    for (const item of this.corpus) {
      // Basic language pre-filter if provided
      if (ragQuery.language && item.language.toLowerCase() !== ragQuery.language.toLowerCase()) {
        continue
      }

      const docVec = this.docVectors.get(item.id)
      const docMag = this.docMagnitudes.get(item.id) || 1
      if (!docVec) continue

      let dotProduct = 0
      for (const [qIdx, qVal] of qVec.entries()) {
        const docVal = docVec.get(qIdx)
        if (docVal) {
          dotProduct += qVal * docVal
        }
      }

      const cosineSim = dotProduct / (qMagnitude * docMag)
      if (cosineSim > 0.05) {
        scored.push({ item, score: cosineSim })
      }
    }

    scored.sort((a, b) => b.score - a.score)
    const selected = scored.slice(0, topK)

    return selected.map(({ item, score }) => {
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
        score: Math.round(score * 1000) / 1000,
        matchedIntent: item.initial_intent,
        matchedObjection: item.objections[0],
        dialogueSnippet: snippet,
        assistantBehavior: item.behavior,
        briePlaceholders: Array.from(new Set(briePlaceholders)),
      }
    })
  }
}

export const naiveRAG = new NaiveRAG()
