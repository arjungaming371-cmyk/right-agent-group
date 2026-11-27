import { RAGMode, RAGQuery, UnifiedRAGResponse } from "./types"
import { naiveRAG } from "./naive-rag"
import { hybridRAG } from "./hybrid-rag"
import { graphRAG } from "./graph-rag"
import { agenticRAG } from "./agentic-rag"

export * from "./types"
export { naiveRAG } from "./naive-rag"
export { hybridRAG } from "./hybrid-rag"
export { graphRAG } from "./graph-rag"
export { agenticRAG } from "./agentic-rag"

/**
 * Unified Priya RAG Access Point
 * Selects between Naive, Hybrid, Graph, and Agentic RAG models.
 * Defaults to "agentic" for state-of-the-art conversational performance.
 */
export async function getPriyaRAGContext(
  query: RAGQuery,
  explicitMode?: RAGMode
): Promise<UnifiedRAGResponse> {
  const mode: RAGMode = explicitMode || (process.env.PRIYA_RAG_MODE as RAGMode) || "agentic"
  const start = Date.now()

  switch (mode) {
    case "naive": {
      const items = naiveRAG.retrieve(query)
      const prompt = items.length > 0
        ? `=== NAIVE VECTOR RAG CONTEXT ===\n${items.map((i, idx) => `[Example ${idx + 1}]:\n${i.dialogueSnippet}`).join("\n\n")}\n=== END NAIVE CONTEXT ===`
        : ""
      return {
        mode: "naive",
        latencyMs: Date.now() - start,
        items,
        formattedPromptContext: prompt,
      }
    }

    case "hybrid": {
      const items = hybridRAG.retrieve(query)
      const prompt = items.length > 0
        ? `=== HYBRID RAG + RERANKER CONTEXT (BM25 + DENSE) ===\n${items.map((i, idx) => `[Exemplar ${idx + 1} - ${i.language} (Score: ${i.score})]:\n${i.dialogueSnippet}`).join("\n\n")}\n=== END HYBRID CONTEXT ===`
        : ""
      return {
        mode: "hybrid",
        latencyMs: Date.now() - start,
        items,
        formattedPromptContext: prompt,
      }
    }

    case "graph": {
      const graphContext = graphRAG.traverse(query)
      const prompt = `=== GRAPHRAG CONVERSATIONAL TOPOLOGY ===\n* Intent: ${graphContext.primaryIntent}\n* Recommended Trajectory: ${graphContext.suggestedConversationPath.join(" -> ")}\n* Recommended Products: ${graphContext.recommendedProducts.join(", ")}\n* Canonical Guidance: ${graphContext.canonicalResponses.join(" | ")}\n=== END GRAPHRAG CONTEXT ===`
      return {
        mode: "graph",
        latencyMs: Date.now() - start,
        items: [],
        graphContext,
        formattedPromptContext: prompt,
      }
    }

    case "agentic":
    default: {
      return await agenticRAG.planAndRetrieve(query)
    }
  }
}
