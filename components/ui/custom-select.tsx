"use client"

import React, { useEffect, useRef, useState } from "react"
import { Check, ChevronDown } from "lucide-react"

export type CustomSelectOption = {
  value: string
  label: string
  dotColor?: string
  icon?: React.ReactNode
  accent?: boolean
  dividerBefore?: boolean
}

interface CustomSelectProps {
  value: string
  onChange: (value: string) => void
  options: CustomSelectOption[]
  disabled?: boolean
  placeholder?: string
  title?: string
  triggerStyle?: React.CSSProperties
  menuAlign?: "left" | "right"
  compact?: boolean
}

export default function CustomSelect({
  value,
  onChange,
  options,
  disabled = false,
  placeholder = "Select...",
  title,
  triggerStyle,
  menuAlign = "left",
  compact = false,
}: CustomSelectProps) {
  const [open, setOpen] = useState(false)
  const [coords, setCoords] = useState<{ top: number; left: number; width: number; openUp: boolean }>({
    top: 0,
    left: 0,
    width: 200,
    openUp: false,
  })
  const containerRef = useRef<HTMLDivElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  const selected = options.find((o) => o.value === value)

  function updatePosition() {
    if (!containerRef.current) return
    const rect = containerRef.current.getBoundingClientRect()
    const spaceBelow = window.innerHeight - rect.bottom
    const openUp = spaceBelow < 220 && rect.top > 240
    setCoords({
      top: openUp ? rect.top - 5 : rect.bottom + 5,
      left: menuAlign === "right" ? rect.right : rect.left,
      width: rect.width,
      openUp,
    })
  }

  useEffect(() => {
    if (!open) return
    updatePosition()
    function onDocClick(e: MouseEvent) {
      const target = e.target as Node
      if (
        containerRef.current &&
        !containerRef.current.contains(target) &&
        (!menuRef.current || !menuRef.current.contains(target))
      ) {
        setOpen(false)
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false)
    }
    function onScrollOrResize() {
      setOpen(false)
    }
    document.addEventListener("mousedown", onDocClick)
    document.addEventListener("keydown", onKey)
    window.addEventListener("resize", onScrollOrResize)
    window.addEventListener("scroll", onScrollOrResize, true)
    return () => {
      document.removeEventListener("mousedown", onDocClick)
      document.removeEventListener("keydown", onKey)
      window.removeEventListener("resize", onScrollOrResize)
      window.removeEventListener("scroll", onScrollOrResize, true)
    }
  }, [open])

  return (
    <div
      ref={containerRef}
      style={{ position: "relative", width: "100%", display: "inline-block" }}
      title={title}
    >
      <button
        type="button"
        disabled={disabled}
        onClick={() => {
          if (disabled) return
          if (!open) updatePosition()
          setOpen((v) => !v)
        }}
        style={{
          width: "100%",
          height: compact ? 32 : 36,
          padding: compact ? "0 10px" : "0 12px",
          borderRadius: 8,
          border: open ? "1px solid var(--accent-blue)" : "1px solid var(--border)",
          background: "var(--bg-secondary)",
          color: "var(--text-primary)",
          fontSize: compact ? 12 : 12.5,
          fontWeight: 500,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
          cursor: disabled ? "not-allowed" : "pointer",
          opacity: disabled ? 0.6 : 1,
          outline: "none",
          transition: "border-color 0.15s ease, background 0.15s ease",
          boxShadow: open ? "var(--focus-ring)" : "none",
          ...triggerStyle,
        }}
      >
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 7,
            minWidth: 0,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {selected?.dotColor && (
            <span
              style={{
                width: 7,
                height: 7,
                borderRadius: "50%",
                background: selected.dotColor,
                flexShrink: 0,
              }}
            />
          )}
          {selected?.icon && (
            <span style={{ display: "inline-flex", alignItems: "center", flexShrink: 0 }}>
              {selected.icon}
            </span>
          )}
          <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>
            {selected ? selected.label : placeholder}
          </span>
        </span>
        <ChevronDown
          size={14}
          strokeWidth={2}
          style={{
            flexShrink: 0,
            color: "var(--text-muted)",
            transform: open ? "rotate(180deg)" : "rotate(0deg)",
            transition: "transform 0.15s ease",
          }}
        />
      </button>

      {open && (
        <div
          ref={menuRef}
          style={{
            position: "fixed",
            top: coords.top,
            left: menuAlign === "right" ? undefined : coords.left,
            right: menuAlign === "right" ? window.innerWidth - coords.left : undefined,
            transform: coords.openUp ? "translateY(-100%)" : undefined,
            minWidth: coords.width,
            width: "max-content",
            maxWidth: 290,
            maxHeight: 250,
            overflowY: "auto",
            background: "var(--bg-card)",
            border: "1px solid var(--border)",
            borderRadius: 10,
            padding: 5,
            boxShadow: "var(--shadow-soft)",
            zIndex: 9999,
          }}
        >
          {options.map((opt) => {
            const isSel = opt.value === value
            return (
              <React.Fragment key={opt.value}>
                {opt.dividerBefore && (
                  <div
                    style={{
                      height: 1,
                      background: "var(--border-light)",
                      margin: "4px 6px",
                    }}
                  />
                )}
                <button
                  type="button"
                  onClick={() => {
                    onChange(opt.value)
                    setOpen(false)
                  }}
                  style={{
                    width: "100%",
                    textAlign: "left",
                    padding: "7px 10px",
                    borderRadius: 7,
                    border: "none",
                    background: isSel ? "var(--overlay-chip)" : "transparent",
                    color: opt.accent
                      ? "var(--accent-violet)"
                      : isSel
                        ? "var(--text-primary)"
                        : "var(--text-secondary)",
                    fontSize: 12.5,
                    fontWeight: isSel || opt.accent ? 600 : 500,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 8,
                    cursor: "pointer",
                    transition: "background 0.12s ease, color 0.12s ease",
                  }}
                  onMouseEnter={(e) => {
                    if (!isSel) e.currentTarget.style.background = "var(--bg-card-hover)"
                    e.currentTarget.style.color = opt.accent ? "var(--accent-violet)" : "var(--text-primary)"
                  }}
                  onMouseLeave={(e) => {
                    if (!isSel) e.currentTarget.style.background = "transparent"
                    e.currentTarget.style.color = opt.accent
                      ? "var(--accent-violet)"
                      : isSel
                        ? "var(--text-primary)"
                        : "var(--text-secondary)"
                  }}
                >
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                    {opt.dotColor && (
                      <span
                        style={{
                          width: 7,
                          height: 7,
                          borderRadius: "50%",
                          background: opt.dotColor,
                          flexShrink: 0,
                        }}
                      />
                    )}
                    {opt.icon && (
                      <span style={{ display: "inline-flex", alignItems: "center", flexShrink: 0 }}>
                        {opt.icon}
                      </span>
                    )}
                    <span style={{ whiteSpace: "nowrap" }}>{opt.label}</span>
                  </span>
                  {isSel && !opt.accent && (
                    <Check size={13} strokeWidth={2.4} style={{ color: "var(--accent-blue)", flexShrink: 0 }} />
                  )}
                </button>
              </React.Fragment>
            )
          })}
        </div>
      )}
    </div>
  )
}
