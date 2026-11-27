/**
 * Core Types for Priya's 4-Tier RAG Architecture:
 * 1. Naive RAG (Basic Vector Cosine)
 * 2. Hybrid RAG + Reranker (BM25 + Vector + Cross Reranker)
 * 3. GraphRAG (Knowledge Graph Entity-Relation Traversal)
 * 4. Agentic Hybrid RAG (Multi-Route Intent Planning + Contrastive Reflection)
 */

export type RAGMode = "naive" | "hybrid" | "graph" | "agentic"

export type SupportedLanguage = "Tenglish" | "Telugu" | "English" | "Hinglish" | "Hindi"

export interface ConversationTurn {
  turn_index: number
  role: "user" | "assistant"
  content: string
  language_tag?: string
  brie?: string[]
}

export interface IndexedConversation {
  id: string
  language: SupportedLanguage
  product: string
  category: string
  initial_intent: string
  final_intent: string
  objections: string[]
  style: string
  objective: string
  behavior: string[]
  turns: ConversationTurn[]
  first_user_turn: string
  first_assistant_turn: string
}

export interface RAGQuery {
  query: string
  language?: SupportedLanguage | string
  intent?: string
  objectionType?: string
  product?: string
  customerProfile?: string
  turnCount?: number
  topK?: number
}

export interface RAGResultItem {
  id: string
  language: string
  product: string
  category: string
  score: number
  matchedIntent: string
  matchedObjection?: string
  dialogueSnippet: string
  assistantBehavior: string[]
  briePlaceholders: string[]
}

export interface GraphNode {
  type: "intent" | "language" | "product" | "style" | "objection" | "stage"
  name: string
}

export interface GraphEdge {
  source: string
  target: string
  relation: string
}

export interface GraphContext {
  primaryIntent: string
  relatedObjections: string[]
  recommendedProducts: string[]
  suggestedConversationPath: string[]
  canonicalResponses: string[]
}

export interface AgenticRAGPlan {
  detectedLanguage: SupportedLanguage | string
  detectedIntent: string
  detectedObjection?: string
  needsBrieFacts: boolean
  needsBehavioralEmpathy: boolean
  needsObjectionResolution: boolean
  searchKeywords: string[]
  graphExpansionNodes: string[]
}

export interface UnifiedRAGResponse {
  mode: RAGMode
  latencyMs: number
  plan?: AgenticRAGPlan
  items: RAGResultItem[]
  graphContext?: GraphContext
  formattedPromptContext: string
}
