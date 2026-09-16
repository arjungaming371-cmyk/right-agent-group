// Incremental sentence splitting for the streaming voice pipeline.
//
// As the LLM streams tokens, we cut the text at sentence boundaries and hand
// each finished sentence to TTS immediately — the caller hears sentence 1
// while sentence 2 is still being generated. The rules are deliberately
// conservative: a wrong split mid-number ("9.5 lakhs") sounds far worse than
// a slightly late split.

// Sentence-final punctuation: western . ! ? …, Devanagari danda ।/॥
// (Telugu uses western punctuation.)
const BOUNDARY = /[.!?…।॥]/

/** Minimum characters before a boundary is allowed to end a sentence —
 *  keeps "Mr." / "Dr." / list numbering from producing confetti. */
const MIN_SENTENCE_CHARS = 8

/**
 * Splits accumulated stream text into complete sentences + the unfinished
 * remainder. Call repeatedly with the growing buffer's unconsumed part.
 */
export function splitSentences(text: string): { complete: string[]; rest: string } {
  const complete: string[] = []
  let start = 0
  for (let i = 0; i < text.length; i++) {
    if (!BOUNDARY.test(text[i])) continue
    const next = text[i + 1]
    // Only a real boundary if followed by whitespace/EOS — "9.5" keeps going.
    if (next !== undefined && !/\s/.test(next)) continue
    // Unfinished stream: a boundary at the very end of the buffer might still
    // be mid-number ("rate is 9." + next chunk "5 percent"), so hold it back.
    if (next === undefined) break
    const candidate = text.slice(start, i + 1).trim()
    if (candidate.length < MIN_SENTENCE_CHARS) continue
    complete.push(candidate)
    start = i + 1
  }
  return { complete, rest: text.slice(start) }
}
