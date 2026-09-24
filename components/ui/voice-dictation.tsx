"use client"

import { useState, useRef, useEffect } from "react"
import { Mic, Loader2 } from "lucide-react"
import {
  type SpeechRecognitionLike,
  type SpeechRecognitionEventLike,
  type SpeechRecognitionErrorEventLike,
  getSpeechRecognitionCtor,
} from "@/lib/web-speech"

interface VoiceDictationProps {
  onTranscript: (text: string) => void
  disabled?: boolean
  size?: number
  className?: string
  style?: React.CSSProperties
  title?: string
  append?: boolean
  lang?: string // default "en-IN"
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
  const [initializing, setInitializing] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null)
  const onTranscriptRef = useRef(onTranscript)

  // Keep latest callback reference without tearing down recognition
  useEffect(() => {
    onTranscriptRef.current = onTranscript
  }, [onTranscript])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (recognitionRef.current) {
        try {
          recognitionRef.current.abort()
        } catch {}
      }
    }
  }, [])

  const startListening = async () => {
    const SpeechRecognition = getSpeechRecognitionCtor()

    if (!SpeechRecognition) {
      alert("Voice speech recognition is not supported in this browser. Please use Google Chrome or Microsoft Edge.")
      return
    }

    setInitializing(true)
    setErrorMessage(null)

    try {
      // 1. Explicitly prompt and ensure microphone permission
      if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
        // release the stream right away so recognition can take over
        stream.getTracks().forEach((track) => track.stop())
      }
    } catch (permErr) {
      console.warn("Microphone permission error:", permErr)
      setInitializing(false)
      alert("Microphone permission was denied. Please allow microphone access in your browser address bar and try again.")
      return
    }

    try {
      // Abort any previous instance
      if (recognitionRef.current) {
        try {
          recognitionRef.current.abort()
        } catch {}
      }

      const recognition = new SpeechRecognition()
      recognition.continuous = false
      recognition.interimResults = false
      recognition.lang = lang
      recognition.maxAlternatives = 1

      recognition.onstart = () => {
        setInitializing(false)
        setListening(true)
      }

      recognition.onresult = (event: SpeechRecognitionEventLike) => {
        const transcript = event.results[0]?.[0]?.transcript
        if (transcript && onTranscriptRef.current) {
          onTranscriptRef.current(transcript)
        }
      }

      recognition.onerror = (event: SpeechRecognitionErrorEventLike) => {
        console.warn("Speech recognition error:", event.error)
        setListening(false)
        setInitializing(false)
        if (event.error === "not-allowed" || event.error === "service-not-allowed") {
          alert("Microphone access is blocked. Please enable microphone permission for this site in your browser settings.")
        } else if (event.error === "no-speech") {
          // just silent timeout
        } else if (event.error === "network") {
          console.warn("Speech recognition network notice.")
        }
      }

      recognition.onend = () => {
        setListening(false)
        setInitializing(false)
      }

      recognitionRef.current = recognition
      recognition.start()
    } catch (err) {
      console.error("Failed to start SpeechRecognition:", err)
      setListening(false)
      setInitializing(false)
    }
  }

  const stopListening = () => {
    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop()
      } catch {}
    }
    setListening(false)
    setInitializing(false)
  }

  const toggleListening = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()

    if (disabled) return

    if (listening) {
      stopListening()
    } else {
      startListening()
    }
  }

  return (
    <button
      type="button"
      onClick={toggleListening}
      disabled={disabled || initializing}
      title={listening ? "Listening... speak now (click to stop)" : initializing ? "Accessing microphone..." : title}
      aria-label={listening ? "Stop voice dictation" : "Start voice dictation"}
      style={{
        background: listening ? "rgba(239, 68, 68, 0.22)" : initializing ? "rgba(6, 182, 212, 0.15)" : "transparent",
        border: listening ? "1.5px solid #ef4444" : initializing ? "1px solid var(--accent-cyan)" : "1px solid var(--border)",
        borderRadius: 8,
        width: 34,
        height: 34,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        cursor: disabled ? "not-allowed" : "pointer",
        color: listening ? "#ef4444" : initializing ? "var(--accent-cyan)" : "var(--text-muted)",
        transition: "all 0.18s ease",
        flexShrink: 0,
        position: "relative",
        boxShadow: listening ? "0 0 12px rgba(239, 68, 68, 0.45)" : "none",
        ...style,
      }}
      onMouseEnter={(e) => {
        if (!listening && !disabled && !initializing) {
          e.currentTarget.style.color = "var(--accent-cyan)"
          e.currentTarget.style.borderColor = "var(--accent-cyan)"
        }
      }}
      onMouseLeave={(e) => {
        if (!listening && !initializing) {
          e.currentTarget.style.color = "var(--text-muted)"
          e.currentTarget.style.borderColor = "var(--border)"
        }
      }}
    >
      {initializing ? (
        <Loader2 size={size} className="animate-spin" style={{ color: "var(--accent-cyan)" }} />
      ) : listening ? (
        <span style={{ position: "relative", display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
          <Mic size={size} strokeWidth={2.6} style={{ color: "#ef4444" }} />
          <span
            style={{
              position: "absolute",
              width: size + 12,
              height: size + 12,
              borderRadius: "50%",
              background: "rgba(239, 68, 68, 0.35)",
              animation: "ping 1.2s cubic-bezier(0, 0, 0.2, 1) infinite",
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
