"use client"

// "Test Priya" — public text demo island for the marketing site.
// Consent is REQUIRED before the chat enables (the visitor explicitly
// acknowledges they are talking to an automated AI, not a human). Messages
// are capped client-side at 12 turns; the server independently rate-limits
// and re-validates everything (see app/api/demo/chat/route.ts).
import { useEffect, useRef, useState } from "react"
import Link from "next/link"
import { Info, SendHorizontal } from "lucide-react"

type ChatRole = "user" | "assistant"
type Msg = { role: ChatRole; content: string }

const LANGUAGES = [
  { value: "english", label: "English" },
  { value: "hindi", label: "हिन्दी" },
  { value: "telugu", label: "తెలుగు" },
]

// Keep the last 12 turns (a turn = one visitor message + one Priya reply).
const MAX_MESSAGES = 24

const CONSENT_TEXT =
  "I understand this is an automated AI demo, not a human, and I agree to this test conversation."

export default function DemoChat() {
  const [consent, setConsent] = useState(false)
  const [language, setLanguage] = useState("english")
  const [messages, setMessages] = useState<Msg[]>([])
  const [input, setInput] = useState("")
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<"limit" | "unavailable" | null>(null)
  const logRef = useRef<HTMLDivElement>(null)

  // Keep the newest message visible as the conversation grows.
  useEffect(() => {
    const el = logRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages, pending])

  const canSend = consent && !pending && input.trim().length > 0

  async function send() {
    const text = input.trim()
    if (!text || pending || !consent) return

    setError(null)
    setInput("")

    // Server accepts at most 10 history entries; send the most recent ones.
    const history = messages.slice(-10).map((m) => ({
      role: m.role === "assistant" ? ("model" as const) : ("user" as const),
      content: m.content,
    }))

    setMessages((prev) => [...prev, { role: "user" as const, content: text }].slice(-MAX_MESSAGES))
    setPending(true)

    try {
      const res = await fetch("/api/demo/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text, language, consent: true, history }),
      })

      if (res.status === 429) {
        setError("limit")
        return
      }

      const data = await res.json().catch(() => null)
      if (!res.ok || !data?.reply) {
        setError("unavailable")
        return
      }

      setMessages((prev) =>
        [...prev, { role: "assistant" as const, content: String(data.reply) }].slice(-MAX_MESSAGES)
      )
    } catch {
      setError("unavailable")
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="dmc-wrap">
      <div className="dmc-head">
        <span className="dmc-title">
          <span className="dmc-avatar" aria-hidden="true">
            P
          </span>
          Priya — AI loan agent
        </span>
        <label className="dmc-lang">
          Language
          <select
            value={language}
            onChange={(e) => setLanguage(e.target.value)}
            aria-label="Demo language"
          >
            {LANGUAGES.map((l) => (
              <option key={l.value} value={l.value}>
                {l.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <label className="dmc-consent">
        <input
          type="checkbox"
          checked={consent}
          onChange={(e) => setConsent(e.target.checked)}
        />
        <span>{CONSENT_TEXT}</span>
      </label>

      <div className="rg-glass dmc-card">
        <div className="dmc-log" ref={logRef} aria-live="polite" aria-label="Demo conversation">
          {messages.length === 0 && !pending && (
            <p className="dmc-empty">
              Tick the consent box above, then ask Priya anything about loans — EMI basics,
              documents, eligibility, process. She replies in the language you pick.
            </p>
          )}

          {messages.map((m, i) => (
            <div key={i} className={`dmc-msg ${m.role === "user" ? "dmc-user" : "dmc-ai"}`}>
              {m.role === "assistant" && (
                <span className="dmc-avatar" aria-hidden="true">
                  P
                </span>
              )}
              <div className="dmc-bubble">{m.content}</div>
            </div>
          ))}

          {pending && (
            <div className="dmc-msg dmc-ai">
              <span className="dmc-avatar" aria-hidden="true">
                P
              </span>
              <div className="dmc-bubble dmc-typing" aria-label="Priya is typing">
                <i />
                <i />
                <i />
              </div>
            </div>
          )}
        </div>

        {error && (
          <div className="dmc-alert" role="alert">
            <span>
              {error === "limit"
                ? "Demo limit reached — book a live demo instead."
                : "Demo is temporarily unavailable. Please try again in a moment."}
            </span>
            {error === "limit" && (
              <Link href="/demo">Book a Demo</Link>
            )}
          </div>
        )}

        <form
          className="dmc-inputrow"
          onSubmit={(e) => {
            e.preventDefault()
            send()
          }}
        >
          <input
            className="rgf-input dmc-input"
            type="text"
            value={input}
            maxLength={500}
            placeholder={consent ? "Type your question…" : "Accept the consent note above to start"}
            aria-label="Message Priya"
            disabled={!consent || pending}
            onChange={(e) => setInput(e.target.value)}
          />
          <button
            type="submit"
            className="dmc-send"
            disabled={!canSend}
            aria-label="Send message"
          >
            <SendHorizontal size={17} strokeWidth={2.1} />
          </button>
        </form>
      </div>

      <p className="dmc-disclosure">
        <Info size={13} strokeWidth={2} />
        <span>
          Simulated AI demo — Priya does not place real calls from this page. Replies are
          AI-generated and may not reflect what she would say on your configured scripts.
        </span>
      </p>
    </div>
  )
}
