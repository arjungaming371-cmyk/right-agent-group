/**
 * TTS number & text hygiene for speech synthesis.
 * Converts numbers, currencies, phone numbers, tenures, and percentages into English words
 * so TTS engines pronounce them clearly in any language (Telugu, Hindi, English).
 */

const ONES = [
  "", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine",
  "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen",
  "seventeen", "eighteen", "nineteen"
]

const TENS = [
  "", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"
]

const DIGIT_WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine"]

export function smallNumberToWords(n: number): string {
  if (n === 0) return "zero"
  if (n < 20) return ONES[n]
  if (n < 100) {
    const ten = TENS[Math.floor(n / 10)]
    const one = ONES[n % 10]
    return one ? `${ten} ${one}` : ten
  }
  if (n < 1000) {
    const hundred = ONES[Math.floor(n / 100)] + " hundred"
    const rem = n % 100
    return rem ? `${hundred} and ${smallNumberToWords(rem)}` : hundred
  }
  return ""
}

/** Converts integer (up to crores) to Indian English words */
export function integerToWords(num: number): string {
  if (isNaN(num)) return ""
  let n = Math.abs(Math.round(num))
  if (n === 0) return "zero"

  const parts: string[] = []

  // Crores (>= 1,00,00,000)
  if (n >= 10000000) {
    const cr = Math.floor(n / 10000000)
    n %= 10000000
    parts.push(`${smallNumberToWords(cr)} crore`)
  }

  // Lakhs (>= 1,00,000)
  if (n >= 100000) {
    const lk = Math.floor(n / 100000)
    n %= 100000
    parts.push(`${smallNumberToWords(lk)} lakh`)
  }

  // Thousands (>= 1,000)
  if (n >= 1000) {
    const th = Math.floor(n / 1000)
    n %= 1000
    parts.push(`${smallNumberToWords(th)} thousand`)
  }

  // Hundreds & remainder
  if (n > 0) {
    if (parts.length > 0 && n < 100) {
      parts.push(`and ${smallNumberToWords(n)}`)
    } else {
      parts.push(smallNumberToWords(n))
    }
  }

  return parts.join(" ")
}

export function decimalToWords(val: number): string {
  const [whole, dec] = val.toString().split(".")
  return `${integerToWords(parseInt(whole, 10))} point ${digitsToWords(dec)}`
}

/** Digits spelled out, e.g. for phone numbers: 6301689511 -> six three zero one six eight nine five one one */
export function digitsToWords(digits: string): string {
  return digits.split("").map((d) => DIGIT_WORDS[parseInt(d, 10)] || d).join(" ")
}

export function normalizeNumbersToEnglishWords(text: string): string {
  if (!text) return text
  let s = String(text)

  // 1. Remove commas in numbers like 16,00,000 or 14,500
  while (/\b(\d+),(\d{2,3})\b/.test(s)) {
    s = s.replace(/\b(\d+),(\d{2,3})\b/g, "$1$2")
  }

  // 2. Currency prefix: ₹ or Rs. / Rs -> rupees
  s = s.replace(/(?:₹|\bRs\.?\s*)\s*(\d+(?:\.\d+)?)/gi, "$1 rupees")

  // 3. Indian phone numbers (10 digits starting with 6-9)
  s = s.replace(/(?:\+91[\s-]?)?\b([6-9]\d{9})\b/g, (match, p1) => {
    return digitsToWords(p1)
  })

  // 4. Number ranges: 15-20 or 15 - 20 -> fifteen to twenty
  s = s.replace(/\b(\d+)\s*[-–—]\s*(\d+)\b/g, (match, a, b) => {
    return `${integerToWords(parseInt(a, 10))} to ${integerToWords(parseInt(b, 10))}`
  })

  // 5. Number with plus: 20+ banks -> twenty plus banks
  s = s.replace(/\b(\d+)\s*\+/g, (match, n) => {
    return `${integerToWords(parseInt(n, 10))} plus `
  })

  // 6. Crores shorthand: 2 crore / 2cr
  s = s.replace(/\b(\d+(?:\.\d+)?)\s*(?:crores?|cr)\b/gi, (match, numStr) => {
    const val = parseFloat(numStr)
    const words = val % 1 === 0 ? integerToWords(val) : decimalToWords(val)
    return `${words} crore`
  })

  // 7. Lakhs shorthand: 16 lakhs / 16 lakh / 16L / 16lac
  s = s.replace(/\b(\d+(?:\.\d+)?)\s*(?:lakhs?|lac|[lL])\b/g, (match, numStr) => {
    const val = parseFloat(numStr)
    const words = val % 1 === 0 ? integerToWords(val) : decimalToWords(val)
    return `${words} lakh`
  })

  // 8. Thousands shorthand: 14 thousand / 14k
  s = s.replace(/\b(\d+(?:\.\d+)?)\s*(?:thousands?|[kK])\b/g, (match, numStr) => {
    const val = parseFloat(numStr)
    const words = val % 1 === 0 ? integerToWords(val) : decimalToWords(val)
    return `${words} thousand`
  })

  // 9. Percentages: 10.5% or 10%
  s = s.replace(/\b(\d+)\.(\d+)\s*%/g, (match, whole, dec) => {
    return `${integerToWords(parseInt(whole, 10))} point ${digitsToWords(dec)} percent`
  })
  s = s.replace(/\b(\d+)\s*%/g, (match, whole) => {
    return `${integerToWords(parseInt(whole, 10))} percent`
  })

  // 10. Decimals: 10.5 -> ten point five
  s = s.replace(/\b(\d+)\.(\d+)\b/g, (match, whole, dec) => {
    return `${integerToWords(parseInt(whole, 10))} point ${digitsToWords(dec)}`
  })

  // 11. Multi-digit years or time durations: "15 years", "5 years", "24 months"
  s = s.replace(/\b(\d+)\s*(years?|months?|days?|hours?|mins?|minutes?|secs?|seconds?)\b/gi, (match, num, unit) => {
    return `${integerToWords(parseInt(num, 10))} ${unit}`
  })

  // 12. Any remaining standalone integers (e.g. 1, 2, 5, 14, 16, 14500, 1600000)
  s = s.replace(/\b\d+\b/g, (match) => {
    const num = parseInt(match, 10)
    return integerToWords(num)
  })

  return s
}

export function normalizeForTts(text: string): string {
  if (!text) return text
  let out = String(text)
  out = out.replace(/\*\*([^*]+)\*\*/g, "$1") // **markdown bold**
  out = out.replace(/\*([^*]+)\*/g, "$1") // *single-asterisk* bold
  out = out.replace(/\p{Extended_Pictographic}/gu, "") // emoji
  out = out.replace(/[—–]/g, ", ") // dashes to gentle commas
  out = out.replace(/\b1\s*minute\b/gi, (match, offset, str) => /[\u0C00-\u0C7F]/.test(str) ? "ఒక్క minute" : "one minute")
  out = out.replace(/&/g, " and ")
  out = out.replace(/(\.{2,}|…)/g, ".") // ellipses to single period

  // Convert numbers to clean English words
  out = normalizeNumbersToEnglishWords(out)

  out = out.replace(/rupees\s+rupees/gi, "rupees")
  out = out.replace(/\s{2,}/g, " ").trim()
  return out
}
