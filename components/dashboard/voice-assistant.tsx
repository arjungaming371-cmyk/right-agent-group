"use client"

import React, { useState, useEffect, useRef, useCallback } from "react"
import {
  Mic,
  MicOff,
  Volume2,
  VolumeX,
  Sparkles,
  X,
  RotateCcw,
  Square,
  Bot,
  User,
  Radio,
  Send,
  Headphones,
  Check,
  ShieldCheck,
  ChevronRight,
  Minimize2,
  Maximize2,
  Zap,
  Play,
  CheckCircle2,
  Sliders,
  SlidersHorizontal,
  ChevronDown,
  ChevronUp,
  History,
  Plus,
  Trash2,
  Clock,
  MessageSquare,
  Loader2,
} from "lucide-react"
import { useToast } from "@/components/ui/toast"

export type VoiceAssistantLanguage = "english" | "telugu" | "hindi"

export interface ChatSummary {
  id: string
  title: string
  created_at: string
  updated_at: string
}

function timeAgoShort(dateStr: string) {
  if (!dateStr) return "now"
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return "just now"
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  if (days === 1) return "yesterday"
  return `${days}d ago`
}

const LANG_CONFIG: Record<VoiceAssistantLanguage, { label: string; bcp47: string; name: string; tag: string }> = {
  english: { label: "English", bcp47: "en-IN", name: "Priya (Indian English)", tag: "EN-IN" },
  telugu:  { label: "తెలుగు",   bcp47: "te-IN", name: "ప్రియ (Telugu)", tag: "TE-IN" },
  hindi:   { label: "हिंदी",    bcp47: "hi-IN", name: "प्रिया (Hindi)", tag: "HI-IN" },
}

const QUICK_PROMPTS: Record<VoiceAssistantLanguage, { title: string; query: string; icon: string }[]> = {
  english: [
    { title: "Today's Pipeline", query: "How many leads do we have today and what is our pipeline value?", icon: "📊" },
    { title: "Escalations Check", query: "Are there any customer escalations or complaints in the last 24 hours?", icon: "⚠️" },
    { title: "Home Loan Rates", query: "What are our current home loan interest rates and partner banks?", icon: "🏠" },
    { title: "Top Prospects", query: "Show me qualified leads interested in personal and business loans", icon: "⭐" },
  ],
  telugu: [
    { title: "ఈ రోజు లీడ్స్", query: "ఈ రోజు ఎన్ని కొత్త లీడ్స్ వచ్చాయి? పైప్‌లైన్ ఎంత?", icon: "📊" },
    { title: "హోమ్ లోన్ రేట్లు", query: "హోమ్ లోన్ వడ్డీ రేట్లు ఎంత ఉన్నాయి? బ్యాంకులు ఏమిటి?", icon: "🏠" },
    { title: "పెండింగ్ లోన్లు", query: "ఎవరివైనా లోన్ అప్లికేషన్లు పెండింగ్‌లో ఉన్నాయా?", icon: "⏳" },
  ],
  hindi: [
    { title: "आज के लीड्स", query: "आज कितने नए लीड्स आए हैं और टोटल पाइपलाइन कितनी है?", icon: "📊" },
    { title: "होम लोन रेट्स", query: "वर्तमान होम लोन ब्याज दरें और बैंक पार्टनर्स क्या हैं?", icon: "🏠" },
    { title: "कस्टमर एस्केलेशन", query: "क्या कोई तत्काल कस्टमर एस्केलेशन या शिकायत है?", icon: "⚠️" },
  ],
}

interface Message {
  role: "user" | "assistant"
  text: string
  actionProposal?: any
  timestamp: string
}

interface VoiceAssistantProps {
  isOpen: boolean
  onClose: () => void
  userEmail?: string
  role?: string
}

function cleanMarkdownForSpeech(text: string): string {
  return text
    .replace(/```action:proposal[\s\S]*?```/g, "")
    .replace(/```[\s\S]*?```/g, "")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/#{1,6}\s+/g, "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/_([^_]+)_/g, "$1")
    .replace(/^\s*[-*+]\s+/gm, "")
    .replace(/^\s*\d+\.\s+/gm, "")
    .replace(/^\s*>\s+/gm, "")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/\n{2,}/g, ". ")
    .replace(/\n/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim()
}

// Client-side Web Audio synthesis chimes (0 external files needed)
function playAudioChime(type: "listen_start" | "listen_stop" | "reply_ready") {
  try {
    const AudioCtx = window.AudioContext || (window as any).webkitAudioContext
    if (!AudioCtx) return
    const ctx = new AudioCtx()
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.connect(gain)
    gain.connect(ctx.destination)

    if (type === "listen_start") {
      osc.type = "sine"
      osc.frequency.setValueAtTime(440, ctx.currentTime)
      osc.frequency.exponentialRampToValueAtTime(880, ctx.currentTime + 0.12)
      gain.gain.setValueAtTime(0.06, ctx.currentTime)
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.14)
      osc.start(ctx.currentTime)
      osc.stop(ctx.currentTime + 0.14)
    } else if (type === "reply_ready") {
      osc.type = "sine"
      osc.frequency.setValueAtTime(740, ctx.currentTime)
      osc.frequency.exponentialRampToValueAtTime(554.37, ctx.currentTime + 0.15)
      gain.gain.setValueAtTime(0.06, ctx.currentTime)
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.16)
      osc.start(ctx.currentTime)
      osc.stop(ctx.currentTime + 0.16)
    }
  } catch {}
}

