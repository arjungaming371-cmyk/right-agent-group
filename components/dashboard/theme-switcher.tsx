"use client"
import { useEffect, useRef, useState } from "react"
import { Palette, Check } from "lucide-react"
import { THEMES, type ThemeId, getStoredTheme, setTheme } from "@/lib/theme"

export default function ThemeSwitcher() {
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState<ThemeId>("dark")
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setActive(getStoredTheme())
  }, [])

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener("mousedown", onClickOutside)
    return () => document.removeEventListener("mousedown", onClickOutside)
  }, [])

  function pick(id: ThemeId) {
    setTheme(id)
    setActive(id)
    setOpen(false)
  }

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button
        onClick={() => setOpen(v => !v)}
        aria-label="Change theme"
        title="Change theme"
        className="icon-btn"
      >
        <Palette size={16} strokeWidth={2} />
      </button>

      {open && (
        <div
          className="glass"
          style={{
            position: "absolute", right: 0, top: 44, width: 220,
            borderRadius: 12, padding: 8, zIndex: 50,
            boxShadow: "0 20px 50px -12px rgba(0,0,0,0.55)",
            animation: "paletteIn 0.15s ease",
          }}
        >
          <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.06em", color: "var(--text-muted)", padding: "6px 10px 8px", textTransform: "uppercase" }}>
            Theme
          </div>
          {THEMES.map(t => (
            <button
              key={t.id}
              onClick={() => pick(t.id)}
              style={{
                width: "100%", display: "flex", alignItems: "center", gap: 10,
                background: active === t.id ? "rgba(139,124,255,0.1)" : "transparent",
                border: "none", borderRadius: 8, padding: "8px 10px", cursor: "pointer",
                color: "var(--text-primary)", fontSize: 13, textAlign: "left",
              }}
            >
              <div style={{ display: "flex", borderRadius: 6, overflow: "hidden", border: "1px solid var(--border)", flexShrink: 0 }}>
                {t.swatch.map((c, i) => (
                  <div key={i} style={{ width: 10, height: 20, background: c }} />
                ))}
              </div>
              <span style={{ flex: 1 }}>{t.label}</span>
              {active === t.id && <Check size={14} strokeWidth={2.4} style={{ color: "var(--accent-violet)", flexShrink: 0 }} />}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
