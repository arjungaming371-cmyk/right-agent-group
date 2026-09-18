/**
 * Smart Search Engine for Right Agent Group
 *
 * Provides intelligent, typo-tolerant fuzzy matching across:
 * - Names with spelling mistakes (e.g., "Sursh" -> "Suresh", "Preeya" -> "Priya")
 * - Loan types and keywords (e.g., "persnal", "bussiness", "hom loan")
 * - Cities and addresses (e.g., "vjaywada", "hydrabad")
 * - Phone numbers in any format (e.g., "98765", "+91 98765-43210")
 * - Multi-token unordered matching (e.g., "hyd suresh personal")
 * - Relevance ranking (exact > prefix > boundary > substring > fuzzy typo)
 */

// Common phonetic replacements in Indian names and loan terms
function normalizePhonetic(str: string): string {
  return str
    .toLowerCase()
    .replace(/ph/g, "f")
    .replace(/ee+/g, "i")
    .replace(/oo+/g, "u")
    .replace(/ck/g, "k")
    .replace(/w/g, "v")
    .replace(/sh/g, "s")
    .replace(/ch/g, "c")
    .replace(/z/g, "s")
    .replace(/([a-z])\1+/g, "$1") // collapse double letters (e.g., "kumar" vs "kummar")
}

// Clean phone digits for phone search
export function cleanDigits(val: string | null | undefined): string {
  if (!val) return ""
  return String(val).replace(/\D/g, "")
}

/**
 * Standard Levenshtein / Damerau edit distance
 */
export function editDistance(a: string, b: string): number {
  if (a === b) return 0
  if (!a.length) return b.length
  if (!b.length) return a.length

  const la = a.length
  const lb = b.length
  const d: number[][] = []

  for (let i = 0; i <= la; i++) {
    d[i] = [i]
  }
  for (let j = 0; j <= lb; j++) {
    d[0][j] = j
  }

  for (let i = 1; i <= la; i++) {
    for (let j = 1; j <= lb; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      d[i][j] = Math.min(
        d[i - 1][j] + 1, // deletion
        d[i][j - 1] + 1, // insertion
        d[i - 1][j - 1] + cost // substitution
      )
      // Damerau transposition check
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + cost)
      }
    }
  }

  return d[la][lb]
}

/**
 * Checks if query token matches a single target word or string
 * Returns a score between 0 (no match) and 1 (exact match)
 */
function matchSingleToken(queryWord: string, targetText: string): number {
  if (!queryWord || !targetText) return 0
  const q = queryWord.toLowerCase().trim()
  const t = targetText.toLowerCase().trim()

  // 1. Exact match
  if (t === q) return 1.0

  // 2. Prefix match (starts with)
  if (t.startsWith(q)) return 0.95

  // 3. Substring match
  if (t.includes(q)) return 0.85

  // 4. Word boundary match if target has spaces
  const targetWords = t.split(/[\s\-_/.,]+/).filter(Boolean)
  for (const tw of targetWords) {
    if (tw === q) return 0.98
    if (tw.startsWith(q)) return 0.92
    if (tw.includes(q)) return 0.82
  }

  // 5. Phone number match
  const qDigits = cleanDigits(q)
  if (qDigits.length >= 3) {
    const tDigits = cleanDigits(t)
    if (tDigits.includes(qDigits)) return 0.9
  }

  // 6. Typo / Fuzzy match via edit distance
  const maxLen = Math.max(q.length, t.length)
  if (maxLen >= 3) {
    let bestWordScore = 0
    for (const tw of targetWords) {
      if (tw.length < 3) continue
      const dist = editDistance(q, tw)
      const allowedDist = q.length <= 4 ? 1 : q.length <= 8 ? 2 : 3
      if (dist <= allowedDist) {
        const score = 0.78 - dist * 0.08
        if (score > bestWordScore) bestWordScore = score
      }

      // Phonetic distance check
      const qNorm = normalizePhonetic(q)
      const twNorm = normalizePhonetic(tw)
      if (qNorm === twNorm) {
        if (0.80 > bestWordScore) bestWordScore = 0.80
      } else if (qNorm.includes(twNorm) || twNorm.includes(qNorm)) {
        if (0.75 > bestWordScore) bestWordScore = 0.75
      }
    }
    if (bestWordScore > 0) return bestWordScore
  }

  return 0
}

export type SmartMatchResult = {
  matches: boolean
  score: number
}

/**
 * Evaluates whether a search query matches any of the candidate strings in a record
 * Supports multi-token search (all query tokens must match at least one candidate field)
 */
export function smartMatch(
  query: string,
  candidates: (string | number | null | undefined)[]
): SmartMatchResult {
  const trimmed = (query || "").trim().toLowerCase()
  if (!trimmed) return { matches: true, score: 1.0 }

  // Clean candidates into non-empty strings
  const textPool = candidates
    .filter((c) => c !== null && c !== undefined)
    .map((c) => String(c).trim())
    .filter((s) => s.length > 0)

  if (textPool.length === 0) return { matches: false, score: 0 }

  // Check full query match first across entire concatenated text
  const combinedText = textPool.join(" ")
  const combinedLower = combinedText.toLowerCase()

  if (combinedLower === trimmed) return { matches: true, score: 1.0 }
  if (combinedLower.includes(trimmed)) return { matches: true, score: 0.9 }

  // Split query into tokens (e.g. "suresh hyderabad")
  const tokens = trimmed.split(/[\s,]+/).filter(Boolean)
  if (tokens.length === 0) return { matches: true, score: 1.0 }

  let totalScore = 0

  // ALL query tokens must match at least one candidate field
  for (const token of tokens) {
    let bestTokenScore = 0

    for (const text of textPool) {
      const score = matchSingleToken(token, text)
      if (score > bestTokenScore) {
        bestTokenScore = score
      }
    }

    // If any token has 0 match, the record fails
    if (bestTokenScore === 0) {
      return { matches: false, score: 0 }
    }

    totalScore += bestTokenScore
  }

  const avgScore = totalScore / tokens.length
  return {
    matches: avgScore > 0,
    score: avgScore,
  }
}

/**
 * Filter an array of items using smart search and sort by relevance score descending
 */
export function smartFilter<T>(
  items: T[],
  query: string,
  extractCandidates: (item: T) => (string | number | null | undefined)[]
): T[] {
  const trimmed = (query || "").trim()
  if (!trimmed) return items

  const scored: { item: T; score: number }[] = []

  for (const item of items) {
    const candidates = extractCandidates(item)
    const { matches, score } = smartMatch(trimmed, candidates)
    if (matches) {
      scored.push({ item, score })
    }
  }

  // Sort higher scores first
  scored.sort((a, b) => b.score - a.score)
  return scored.map((s) => s.item)
}