export default function VoiceAssistant({
  isOpen,
  onClose,
  userEmail = "",
  role = "agent",
}: VoiceAssistantProps) {
  const toast = useToast()
  const [state, setState] = useState<"idle" | "listening" | "thinking" | "speaking">("idle")
  const [language, setLanguage] = useState<VoiceAssistantLanguage>("english")
  const [continuousMode, setContinuousMode] = useState(true)
  const [muted, setMuted] = useState(false)
  const [isMinimized, setIsMinimized] = useState(false)
  const [userTranscript, setUserTranscript] = useState("")
  const [messages, setMessages] = useState<Message[]>([
    {
      role: "assistant",
      text: "Hello! I am Priya, your executive personal voice assistant. I can query real-time leads, track loan pipeline status, check escalations, or execute CRM actions. What can I do for you today?",
      timestamp: "Just now",
    },
  ])
  const [textInput, setTextInput] = useState("")
  const [showHistory, setShowHistory] = useState(false)
  const [executingAction, setExecutingAction] = useState(false)
  const [actionDone, setActionDone] = useState(false)

  // Persistent Chat History state
  const [chatId, setChatId] = useState<string | null>(null)
  const [chats, setChats] = useState<ChatSummary[]>([])
  const [chatsLoading, setChatsLoading] = useState(false)
  const [showHistoryDrawer, setShowHistoryDrawer] = useState(false)
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const [playingMsgIndex, setPlayingMsgIndex] = useState<number | null>(null)
  const [activeChatTitle, setActiveChatTitle] = useState<string>("")
  const [loadingChat, setLoadingChat] = useState(false)

  const recognitionRef = useRef<any>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const audioUrlRef = useRef<string | null>(null)
  const isListeningRef = useRef(false)
  const abortControllerRef = useRef<AbortController | null>(null)
  const scrollEndRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const animFrameRef = useRef<number | null>(null)

  // Load past chats
  const loadChats = useCallback(async () => {
    setChatsLoading(true)
    try {
      const res = await fetch("/api/assistant/chats")
      if (res.ok) {
        const data = await res.json()
        setChats(data.chats || [])
      }
    } catch (e) {
      console.warn("Failed to load past chats:", e)
    } finally {
      setChatsLoading(false)
    }
  }, [])

  // Load chats when assistant opens
  useEffect(() => {
    if (isOpen) {
      loadChats()
    }
  }, [isOpen, loadChats])

  // Scroll transcript when new message arrives
  useEffect(() => {
    if (showHistory) {
      scrollEndRef.current?.scrollIntoView({ behavior: "smooth" })
    }
  }, [messages, showHistory])

  // Cleanup on close or unmount
  useEffect(() => {
    if (!isOpen) {
      stopAll()
    }
  }, [isOpen])

  function stopAll() {
    stopListening()
    stopSpeaking()
    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
      abortControllerRef.current = null
    }
    setState("idle")
  }

  function stopSpeaking() {
    if (audioRef.current) {
      audioRef.current.pause()
      audioRef.current.currentTime = 0
      audioRef.current = null
    }
    if (audioUrlRef.current) {
      URL.revokeObjectURL(audioUrlRef.current)
      audioUrlRef.current = null
    }
    if (typeof window !== "undefined" && window.speechSynthesis) {
      window.speechSynthesis.cancel()
    }
    setPlayingMsgIndex(null)
    if (state === "speaking") {
      setState("idle")
    }
  }

  function startNewChat() {
    stopAll()
    setChatId(null)
    setActiveChatTitle("")
    setMessages([
      {
        role: "assistant",
        text: "Hello! I am Priya, your executive personal voice assistant. I can query real-time leads, track loan pipeline status, check escalations, or execute CRM actions. What can I do for you today?",
        timestamp: "Just now",
      },
    ])
    setShowHistoryDrawer(false)
    setActionDone(false)
    toast.info("Started new voice session")
  }

  async function openChat(c: ChatSummary) {
    stopAll()
    setChatId(c.id)
    setActiveChatTitle(c.title)
    setShowHistoryDrawer(false)
    setShowHistory(true)
    setLoadingChat(true)
    setActionDone(false)
    try {
      const res = await fetch(`/api/assistant/chats/${c.id}`)
      if (!res.ok) throw new Error("Failed to load chat")
      const data = await res.json()
      const loaded: Message[] = (data.messages || []).map((m: any) => {
        let actionProposal = null
        const proposalMatch = m.content.match(/```(?:action:proposal|json:action|action)\s*([\s\S]*?)\s*```/)
        if (proposalMatch) {
          try {
            actionProposal = JSON.parse(proposalMatch[1])
          } catch {}
        }
        return {
          role: m.role as "user" | "assistant",
          text: m.content,
          actionProposal,
          timestamp: m.created_at
            ? new Date(m.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
            : "Earlier",
        }
      })
      setMessages(
        loaded.length
          ? loaded
          : [
              {
                role: "assistant",
                text: `Loaded conversation: "${c.title}". Ask Priya anything to continue!`,
                timestamp: "Just now",
              },
            ]
      )
      toast.info(`Loaded: ${c.title}`)
    } catch {
      toast.error("Failed to load chat messages")
    } finally {
      setLoadingChat(false)
    }
  }

  async function deleteChat(id: string, e?: React.MouseEvent) {
    if (e) e.stopPropagation()
    setChats((prev) => prev.filter((c) => c.id !== id))
    setConfirmDeleteId(null)
    if (chatId === id) {
      startNewChat()
    }
    try {
      await fetch(`/api/assistant/chats/${id}`, { method: "DELETE" })
      toast.success("Conversation deleted")
    } catch {
      toast.error("Failed to delete chat")
    }
  }

  function handleReplayAudio(text: string, msgIndex: number) {
    if (playingMsgIndex === msgIndex && state === "speaking") {
      stopSpeaking()
      setPlayingMsgIndex(null)
      return
    }
    stopSpeaking()
    setPlayingMsgIndex(msgIndex)
    const spokenText = cleanMarkdownForSpeech(text)
    speakResponse(spokenText)
  }

  function stopListening() {
    isListeningRef.current = false
    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop()
      } catch {}
      recognitionRef.current = null
    }
    if (state === "listening") {
      setState("idle")
    }
  }

  // Canvas 60fps organic wave visualizer animation
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext("2d")
    if (!ctx) return

    let step = 0

    function render() {
      if (!canvas || !ctx) return
      const w = canvas.width
      const h = canvas.height
      ctx.clearRect(0, 0, w, h)

      step += 0.045

      // Determine wave intensity based on state
      let amp = 10
      let speed = 1.0
      let colors = ["rgba(99, 102, 241, 0.35)", "rgba(56, 189, 248, 0.45)", "rgba(168, 85, 247, 0.4)"]

      if (state === "listening") {
        amp = 36
        speed = 2.2
        colors = ["rgba(56, 189, 248, 0.7)", "rgba(14, 165, 233, 0.8)", "rgba(99, 102, 241, 0.6)"]
      } else if (state === "speaking") {
        amp = 42
        speed = 2.4
        colors = ["rgba(236, 72, 153, 0.75)", "rgba(168, 85, 247, 0.85)", "rgba(99, 102, 241, 0.7)"]
      } else if (state === "thinking") {
        amp = 18
        speed = 1.8
        colors = ["rgba(250, 204, 21, 0.6)", "rgba(245, 158, 11, 0.7)", "rgba(234, 88, 12, 0.5)"]
      }

      // Draw 3 layered harmonic waves
      for (let layer = 0; layer < 3; layer++) {
        ctx.beginPath()
        ctx.strokeStyle = colors[layer]
        ctx.lineWidth = layer === 1 ? 2.5 : 1.8

        const layerAmp = amp * (0.8 + layer * 0.25)
        const freq = 0.014 + layer * 0.005
        const phase = step * speed + layer * 1.57

        for (let x = 0; x < w; x += 3) {
          // Windowing envelope so wave tapers to 0 at edges
          const envelope = Math.sin((x / w) * Math.PI)
          const y = h / 2 + Math.sin(x * freq + phase) * layerAmp * envelope
          if (x === 0) ctx.moveTo(x, y)
          else ctx.lineTo(x, y)
        }
        ctx.stroke()
      }

      animFrameRef.current = requestAnimationFrame(render)
    }

    render()

    return () => {
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current)
    }
  }, [state])

  // Speech-to-Text handler
  const startListening = useCallback(async () => {
    stopSpeaking()
    playAudioChime("listen_start")

    const SpeechRecognition =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition

    if (!SpeechRecognition) {
      toast.error("Speech recognition is not supported in this browser. Please use Chrome or Edge.")
      return
    }

    try {
      if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
        stream.getTracks().forEach((t) => t.stop())
      }
    } catch {
      toast.error("Microphone access was denied. Please allow microphone permissions.")
      return
    }

    try {
      if (recognitionRef.current) {
        try { recognitionRef.current.abort() } catch {}
      }

      const recognition = new SpeechRecognition()
      recognition.continuous = false
      recognition.interimResults = true
      recognition.lang = LANG_CONFIG[language].bcp47
      recognition.maxAlternatives = 1

      recognition.onstart = () => {
        isListeningRef.current = true
        setState("listening")
        setUserTranscript("")
      }

      recognition.onresult = (event: any) => {
        let interim = ""
        let final = ""
        for (let i = event.resultIndex; i < event.results.length; ++i) {
          const trans = event.results[i][0].transcript
          if (event.results[i].isFinal) final += trans
          else interim += trans
        }
        const currentText = final || interim
        setUserTranscript(currentText)
      }

      recognition.onerror = (event: any) => {
        if (event.error !== "no-speech" && event.error !== "aborted") {
          console.warn("Speech recognition error:", event.error)
        }
        setState("idle")
      }

      recognition.onend = () => {
        isListeningRef.current = false
        setUserTranscript((latestText) => {
          if (latestText && latestText.trim().length > 1) {
            handleSendMessage(latestText.trim())
            return ""
          } else {
            setState("idle")
            return ""
          }
        })
      }

      recognitionRef.current = recognition
      recognition.start()
    } catch (err: any) {
      console.error("Failed to start speech recognition:", err)
      setState("idle")
    }
  }, [language, toast])

  // Play audio speech output using /api/tts or fallback
  const speakResponse = useCallback(async (spokenText: string) => {
    if (muted || !spokenText.trim()) {
      setState("idle")
      if (continuousMode && isOpen) {
        setTimeout(() => startListening(), 600)
      }
      return
    }

    playAudioChime("reply_ready")
    setState("speaking")

    try {
      const ttsRes = await fetch("/api/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: spokenText.slice(0, 480),
          language: language,
        }),
      })

      if (ttsRes.ok) {
        const audioBlob = await ttsRes.blob()
        const audioUrl = URL.createObjectURL(audioBlob)
        audioUrlRef.current = audioUrl
        const audio = new Audio(audioUrl)
        audioRef.current = audio

        audio.onended = () => {
          stopSpeaking()
          if (continuousMode && isOpen) {
            setTimeout(() => startListening(), 500)
          }
        }

        audio.onerror = () => {
          fallbackSpeechSynthesis(spokenText)
        }

        await audio.play()
        return
      }
    } catch (e: any) {
      console.warn("TTS endpoint failed, using browser speech synthesis fallback:", e.message)
    }

    fallbackSpeechSynthesis(spokenText)
  }, [muted, language, continuousMode, isOpen, startListening])

  function fallbackSpeechSynthesis(text: string) {
    if (typeof window === "undefined" || !window.speechSynthesis) {
      setState("idle")
      return
    }

    window.speechSynthesis.cancel()
    const utterance = new SpeechSynthesisUtterance(text.slice(0, 320))
    utterance.lang = LANG_CONFIG[language].bcp47
    utterance.rate = 1.02

    utterance.onend = () => {
      setState("idle")
      if (continuousMode && isOpen) {
        setTimeout(() => startListening(), 500)
      }
    }

    utterance.onerror = () => {
      setState("idle")
    }

    window.speechSynthesis.speak(utterance)
  }

  // Query assistant
  async function handleSendMessage(text: string) {
    if (!text.trim()) return

    stopSpeaking()
    setState("thinking")

    const now = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    const userMsg: Message = { role: "user", text, timestamp: now }
    setMessages((prev) => [...prev, userMsg])

    try {
      abortControllerRef.current = new AbortController()

      // Ensure an active chat session exists so messages persist to database
      let activeChatId = chatId
      if (!activeChatId) {
        try {
          const chatRes = await fetch("/api/assistant/chats", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ title: text.slice(0, 55) }),
          })
          if (chatRes.ok) {
            const chatData = await chatRes.json()
            if (chatData?.chat?.id) {
              activeChatId = chatData.chat.id
              setChatId(activeChatId)
              setActiveChatTitle(chatData.chat.title || text.slice(0, 55))
            }
          }
        } catch (e) {
          console.warn("Failed to create assistant chat session:", e)
        }
      }

      const res = await fetch("/api/assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: text,
          history: messages.slice(-6).map((m) => ({ role: m.role, content: m.text })),
          chatId: activeChatId,
        }),
        signal: abortControllerRef.current.signal,
      })

      if (!res.ok) throw new Error(`HTTP ${res.status}`)

      const reader = res.body?.getReader()
      const decoder = new TextDecoder()
      let fullReply = ""

      if (reader) {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          fullReply += decoder.decode(value, { stream: true })
        }
      }

      let actionProposal = null
      const proposalMatch = fullReply.match(/```action:proposal\s*([\s\S]*?)\s*```/)
      if (proposalMatch) {
        try {
          actionProposal = JSON.parse(proposalMatch[1])
        } catch {}
      }

      const assistantMsg: Message = {
        role: "assistant",
        text: fullReply,
        actionProposal,
        timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      }

      setMessages((prev) => [...prev, assistantMsg])

      // Refresh chat list in background to reflect updated titles & timestamps
      loadChats()

      const spokenText = cleanMarkdownForSpeech(fullReply)
      speakResponse(spokenText)
    } catch (e: any) {
      if (e.name !== "AbortError") {
        console.error("Voice assistant error:", e)
        const errMsg = "I encountered a network issue while retrieving CRM data. Please ask me again."
        setMessages((prev) => [
          ...prev,
          {
            role: "assistant",
            text: errMsg,
            timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
          },
        ])
        speakResponse(errMsg)
      } else {
        setState("idle")
      }
    }
  }

  // Approve action proposal
  async function executeAction(proposal: any) {
    if (!proposal) return
    setExecutingAction(true)
    try {
      const res = await fetch("/api/assistant/action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          actionType: proposal.type,
          payload: proposal.payload,
        }),
      })

      const data = await res.json()
      if (res.ok) {
        setActionDone(true)
        toast.success(data.message || "Command executed successfully!")
        window.dispatchEvent(new CustomEvent("rag:refresh"))
        speakResponse("Done. The action has been executed and your dashboard is updated.")
      } else {
        toast.error(data.error || "Execution failed")
      }
    } catch {
      toast.error("Network error while executing action")
    } finally {
      setExecutingAction(false)
    }
  }

  if (!isOpen) return null

  const isListening = state === "listening"
  const isThinking = state === "thinking"
  const isSpeaking = state === "speaking"
  const isIdle = state === "idle"

  const latestAssistant = messages.filter((m) => m.role === "assistant").slice(-1)[0]
  const pendingProposal = latestAssistant?.actionProposal

  // MINIMIZED FLOATING PILL MODE
  if (isMinimized) {
    return (
      <div
        style={{
          position: "fixed",
          bottom: 24,
          right: 24,
          zIndex: 9999,
          display: "flex",
          alignItems: "center",
          gap: 12,
          padding: "10px 16px",
          borderRadius: 40,
          background: "rgba(15, 23, 42, 0.85)",
          backdropFilter: "blur(16px)",
          border: `1.5px solid ${isListening ? "rgba(56, 189, 248, 0.6)" : isSpeaking ? "rgba(168, 85, 247, 0.6)" : "rgba(99, 102, 241, 0.4)"}`,
          boxShadow: "0 12px 35px -6px rgba(0,0,0,0.6), 0 0 20px rgba(99, 102, 241, 0.3)",
          animation: "fadeIn 0.2s ease-out",
        }}
      >
        {/* Pulsing Mini Orb */}
        <div
          onClick={() => {
            if (isListening) stopListening()
            else if (isSpeaking) stopSpeaking()
            else startListening()
          }}
          style={{
            width: 38,
            height: 38,
            borderRadius: "50%",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: isListening
              ? "radial-gradient(circle, #38bdf8 0%, #0284c7 100%)"
              : isSpeaking
              ? "radial-gradient(circle, #ec4899 0%, #9333ea 100%)"
              : isThinking
              ? "radial-gradient(circle, #facc15 0%, #ea580c 100%)"
              : "radial-gradient(circle, #818cf8 0%, #4f46e5 100%)",
            boxShadow: `0 0 14px ${isListening ? "rgba(56,189,248,0.7)" : isSpeaking ? "rgba(168,85,247,0.7)" : "rgba(99,102,241,0.5)"}`,
            transition: "all 0.3s ease",
          }}
          title={isListening ? "Listening... click to pause" : isSpeaking ? "Speaking... click to stop" : "Click to speak"}
        >
          {isListening ? (
            <div className="flex gap-0.5 items-center">
              <span className="w-1 h-3 bg-white rounded-full animate-pulse" />
              <span className="w-1 h-5 bg-white rounded-full animate-pulse delay-75" />
              <span className="w-1 h-3 bg-white rounded-full animate-pulse delay-150" />
            </div>
          ) : isSpeaking ? (
            <Volume2 size={18} color="#fff" className="animate-pulse" />
          ) : isThinking ? (
            <Sparkles size={18} color="#fff" className="animate-spin" />
          ) : (
            <Mic size={18} color="#fff" />
          )}
        </div>

        {/* Status Text in Pill */}
        <div style={{ maxWidth: 220, overflow: "hidden" }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: "#fff", whiteSpace: "nowrap", textOverflow: "ellipsis", overflow: "hidden" }}>
            {isListening ? "Listening..." : isSpeaking ? "Priya speaking..." : isThinking ? "Thinking..." : "Priya AI Ready"}
          </div>
          <div style={{ fontSize: 11, color: "rgba(255,255,255,0.6)", whiteSpace: "nowrap", textOverflow: "ellipsis", overflow: "hidden" }}>
            {userTranscript || (isSpeaking ? "Tap to interrupt" : "Click orb to speak")}
          </div>
        </div>

        {/* Maximize & Close buttons */}
        <div style={{ display: "flex", alignItems: "center", gap: 6, borderLeft: "1px solid rgba(255,255,255,0.15)", paddingLeft: 8 }}>
          <button
            onClick={() => setIsMinimized(false)}
            title="Expand Voice Assistant"
            style={{ background: "transparent", border: "none", color: "#a5b4fc", cursor: "pointer", padding: 4 }}
          >
            <Maximize2 size={16} />
          </button>
          <button
            onClick={() => {
              stopAll()
              onClose()
            }}
            title="Close Assistant"
            style={{ background: "transparent", border: "none", color: "rgba(255,255,255,0.5)", cursor: "pointer", padding: 4 }}
          >
            <X size={16} />
          </button>
        </div>
      </div>
    )
  }

  // FULL IMMERSIVE STAGE MODE
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9999,
        background: "radial-gradient(circle at 50% 30%, rgba(17, 24, 39, 0.94) 0%, rgba(3, 7, 18, 0.98) 100%)",
        backdropFilter: "blur(24px)",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "20px 24px",
        color: "var(--text-primary)",
        animation: "fadeIn 0.25s cubic-bezier(0.16, 1, 0.3, 1)",
      }}
    >
      {/* Top Header Bar */}
      <div
        style={{
          width: "100%",
          maxWidth: 960,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          zIndex: 20,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <div
            style={{
              width: 42,
              height: 42,
              borderRadius: 14,
              background: "linear-gradient(135deg, #6366f1 0%, #a855f7 50%, #ec4899 100%)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              boxShadow: "0 0 25px rgba(168, 85, 247, 0.55)",
            }}
          >
            <Sparkles size={22} color="#ffffff" />
          </div>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 17, fontWeight: 800, letterSpacing: "-0.02em", color: "#ffffff" }}>
                Priya AI Voice Assistant
              </span>
              <span
                style={{
                  fontSize: 10,
                  fontWeight: 700,
                  letterSpacing: "0.05em",
                  padding: "2px 8px",
                  borderRadius: 12,
                  background: "rgba(34, 197, 94, 0.18)",
                  border: "1px solid rgba(34, 197, 94, 0.4)",
                  color: "#4ade80",
                  textTransform: "uppercase",
                }}
              >
                Online
              </span>
            </div>
            <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 1 }}>
              Personal Executive Financial & Operations Intelligence
            </div>
          </div>
        </div>

        {/* Top Controls */}
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {/* Language Selector */}
          <div style={{ position: "relative" }}>
            <select
              value={language}
              onChange={(e) => {
                setLanguage(e.target.value as VoiceAssistantLanguage)
                stopAll()
              }}
              style={{
                background: "rgba(255,255,255,0.07)",
                border: "1px solid rgba(255,255,255,0.15)",
                borderRadius: 10,
                padding: "7px 12px",
                color: "#ffffff",
                fontSize: 13,
                fontWeight: 600,
                cursor: "pointer",
                outline: "none",
              }}
            >
              <option value="english" style={{ background: "#0f172a" }}>English (India)</option>
              <option value="telugu" style={{ background: "#0f172a" }}>తెలుగు (Telugu)</option>
              <option value="hindi" style={{ background: "#0f172a" }}>हिंदी (Hindi)</option>
            </select>
          </div>

          {/* Hands-Free Mode Toggle */}
          <button
            onClick={() => setContinuousMode((prev) => !prev)}
            title={continuousMode ? "Hands-Free continuous conversation active" : "Push-to-talk mode active"}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 7,
              background: continuousMode ? "rgba(99, 102, 241, 0.22)" : "rgba(255,255,255,0.06)",
              border: `1px solid ${continuousMode ? "rgba(129, 140, 248, 0.5)" : "rgba(255,255,255,0.12)"}`,
              borderRadius: 10,
              padding: "7px 14px",
              color: continuousMode ? "#a5b4fc" : "var(--text-muted)",
              fontSize: 12.5,
              fontWeight: 600,
              cursor: "pointer",
              transition: "all 0.2s ease",
            }}
          >
            <Radio size={14} className={continuousMode ? "animate-pulse" : ""} />
            <span className="hidden sm:inline">Hands-Free</span>
          </button>

          {/* Mute Voice Toggle */}
          <button
            onClick={() => {
              if (!muted) stopSpeaking()
              setMuted((prev) => !prev)
            }}
            title={muted ? "Unmute Spoken Audio" : "Mute Spoken Audio"}
            style={{
              width: 38,
              height: 38,
              borderRadius: 10,
              background: muted ? "rgba(239, 68, 68, 0.2)" : "rgba(255,255,255,0.06)",
              border: `1px solid ${muted ? "rgba(239, 68, 68, 0.4)" : "rgba(255,255,255,0.12)"}`,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: muted ? "#f87171" : "#ffffff",
              cursor: "pointer",
            }}
          >
            {muted ? <VolumeX size={17} /> : <Volume2 size={17} />}
          </button>

          {/* New Chat Button */}
          <button
            onClick={startNewChat}
            title="Start New Voice Chat Session"
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              background: "linear-gradient(135deg, rgba(99, 102, 241, 0.25), rgba(168, 85, 247, 0.25))",
              border: "1px solid rgba(129, 140, 248, 0.4)",
              borderRadius: 10,
              padding: "7px 12px",
              color: "#ffffff",
              fontSize: 12.5,
              fontWeight: 600,
              cursor: "pointer",
              transition: "all 0.2s ease",
            }}
          >
            <Plus size={14} />
            <span className="hidden sm:inline">New Chat</span>
          </button>

          {/* History Drawer Toggle */}
          <button
            onClick={() => {
              setShowHistoryDrawer((prev) => !prev)
              if (!showHistoryDrawer) loadChats()
            }}
            title="View Past Voice Conversations"
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              borderRadius: 10,
              padding: "7px 12px",
              background: showHistoryDrawer ? "rgba(99, 102, 241, 0.35)" : "rgba(255, 255, 255, 0.08)",
              border: `1px solid ${showHistoryDrawer ? "rgba(129, 140, 248, 0.6)" : "rgba(255, 255, 255, 0.12)"}`,
              color: showHistoryDrawer ? "#a5b4fc" : "#ffffff",
              fontSize: 12.5,
              fontWeight: 600,
              cursor: "pointer",
              transition: "all 0.2s ease",
            }}
          >
            <History size={14} />
            <span className="hidden sm:inline">History</span>
            {chats.length > 0 && (
              <span
                style={{
                  fontSize: 10,
                  fontWeight: 700,
                  padding: "1px 6px",
                  borderRadius: 8,
                  background: "rgba(99, 102, 241, 0.4)",
                  color: "#c7d2fe",
                  marginLeft: 2,
                }}
              >
                {chats.length}
              </span>
            )}
          </button>

          {/* Transcript Toggle */}
          <button
            onClick={() => setShowHistory((prev) => !prev)}
            title="Toggle Transcript Display"
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              borderRadius: 10,
              padding: "7px 12px",
              background: showHistory ? "rgba(255,255,255,0.18)" : "rgba(255,255,255,0.06)",
              border: "1px solid rgba(255,255,255,0.12)",
              color: "#ffffff",
              fontSize: 12.5,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            <MessageSquare size={14} />
            <span className="hidden sm:inline">{showHistory ? "Hide Transcript" : "Transcript"}</span>
          </button>

          {/* Minimize to Floating Bubble */}
          <button
            onClick={() => setIsMinimized(true)}
            title="Minimize to Floating Voice Bubble"
            style={{
              width: 38,
              height: 38,
              borderRadius: 10,
              background: "rgba(255,255,255,0.06)",
              border: "1px solid rgba(255,255,255,0.12)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "var(--text-secondary)",
              cursor: "pointer",
            }}
          >
            <Minimize2 size={16} />
          </button>

          {/* Close */}
          <button
            onClick={() => {
              stopAll()
              onClose()
            }}
            title="Close (Esc)"
            style={{
              width: 38,
              height: 38,
              borderRadius: 10,
              background: "rgba(255,255,255,0.06)",
              border: "1px solid rgba(255,255,255,0.12)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "var(--text-secondary)",
              cursor: "pointer",
            }}
          >
            <X size={18} />
          </button>
        </div>
      </div>

      {/* Center Interactive Stage */}
      <div
        style={{
          flex: 1,
          width: "100%",
          maxWidth: 880,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          position: "relative",
          margin: "10px 0",
        }}
      >
        {/* Active Session Indicator Pill */}
        {activeChatTitle && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "4px 14px",
              borderRadius: 20,
              background: "rgba(99, 102, 241, 0.15)",
              border: "1px solid rgba(99, 102, 241, 0.35)",
              fontSize: 12,
              color: "#c7d2fe",
              marginBottom: 10,
              zIndex: 10,
            }}
          >
            <span style={{ width: 7, height: 7, borderRadius: "50%", background: "#4ade80", boxShadow: "0 0 8px #4ade80" }} />
            <span>Active Session: <strong style={{ color: "#ffffff" }}>{activeChatTitle}</strong></span>
            <button
              onClick={startNewChat}
              style={{
                background: "none",
                border: "none",
                color: "#a5b4fc",
                cursor: "pointer",
                fontSize: 11.5,
                fontWeight: 600,
                textDecoration: "underline",
                marginLeft: 4,
              }}
            >
              New Chat
            </button>
          </div>
        )}

        {/* Dynamic Canvas Soundwave Ribbons (Placed across center) */}
        <canvas
          ref={canvasRef}
          width={800}
          height={180}
          style={{
            position: "absolute",
            top: "50%",
            left: "50%",
            transform: "translate(-50%, -60%)",
            pointerEvents: "none",
            zIndex: 1,
            opacity: isListening ? 0.9 : isSpeaking ? 1.0 : isThinking ? 0.6 : 0.35,
            transition: "opacity 0.4s ease",
          }}
        />

        {/* 3D Bioluminescent Voice Orb */}
        <div
          onClick={() => {
            if (isListening) stopListening()
            else if (isSpeaking) stopSpeaking()
            else startListening()
          }}
          style={{
            position: "relative",
            width: 210,
            height: 210,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            cursor: "pointer",
            userSelect: "none",
            zIndex: 5,
            marginBottom: 24,
          }}
          title={isListening ? "Listening... click to pause" : isSpeaking ? "Speaking... click to interrupt" : "Click to speak"}
        >
          {/* Outer Pulsing Shockwave Ring */}
          <div
            style={{
              position: "absolute",
              inset: isListening ? -26 : isSpeaking ? -18 : -10,
              borderRadius: "50%",
              border: `2px solid ${
                isListening
                  ? "rgba(56, 189, 248, 0.55)"
                  : isSpeaking
                  ? "rgba(236, 72, 153, 0.55)"
                  : isThinking
                  ? "rgba(250, 204, 21, 0.55)"
                  : "rgba(99, 102, 241, 0.3)"
              }`,
              animation: isListening
                ? "ping 2.2s cubic-bezier(0, 0, 0.2, 1) infinite"
                : isSpeaking
                ? "pulse 1.6s ease-in-out infinite"
                : "none",
              transition: "all 0.5s ease",
            }}
          />

          {/* Gyroscopic Orbital Ring for Thinking State */}
          {isThinking && (
            <div
              style={{
                position: "absolute",
                inset: -14,
                borderRadius: "50%",
                border: "2px dashed rgba(250, 204, 21, 0.7)",
                animation: "spin 3s linear infinite",
              }}
            />
          )}

          {/* Radial Ambient Glow Aura */}
          <div
            style={{
              position: "absolute",
              inset: -20,
              borderRadius: "50%",
              background: isListening
                ? "radial-gradient(circle, rgba(56, 189, 248, 0.35) 0%, transparent 70%)"
                : isSpeaking
                ? "radial-gradient(circle, rgba(168, 85, 247, 0.4) 0%, transparent 70%)"
                : isThinking
                ? "radial-gradient(circle, rgba(250, 204, 21, 0.35) 0%, transparent 70%)"
                : "radial-gradient(circle, rgba(99, 102, 241, 0.25) 0%, transparent 70%)",
              filter: "blur(20px)",
              transition: "all 0.5s ease",
            }}
          />

          {/* Core Sphere */}
          <div
            style={{
              width: 146,
              height: 146,
              borderRadius: "50%",
              background: isListening
                ? "radial-gradient(circle at 35% 30%, #38bdf8 0%, #0284c7 45%, #0f172a 100%)"
                : isSpeaking
                ? "radial-gradient(circle at 35% 30%, #f472b6 0%, #a855f7 45%, #1e1b4b 100%)"
                : isThinking
                ? "radial-gradient(circle at 35% 30%, #fde047 0%, #d97706 45%, #451a03 100%)"
                : "radial-gradient(circle at 35% 30%, #818cf8 0%, #4f46e5 50%, #0f172a 100%)",
              boxShadow: isListening
                ? "0 0 60px rgba(56, 189, 248, 0.7), inset 0 0 25px rgba(255,255,255,0.6)"
                : isSpeaking
                ? "0 0 65px rgba(168, 85, 247, 0.75), inset 0 0 25px rgba(255,255,255,0.6)"
                : isThinking
                ? "0 0 55px rgba(250, 204, 21, 0.7), inset 0 0 25px rgba(255,255,255,0.6)"
                : "0 0 40px rgba(99, 102, 241, 0.45), inset 0 0 15px rgba(255,255,255,0.4)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              transform: isListening ? "scale(1.08)" : isSpeaking ? "scale(1.05)" : "scale(1)",
              transition: "all 0.35s cubic-bezier(0.16, 1, 0.3, 1)",
            }}
          >
            {isListening ? (
              <div style={{ display: "flex", gap: 5, alignItems: "center" }}>
                {[14, 32, 48, 32, 14].map((h, i) => (
                  <div
                    key={i}
                    style={{
                      width: 5,
                      height: h,
                      borderRadius: 3,
                      background: "#ffffff",
                      animation: `pulse 0.65s ease-in-out infinite alternate ${i * 0.12}s`,
                    }}
                  />
                ))}
              </div>
            ) : isSpeaking ? (
              <div style={{ display: "flex", gap: 5, alignItems: "center" }}>
                {[18, 42, 26, 46, 20].map((h, i) => (
                  <div
                    key={i}
                    style={{
                      width: 5,
                      height: h,
                      borderRadius: 3,
                      background: "#ffffff",
                      animation: `pulse 0.55s ease-in-out infinite alternate ${i * 0.09}s`,
                    }}
                  />
                ))}
              </div>
            ) : isThinking ? (
              <Sparkles size={38} color="#ffffff" className="animate-spin" />
            ) : (
              <Mic size={38} color="#ffffff" />
            )}
          </div>
        </div>

        {/* Dynamic Status Display */}
        <div style={{ textAlign: "center", marginBottom: 16, zIndex: 10 }}>
          <div
            style={{
              fontSize: 20,
              fontWeight: 800,
              letterSpacing: "-0.02em",
              color: isListening
                ? "#38bdf8"
                : isSpeaking
                ? "#c084fc"
                : isThinking
                ? "#facc15"
                : "#ffffff",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 8,
            }}
          >
            {isListening && <><span>Listening...</span></>}
            {isSpeaking && <><span>Priya Speaking</span></>}
            {isThinking && <><span>Querying Real-Time CRM...</span></>}
            {isIdle && <><span>Tap Orb or Speak</span></>}
          </div>

          {/* Subtitle / Spoken Transcript Display */}
          <div style={{ fontSize: 13.5, color: "#94a3b8", marginTop: 6, minHeight: 22 }}>
            {isListening && (
              <span style={{ color: "#e2e8f0", fontWeight: 600 }}>
                "{userTranscript || "Say your question in " + LANG_CONFIG[language].label + "..."}"
              </span>
            )}
            {isSpeaking && "Tap orb or click Interrupt below to pause speech"}
            {isThinking && "Analyzing leads, loan database, and telephony logs"}
            {isIdle && (continuousMode ? "Hands-Free is active • Automatically listens when you speak" : "Click the orb or press Spacebar to speak")}
          </div>
        </div>

        {/* Live Response Card with Formatted Highlights */}
        {latestAssistant && !showHistory && (
          <div
            style={{
              width: "100%",
              maxHeight: 210,
              overflowY: "auto",
              background: "rgba(15, 23, 42, 0.78)",
              border: "1px solid rgba(255, 255, 255, 0.14)",
              borderRadius: 16,
              padding: "16px 20px",
              boxShadow: "0 8px 30px rgba(0,0,0,0.4)",
              zIndex: 10,
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
              <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.05em", color: "#818cf8", textTransform: "uppercase", display: "flex", alignItems: "center", gap: 6 }}>
                <Bot size={13} /> Priya's Response
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <button
                  onClick={() => handleReplayAudio(latestAssistant.text, messages.length - 1)}
                  title={isSpeaking && playingMsgIndex === messages.length - 1 ? "Stop Priya's voice" : "Replay Priya's spoken response"}
                  style={{
                    background: isSpeaking && playingMsgIndex === messages.length - 1 ? "rgba(236, 72, 153, 0.25)" : "rgba(255, 255, 255, 0.08)",
                    border: `1px solid ${isSpeaking && playingMsgIndex === messages.length - 1 ? "rgba(236, 72, 153, 0.5)" : "rgba(255, 255, 255, 0.15)"}`,
                    color: isSpeaking && playingMsgIndex === messages.length - 1 ? "#f472b6" : "var(--text-secondary)",
                    padding: "2px 8px",
                    borderRadius: 12,
                    fontSize: 11,
                    fontWeight: 600,
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    gap: 4,
                  }}
                >
                  {isSpeaking && playingMsgIndex === messages.length - 1 ? <Square size={10} /> : <Volume2 size={11} />}
                  <span>{isSpeaking && playingMsgIndex === messages.length - 1 ? "Stop" : "Replay"}</span>
                </button>
                <span style={{ fontSize: 11, color: "var(--text-muted)" }}>{latestAssistant.timestamp}</span>
              </div>
            </div>

            <div style={{ fontSize: 14, lineHeight: 1.6, color: "#f8fafc" }}>
              {cleanMarkdownForSpeech(latestAssistant.text)}
            </div>

            {/* Inline Action Proposal Card */}
            {pendingProposal && (
              <div
                style={{
                  marginTop: 12,
                  padding: "12px 14px",
                  borderRadius: 12,
                  background: "rgba(99, 102, 241, 0.12)",
                  border: "1.5px solid rgba(99, 102, 241, 0.4)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 12,
                }}
              >
                <div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: "#ffffff", display: "flex", alignItems: "center", gap: 6 }}>
                    <ShieldCheck size={16} color="#818cf8" />
                    <span>Proposed Action: {pendingProposal.title || pendingProposal.type}</span>
                  </div>
                  <div style={{ fontSize: 11.5, color: "#cbd5e1", marginTop: 2 }}>
                    {pendingProposal.description || JSON.stringify(pendingProposal.payload)}
                  </div>
                </div>

                {!actionDone ? (
                  <button
                    onClick={() => executeAction(pendingProposal)}
                    disabled={executingAction}
                    style={{
                      background: "linear-gradient(135deg, #6366f1 0%, #a855f7 100%)",
                      border: "none",
                      color: "#fff",
                      padding: "8px 16px",
                      borderRadius: 8,
                      fontSize: 12.5,
                      fontWeight: 700,
                      cursor: "pointer",
                      boxShadow: "0 2px 10px rgba(99, 102, 241, 0.45)",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {executingAction ? "Executing..." : "Approve & Execute"}
                  </button>
                ) : (
                  <span style={{ fontSize: 12, fontWeight: 700, color: "#34d399", display: "flex", alignItems: "center", gap: 4 }}>
                    <CheckCircle2 size={14} /> Executed
                  </span>
                )}
              </div>
            )}
          </div>
        )}

        {/* History Transcript Window */}
        {showHistory && (
          <div
            style={{
              width: "100%",
              height: 280,
              overflowY: "auto",
              background: "rgba(15, 23, 42, 0.82)",
              backdropFilter: "blur(16px)",
              border: "1px solid rgba(255, 255, 255, 0.14)",
              borderRadius: 18,
              padding: "16px 20px",
              display: "flex",
              flexDirection: "column",
              gap: 14,
              zIndex: 10,
              boxShadow: "0 10px 30px rgba(0,0,0,0.45)",
            }}
          >
            {loadingChat && (
              <div style={{ textAlign: "center", padding: "20px 0", color: "#818cf8", fontSize: 13, display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
                <Loader2 size={16} className="animate-spin" />
                <span>Loading conversation messages...</span>
              </div>
            )}

            {messages.map((m, idx) => {
              const isAssistant = m.role === "assistant"
              const isPlayingThis = isSpeaking && playingMsgIndex === idx

              return (
                <div
                  key={idx}
                  style={{
                    display: "flex",
                    gap: 10,
                    alignItems: "flex-start",
                    alignSelf: isAssistant ? "flex-start" : "flex-end",
                    maxWidth: "88%",
                  }}
                >
                  {isAssistant && (
                    <div
                      style={{
                        width: 30,
                        height: 30,
                        borderRadius: 10,
                        background: "linear-gradient(135deg, #a855f7 0%, #ec4899 100%)",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        flexShrink: 0,
                        boxShadow: "0 0 12px rgba(168, 85, 247, 0.4)",
                      }}
                    >
                      <Bot size={15} color="#ffffff" />
                    </div>
                  )}

                  <div style={{ display: "flex", flexDirection: "column", alignItems: isAssistant ? "flex-start" : "flex-end" }}>
                    <div
                      style={{
                        background: isAssistant
                          ? "rgba(30, 41, 59, 0.7)"
                          : "linear-gradient(135deg, rgba(14, 165, 233, 0.25) 0%, rgba(99, 102, 241, 0.3) 100%)",
                        border: `1px solid ${
                          isAssistant
                            ? isPlayingThis
                              ? "rgba(168, 85, 247, 0.7)"
                              : "rgba(255, 255, 255, 0.12)"
                            : "rgba(56, 189, 248, 0.4)"
                        }`,
                        borderRadius: isAssistant ? "4px 16px 16px 16px" : "16px 4px 16px 16px",
                        padding: "10px 15px",
                        fontSize: 13.5,
                        lineHeight: 1.55,
                        color: "#f8fafc",
                        boxShadow: isPlayingThis ? "0 0 16px rgba(168, 85, 247, 0.35)" : "none",
                        transition: "all 0.2s ease",
                      }}
                    >
                      <div style={{ whiteSpace: "pre-wrap" }}>
                        {cleanMarkdownForSpeech(m.text)}
                      </div>

                      {/* Assistant Action Proposal Card if present */}
                      {m.actionProposal && (
                        <div
                          style={{
                            marginTop: 10,
                            padding: "10px 12px",
                            borderRadius: 10,
                            background: "rgba(99, 102, 241, 0.15)",
                            border: "1px solid rgba(99, 102, 241, 0.4)",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "space-between",
                            gap: 10,
                          }}
                        >
                          <div>
                            <div style={{ fontSize: 12.5, fontWeight: 700, color: "#fff", display: "flex", alignItems: "center", gap: 5 }}>
                              <ShieldCheck size={14} color="#818cf8" />
                              <span>Proposed: {m.actionProposal.title || m.actionProposal.type}</span>
                            </div>
                            <div style={{ fontSize: 11, color: "#cbd5e1", marginTop: 2 }}>
                              {m.actionProposal.description || "Dashboard modification requested"}
                            </div>
                          </div>
                          <button
                            onClick={() => executeAction(m.actionProposal)}
                            disabled={executingAction}
                            style={{
                              background: "linear-gradient(135deg, #6366f1 0%, #a855f7 100%)",
                              border: "none",
                              color: "#fff",
                              padding: "6px 12px",
                              borderRadius: 7,
                              fontSize: 11.5,
                              fontWeight: 700,
                              cursor: "pointer",
                              whiteSpace: "nowrap",
                            }}
                          >
                            {executingAction ? "Executing..." : "Execute"}
                          </button>
                        </div>
                      )}
                    </div>

                    {/* Meta info & Spoken Voice Replay Button */}
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 4 }}>
                      <span style={{ fontSize: 10.5, color: "var(--text-muted)" }}>{m.timestamp}</span>

                      {isAssistant && (
                        <button
                          onClick={() => handleReplayAudio(m.text, idx)}
                          title={isPlayingThis ? "Stop Priya's voice" : "Replay Priya's spoken response"}
                          style={{
                            background: isPlayingThis ? "rgba(236, 72, 153, 0.25)" : "rgba(255, 255, 255, 0.06)",
                            border: `1px solid ${isPlayingThis ? "rgba(236, 72, 153, 0.5)" : "rgba(255, 255, 255, 0.1)"}`,
                            color: isPlayingThis ? "#f472b6" : "var(--text-secondary)",
                            padding: "2px 8px",
                            borderRadius: 12,
                            fontSize: 11,
                            fontWeight: 600,
                            cursor: "pointer",
                            display: "flex",
                            alignItems: "center",
                            gap: 4,
                            transition: "all 0.18s ease",
                          }}
                        >
                          {isPlayingThis ? (
                            <>
                              <Square size={10} />
                              <span>Stop</span>
                            </>
                          ) : (
                            <>
                              <Volume2 size={11} />
                              <span>Replay Voice</span>
                            </>
                          )}
                        </button>
                      )}
                    </div>
                  </div>

                  {!isAssistant && (
                    <div
                      style={{
                        width: 30,
                        height: 30,
                        borderRadius: 10,
                        background: "linear-gradient(135deg, #0284c7 0%, #38bdf8 100%)",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        flexShrink: 0,
                        boxShadow: "0 0 12px rgba(56, 189, 248, 0.35)",
                      }}
                    >
                      <User size={15} color="#ffffff" />
                    </div>
                  )}
                </div>
              )
            })}
            <div ref={scrollEndRef} />
          </div>
        )}
      </div>

      {/* Bottom Control Dock & Quick Voice Chips */}
      <div
        style={{
          width: "100%",
          maxWidth: 960,
          display: "flex",
          flexDirection: "column",
          gap: 12,
          zIndex: 20,
        }}
      >
        {/* Quick Voice Chips */}
        <div
          style={{
            display: "flex",
            gap: 10,
            overflowX: "auto",
            paddingBottom: 2,
            justifyContent: "center",
          }}
        >
          {QUICK_PROMPTS[language].map((prompt, idx) => (
            <button
              key={idx}
              onClick={() => handleSendMessage(prompt.query)}
              style={{
                flexShrink: 0,
                background: "rgba(255, 255, 255, 0.06)",
                border: "1px solid rgba(255, 255, 255, 0.12)",
                borderRadius: 20,
                padding: "7px 16px",
                fontSize: 12.5,
                fontWeight: 600,
                color: "#e2e8f0",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                gap: 6,
                transition: "all 0.2s ease",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = "rgba(99, 102, 241, 0.25)"
                e.currentTarget.style.borderColor = "rgba(99, 102, 241, 0.5)"
                e.currentTarget.style.color = "#ffffff"
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = "rgba(255, 255, 255, 0.06)"
                e.currentTarget.style.borderColor = "rgba(255, 255, 255, 0.12)"
                e.currentTarget.style.color = "#e2e8f0"
              }}
            >
              <span>{prompt.icon}</span>
              <span>{prompt.title}</span>
            </button>
          ))}
        </div>

        {/* Input Bar & Master Push-To-Talk Toggle */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            background: "rgba(15, 23, 42, 0.85)",
            backdropFilter: "blur(18px)",
            border: "1px solid rgba(255, 255, 255, 0.15)",
            borderRadius: 16,
            padding: "8px 14px",
            boxShadow: "0 10px 30px rgba(0,0,0,0.45)",
          }}
        >
          {/* Main Push-To-Talk Action Button */}
          <button
            onClick={() => {
              if (isListening) stopListening()
              else if (isSpeaking) stopSpeaking()
              else startListening()
            }}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              background: isListening
                ? "rgba(239, 68, 68, 0.25)"
                : isSpeaking
                ? "rgba(168, 85, 247, 0.25)"
                : "linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)",
              border: `1.5px solid ${isListening ? "#ef4444" : isSpeaking ? "#a855f7" : "rgba(255,255,255,0.2)"}`,
              color: isListening ? "#f87171" : isSpeaking ? "#c084fc" : "#ffffff",
              borderRadius: 12,
              padding: "9px 20px",
              fontSize: 13.5,
              fontWeight: 700,
              cursor: "pointer",
              boxShadow: isListening
                ? "0 0 16px rgba(239, 68, 68, 0.5)"
                : "0 4px 14px rgba(99, 102, 241, 0.4)",
              transition: "all 0.2s ease",
            }}
          >
            {isListening ? (
              <>
                <Square size={15} /> Stop Listening
              </>
            ) : isSpeaking ? (
              <>
                <Square size={15} /> Interrupt
              </>
            ) : (
              <>
                <Mic size={16} /> Speak Now
              </>
            )}
          </button>

          {/* Text Input Fallback */}
          <input
            type="text"
            value={textInput}
            onChange={(e) => setTextInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && textInput.trim()) {
                handleSendMessage(textInput.trim())
                setTextInput("")
              }
            }}
            placeholder="Type your question or speak with Priya..."
            style={{
              flex: 1,
              background: "transparent",
              border: "none",
              outline: "none",
              color: "#ffffff",
              fontSize: 14,
              padding: "6px 10px",
            }}
          />

          {textInput.trim() && (
            <button
              onClick={() => {
                if (textInput.trim()) {
                  handleSendMessage(textInput.trim())
                  setTextInput("")
                }
              }}
              style={{
                width: 36,
                height: 36,
                borderRadius: 10,
                background: "linear-gradient(135deg, #6366f1 0%, #a855f7 100%)",
                border: "none",
                color: "#ffffff",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                cursor: "pointer",
                boxShadow: "0 2px 10px rgba(99, 102, 241, 0.4)",
              }}
            >
              <Send size={15} />
            </button>
          )}
        </div>
      </div>

      {/* Slide-In Chat History Drawer */}
      {showHistoryDrawer && (
        <>
          {/* Translucent Backdrop */}
          <div
            onClick={() => setShowHistoryDrawer(false)}
            style={{
              position: "fixed",
              inset: 0,
              background: "rgba(0, 0, 0, 0.65)",
              backdropFilter: "blur(6px)",
              zIndex: 40,
              animation: "fadeIn 0.2s ease-out",
            }}
          />

          {/* Drawer Panel */}
          <div
            style={{
              position: "fixed",
              top: 0,
              right: 0,
              bottom: 0,
              width: "min(400px, 92vw)",
              background: "linear-gradient(180deg, rgba(15, 23, 42, 0.98) 0%, rgba(10, 15, 30, 0.99) 100%)",
              backdropFilter: "blur(28px)",
              borderLeft: "1px solid rgba(99, 102, 241, 0.3)",
              boxShadow: "-14px 0 50px rgba(0, 0, 0, 0.8)",
              zIndex: 50,
              display: "flex",
              flexDirection: "column",
              animation: "slideInRight 0.24s cubic-bezier(0.16, 1, 0.3, 1)",
            }}
          >
            {/* Drawer Header */}
            <div
              style={{
                padding: "20px 22px",
                borderBottom: "1px solid rgba(255, 255, 255, 0.1)",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <div
                  style={{
                    width: 34,
                    height: 34,
                    borderRadius: 10,
                    background: "linear-gradient(135deg, #6366f1 0%, #a855f7 100%)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    boxShadow: "0 0 14px rgba(99, 102, 241, 0.5)",
                  }}
                >
                  <History size={17} color="#ffffff" />
                </div>
                <div>
                  <div style={{ fontSize: 15, fontWeight: 700, color: "#ffffff" }}>Voice Chat History</div>
                  <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
                    {chats.length} {chats.length === 1 ? "session" : "sessions"} saved in CRM
                  </div>
                </div>
              </div>
              <button
                onClick={() => setShowHistoryDrawer(false)}
                title="Close Drawer (Esc)"
                style={{
                  background: "rgba(255, 255, 255, 0.06)",
                  border: "1px solid rgba(255, 255, 255, 0.1)",
                  color: "var(--text-secondary)",
                  cursor: "pointer",
                  width: 32,
                  height: 32,
                  borderRadius: 8,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <X size={16} />
              </button>
            </div>

            {/* Quick Action in Drawer */}
            <div style={{ padding: "14px 20px 10px 20px" }}>
              <button
                onClick={startNewChat}
                style={{
                  width: "100%",
                  padding: "10px 16px",
                  borderRadius: 12,
                  background: "linear-gradient(135deg, #6366f1 0%, #8b5cf6 50%, #d946ef 100%)",
                  border: "none",
                  color: "#ffffff",
                  fontSize: 13,
                  fontWeight: 700,
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 8,
                  boxShadow: "0 4px 18px rgba(99, 102, 241, 0.4)",
                  transition: "transform 0.15s ease",
                }}
                onMouseEnter={(e) => (e.currentTarget.style.transform = "translateY(-1px)")}
                onMouseLeave={(e) => (e.currentTarget.style.transform = "translateY(0)")}
              >
                <Plus size={16} />
                <span>Start New Voice Chat</span>
              </button>
            </div>

            {/* Chat List */}
            <div
              style={{
                flex: 1,
                overflowY: "auto",
                padding: "10px 20px 24px 20px",
                display: "flex",
                flexDirection: "column",
                gap: 8,
              }}
            >
              {chatsLoading && (
                <div style={{ padding: "50px 20px", textAlign: "center", color: "var(--text-muted)", fontSize: 13, display: "flex", flexDirection: "column", alignItems: "center", gap: 12 }}>
                  <Loader2 size={24} className="animate-spin" color="#818cf8" />
                  <span>Loading past conversations...</span>
                </div>
              )}

              {!chatsLoading && chats.length === 0 && (
                <div style={{ padding: "60px 20px", textAlign: "center", color: "var(--text-muted)" }}>
                  <div
                    style={{
                      width: 52,
                      height: 52,
                      borderRadius: 16,
                      background: "rgba(99, 102, 241, 0.12)",
                      border: "1px solid rgba(99, 102, 241, 0.25)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      margin: "0 auto 14px auto",
                    }}
                  >
                    <Mic size={24} color="#818cf8" />
                  </div>
                  <div style={{ fontSize: 14, fontWeight: 600, color: "#e2e8f0", marginBottom: 4 }}>No past conversations</div>
                  <div style={{ fontSize: 12, lineHeight: 1.5, maxWidth: 240, margin: "0 auto" }}>
                    Speak or type with Priya. All your voice sessions are safely stored here!
                  </div>
                </div>
              )}

              {!chatsLoading &&
                chats.map((c) => {
                  const isActive = c.id === chatId
                  const isConfirming = confirmDeleteId === c.id

                  return (
                    <div
                      key={c.id}
                      onClick={() => !isConfirming && openChat(c)}
                      style={{
                        borderRadius: 12,
                        padding: "12px 14px",
                        background: isActive
                          ? "rgba(99, 102, 241, 0.2)"
                          : "rgba(255, 255, 255, 0.04)",
                        border: `1px solid ${
                          isActive ? "rgba(129, 140, 248, 0.55)" : "rgba(255, 255, 255, 0.08)"
                        }`,
                        cursor: "pointer",
                        transition: "all 0.18s ease",
                        display: "flex",
                        flexDirection: "column",
                        gap: 6,
                      }}
                      onMouseEnter={(e) => {
                        if (!isActive) e.currentTarget.style.background = "rgba(255, 255, 255, 0.07)"
                      }}
                      onMouseLeave={(e) => {
                        if (!isActive) e.currentTarget.style.background = "rgba(255, 255, 255, 0.04)"
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 8 }}>
                        <div style={{ minWidth: 0, flex: 1 }}>
                          <div
                            style={{
                              fontSize: 13,
                              fontWeight: 650,
                              color: isActive ? "#ffffff" : "#e2e8f0",
                              whiteSpace: "nowrap",
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                            }}
                            title={c.title}
                          >
                            {c.title}
                          </div>
                          <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 4, fontSize: 11, color: "var(--text-muted)" }}>
                            <Clock size={11} />
                            <span>{timeAgoShort(c.updated_at)}</span>
                            {isActive && (
                              <span
                                style={{
                                  fontSize: 9.5,
                                  fontWeight: 700,
                                  padding: "1px 6px",
                                  borderRadius: 4,
                                  background: "rgba(34, 197, 94, 0.2)",
                                  color: "#4ade80",
                                  border: "1px solid rgba(34, 197, 94, 0.4)",
                                  textTransform: "uppercase",
                                  letterSpacing: "0.03em",
                                }}
                              >
                                Active
                              </span>
                            )}
                          </div>
                        </div>

                        {/* Delete button or confirmation */}
                        <div style={{ flexShrink: 0 }} onClick={(e) => e.stopPropagation()}>
                          {isConfirming ? (
                            <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                              <button
                                onClick={(e) => deleteChat(c.id, e)}
                                style={{
                                  fontSize: 10.5,
                                  fontWeight: 700,
                                  color: "#ffffff",
                                  background: "#ef4444",
                                  border: "none",
                                  borderRadius: 6,
                                  padding: "4px 8px",
                                  cursor: "pointer",
                                }}
                              >
                                Delete
                              </button>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation()
                                  setConfirmDeleteId(null)
                                }}
                                style={{
                                  fontSize: 10.5,
                                  color: "var(--text-muted)",
                                  background: "rgba(255,255,255,0.08)",
                                  border: "1px solid rgba(255,255,255,0.1)",
                                  borderRadius: 6,
                                  padding: "4px 7px",
                                  cursor: "pointer",
                                }}
                              >
                                Cancel
                              </button>
                            </div>
                          ) : (
                            <button
                              onClick={(e) => {
                                e.stopPropagation()
                                setConfirmDeleteId(c.id)
                              }}
                              title="Delete conversation"
                              style={{
                                background: "none",
                                border: "none",
                                color: "var(--text-muted)",
                                cursor: "pointer",
                                padding: 4,
                                borderRadius: 6,
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                transition: "color 0.15s",
                              }}
                              onMouseEnter={(e) => (e.currentTarget.style.color = "#ef4444")}
                              onMouseLeave={(e) => (e.currentTarget.style.color = "var(--text-muted)")}
                            >
                              <Trash2 size={14} />
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  )
                })}
            </div>
          </div>
        </>
      )}

      {/* Animation Styles */}
      <style>{`
        @keyframes slideInRight {
          from { transform: translateX(100%); opacity: 0; }
          to { transform: translateX(0); opacity: 1; }
        }
        @keyframes fadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
      `}</style>
    </div>
  )
}
