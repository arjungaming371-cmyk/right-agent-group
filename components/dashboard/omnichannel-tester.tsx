"use client"

import { useState, useRef, useEffect } from "react"
import {
  Phone,
  MessageCircle,
  Instagram,
  Send,
  RotateCcw,
  Sparkles,
  Volume2,
  VolumeX,
  CheckCircle2,
  PhoneOff,
  User,
  Sliders,
  ChevronDown,
  ChevronUp,
  Info,
  Clock,
  ExternalLink,
  Shield,
  Layers,
  ArrowRight,
  Headphones,
} from "lucide-react"

export type ChannelType = "call" | "whatsapp" | "instagram_dm" | "instagram_comment"
export type LangType = "telugu" | "english" | "hindi"

export type LeadScenario = {
  id: string
  label: string
  desc: string
  name: string
  phone: string
  loanType: string
  loanAmount: string
  loanTenure: string
  city: string
  hasApplication: boolean
  applicationRef: string
  applicationStatus: string
  notes?: string
}

const PRESET_SCENARIOS: LeadScenario[] = [
  {
    id: "returning_app",
    label: "Returning Applicant (App on File)",
    desc: "Application submitted, testing doubts & avoiding re-asking",
    name: "Ajay Kumar",
    phone: "+91 98480 22338",
    loanType: "Education Loan",
    loanAmount: "sixteen lakh",
    loanTenure: "fifteen years",
    city: "Hyderabad",
    hasApplication: true,
    applicationRef: "LA-8492",
    applicationStatus: "Under Review by loan officer",
    notes: "Applied online yesterday for MS abroad in US",
  },
  {
    id: "new_prospect",
    label: "New Prospect (No App Yet)",
    desc: "First-time inquiry, needs qualification & form link",
    name: "Rahul Varma",
    phone: "+91 98765 43210",
    loanType: "Business Loan",
    loanAmount: "twenty-five lakh",
    loanTenure: "five years",
    city: "Vijayawada",
    hasApplication: false,
    applicationRef: "",
    applicationStatus: "",
    notes: "Looking for working capital expansion",
  },
  {
    id: "home_loan",
    label: "Home Loan Prospect",
    desc: "Seeking rates, tenure & bank partner comparisons",
    name: "Suresh Reddy",
    phone: "+91 99887 76655",
    loanType: "Home Loan",
    loanAmount: "fifty lakh",
    loanTenure: "twenty years",
    city: "Gachibowli, Hyderabad",
    hasApplication: false,
    applicationRef: "",
    applicationStatus: "",
    notes: "Flat purchase in Kondapur",
  },
]

type ChatMessage = {
  id: string
  role: "user" | "model"
  content: string
  timestamp: string
  hangup?: boolean
  latencyMs?: number
  contextUsed?: {
    stageDetected?: string
    leadBrief?: string
    kbMatches?: string
    brevityRule?: string
  }
}

