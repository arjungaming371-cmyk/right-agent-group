"use client"

import { useState, useRef, useEffect } from "react"
import { Play, Pause, Volume2, ShieldCheck, Zap, Sparkles, CheckCircle2, MessageCircle, FileText } from "lucide-react"

type VoiceTrack = {
  id: string
  language: string
  nativeName: string
  dialect: string
  audioSrc: string
  duration: string
  persona: string
  loanType: string
  amount: string
  dialogue: Array<{ speaker: "Priya" | "Customer"; text: string; translation?: string }>
  extractedData: {
    customerName: string
    requestedAmount: string
    monthlyIncome: string
    cibilStatus: string
    urgency: string
    actionTaken: string
  }
}

const TRACKS: VoiceTrack[] = [
  {
    id: "telugu",
    language: "Telugu",
    nativeName: "తెలుగు",
    dialect: "Hyderabad / Telangana Vernacular",
    audioSrc: "/promo/audio/priya-telugu.mp3",
    duration: "0:42",
    persona: "Priya (Senior Loan Advisor)",
    loanType: "Personal Loan",
    amount: "₹5,00,000",
    dialogue: [
      {
        speaker: "Priya",
        text: "నమస్కారం సార్! నేను Right Agent Group నుండి ప్రియా మాట్లాడుతున్నాను. మీరు ₹5 లక్షల పర్సనల్ లోన్ కోసం వివరాలు అడిగారు కదా, ఒకసారి మాట్లాడవచ్చా?",
        translation: "Hello sir! I am Priya calling from Right Agent Group. You enquired about a ₹5 Lakh personal loan, may I take 2 minutes?"
      },
      {
        speaker: "Customer",
        text: "అవును మేడమ్, నాకు అర్జెంట్‌గా కావాలి. వడ్డీ రేటు ఎంత ఉంటుంది?",
        translation: "Yes madam, I need it urgently. What will be the interest rate?"
      },
      {
        speaker: "Priya",
        text: "మీ శాలరీ మరియు CIBIL బట్టి 10.5% నుండి స్టార్ట్ అవుతుంది సార్. మీ WhatsApp కి డాక్యుమెంట్ సబ్మిషన్ లింక్ పంపించాను, ఒక్క నిమిషంలో అప్లై చేసుకోవచ్చు.",
        translation: "Starts from 10.5% based on your salary and CIBIL. I have sent the 1-click application link to your WhatsApp right now."
      }
    ],
    extractedData: {
      customerName: "Suresh Reddy",
      requestedAmount: "₹5,00,000",
      monthlyIncome: "₹65,000 / month",
      cibilStatus: "760+ (Pre-Approved)",
      urgency: "Immediate Disbursal",
      actionTaken: "WhatsApp Form Sent (Mid-Call)"
    }
  },
  {
    id: "hindi",
    language: "Hindi",
    nativeName: "हिन्दी",
    dialect: "Conversational Hinglish / North India",
    audioSrc: "/promo/audio/priya-hindi.mp3",
    duration: "0:48",
    persona: "Priya (Loan Specialist)",
    loanType: "Business / Personal Loan",
    amount: "₹10,00,000",
    dialogue: [
      {
        speaker: "Priya",
        text: "नमस्ते सर! मैं Right Agent Group से प्रिया बात कर रही हूँ। आपने ₹10 लाख के बिज़नेस लोन के लिए इन्क्वायरी की थी। क्या हम 2 मिनट बात कर सकते हैं?",
        translation: "Hello sir! Priya here from Right Agent Group. You enquired about a ₹10 Lakh business loan. Can we speak for 2 minutes?"
      },
      {
        speaker: "Customer",
        text: "हाँ प्रिया जी, मुझे अपनी शॉप एक्सपेंशन के लिए फंड्स चाहिए। प्रोसेस कितना टाइम लेगा?",
        translation: "Yes Priya ji, I need funds for shop expansion. How much time does the process take?"
      },
      {
        speaker: "Priya",
        text: "सिर्फ 24 घंटे में अप्रूवल हो जाता है सर। मैंने आपके WhatsApp पर ऑफिशियल एप्लीकेशन लिंक भेज दिया है। आप अभी डॉक्युमेंट्स अपलोड कर सकते हैं।",
        translation: "Approval takes just 24 hours sir. I have dispatched the official application link to your WhatsApp. You can upload docs now."
      }
    ],
    extractedData: {
      customerName: "Rajesh Sharma",
      requestedAmount: "₹10,00,000",
      monthlyIncome: "₹1,20,000 / month (GST)",
      cibilStatus: "740 (Eligible)",
      urgency: "Within 48 Hours",
      actionTaken: "WhatsApp Form Sent & KYC Scheduled"
    }
  },
  {
    id: "english",
    language: "Indian English",
    nativeName: "English",
    dialect: "Professional Indian Accent",
    audioSrc: "/promo/audio/priya-english.mp3",
    duration: "0:39",
    persona: "Priya (Executive Advisor)",
    loanType: "Home Loan / Balance Transfer",
    amount: "₹35,00,000",
    dialogue: [
      {
        speaker: "Priya",
        text: "Good morning! This is Priya from Right Agent Group following up on your Home Loan Balance Transfer inquiry. Is this a good time to connect?",
        translation: "Connecting on Home Loan Balance Transfer inquiry with reduced EMI."
      },
      {
        speaker: "Customer",
        text: "Yes Priya, I am currently paying 9.4% on my existing mortgage. Can you offer a better rate?",
        translation: "Looking to reduce existing 9.4% mortgage interest rate."
      },
      {
        speaker: "Priya",
        text: "Certainly! We have partner banks offering 8.5% which can save you up to ₹12,000 every month on EMIs. I'm texting the rate comparison straight to your WhatsApp right now.",
        translation: "Offering 8.5% partner rate saving ₹12,000 monthly, sent to WhatsApp."
      }
    ],
    extractedData: {
      customerName: "Vikram Malhotra",
      requestedAmount: "₹35,00,000",
      monthlyIncome: "₹1,85,000 / month",
      cibilStatus: "790 (Prime Borrower)",
      urgency: "Next Billing Cycle",
      actionTaken: "Rate Comparison & Form on WhatsApp"
    }
  }
]

