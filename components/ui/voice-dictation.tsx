"use client"

import { useState, useEffect, useRef } from "react"
import { Mic, MicOff, Loader2 } from "lucide-react"

interface VoiceDictationProps {
  onTranscript: (text: string) => void
  disabled?: boolean
  size?: number
  className?: string
  style?: React.CSSProperties
  title?: string
  append?: boolean
  lang?: string // default "en-IN" (supports Indian English, Hindi, Telugu etc.)
}

export function VoiceDictation({
  onTranscript,
  disabled = false,
  size = 15,
  style = {},
  title = "Speak to type (Voice input)",
  append = true,
  lang = "en-IN",
}: VoiceDictationProps) {
  const [listening, setListening] = useState(false)
  const [supported, setSupported] = useState(true)
  const recognitionRef = useRef<any>(null)

  useEffect(() => {
    // Web Speech API check (standard or webkit prefixed)
    const SpeechRecognition =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition

    if (!SpeechRecognition) {
      setSupported(false)
      return
    }

    try {
      const recognition = new SpeechRecognition()
      recognition.continuous = false
      recognition.interimResults = false
      recognition.lang = lang

      recognition.onstart = () => {
        setListening(true)
      }

      recognition.onresult = (event: any) => {
        const transcript = event.results[0]?.[0]?.transcript
        if (transcript) {
          onTranscript(transcript)
        }
      }

      recognition.onerror = (event: any) => {
        console.warn("Speech recognition error:", event.error)
        setListening(false)
      }

      recognition.onend = () => {
        setListening(false)
      }

      recognitionRef.current = recognition
    } catch (e) {
      console.warn("Speech recognition init error:", e)
      setSupported(false)
    }

    return () => {
      if (recognitionRef.current) {
        try {
          recognitionRef.current.stop()
        } catch {}
      }
    }
  }, [lang, onTranscript])

  const toggleListening = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()

    if (!supported) {
      alert("Voice speech recognition is not supported in this browser. Please use Google Chrome or Microsoft Edge.")
      return
    }

    if (disabled || !recognitionRef.current) return

    if (listening) {
      try {
        recognitionRef.current.stop()
      } catch {}
      setListening(false)
    } else {
      try {
        recognitionRef.current.start()
        setListening(true)
      } catch (err) {
        console.warn("Could not start speech recognition:", err)
        setListening(false)
      }
    }
  }

  if (!supported) return null

  return (
    <button
      type="button"
      onClick={toggleListening}
      disabled={disabled}
      title={listening ? "Listening... click to stop" : title}
      aria-label={listening ? "Stop voice dictation" : "Start voice dictation"}
      style={{
        background: listening ? "rgba(239, 68, 68, 0.18)" : "transparent",
        border: listening ? "1px solid rgba(239, 68, 68, 0.5)" : "1px solid var(--border)",
        borderRadius: 8,
        width: 34,
        height: 34,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        cursor: disabled ? "not-allowed" : "pointer",
        color: listening ? "var(--accent-red)" : "var(--text-muted)",
        transition: "all 0.18s ease",
        flexShrink: 0,
        ...style,
      }}
      onMouseEnter={e => {
        if (!listening && !disabled) {
          e.currentTarget.style.color = "var(--accent-cyan)"
          e.currentTarget.style.borderColor = "var(--accent-cyan)"
        }
      }}
      onMouseLeave={e => {
        if (!listening) {
          e.currentTarget.style.color = "var(--text-muted)"
          e.currentTarget.style.borderColor = "var(--border)"
        }
      }}
    >
      {listening ? (
        <span style={{ position: "relative", display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
          <Mic size={size} strokeWidth={2.4} style={{ color: "#ef4444", animation: "pulse 1.2s infinite" }} />
          <span
            style={{
              position: "absolute",
              width: size + 10,
              height: size + 10,
              borderRadius: "50%",
              background: "rgba(239,68,68,0.25)",
              animation: "ping 1.5s cubic-bezier(0, 0, 0.2, 1) infinite",
            }}
          />
        </span>
      ) : (
        <Mic size={size} strokeWidth={1.9} />
      )}
    </button>
  )
}

export default VoiceDictation
