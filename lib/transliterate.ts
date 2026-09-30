/**
 * Deterministic transliteration for Indic scripts (Telugu & Devanagari) to English alphabets (Tanglish / Hinglish).
 * Guarantees that any text sent to TTS or callers contains ONLY English/Roman letters.
 */

const TELUGU_VOWELS: Record<string, string> = {
  "\u0C05": "a", "\u0C06": "aa", "\u0C07": "i", "\u0C08": "ee", "\u0C09": "u",
  "\u0C0A": "oo", "\u0C0B": "ru", "\u0C0E": "e", "\u0C0F": "e", "\u0C10": "ai",
  "\u0C12": "o", "\u0C13": "o", "\u0C14": "au"
}

const TELUGU_CONSONANTS: Record<string, string> = {
  "\u0C15": "k", "\u0C16": "kh", "\u0C17": "g", "\u0C18": "gh", "\u0C19": "ng",
  "\u0C1A": "ch", "\u0C1B": "chh", "\u0C1C": "j", "\u0C1D": "jh", "\u0C1E": "ny",
  "\u0C1F": "t", "\u0C20": "th", "\u0C21": "d", "\u0C22": "dh", "\u0C23": "n",
  "\u0C24": "t", "\u0C25": "th", "\u0C26": "d", "\u0C27": "dh", "\u0C28": "n",
  "\u0C2A": "p", "\u0C2B": "ph", "\u0C2C": "b", "\u0C2D": "bh", "\u0C2E": "m",
  "\u0C2F": "y", "\u0C30": "r", "\u0C31": "r", "\u0C32": "l", "\u0C33": "l",
  "\u0C35": "v", "\u0C36": "sh", "\u0C37": "sh", "\u0C38": "s", "\u0C39": "h"
}

const TELUGU_MATRAS: Record<string, string> = {
  "\u0C3E": "aa", "\u0C3F": "i", "\u0C40": "ee", "\u0C41": "u", "\u0C42": "oo",
  "\u0C43": "ru", "\u0C46": "e", "\u0C47": "e", "\u0C48": "ai", "\u0C4A": "o",
  "\u0C4B": "o", "\u0C4C": "au"
}

const HINDI_VOWELS: Record<string, string> = {
  "\u0905": "a", "\u0906": "aa", "\u0907": "i", "\u0908": "ee", "\u0909": "u",
  "\u090A": "oo", "\u090B": "ri", "\u090F": "e", "\u0910": "ai", "\u0913": "o",
  "\u0914": "au"
}

const HINDI_CONSONANTS: Record<string, string> = {
  "\u0915": "k", "\u0916": "kh", "\u0917": "g", "\u0918": "gh", "\u0919": "ng",
  "\u091A": "ch", "\u091B": "chh", "\u091C": "j", "\u091D": "jh", "\u091E": "ny",
  "\u091F": "t", "\u0920": "th", "\u0921": "d", "\u0922": "dh", "\u0923": "n",
  "\u0924": "t", "\u0925": "th", "\u0926": "d", "\u0927": "dh", "\u0928": "n",
  "\u092A": "p", "\u092B": "ph", "\u092C": "b", "\u092D": "bh", "\u092E": "m",
  "\u092F": "y", "\u0930": "r", "\u0932": "l", "\u0935": "v", "\u0936": "sh",
  "\u0937": "sh", "\u0938": "s", "\u0939": "h"
}

const HINDI_MATRAS: Record<string, string> = {
  "\u093E": "aa", "\u093F": "i", "\u0940": "ee", "\u0941": "u", "\u0942": "oo",
  "\u0943": "ri", "\u0947": "e", "\u0948": "ai", "\u094B": "o", "\u094C": "au"
}

export function toTanglish(text: string): string {
  if (!text) return text
  // Fast path: if no Indic characters exist, return as is
  if (!/[\u0900-\u097F\u0C00-\u0C7F]/.test(text)) return text

  let out = ""
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]

    // 1. Telugu vowels
    if (TELUGU_VOWELS[ch]) {
      out += TELUGU_VOWELS[ch]
    }
    // 2. Telugu consonants
    else if (TELUGU_CONSONANTS[ch]) {
      const base = TELUGU_CONSONANTS[ch]
      const next = text[i + 1]
      if (next === "\u0C4D") { // virama (halant)
        out += base
        i++
      } else if (TELUGU_MATRAS[next]) {
        out += base + TELUGU_MATRAS[next]
        i++
      } else {
        out += base + "a"
      }
    }
    // 3. Telugu modifiers
    else if (ch === "\u0C02") { // anusvara
      const nextCh = text[i + 1]
      // In Telugu phonetics, anusvara before stops (k, g, ch, j, t, d, n, s) sounds as 'n', before labials (p, b, m) as 'm'
      if (nextCh && /[\u0C15-\u0C29\u0C36-\u0C39]/.test(nextCh)) {
        out += "n"
      } else {
        out += "m"
      }
    } else if (ch === "\u0C03") { // visarga
      out += "h"
    }
    // 4. Hindi vowels
    else if (HINDI_VOWELS[ch]) {
      out += HINDI_VOWELS[ch]
    }
    // 5. Hindi consonants
    else if (HINDI_CONSONANTS[ch]) {
      const base = HINDI_CONSONANTS[ch]
      const next = text[i + 1]
      if (next === "\u094D") { // virama
        out += base
        i++
      } else if (HINDI_MATRAS[next]) {
        out += base + HINDI_MATRAS[next]
        i++
      } else {
        const isEnd = (i === text.length - 1) || /[\s,.\?!]/.test(text[i + 1])
        out += base + (isEnd ? "" : "a")
      }
    }
    // 6. Hindi modifiers
    else if (ch === "\u0902" || ch === "\u0901") {
      out += "n"
    } else if (ch === "\u0903") {
      out += "h"
    } else if (ch === "।") {
      out += "."
    } else {
      out += ch
    }
  }

  return out
    .replace(/(\w)mdi\b/gi, "$1ndi")
    .replace(/\bamdi\b/gi, "andi")
    .replace(/\bcheppamdi\b/gi, "cheppandi")
    .replace(/\bnumdi\b/gi, "nunchi")
    .replace(/\bnamaskaaram\b/gi, "namaskaram")
}