export default function VoiceSamplePlayer() {
  const [activeTab, setActiveTab] = useState<string>("telugu")
  const [isPlaying, setIsPlaying] = useState<boolean>(false)
  const [currentTime, setCurrentTime] = useState<number>(0)
  const [duration, setDuration] = useState<number>(0)
  const audioRef = useRef<HTMLAudioElement | null>(null)

  const activeTrack = TRACKS.find((t) => t.id === activeTab) || TRACKS[0]

  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.pause()
      audioRef.current.currentTime = 0
      setIsPlaying(false)
      setCurrentTime(0)
    }
  }, [activeTab])

  const togglePlay = () => {
    if (!audioRef.current) return
    if (isPlaying) {
      audioRef.current.pause()
      setIsPlaying(false)
    } else {
      audioRef.current.play().then(() => setIsPlaying(true)).catch(() => setIsPlaying(false))
    }
  }

  const handleTimeUpdate = () => {
    if (audioRef.current) {
      setCurrentTime(audioRef.current.currentTime)
    }
  }

  const handleLoadedMetadata = () => {
    if (audioRef.current) {
      setDuration(audioRef.current.duration)
    }
  }

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const time = parseFloat(e.target.value)
    if (audioRef.current) {
      audioRef.current.currentTime = time
      setCurrentTime(time)
    }
  }

  const formatSeconds = (sec: number) => {
    const m = Math.floor(sec / 60)
    const s = Math.floor(sec % 60)
    return `${m}:${s < 10 ? "0" : ""}${s}`
  }

  return (
    <div style={{ maxWidth: 1140, margin: "0 auto", padding: "0 clamp(18px, 4vw, 40px)" }}>
      <audio
        ref={audioRef}
        src={activeTrack.audioSrc}
        onTimeUpdate={handleTimeUpdate}
        onLoadedMetadata={handleLoadedMetadata}
        onEnded={() => setIsPlaying(false)}
        preload="metadata"
      />

      <div
        className="rg-glass"
        style={{
          padding: "clamp(24px, 4vw, 40px)",
          borderRadius: 24,
          border: "1px solid rgba(139,124,255,0.2)",
          background: "linear-gradient(180deg, rgba(17,24,39,0.85) 0%, rgba(10,14,24,0.95) 100%)",
          boxShadow: "0 24px 60px -20px rgba(0,0,0,0.8), 0 0 40px -10px rgba(139,124,255,0.15)",
        }}
      >
        {/* Header with Language Tabs */}
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 16, marginBottom: 28 }}>
          <div>
            <div className="rg-eyebrow" style={{ marginBottom: 10 }}>
              <Volume2 size={13} />
              Hear Priya In Action — Real Indian Loan Telecalling
            </div>
            <h3 className="rg-h3" style={{ margin: 0 }}>
              Natural Indic Voice, Sub-400ms Latency & Instant In-Call Actions
            </h3>
          </div>

          {/* Language Selector Tabs */}
          <div
            style={{
              display: "inline-flex",
              background: "rgba(255,255,255,0.05)",
              border: "1px solid rgba(255,255,255,0.1)",
              borderRadius: 14,
              padding: 4,
              gap: 4,
            }}
          >
            {TRACKS.map((t) => {
              const active = t.id === activeTab
              return (
                <button
                  key={t.id}
                  onClick={() => setActiveTab(t.id)}
                  style={{
                    border: "none",
                    background: active ? "linear-gradient(135deg, #8b7cff 0%, #5b7cfa 100%)" : "transparent",
                    color: active ? "#fff" : "#9aa5bd",
                    fontWeight: active ? 700 : 500,
                    fontSize: 13.5,
                    padding: "8px 16px",
                    borderRadius: 10,
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    transition: "all .15s ease",
                  }}
                >
                  <span>{t.nativeName}</span>
                  <span style={{ fontSize: 11, opacity: active ? 0.9 : 0.6 }}>({t.language})</span>
                </button>
              )
            })}
          </div>
        </div>

        {/* Audio Player Bar */}
        <div
          style={{
            background: "rgba(139,124,255,0.06)",
            border: "1px solid rgba(139,124,255,0.25)",
            borderRadius: 16,
            padding: "16px 22px",
            display: "flex",
            alignItems: "center",
            gap: 18,
            marginBottom: 28,
          }}
        >
          {/* Play/Pause Button */}
          <button
            onClick={togglePlay}
            style={{
              width: 52,
              height: 52,
              borderRadius: 26,
              background: isPlaying
                ? "linear-gradient(135deg, #f43f5e 0%, #e11d48 100%)"
                : "linear-gradient(135deg, #8b7cff 0%, #5b7cfa 100%)",
              color: "#fff",
              border: "none",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              cursor: "pointer",
              boxShadow: "0 8px 24px -4px rgba(91,124,250,0.6)",
              transition: "transform .15s ease",
              flexShrink: 0,
            }}
            title={isPlaying ? "Pause audio" : "Play audio sample"}
          >
            {isPlaying ? <Pause size={22} /> : <Play size={22} style={{ marginLeft: 2 }} />}
          </button>

          {/* Track details & scrubber */}
          <div style={{ flex: 1, minWidth: 200 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{ fontWeight: 700, fontSize: 14.5, color: "#fff" }}>
                  {activeTrack.persona}
                </span>
                <span style={{ fontSize: 12, color: "#a5b0ff", background: "rgba(139,124,255,0.15)", padding: "2px 8px", borderRadius: 6 }}>
                  {activeTrack.dialect}
                </span>
              </div>
              <span style={{ fontSize: 12.5, color: "#9aa5bd", fontVariantNumeric: "tabular-nums" }}>
                {formatSeconds(currentTime)} / {duration > 0 ? formatSeconds(duration) : activeTrack.duration}
              </span>
            </div>

            {/* Range Scrubber */}
            <input
              type="range"
              min={0}
              max={duration || 100}
              value={currentTime}
              onChange={handleSeek}
              style={{
                width: "100%",
                accentColor: "#8b7cff",
                height: 5,
                borderRadius: 4,
                cursor: "pointer",
              }}
            />
          </div>

          {/* Animated Waveform Bars */}
          <div style={{ display: "flex", alignItems: "center", gap: 3, height: 28, paddingRight: 6 }}>
            {[14, 22, 10, 26, 18, 12, 28, 20, 16, 24].map((h, i) => (
              <span
                key={i}
                style={{
                  width: 3,
                  height: isPlaying ? `${h}px` : "6px",
                  borderRadius: 2,
                  background: isPlaying ? "#8b7cff" : "rgba(255,255,255,0.2)",
                  transition: "height 0.2s ease",
                  animation: isPlaying ? `rg-pulse 0.${(i % 5) + 3}s ease-in-out infinite alternate` : "none",
                }}
              />
            ))}
          </div>
        </div>

        {/* 2-Column Live Call & Lead Brain Simulation */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 24 }}>
          {/* Left: Call Dialogue Bubbles */}
          <div
            style={{
              background: "rgba(0,0,0,0.4)",
              border: "1px solid rgba(255,255,255,0.06)",
              borderRadius: 18,
              padding: 20,
              display: "flex",
              flexDirection: "column",
              gap: 14,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", borderBottom: "1px solid rgba(255,255,255,0.06)", paddingBottom: 10 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ width: 8, height: 8, borderRadius: 4, background: "#2dd4a0" }} />
                <span style={{ fontSize: 13, fontWeight: 600, color: "#eef1f7" }}>Live Telephony Transcript</span>
              </div>
              <span style={{ fontSize: 11.5, color: "#727e9c" }}>Telemetry: 380ms Latency</span>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {activeTrack.dialogue.map((item, idx) => {
                const isAI = item.speaker === "Priya"
                return (
                  <div
                    key={idx}
                    style={{
                      alignSelf: isAI ? "flex-start" : "flex-end",
                      maxWidth: "88%",
                      background: isAI ? "rgba(139,124,255,0.12)" : "rgba(255,255,255,0.06)",
                      border: isAI ? "1px solid rgba(139,124,255,0.25)" : "1px solid rgba(255,255,255,0.1)",
                      borderRadius: 14,
                      padding: "10px 14px",
                    }}
                  >
                    <div style={{ fontSize: 11, fontWeight: 700, color: isAI ? "#a5b0ff" : "#38bdf8", marginBottom: 4 }}>
                      {item.speaker} {isAI && <span style={{ opacity: 0.7 }}>(Right Agent Group AI)</span>}
                    </div>
                    <div style={{ fontSize: 13.5, lineHeight: 1.5, color: "#fff" }}>
                      {item.text}
                    </div>
                    {item.translation && (
                      <div style={{ fontSize: 11.5, color: "#9aa5bd", marginTop: 4, fontStyle: "italic" }}>
                        &quot;{item.translation}&quot;
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>

          {/* Right: Live Lead Brain & Disbursal Actions */}
          <div
            style={{
              background: "rgba(0,0,0,0.4)",
              border: "1px solid rgba(255,255,255,0.06)",
              borderRadius: 18,
              padding: 20,
              display: "flex",
              flexDirection: "column",
              justifyContent: "space-between",
            }}
          >
            <div>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", borderBottom: "1px solid rgba(255,255,255,0.06)", paddingBottom: 10, marginBottom: 16 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <Sparkles size={14} color="#8b7cff" />
                  <span style={{ fontSize: 13, fontWeight: 600, color: "#eef1f7" }}>Real-Time CRM & Lead Brain Extraction</span>
                </div>
                <span style={{ fontSize: 11.5, color: "#2dd4a0", display: "flex", alignItems: "center", gap: 4 }}>
                  <CheckCircle2 size={12} /> Sync Active
                </span>
              </div>

              {/* Extracted Fields Grid */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 18 }}>
                <div style={{ background: "rgba(255,255,255,0.03)", padding: "8px 12px", borderRadius: 10 }}>
                  <div style={{ fontSize: 11, color: "#727e9c" }}>Borrower Name</div>
                  <div style={{ fontSize: 13.5, fontWeight: 600, color: "#fff", marginTop: 2 }}>
                    {activeTrack.extractedData.customerName}
                  </div>
                </div>

                <div style={{ background: "rgba(255,255,255,0.03)", padding: "8px 12px", borderRadius: 10 }}>
                  <div style={{ fontSize: 11, color: "#727e9c" }}>Requested Amount</div>
                  <div style={{ fontSize: 13.5, fontWeight: 600, color: "#38bdf8", marginTop: 2 }}>
                    {activeTrack.extractedData.requestedAmount}
                  </div>
                </div>

                <div style={{ background: "rgba(255,255,255,0.03)", padding: "8px 12px", borderRadius: 10 }}>
                  <div style={{ fontSize: 11, color: "#727e9c" }}>Monthly Income</div>
                  <div style={{ fontSize: 13.5, fontWeight: 600, color: "#fff", marginTop: 2 }}>
                    {activeTrack.extractedData.monthlyIncome}
                  </div>
                </div>

                <div style={{ background: "rgba(255,255,255,0.03)", padding: "8px 12px", borderRadius: 10 }}>
                  <div style={{ fontSize: 11, color: "#727e9c" }}>CIBIL & Bureau Score</div>
                  <div style={{ fontSize: 13.5, fontWeight: 600, color: "#2dd4a0", marginTop: 2 }}>
                    {activeTrack.extractedData.cibilStatus}
                  </div>
                </div>
              </div>
            </div>

            {/* In-Call Action Highlight */}
            <div
              style={{
                background: "linear-gradient(135deg, rgba(37,211,102,0.12) 0%, rgba(37,211,102,0.03) 100%)",
                border: "1px solid rgba(37,211,102,0.25)",
                borderRadius: 14,
                padding: "12px 16px",
                display: "flex",
                alignItems: "center",
                gap: 12,
              }}
            >
              <div
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: 18,
                  background: "#25d366",
                  color: "#05070c",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flexShrink: 0,
                }}
              >
                <MessageCircle size={20} />
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: "#25d366" }}>
                  Automated Meta Cloud WhatsApp Handoff
                </div>
                <div style={{ fontSize: 12, color: "#c6cede", marginTop: 2 }}>
                  {activeTrack.extractedData.actionTaken} — Pre-filled 1-time form link with 0-login friction.
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Feature Badges below player */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
            gap: 16,
            marginTop: 28,
            paddingTop: 20,
            borderTop: "1px solid rgba(255,255,255,0.06)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 10, color: "#c6cede", fontSize: 13 }}>
            <Zap size={16} color="#38bdf8" />
            <span><strong>&lt; 400ms Turn Latency</strong> — Real-time conversational speed</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10, color: "#c6cede", fontSize: 13 }}>
            <ShieldCheck size={16} color="#2dd4a0" />
            <span><strong>TRAI & DLT Compliant</strong> — 140-series & DND scrubbed</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10, color: "#c6cede", fontSize: 13 }}>
            <FileText size={16} color="#8b7cff" />
            <span><strong>Zero Lost Details</strong> — Full call audio & audit logging</span>
          </div>
        </div>
      </div>
    </div>
  )
}
