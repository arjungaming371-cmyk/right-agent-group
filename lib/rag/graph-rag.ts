import fs from "fs"
import path from "path"
import { GraphContext, GraphEdge, GraphNode, RAGQuery } from "./types"

/**
 * 3. GRAPHRAG (Knowledge Graph Entity-Relation Traversal)
 * Models conversational topology:
 * Nodes: Intents, Objections, Loan Products, Languages, Conversation Stages
 * Edges: TRIGGERS_OBJECTION, ASSOCIATED_WITH, OCCURS_IN, RESOLVES_WITH
 * Performs multi-hop subgraph expansion to determine the optimal response path.
 */

export class GraphRAG {
  private nodes: Map<string, GraphNode> = new Map()
  private adjacency: Map<string, { target: string; relation: string }[]> = new Map()
  private isLoaded = false

  constructor() {
    this.init()
  }

  private init() {
    if (this.isLoaded) return
    try {
      const graphPath = path.join(process.cwd(), "data", "clean_indexed", "knowledge_graph_8800.json")
      if (!fs.existsSync(graphPath)) return

      const raw = fs.readFileSync(graphPath, "utf-8")
      const data: { nodes: GraphNode[]; edges: GraphEdge[] } = JSON.parse(raw)

      for (const node of data.nodes) {
        this.nodes.set(node.name, node)
      }

      for (const edge of data.edges) {
        if (!this.adjacency.has(edge.source)) {
          this.adjacency.set(edge.source, [])
        }
        this.adjacency.get(edge.source)!.push({
          target: edge.target,
          relation: edge.relation,
        })
      }

      this.isLoaded = true
    } catch (err) {
      console.error("[GraphRAG] Error initializing knowledge graph:", err)
    }
  }

  public traverse(query: RAGQuery): GraphContext {
    if (!this.isLoaded) this.init()

    const intent = query.intent || "general_banking"
    const lang = query.language || "Tenglish"
    const objection = query.objectionType

    const relatedObjections = new Set<string>()
    const recommendedProducts = new Set<string>()
    const pathSteps: string[] = []

    // 1. Expand from Intent Node
    const intentKey = `intent:${intent}`
    const edges = this.adjacency.get(intentKey) || []

    for (const e of edges) {
      if (e.relation === "TRIGGERS_OBJECTION") {
        relatedObjections.add(e.target.replace("objection:", ""))
      } else if (e.relation === "ASSOCIATED_WITH") {
        recommendedProducts.add(e.target.replace("prod:", ""))
      }
    }

    // 2. Multi-hop traversal: If objection present, find resolving products & style
    if (objection) {
      pathSteps.push(`Step 1: Acknowledge objection '${objection}' transparently without defensiveness`)
      const objKey = `objection:${objection}`
      const objEdges = this.adjacency.get(objKey) || []
      for (const e of objEdges) {
        if (e.target.startsWith("prod:")) {
          recommendedProducts.add(e.target.replace("prod:", ""))
        }
      }
      pathSteps.push(`Step 2: Reference verified lender policies via BRIE comparison`)
      pathSteps.push(`Step 3: Offer soft digital verification via WhatsApp (zero pressure)`)
    } else {
      pathSteps.push(`Step 1: Active listen to caller's stated requirement (${intent})`)
      pathSteps.push(`Step 2: Check corporate eligibility across 20+ partner banks`)
      pathSteps.push(`Step 3: Secure explicit customer consent before sending documents`)
    }

    // 3. Synthesize canonical response guidelines
    const canonicalResponses = this.generateCanonicalResponses(intent, lang, objection)

    return {
      primaryIntent: intent,
      relatedObjections: Array.from(relatedObjections),
      recommendedProducts: Array.from(recommendedProducts).slice(0, 3),
      suggestedConversationPath: pathSteps,
      canonicalResponses,
    }
  }

  private generateCanonicalResponses(intent: string, lang: string, objection?: string): string[] {
    const isTelugu = lang.toLowerCase().includes("telugu") || lang.toLowerCase().includes("tenglish")
    const isHindi = lang.toLowerCase().includes("hindi") || lang.toLowerCase().includes("hinglish")

    if (objection === "high_interest_rate") {
      if (isTelugu) {
        return [
          "మీ కన్సర్న్ అర్థమైంది sir. 20 కి పైగా పార్ట్నర్ బ్యాంక్స్ లో రేట్స్ కంపేర్ చేసి మీ CIBIL కి అతి తక్కువ ROI వచ్చే ఆప్షన్ మాత్రమే మేము సజెస్ట్ చేస్తాము.",
        ]
      }
      if (isHindi) {
        return [
          "आपकी चिंता बिल्कुल सही है sir. 20 से ज़्यादा पार्टनर बैंकों में तुलना करके आपके प्रोफाइल के लिए सबसे कम ब्याज़ दर का विकल्प ही हम देंगे।",
        ]
      }
      return [
        "I completely understand your rate concern. As a partner with 20+ top banks, we compare all options to secure the lowest possible ROI for your credit score.",
      ]
    }

    if (intent === "unknown_caller_verification" || intent === "who_are_you") {
      if (isTelugu) {
        return [
          "Right Agent Group నుంచి Priya మాట్లాడుతున్నాను sir. మేము 20 కి పైగా టాప్ బ్యాంక్స్ కి అఫీషియల్ లోన్ పార్ట్నర్స్. మాట్లాడటానికి ఒక నిమిషం సమయం ఉందా?",
        ]
      }
      if (isHindi) {
        return [
          "मैं Right Agent Group से Priya बात कर रही हूँ sir. हम 20+ बैंकों के अधिकृत लोन पार्टनर हैं. क्या आपसे एक मिनट बात हो सकती है?",
        ]
      }
      return [
        "This is Priya from Right Agent Group. We are official loan partners for 20+ leading banks. Do you have a quick minute to speak?",
      ]
    }

    return []
  }
}

export const graphRAG = new GraphRAG()
