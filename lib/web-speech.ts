// Minimal Web Speech API typings.
//
// TypeScript's DOM lib does not include SpeechRecognition (it ships in
// lib.dom for only some TS versions and never for the webkit-prefixed
// constructor Chrome actually exposes), so every voice UI ended up doing
// `(window as any).SpeechRecognition` and typing handlers as `any`. These
// structural types cover exactly the surface both components use — no
// runtime behaviour, pure typing + one safe constructor lookup.

export interface SpeechRecognitionAlternativeLike {
  readonly transcript: string
  readonly confidence: number
}

export interface SpeechRecognitionResultLike {
  readonly length: number
  readonly isFinal: boolean
  [index: number]: SpeechRecognitionAlternativeLike
}

export interface SpeechRecognitionResultListLike {
  readonly length: number
  [index: number]: SpeechRecognitionResultLike
}

export interface SpeechRecognitionEventLike {
  readonly resultIndex: number
  readonly results: SpeechRecognitionResultListLike
}

export interface SpeechRecognitionErrorEventLike {
  readonly error: string
  readonly message: string
}

export interface SpeechRecognitionLike {
  continuous: boolean
  interimResults: boolean
  lang: string
  maxAlternatives: number
  onstart: (() => void) | null
  onend: (() => void) | null
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null
  onresult: ((event: SpeechRecognitionEventLike) => void) | null
  start(): void
  stop(): void
  abort(): void
}

export type SpeechRecognitionCtor = new () => SpeechRecognitionLike

/**
 * Resolve the browser's SpeechRecognition constructor (Chrome/Edge expose the
 * webkit-prefixed one). Returns null outside a browser or in unsupported
 * browsers — callers show their own "not supported" message.
 */
export function getSpeechRecognitionCtor(): SpeechRecognitionCtor | null {
  if (typeof window === "undefined") return null
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor
    webkitSpeechRecognition?: SpeechRecognitionCtor
  }
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null
}
