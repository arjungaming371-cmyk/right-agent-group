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
 *  prevents tiny 1-2 word fragments ("Nenu Priya.", "Avunu sir!") from chopping
 *  the voice into robotic stutters with falling pitch. */
const MIN_SENTENCE_CHARS = 28

// Outpero-grade FIRST-AUDIO latency (2026-09-30): the prompt training makes
// Priya open every reply with a short acknowledgment joined to the main
// clause by a COMMA ("నమస్కారం sir, ..."). That leading comma is a natural
// TTS pause point (a gentle rise, never the falling pitch an exclamation
// produces), so the FIRST emission may flush at the first comma — the caller
// hears the warm acknowledgment while the model is still writing the main
// clause. Subsequent emissions ignore commas entirely: mid-sentence commas
// (lists, "sixteen, twenty") must never split the voice. The floor keeps
// one-word false starts from reaching TTS.
const FIRST_COMMA_FLUSH_CHARS = 10

/**
 * Splits accumulated stream text into complete sentences + the unfinished
 * remainder. Call repeatedly with the growing buffer's unconsumed part.
 *
 * opts.allowFirstCommaFlush — pass true ONLY while nothing has been emitted
 * for this reply yet (the caller tracks that). Once a first emission exists,
 * omit the flag and commas are treated as ordinary characters again.
 */
export function splitSentences(
  text: string,
  opts?: { allowFirstCommaFlush?: boolean }
): { complete: string[]; rest: string } {
  const complete: string[] = []
  let start = 0
  let commaFlushUsed = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (!BOUNDARY.test(ch)) {
      // One-shot leading-comma flush: only before ANY boundary sentence has
      // been emitted in this reply, only when there is more text pending
      // after the comma (a trailing comma at end-of-stream is just the
      // unfinished remainder — the caller's tail flush handles it), and only
      // when the clause is long enough to be a real acknowledgment.
      if (
        ch === "," &&
        opts?.allowFirstCommaFlush &&
        !commaFlushUsed &&
        complete.length === 0 &&
        start === 0 &&
        i + 1 < text.length &&
        /\s/.test(text[i + 1]) &&
        i + 1 - start >= FIRST_COMMA_FLUSH_CHARS
      ) {
        const candidate = text.slice(start, i + 1).trim()
        if (candidate.length >= FIRST_COMMA_FLUSH_CHARS) {
          complete.push(candidate)
          commaFlushUsed = true
          start = i + 1
        }
      }
      continue
    }
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
