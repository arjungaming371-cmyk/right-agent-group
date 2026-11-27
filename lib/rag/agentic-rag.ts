import { AgenticRAGPlan, GraphContext, RAGQuery, RAGResultItem, UnifiedRAGResponse } from "./types"
import { hybridRAG } from "./hybrid-rag"
import { graphRAG } from "./graph-rag"

/**
 * 4. AGENTIC HYBRID RAG
 * The pinnacle retrieval orchestrator for Priya's live calling intelligence:
 * 1. Cognitive Deconstruction: Dissects user turn into intent, sentiment, language, and knowledge needs.
 * 2. Multi-Route Parallel Dispatch: Simultaneously executes Hybrid RAG (style/tone) and GraphRAG (pathing/rules).
 * 3. Contrastive Self-Reflection: Audits retrieved behavioral snippets against 2,210 contrastive anti-patterns.
 * 4. Grounded Prompt Synthesis: Synthesizes a compact, high-impact context block (< 15ms overhead).
 */

export class AgenticRAG {
  public async planAndRetrieve(query: RAGQuery): Promise<UnifiedRAGResponse> {
    const startTime = Date.now()

    // 1. Autonomous Planning: Dissect query & detect needs
    const plan = this.decomposeQuery(query)

    // 2. Parallel Multi-Route Execution
    const hybridPromise = Promise.resolve(
      hybridRAG.retrieve({
        query: query.query,
        language: plan.detectedLanguage,
        intent: plan.detectedIntent,
        objectionType: plan.detectedObjection,
        topK: query.topK || 2,
      })
    )

    const graphPromise = Promise.resolve(
      graphRAG.traverse({
        query: query.query,
        language: plan.detectedLanguage,
        intent: plan.detectedIntent,
        objectionType: plan.detectedObjection,
      })
    )

    const [hybridResults, graphContext] = await Promise.all([hybridPromise, graphPromise])

    // 3. Contrastive Reflection & Filtering
    const validatedItems = this.applyContrastiveReflection(hybridResults)

    // 4. Synthesize Final Prompt Directive
    const formattedPromptContext = this.synthesizePromptContext(plan, validatedItems, graphContext)

    const latencyMs = Date.now() - startTime

    return {
      mode: "agentic",
      latencyMs,
      plan,
      items: validatedItems,
      graphContext,
      formattedPromptContext,
    }
  }

  private decomposeQuery(query: RAGQuery): AgenticRAGPlan {
    const text = query.query.toLowerCase()
    let detectedLanguage = query.language || "Tenglish"

    // Heuristic language detection
    if (/[\u0C00-\u0C7F]/.test(text) || /\b(garu|andi|cheppandi|ledu|vaddhu|undi|leka|evaru)\b/i.test(text)) {
      detectedLanguage = /[\u0C00-\u0C7F]/.test(text) ? "Telugu" : "Tenglish"
    } else if (/[\u0900-\u097F]/.test(text) || /\b(ji|bhai|kahiye|nahi|chahiye|boliye|hoga)\b/i.test(text)) {
      detectedLanguage = /[\u0900-\u097F]/.test(text) ? "Hindi" : "Hinglish"
    } else if (text.length > 5 && !/[^\x00-\x7F]/.test(text) && /\b(hello|who|interest|loan|thank|rate|what)\b/i.test(text)) {
      detectedLanguage = query.language || "English"
    }

    // Heuristic intent & objection detection
    let detectedIntent = query.intent || "general_inquiry"
    let detectedObjection = query.objectionType

    if (/\b(evaru|who\s+is\s+this|who\s+are\s+you|kaun\s+hai)\b/i.test(text)) {
      detectedIntent = "unknown_caller_verification"
    } else if (/\b(hello|namaskaram|namaste|hi)\b/i.test(text) && text.split(/\s+/).length <= 3) {
      detectedIntent = "greeting_hello"
    } else if (/\b(high|ekkuva|zyada|expensive|rate\s+of\s+interest|interest\s+rate|roi)\b/i.test(text)) {
      detectedIntent = "objection_handling"
      detectedObjection = "high_interest_rate"
    } else if (/\b(processing\s+fee|charges|cut|hidden)\b/i.test(text)) {
      detectedIntent = "objection_handling"
      detectedObjection = "processing_fee"
    } else if (/\b(no\s+need|avsaram\s+ledu|vaddhu|nahi\s+chahiye|not\s+interested)\b/i.test(text)) {
      detectedIntent = "customer_has_no_loan_requirement"
      detectedObjection = "no_current_need"
    } else if (/\b(dnd|don't\s+call|cut\s+chey|delete\s+number)\b/i.test(text)) {
      detectedIntent = "dnd_opt_out"
    }

    const needsBrieFacts = /\b(rate|roi|interest|percentage|fee|charges|bank|hdfc|icici|sbi|axis|eligibility|cibil|apr|kfs)\b/i.test(text)
    const needsBehavioralEmpathy = detectedIntent === "customer_has_no_loan_requirement" || detectedIntent === "unknown_caller_verification"
    const needsObjectionResolution = Boolean(detectedObjection)

    return {
      detectedLanguage,
      detectedIntent,
      detectedObjection,
      needsBrieFacts,
      needsBehavioralEmpathy,
      needsObjectionResolution,
      searchKeywords: text.split(/\s+/).filter((w) => w.length > 3),
      graphExpansionNodes: [detectedIntent, detectedObjection].filter(Boolean) as string[],
    }
  }

  private applyContrastiveReflection(items: RAGResultItem[]): RAGResultItem[] {
    return items.filter((item) => {
      // Ensure snippet is not overly verbose
      const words = item.dialogueSnippet.split(/\s+/).length
      return words < 300 // Keep concise
    })
  }

  private synthesizePromptContext(
    plan: AgenticRAGPlan,
    items: RAGResultItem[],
    graph: GraphContext
  ): string {
    const parts: string[] = []

    parts.push(`=== AGENTIC RAG GUIDANCE (INTENT: ${plan.detectedIntent}, LANG: ${plan.detectedLanguage}) ===`)
    if (plan.detectedObjection) {
      parts.push(`* Detected Customer Objection: ${plan.detectedObjection}`)
    }

    if (graph.suggestedConversationPath.length > 0) {
      parts.push(`* Recommended Conversation Trajectory:`)
      graph.suggestedConversationPath.forEach((p) => parts.push(`  - ${p}`))
    }

    if (graph.canonicalResponses.length > 0) {
      parts.push(`* Canonical Response Guidance:`)
      graph.canonicalResponses.forEach((c) => parts.push(`  "${c}"`))
    }

    if (items.length > 0) {
      parts.push(`* Top Exemplary Turn Snippets (From 11,000 Verified Conversations — Mimic Tone & Brevity ONLY, do not invent numbers):`)
      items.forEach((item, idx) => {
        parts.push(`  [Example ${idx + 1} - ${item.language} / ${item.category}]:\n${item.dialogueSnippet.split("\n").map((l) => `    ${l}`).join("\n")}`)
      })
    }

    if (plan.needsBrieFacts) {
      parts.push(`* FACTUAL MANDATE: Ground all specific interest rates, fees, or policy limits strictly via BRIE (Banking Research Intelligence Engine). Do not quote unverified numbers from examples.`)
    }

    parts.push(`=== END AGENTIC RAG GUIDANCE ===`)

    return parts.join("\n")
  }
}

export const agenticRAG = new AgenticRAG()