export default function OmnichannelTester({
  initialChannel = "call",
  onClose,
}: {
  initialChannel?: ChannelType
  onClose?: () => void
}) {
  const [channel, setChannel] = useState<ChannelType>(initialChannel)
  const [language, setLanguage] = useState<LangType>("telugu")
  const [selectedScenario, setSelectedScenario] = useState<LeadScenario>(PRESET_SCENARIOS[0])
  const [showConfig, setShowConfig] = useState(false)
  const [showInspector, setShowInspector] = useState(false)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [inputText, setInputText] = useState("")
  const [loading, setLoading] = useState(false)
  const [activeAudioId, setActiveAudioId] = useState<string | null>(null)
  const [audioLoading, setAudioLoading] = useState<string | null>(null)

  const chatEndRef = useRef<HTMLDivElement>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)

  // Scroll to bottom on new message
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [messages, loading])

  // Reset conversation when channel or scenario changes
  const handleReset = () => {
    if (audioRef.current) {
      audioRef.current.pause()
      audioRef.current = null
    }
    setActiveAudioId(null)
    setMessages([])
  }

  // Pre-seed opening greeting based on channel
  const seedGreeting = () => {
    handleReset()
    let greeting = ""
    if (channel === "call") {
      if (selectedScenario.hasApplication) {
        greeting =
          language === "telugu"
            ? `నమస్కారం ${selectedScenario.name} sir! LS Right Agent Services నుండి Priya ని మాట్లాడుతున్నాను. మీ ${selectedScenario.loanAmount} ${selectedScenario.loanType} application మాకు reach అయింది.`
            : `Hello ${selectedScenario.name} sir! I am Priya from LS Right Agent Services. We have received your ${selectedScenario.loanType} application.`
      } else {
        greeting =
          language === "telugu"
            ? `హలో sir! LS Right Agent Services నుండి Priya ని మాట్లాడుతున్నాను. మీకు loans గురించి ఏమైనా సమాచారం కావాలా?`
            : `Hello! I am Priya from Right Agent Group. How can I help you with your loan requirements today?`
      }
    } else if (channel === "whatsapp") {
      greeting =
        language === "telugu"
          ? `Hello ${selectedScenario.name} garu! LS Right Agent Services loan assistance desk. How can I help you today?`
          : `Hello ${selectedScenario.name}! Welcome to Right Agent Group loan support. How can we assist your loan journey today?`
    } else {
      greeting = `Hey ${selectedScenario.name}! Thanks for reaching out to Right Agent Group on Instagram. How can we help you today?`
    }

    setMessages([
      {
        id: "msg_greet",
        role: "model",
        content: greeting,
        timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      },
    ])
  }

  // Send message to simulator API
  const handleSendMessage = async (textToSend?: string) => {
    const text = (textToSend || inputText).trim()
    if (!text || loading) return

    setInputText("")
    const userMsgId = "usr_" + Date.now()
    const newMsg: ChatMessage = {
      id: userMsgId,
      role: "user",
      content: text,
      timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    }

    const updated = [...messages, newMsg]
    setMessages(updated)
    setLoading(true)

    try {
      const history = updated.slice(0, -1).map((m) => ({
        role: m.role,
        content: m.content,
      }))

      const res = await fetch("/api/simulator/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: text,
          channel,
          language,
          lead: selectedScenario,
          history,
        }),
      })

      const data = await res.json()
      if (!res.ok) throw new Error(data.error || "Failed to generate reply")

      const botMsg: ChatMessage = {
        id: "bot_" + Date.now(),
        role: "model",
        content: data.reply,
        timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
        hangup: data.hangup,
        latencyMs: data.latencyMs,
        contextUsed: data.contextUsed,
      }

      setMessages([...updated, botMsg])
    } catch (e: any) {
      setMessages([
        ...updated,
        {
          id: "err_" + Date.now(),
          role: "model",
          content: `⚠️ Error: ${e.message}`,
          timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
        },
      ])
    } finally {
      setLoading(false)
    }
  }

  // TTS audio playback
  const playAudio = async (msgId: string, text: string) => {
    if (activeAudioId === msgId) {
      if (audioRef.current) {
        audioRef.current.pause()
        audioRef.current = null
      }
      setActiveAudioId(null)
      return
    }

    try {
      setAudioLoading(msgId)
      if (audioRef.current) {
        audioRef.current.pause()
      }

      const res = await fetch("/api/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, language }),
      })

      if (!res.ok) throw new Error("TTS playback failed")
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)

      const audio = new Audio(url)
      audioRef.current = audio
      setActiveAudioId(msgId)

      audio.onended = () => {
        setActiveAudioId(null)
      }
      audio.onerror = () => {
        setActiveAudioId(null)
      }

      await audio.play()
    } catch (err) {
      console.error(err)
      setActiveAudioId(null)
    } finally {
      setAudioLoading(null)
    }
  }

  const lastAiMessage = [...messages].reverse().find((m) => m.role === "model")

  return (
    <div className="flex flex-col h-full bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded-xl overflow-hidden shadow-2xl">
      {/* Top Bar: Channel Toggle & Settings */}
      <div className="p-3 bg-[var(--bg-primary)] border-b border-[var(--border-color)] flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="h-9 w-9 rounded-lg bg-[var(--accent-blue)]/10 text-[var(--accent-blue)] flex items-center justify-center font-bold">
            <Sparkles size={18} />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="font-semibold text-sm text-[var(--text-primary)]">Omnichannel Script Chatbot</h3>
              <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-full bg-[var(--accent-blue)]/15 text-[var(--accent-blue)]">
                Live Simulator
              </span>
            </div>
            <p className="text-xs text-[var(--text-muted)]">
              Simulate & test Priya&apos;s real replies for Calls, WhatsApp & Instagram
            </p>
          </div>
        </div>

        {/* Channel Selector Pills */}
        <div className="flex items-center bg-[var(--bg-secondary)] p-1 rounded-lg border border-[var(--border-color)]">
          <button
            onClick={() => setChannel("call")}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
              channel === "call"
                ? "bg-[var(--accent-blue)] text-white shadow-sm"
                : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
            }`}
          >
            <Phone size={13} />
            <span>Voice Call</span>
          </button>
          <button
            onClick={() => setChannel("whatsapp")}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
              channel === "whatsapp"
                ? "bg-emerald-600 text-white shadow-sm"
                : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
            }`}
          >
            <MessageCircle size={13} />
            <span>WhatsApp</span>
          </button>
          <button
            onClick={() => setChannel("instagram_dm")}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
              channel === "instagram_dm"
                ? "bg-gradient-to-r from-purple-600 to-pink-600 text-white shadow-sm"
                : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
            }`}
          >
            <Instagram size={13} />
            <span>Instagram</span>
          </button>
        </div>

        {/* Actions & Language */}
        <div className="flex items-center gap-2">
          {/* Language selector */}
          <select
            value={language}
            onChange={(e) => setLanguage(e.target.value as LangType)}
            className="text-xs px-2.5 py-1.5 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-color)] text-[var(--text-primary)] focus:outline-none"
          >
            <option value="telugu">Telugu (తెలుగు)</option>
            <option value="english">English</option>
            <option value="hindi">Hindi (हिंदी)</option>
          </select>

          {/* Lead Context Config Toggle */}
          <button
            onClick={() => setShowConfig(!showConfig)}
            className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs font-medium transition-colors ${
              showConfig
                ? "bg-[var(--accent-blue)]/15 border-[var(--accent-blue)] text-[var(--accent-blue)]"
                : "border-[var(--border-color)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
            }`}
            title="Configure lead scenario & facts"
          >
            <Sliders size={13} />
            <span>Lead: {selectedScenario.name.split(" ")[0]}</span>
            {showConfig ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
          </button>

          {/* Reset */}
          <button
            onClick={handleReset}
            className="p-1.5 rounded-lg border border-[var(--border-color)] text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
            title="Clear Chat History"
          >
            <RotateCcw size={14} />
          </button>

          {onClose && (
            <button
              onClick={onClose}
              className="px-2.5 py-1 rounded-lg text-xs font-medium bg-[var(--bg-secondary)] border border-[var(--border-color)] hover:bg-[var(--overlay-soft)]"
            >
              Close
            </button>
          )}
        </div>
      </div>

      {/* Collapsible Scenario / Lead Details Drawer */}
      {showConfig && (
        <div className="p-3 bg-[var(--bg-primary)] border-b border-[var(--border-color)] animate-fadeIn text-xs">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-2.5">
            <span className="font-semibold text-[var(--text-primary)] flex items-center gap-1.5">
              <User size={13} className="text-[var(--accent-blue)]" />
              Lead Context Presets:
            </span>
            <div className="flex items-center gap-1.5 flex-wrap">
              {PRESET_SCENARIOS.map((sc) => (
                <button
                  key={sc.id}
                  onClick={() => {
                    setSelectedScenario(sc)
                    handleReset()
                  }}
                  className={`px-2.5 py-1 rounded-md transition-all font-medium ${
                    selectedScenario.id === sc.id
                      ? "bg-[var(--accent-blue)] text-white shadow-sm"
                      : "bg-[var(--bg-secondary)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] border border-[var(--border-color)]"
                  }`}
                >
                  {sc.label}
                </button>
              ))}
            </div>
          </div>

          {/* Lead facts grid */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5 p-2.5 bg-[var(--bg-secondary)] rounded-lg border border-[var(--border-color)]">
            <div>
              <span className="text-[10px] text-[var(--text-muted)] uppercase block">Customer Name</span>
              <input
                type="text"
                value={selectedScenario.name}
                onChange={(e) => setSelectedScenario({ ...selectedScenario, name: e.target.value })}
                className="w-full mt-0.5 px-2 py-1 bg-[var(--bg-primary)] border border-[var(--border-color)] rounded text-xs"
              />
            </div>
            <div>
              <span className="text-[10px] text-[var(--text-muted)] uppercase block">Loan Amount & Type</span>
              <input
                type="text"
                value={`${selectedScenario.loanAmount} ${selectedScenario.loanType}`}
                onChange={(e) => {
                  const parts = e.target.value.split(" ")
                  setSelectedScenario({
                    ...selectedScenario,
                    loanAmount: parts[0] || "",
                    loanType: parts.slice(1).join(" ") || "Loan",
                  })
                }}
                className="w-full mt-0.5 px-2 py-1 bg-[var(--bg-primary)] border border-[var(--border-color)] rounded text-xs"
              />
            </div>
            <div>
              <span className="text-[10px] text-[var(--text-muted)] uppercase block">Application Status</span>
              <div className="flex items-center gap-2 mt-1">
                <input
                  type="checkbox"
                  id="hasAppToggle"
                  checked={selectedScenario.hasApplication}
                  onChange={(e) => setSelectedScenario({ ...selectedScenario, hasApplication: e.target.checked })}
                  className="rounded accent-[var(--accent-blue)]"
                />
                <label htmlFor="hasAppToggle" className="cursor-pointer">
                  {selectedScenario.hasApplication ? "App on File (Ref: " + (selectedScenario.applicationRef || "LA-101") + ")" : "No App Yet (New Lead)"}
                </label>
              </div>
            </div>
            <div>
              <span className="text-[10px] text-[var(--text-muted)] uppercase block">Location / City</span>
              <input
                type="text"
                value={selectedScenario.city}
                onChange={(e) => setSelectedScenario({ ...selectedScenario, city: e.target.value })}
                className="w-full mt-0.5 px-2 py-1 bg-[var(--bg-primary)] border border-[var(--border-color)] rounded text-xs"
              />
            </div>
          </div>
        </div>
      )}

      {/* Main Body: Chat Stream & Right Inspector */}
      <div className="flex-1 flex overflow-hidden">
        {/* Chat Stream Window */}
        <div className="flex-1 flex flex-col justify-between overflow-hidden bg-[var(--bg-secondary)]">
          {/* Messages list */}
          <div className="flex-1 overflow-y-auto p-4 space-y-3.5">
            {messages.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-center p-6 text-[var(--text-muted)]">
                <div className="h-12 w-12 rounded-2xl bg-[var(--accent-blue)]/10 text-[var(--accent-blue)] flex items-center justify-center mb-3">
                  <Headphones size={24} />
                </div>
                <h4 className="font-semibold text-sm text-[var(--text-primary)] mb-1">
                  Ready to test Priya for {channel === "call" ? "Voice Calls" : channel === "whatsapp" ? "WhatsApp" : "Instagram"}
                </h4>
                <p className="text-xs max-w-md mb-4 text-[var(--text-muted)]">
                  Scenario: <strong className="text-[var(--text-primary)]">{selectedScenario.name}</strong> ({selectedScenario.hasApplication ? `App on File: ${selectedScenario.loanAmount} ${selectedScenario.loanType}` : "New Prospect"})
                </p>
                <div className="flex items-center gap-2">
                  <button
                    onClick={seedGreeting}
                    className="px-3 py-1.5 rounded-lg bg-[var(--accent-blue)] text-white text-xs font-medium hover:opacity-90 shadow-sm"
                  >
                    Simulate Priya&apos;s Greeting
                  </button>
                  <button
                    onClick={() => handleSendMessage(selectedScenario.hasApplication ? "Nenu loan form fill chesa, status enti?" : "Hello, loan kavali details cheppandi")}
                    className="px-3 py-1.5 rounded-lg bg-[var(--bg-primary)] border border-[var(--border-color)] text-xs font-medium hover:text-[var(--text-primary)]"
                  >
                    Send Customer Opening Question
                  </button>
                </div>
              </div>
            ) : (
              messages.map((m) => (
                <div
                  key={m.id}
                  className={`flex flex-col ${m.role === "user" ? "items-end" : "items-start"} max-w-[85%] ${
                    m.role === "user" ? "ml-auto" : "mr-auto"
                  }`}
                >
                  {/* Sender label */}
                  <div className="flex items-center gap-1.5 mb-1 px-1">
                    <span className="text-[11px] font-semibold text-[var(--text-secondary)]">
                      {m.role === "user" ? selectedScenario.name : "Priya (AI Advisor)"}
                    </span>
                    <span className="text-[10px] text-[var(--text-muted)]">{m.timestamp}</span>
                    {m.latencyMs && (
                      <span className="text-[10px] text-[var(--accent-blue)] font-mono">
                        ⚡ {m.latencyMs}ms
                      </span>
                    )}
                  </div>

                  {/* Bubble */}
                  <div
                    className={`rounded-2xl px-4 py-2.5 text-xs leading-relaxed shadow-sm relative ${
                      m.role === "user"
                        ? "bg-[var(--accent-blue)] text-white rounded-br-none"
                        : channel === "whatsapp"
                        ? "bg-[#1f2c34] text-gray-100 border border-emerald-900/50 rounded-bl-none font-sans"
                        : "bg-[var(--bg-primary)] text-[var(--text-primary)] border border-[var(--border-color)] rounded-bl-none"
                    }`}
                  >
                    <p className="whitespace-pre-wrap">{m.content}</p>

                    {/* Audio Player Button (For Call channel) */}
                    {m.role === "model" && channel === "call" && (
                      <div className="mt-2 pt-2 border-t border-[var(--border-color)]/40 flex items-center justify-between gap-2">
                        <button
                          onClick={() => playAudio(m.id, m.content)}
                          disabled={audioLoading === m.id}
                          className="flex items-center gap-1.5 text-[11px] font-medium text-[var(--accent-blue)] hover:underline"
                        >
                          {audioLoading === m.id ? (
                            <span className="inline-block animate-spin">⏳</span>
                          ) : activeAudioId === m.id ? (
                            <VolumeX size={13} className="text-red-400" />
                          ) : (
                            <Volume2 size={13} />
                          )}
                          <span>{activeAudioId === m.id ? "Stop Voice" : "🔊 Listen Voice"}</span>
                        </button>

                        {/* Call Hangup State Indicator */}
                        {m.hangup !== undefined && (
                          <span
                            className={`text-[10px] font-semibold px-2 py-0.5 rounded-full flex items-center gap-1 ${
                              m.hangup
                                ? "bg-red-500/15 text-red-400 border border-red-500/30"
                                : "bg-emerald-500/15 text-emerald-400 border border-emerald-500/30"
                            }`}
                          >
                            {m.hangup ? <PhoneOff size={10} /> : <Phone size={10} />}
                            {m.hangup ? "Call Ended (Hangup)" : "Call Live"}
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              ))
            )}

            {loading && (
              <div className="flex items-center gap-2 text-xs text-[var(--text-muted)] animate-pulse">
                <div className="h-2 w-2 rounded-full bg-[var(--accent-blue)] animate-ping" />
                <span>Priya is thinking & formulating reply...</span>
              </div>
            )}
            <div ref={chatEndRef} />
          </div>

          {/* Quick Suggestions Row */}
          <div className="px-3 py-1.5 bg-[var(--bg-primary)] border-t border-[var(--border-color)] flex items-center gap-2 overflow-x-auto text-[11px]">
            <span className="text-[10px] uppercase font-bold text-[var(--text-muted)] flex items-center gap-1 shrink-0">
              <Sparkles size={11} className="text-amber-400" /> Quick Tests:
            </span>
            <button
              onClick={() => handleSendMessage("Avunu nenu loan form fill chesa, status enti?")}
              className="px-2 py-1 bg-[var(--bg-secondary)] hover:bg-[var(--overlay-soft)] border border-[var(--border-color)] rounded text-[var(--text-secondary)] hover:text-[var(--text-primary)] shrink-0 transition-colors"
            >
              &quot;Application status enti?&quot;
            </button>
            <button
              onClick={() => handleSendMessage("Interest rate entha untundi sir?")}
              className="px-2 py-1 bg-[var(--bg-secondary)] hover:bg-[var(--overlay-soft)] border border-[var(--border-color)] rounded text-[var(--text-secondary)] hover:text-[var(--text-primary)] shrink-0 transition-colors"
            >
              &quot;Interest rate entha?&quot;
            </button>
            <button
              onClick={() => handleSendMessage("Processing fee entha untundi?")}
              className="px-2 py-1 bg-[var(--bg-secondary)] hover:bg-[var(--overlay-soft)] border border-[var(--border-color)] rounded text-[var(--text-secondary)] hover:text-[var(--text-primary)] shrink-0 transition-colors"
            >
              &quot;Processing fee?&quot;
            </button>
            <button
              onClick={() => handleSendMessage("Naa daggara salary slip ledu sir")}
              className="px-2 py-1 bg-[var(--bg-secondary)] hover:bg-[var(--overlay-soft)] border border-[var(--border-color)] rounded text-[var(--text-secondary)] hover:text-[var(--text-primary)] shrink-0 transition-colors"
            >
              &quot;Salary slip ledu (Doc doubt)&quot;
            </button>
            <button
              onClick={() => handleSendMessage("Inka em ledu sir, thank you bye")}
              className="px-2 py-1 bg-[var(--bg-secondary)] hover:bg-[var(--overlay-soft)] border border-[var(--border-color)] rounded text-red-400 hover:text-red-300 shrink-0 transition-colors"
            >
              &quot;Inka em ledu, bye (Finish call)&quot;
            </button>
          </div>

          {/* Input Box */}
          <div className="p-3 bg-[var(--bg-primary)] border-t border-[var(--border-color)] flex items-center gap-2">
            <input
              type="text"
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSendMessage()}
              placeholder={
                channel === "call"
                  ? "Type what customer speaks (e.g. 'Processing fee entha?', 'Inka em ledu')..."
                  : "Type what customer sends on WhatsApp..."
              }
              className="flex-1 px-3 py-2 bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded-lg text-xs text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:outline-none focus:border-[var(--accent-blue)]"
            />
            <button
              onClick={() => handleSendMessage()}
              disabled={loading || !inputText.trim()}
              className="px-4 py-2 bg-[var(--accent-blue)] text-white rounded-lg text-xs font-semibold hover:opacity-90 disabled:opacity-50 flex items-center gap-1.5 shadow-sm"
            >
              <span>Send</span>
              <Send size={13} />
            </button>

            {/* Inspector Toggle */}
            <button
              onClick={() => setShowInspector(!showInspector)}
              className={`p-2 rounded-lg border text-xs transition-colors ${
                showInspector
                  ? "bg-[var(--accent-blue)]/15 border-[var(--accent-blue)] text-[var(--accent-blue)]"
                  : "border-[var(--border-color)] text-[var(--text-muted)] hover:text-[var(--text-primary)]"
              }`}
              title="Toggle Rules & Context Inspector"
            >
              <Info size={14} />
            </button>
          </div>
        </div>

        {/* Right Rules & Context Inspector Panel */}
        {showInspector && (
          <div className="w-80 bg-[var(--bg-primary)] border-l border-[var(--border-color)] p-3.5 flex flex-col justify-between overflow-y-auto text-xs animate-fadeIn">
            <div className="space-y-3.5">
              <div className="flex items-center justify-between pb-2 border-b border-[var(--border-color)]">
                <span className="font-semibold text-[var(--text-primary)] flex items-center gap-1.5">
                  <Shield size={13} className="text-[var(--accent-green)]" />
                  Context &amp; Rules Inspector
                </span>
                <button
                  onClick={() => setShowInspector(false)}
                  className="text-[var(--text-muted)] hover:text-[var(--text-primary)] text-sm"
                >
                  ✕
                </button>
              </div>

              {/* Active Channel Mandates */}
              <div>
                <span className="text-[10px] uppercase font-bold text-[var(--text-muted)] block mb-1">
                  Active Channel Rules
                </span>
                <div className="p-2.5 bg-[var(--bg-secondary)] rounded-lg border border-[var(--border-color)] space-y-1.5 text-[11px]">
                  <div className="flex items-center gap-1.5 text-[var(--text-primary)] font-medium">
                    <CheckCircle2 size={12} className="text-[var(--accent-green)]" />
                    <span>Channel: {channel.toUpperCase()}</span>
                  </div>
                  <div className="text-[var(--text-muted)]">
                    {channel === "call"
                      ? "Brevity Mandate: 1-2 spoken sentences only. Spoken English words for numbers. Proactively asks for doubts."
                      : channel === "whatsapp"
                      ? "WhatsApp Mandate: Mobile readable text. Roman letters for ops dashboard readability."
                      : "Instagram Mandate: Social media hook, DM conversation to lead conversion."}
                  </div>
                </div>
              </div>

              {/* Lead Brain Context Injected */}
              <div>
                <span className="text-[10px] uppercase font-bold text-[var(--text-muted)] block mb-1">
                  Lead Brain Stage
                </span>
                <div className="p-2.5 bg-[var(--bg-secondary)] rounded-lg border border-[var(--border-color)] text-[11px] space-y-1">
                  <div className="font-semibold text-[var(--text-primary)]">
                    {selectedScenario.hasApplication ? "Case 1: Returning Applicant" : "Case 2: New Prospect"}
                  </div>
                  <p className="text-[var(--text-muted)] text-[10.5px]">
                    {selectedScenario.hasApplication
                      ? "App is on record. Model is instructed NEVER to ask for re-application, acknowledge submitted form, clarify doubts, and wait for customer to finish."
                      : "No application on file. Model will pitch loan benefits and offer simple WhatsApp application link."}
                  </p>
                </div>
              </div>

              {/* Last Turn Knowledge Base Hits */}
              {lastAiMessage?.contextUsed && (
                <div>
                  <span className="text-[10px] uppercase font-bold text-[var(--text-muted)] block mb-1">
                    Knowledge Base Hits (Last Turn)
                  </span>
                  <div className="p-2.5 bg-[var(--bg-secondary)] rounded-lg border border-[var(--border-color)] text-[10.5px] text-[var(--text-muted)] max-h-36 overflow-y-auto whitespace-pre-wrap font-mono">
                    {lastAiMessage.contextUsed.kbMatches || "No FAQ match needed for this turn"}
                  </div>
                </div>
              )}

              {/* Call Hangup Radar */}
              {channel === "call" && lastAiMessage && (
                <div>
                  <span className="text-[10px] uppercase font-bold text-[var(--text-muted)] block mb-1">
                    Call Hangup Radar
                  </span>
                  <div className="p-2.5 bg-[var(--bg-secondary)] rounded-lg border border-[var(--border-color)] space-y-1 text-[11px]">
                    <div className="flex items-center justify-between">
                      <span>Customer Finished?</span>
                      <span className="font-semibold text-[var(--text-primary)]">
                        {lastAiMessage.hangup ? "Yes (Sign-off matched)" : "No (Questions active)"}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span>Server Hangup Emitted:</span>
                      <span
                        className={`font-semibold ${
                          lastAiMessage.hangup ? "text-red-400" : "text-emerald-400"
                        }`}
                      >
                        {lastAiMessage.hangup ? "true (End of Call)" : "false (Keep Line Open)"}
                      </span>
                    </div>
                  </div>
                </div>
              )}
            </div>

            <div className="pt-3 border-t border-[var(--border-color)] text-[10px] text-[var(--text-muted)] flex items-center gap-1">
              <Clock size={11} />
              <span>Real-time response from Sarvam AI / Groq backend</span>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
