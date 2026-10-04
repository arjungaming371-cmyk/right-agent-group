"use client"
import { useEffect, useRef, useState } from "react"
import { Palette, Check } from "lucide-react"
import { THEMES, type ThemeId, getStoredTheme, setTheme } from "@/lib/theme"

// Sectioned like the theme pickers in website builders: the famous looks
// people ask for by name first, the in-house core set below.
const GROUPS: { id: "popular" | "core"; title: string }[] = [
  { id: "popular", title: "Popular" },
  { id: "core", title: "Core" },
]

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
            position: "absolute", right: 0, top: 44, width: 252,
            borderRadius: 12, padding: 8, zIndex: 50,
            boxShadow: "0 20px 50px -12px rgba(0,0,0,0.55)",
            animation: "paletteIn 0.15s ease",
            maxHeight: "min(520px, calc(100vh - 120px))", overflowY: "auto",
          }}
        >
          <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.06em", color: "var(--text-muted)", padding: "6px 10px 8px", textTransform: "uppercase" }}>
            Theme
          </div>
          {GROUPS.map(g => {
            const items = THEMES.filter(t => t.group === g.id)
            if (!items.length) return null
            return (
              <div key={g.id} style={{ marginBottom: 6 }}>
                <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: "0.08em", color: "var(--text-muted)", padding: "4px 10px 5px", textTransform: "uppercase" }}>
                  {g.title}
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
                  {items.map(t => {
                    const isActive = active === t.id
                    return (
                      <button
                        key={t.id}
                        onClick={() => pick(t.id)}
                        title={t.blurb}
                        aria-pressed={isActive}
                        style={{
                          display: "flex", alignItems: "center", gap: 8,
                          background: isActive ? "var(--overlay-chip)" : "transparent",
                          border: `1px solid ${isActive ? "var(--accent-violet)" : "var(--border)"}`,
                          borderRadius: 9, padding: "7px 8px", cursor: "pointer",
                          color: "var(--text-primary)", textAlign: "left",
                          boxShadow: isActive ? "0 0 0 1px var(--accent-violet)" : "none",
                        }}
                      >
                        <div style={{ display: "flex", borderRadius: 5, overflow: "hidden", border: "1px solid var(--border)", flexShrink: 0 }}>
                          {t.swatch.map((c, i) => (
                            <div key={i} style={{ width: 7, height: 26, background: c }} />
                          ))}
                        </div>
                        <span style={{ flex: 1, minWidth: 0 }}>
                          <span style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 12.5, fontWeight: 600, lineHeight: 1.25 }}>
                            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.label}</span>
                            {isActive && <Check size={13} strokeWidth={2.6} style={{ color: "var(--accent-violet)", flexShrink: 0 }} />}
                          </span>
                          <span style={{ display: "block", fontSize: 10, color: "var(--text-muted)", lineHeight: 1.3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {t.blurb}
                          </span>
                        </span>
                      </button>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
