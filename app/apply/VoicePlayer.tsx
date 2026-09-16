"use client"
import { useRef, useState } from "react"
import { Play, Pause, Loader2 } from "lucide-react"

export function VoicePlayer({ label, flag, blurb, src }: { label: string; flag: string; blurb: string; src: string }) {
  const audioRef = useRef<HTMLAudioElement>(null)
  const [playing, setPlaying] = useState(false)
  const [loading, setLoading] = useState(false)

  const toggle = () => {
    const a = audioRef.current
    if (!a) return
    if (playing) {
      a.pause()
    } else {
      setLoading(true)
      a.play().catch(() => setLoading(false))
    }
  }

  return (
    <div className="card" style={{ padding: 22 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 6 }}>
        <span style={{ fontSize: 26 }}>{flag}</span>
        <div>
          <div style={{ fontWeight: 700, fontSize: 15, color: "var(--text-primary)" }}>{label}</div>
          <div style={{ fontSize: 12, color: "var(--text-muted)" }}>{blurb}</div>
        </div>
      </div>

      <div
        style={{
          display: "flex",
          gap: 3,
          alignItems: "flex-end",
          height: 36,
          margin: "16px 0",
          justifyContent: "center",
        }}
      >
        {Array.from({ length: 28 }).map((_, i) => (
          <span
            key={i}
            style={{
              width: 3,
              borderRadius: 2,
              background: playing ? "var(--gradient-brand)" : "var(--border-light)",
              height: "100%",
              transformOrigin: "bottom",
              animation: playing ? `audioBar ${0.5 + (i % 5) * 0.12}s ease-in-out infinite` : "none",
              animationDelay: `${i * 0.025}s`,
              transform: playing ? undefined : "scaleY(0.25)",
              transition: "background 0.2s",
            }}
          />
        ))}
      </div>

      <button onClick={toggle} className="btn-primary" style={{ width: "100%" }}>
        {loading && !playing ? <Loader2 size={16} className="spin" /> : playing ? <Pause size={16} /> : <Play size={16} />}
        {playing ? "Pause" : "Play sample"}
      </button>

      <audio
        ref={audioRef}
        src={src}
        preload="none"
        onCanPlay={() => setLoading(false)}
        onPlay={() => {
          setPlaying(true)
          setLoading(false)
        }}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
      />
    </div>
  )
}
