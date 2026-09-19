"use client"

import React from "react"
import { CheckSquare, Square, Check, Layers } from "lucide-react"

export type ModuleOption = {
  key: string
  label: string
  section: "Overview" | "Engagement" | "System"
  description: string
}

export const ALL_MODULES: ModuleOption[] = [
  // Overview
  { key: "analytics", label: "Analytics", section: "Overview", description: "Performance metrics & conversion charts" },
  { key: "leads", label: "Leads", section: "Overview", description: "Prospect pipeline & lead status tracking" },
  { key: "loans", label: "Loan Applications", section: "Overview", description: "Loan applications & enquiry files" },

  // Engagement
  { key: "voice", label: "Voice Logs", section: "Engagement", description: "Voice call recordings, transcripts, & durations" },
  { key: "whatsapp", label: "WhatsApp Chat", section: "Engagement", description: "Live customer chat & automated messages" },
  { key: "instagram", label: "Instagram Chat", section: "Engagement", description: "Direct messages & post comment auto-replies" },
  { key: "comms", label: "Communication Log", section: "Engagement", description: "Combined automated activity log" },

  // System
  { key: "upload", label: "Upload & Data", section: "System", description: "Bulk CSV contact uploads & file data" },
  { key: "script", label: "Priya's Script", section: "System", description: "AI system prompts & call scripts" },
  { key: "knowledge", label: "Knowledge Base", section: "System", description: "Contextual facts repository" },
]

export const SECTIONS = ["Overview", "Engagement", "System"] as const

export function ModulePicker({
  selectedKeys,
  onChange,
  disabled = false,
}: {
  selectedKeys: string[] | null
  onChange: (keys: string[]) => void
  disabled?: boolean
}) {
  // If selectedKeys is null, all modules are considered active
  const currentSelected = selectedKeys === null ? ALL_MODULES.map(m => m.key) : selectedKeys

  const isAllSelected = ALL_MODULES.every(m => currentSelected.includes(m.key))

  function toggleKey(key: string) {
    if (disabled) return
    if (currentSelected.includes(key)) {
      onChange(currentSelected.filter(k => k !== key))
    } else {
      onChange([...currentSelected, key])
    }
  }

  function handleSelectAll() {
    if (disabled) return
    onChange(ALL_MODULES.map(m => m.key))
  }

  function handleClearAll() {
    if (disabled) return
    onChange([])
  }

  return (
    <div style={{
      background: "var(--bg-secondary)",
      border: "1px solid var(--border)",
      borderRadius: 12,
      padding: 14,
      display: "flex",
      flexDirection: "column",
      gap: 14,
    }}>
      {/* Header & Quick Action Controls */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", borderBottom: "1px solid var(--border)", paddingBottom: 10 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 12.5, fontWeight: 600, color: "var(--text-primary)" }}>
          <Layers size={15} style={{ color: "var(--accent-cyan)" }} />
          <span>Allotted Modules & Feature Access</span>
          <span style={{ fontSize: 11, color: "var(--text-muted)", fontWeight: 400 }}>
            ({currentSelected.length} of {ALL_MODULES.length} selected)
          </span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <button
            type="button"
            onClick={handleSelectAll}
            disabled={disabled || isAllSelected}
            style={{
              background: "transparent", border: "none", color: "var(--accent-cyan)",
              fontSize: 11.5, fontWeight: 600, cursor: disabled || isAllSelected ? "default" : "pointer",
              opacity: disabled || isAllSelected ? 0.5 : 1, padding: "2px 6px", borderRadius: 4,
            }}
          >
            Select All
          </button>
          <span style={{ color: "var(--border)", fontSize: 12 }}>|</span>
          <button
            type="button"
            onClick={handleClearAll}
            disabled={disabled || currentSelected.length === 0}
            style={{
              background: "transparent", border: "none", color: "var(--text-muted)",
              fontSize: 11.5, fontWeight: 500, cursor: disabled || currentSelected.length === 0 ? "default" : "pointer",
              opacity: disabled || currentSelected.length === 0 ? 0.5 : 1, padding: "2px 6px", borderRadius: 4,
            }}
          >
            Deselect All
          </button>
        </div>
      </div>

      {/* Sections Grouped like Sidebar Navigation */}
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        {SECTIONS.map(section => {
          const sectionModules = ALL_MODULES.filter(m => m.section === section)
          return (
            <div key={section}>
              <div style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--text-muted)", marginBottom: 8 }}>
                {section}
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 8 }}>
                {sectionModules.map(mod => {
                  const isChecked = currentSelected.includes(mod.key)
                  return (
                    <div
                      key={mod.key}
                      onClick={() => toggleKey(mod.key)}
                      style={{
                        display: "flex",
                        alignItems: "flex-start",
                        gap: 9,
                        padding: "8px 10px",
                        borderRadius: 8,
                        background: isChecked ? "rgba(56,189,248,0.08)" : "var(--bg-card)",
                        border: isChecked ? "1px solid rgba(56,189,248,0.35)" : "1px solid var(--border)",
                        cursor: disabled ? "not-allowed" : "pointer",
                        transition: "all 0.15s ease",
                        opacity: disabled ? 0.6 : 1,
                      }}
                    >
                      <div style={{ marginTop: 2, flexShrink: 0 }}>
                        {isChecked ? (
                          <div style={{
                            width: 16, height: 16, borderRadius: 4, background: "var(--accent-cyan)",
                            display: "flex", alignItems: "center", justifyContent: "center", color: "#000",
                          }}>
                            <Check size={12} strokeWidth={3} />
                          </div>
                        ) : (
                          <div style={{
                            width: 16, height: 16, borderRadius: 4, border: "1.5px solid var(--text-muted)",
                            background: "transparent",
                          }} />
                        )}
                      </div>
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div style={{ fontSize: 12.5, fontWeight: isChecked ? 600 : 500, color: isChecked ? "var(--text-primary)" : "var(--text-secondary)" }}>
                          {mod.label}
                        </div>
                        <div style={{ fontSize: 10.5, color: "var(--text-muted)", marginTop: 1, lineHeight: 1.2 }}>
                          {mod.description}
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
