import fs from "fs"
import path from "path"
import { naiveRAG, hybridRAG, graphRAG, agenticRAG, RAGMode } from "../lib/rag"

interface EvalItem {
  id: string
  language: string
  intent: string
  objection?: string
  userQuery: string
  expectedProduct: string
}

async function runRAGBenchmark() {
  console.log("==================================================================")
  console.log("🎯 BENCHMARKING 4 RAG ARCHITECTURES ON HELD-OUT EVALUATION SETS")
  console.log("==================================================================")

  // Load held-out evaluation conversations (leakage-free)
  const evalV1 = path.join(process.cwd(), "data", "datasets", "v1", "priya_evaluation_100.jsonl")
  const evalV2 = path.join(process.cwd(), "data", "datasets", "v2", "priya_outbound_evaluation_1000.jsonl")

  const evalSet: EvalItem[] = []

  const loadEval = (filePath: string, limit: number) => {
    if (!fs.existsSync(filePath)) return
    const lines = fs.readFileSync(filePath, "utf-8").split("\n").filter(Boolean)
    for (let i = 0; i < Math.min(lines.length, limit); i++) {
      try {
        const d = JSON.parse(lines[i])
        const firstUser = d.messages?.find((m: any) => m.role === "user")?.content || "Hello"
        evalSet.push({
          id: d.conversation_id,
          language: d.language || "Tenglish",
          intent: d.initial_customer_intent || d.customer_intent || "general_inquiry",
          objection: d.customer_objections?.[0],
          userQuery: firstUser,
          expectedProduct: d.loan_product || "personal_loan",
        })
      } catch {}
    }
  }

  loadEval(evalV1, 50)
  loadEval(evalV2, 50)
  console.log(`Loaded ${evalSet.length} held-out evaluation test cases.\n`)

  const modes: RAGMode[] = ["naive", "hybrid", "graph", "agentic"]
  const results: Record<
    string,
    {
      latencies: number[]
      intentMatches: number
      objectionMatches: number
      nonEmptyContexts: number
      antiRoboticPasses: number
    }
  > = {}

  for (const mode of modes) {
    results[mode] = {
      latencies: [],
      intentMatches: 0,
      objectionMatches: 0,
      nonEmptyContexts: 0,
      antiRoboticPasses: 0,
    }

    for (const test of evalSet) {
      const start = Date.now()
      let promptContext = ""
      let matchedIntent = ""
      let matchedObjection: string | undefined = ""

      if (mode === "naive") {
        const items = naiveRAG.retrieve({
          query: test.userQuery,
          language: test.language,
          intent: test.intent,
          topK: 2,
        })
        matchedIntent = items[0]?.matchedIntent || ""
        matchedObjection = items[0]?.matchedObjection
        promptContext = items.map((i) => i.dialogueSnippet).join("\n")
      } else if (mode === "hybrid") {
        const items = hybridRAG.retrieve({
          query: test.userQuery,
          language: test.language,
          intent: test.intent,
          objectionType: test.objection,
          topK: 2,
        })
        matchedIntent = items[0]?.matchedIntent || ""
        matchedObjection = items[0]?.matchedObjection
        promptContext = items.map((i) => i.dialogueSnippet).join("\n")
      } else if (mode === "graph") {
        const graph = graphRAG.traverse({
          query: test.userQuery,
          language: test.language,
          intent: test.intent,
          objectionType: test.objection,
        })
        matchedIntent = graph.primaryIntent
        matchedObjection = graph.relatedObjections[0]
        promptContext = graph.suggestedConversationPath.join("\n")
      } else if (mode === "agentic") {
        const agentic = await agenticRAG.planAndRetrieve({
          query: test.userQuery,
          language: test.language,
          intent: test.intent,
          objectionType: test.objection,
          topK: 2,
        })
        matchedIntent = agentic.plan?.detectedIntent || ""
        matchedObjection = agentic.plan?.detectedObjection
        promptContext = agentic.formattedPromptContext
      }

      const elapsed = Date.now() - start
      results[mode].latencies.push(elapsed)

      if (promptContext.length > 0) results[mode].nonEmptyContexts++
      if (matchedIntent && (matchedIntent === test.intent || test.intent.includes(matchedIntent) || matchedIntent.includes(test.intent))) {
        results[mode].intentMatches++
      }
      if (test.objection && matchedObjection) {
        results[mode].objectionMatches++
      }

      // Check anti-robotic compliance
      const hasBannedFiller = /absolutely\s+(sir|madam)|certainly\s+(sir|madam)|thank\s+you\s+for\s+sharing/i.test(promptContext)
      if (!hasBannedFiller) {
        results[mode].antiRoboticPasses++
      }
    }
  }

  console.log("==========================================================================================")
  console.log("📊 4-TIER RAG ARCHITECTURE COMPARISON RESULTS")
  console.log("==========================================================================================")
  console.log("| Architecture          | p50 Latency | p95 Latency | Intent Match % | Anti-Robotic % | Coverage % |")
  console.log("|-----------------------|-------------|-------------|----------------|----------------|------------|")

  for (const mode of modes) {
    const lats = results[mode].latencies.sort((a, b) => a - b)
    const p50 = lats[Math.floor(lats.length * 0.5)] || 0
    const p95 = lats[Math.floor(lats.length * 0.95)] || 0
    const intentPct = Math.round((results[mode].intentMatches / evalSet.length) * 100)
    const antiRoboticPct = Math.round((results[mode].antiRoboticPasses / evalSet.length) * 100)
    const coveragePct = Math.round((results[mode].nonEmptyContexts / evalSet.length) * 100)

    const label =
      mode === "naive"
        ? "1. Naive Vector RAG   "
        : mode === "hybrid"
        ? "2. Hybrid RAG+Reranker"
        : mode === "graph"
        ? "3. GraphRAG           "
        : "4. Agentic Hybrid RAG "

    console.log(
      `| ${label} | ${p50.toString().padStart(9)}ms | ${p95.toString().padStart(9)}ms | ${intentPct.toString().padStart(12)}% | ${antiRoboticPct.toString().padStart(12)}% | ${coveragePct.toString().padStart(8)}% |`
    )
  }
  console.log("==========================================================================================")
}

runRAGBenchmark().catch(console.error)
