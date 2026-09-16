"use client"

import { useEffect, useState } from "react"
import { X, Plus, Trash2, Settings2, Save, Check } from "lucide-react"
import { useToast } from "../ui/toast"

type CustomField = {
  id: string
  label: string
  type: "text" | "number" | "select"
  options?: string[]
  required: boolean
}

type FormConfig = {
  title: string
  subtitle: string
  loan_types: string[]
  enabled_fields: Record<string, boolean>
  required_fields: Record<string, boolean>
  custom_fields: CustomField[]
}

const DEFAULT_CONFIG: FormConfig = {
  title: "Loan Application",
  subtitle: "Complete your application in under 2 minutes",
  loan_types: [
    "Home Loan",
    "Business Loan",
    "Personal Loan",
    "Loan Against Property (LAP)",
    "Education Loan",
    "Vehicle Loan",
    "Gold Loan",
  ],
  enabled_fields: {
    city: true,
    loan_amount: true,
    loan_tenure: true,
    employment_type: true,
    monthly_income: true,
    pan_number: true,
    address: true,
    email: true,
  },
  required_fields: {
    customer_name: true,
    whatsapp_number: true,
    loan_amount: true,
    loan_tenure: true,
    employment_type: true,
    monthly_income: true,
  },
  custom_fields: [],
}

const STANDARD_FIELD_LABELS: Record<string, string> = {
  city: "City / Location",
  loan_amount: "Loan Amount (₹)",
  loan_tenure: "Loan Tenure (Months)",
  employment_type: "Employment Type",
  monthly_income: "Monthly Income (₹)",
  pan_number: "PAN Card Number",
  address: "Full Residential Address",
  email: "Email Address",
}

export default function LoanFormCustomizerModal({
  onClose,
  onSaved,
}: {
  onClose: () => void
  onSaved?: () => void
}) {
  const toast = useToast()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [config, setConfig] = useState<FormConfig>(DEFAULT_CONFIG)

  // New loan type input
  const [newLoanType, setNewLoanType] = useState("")

  // New custom question input
  const [newFieldLabel, setNewFieldLabel] = useState("")
  const [newFieldType, setNewFieldType] = useState<"text" | "number" | "select">("text")
  const [newFieldOptions, setNewFieldOptions] = useState("")
  const [newFieldRequired, setNewFieldRequired] = useState(false)

  useEffect(() => {
    fetch("/api/form-config")
      .then((r) => r.json())
      .then((d) => {
        if (d && d.loan_types) setConfig(d)
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [])

  function addLoanType() {
    const trimmed = newLoanType.trim()
    if (!trimmed) return
    if (config.loan_types.includes(trimmed)) {
      toast.error("Loan type already exists")
      return
    }
    setConfig((prev) => ({
      ...prev,
      loan_types: [...prev.loan_types, trimmed],
    }))
    setNewLoanType("")
  }

  function removeLoanType(index: number) {
    setConfig((prev) => ({
      ...prev,
      loan_types: prev.loan_types.filter((_, i) => i !== index),
    }))
  }

  function toggleFieldEnabled(key: string) {
    setConfig((prev) => ({
      ...prev,
      enabled_fields: {
        ...prev.enabled_fields,
        [key]: !prev.enabled_fields[key],
      },
    }))
  }

  function toggleFieldRequired(key: string) {
    setConfig((prev) => ({
      ...prev,
      required_fields: {
        ...prev.required_fields,
        [key]: !prev.required_fields[key],
      },
    }))
  }

  function addCustomField() {
    const label = newFieldLabel.trim()
    if (!label) return
    const id = "custom_" + Date.now()
    const options =
      newFieldType === "select"
        ? newFieldOptions
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean)
        : undefined

    const field: CustomField = {
      id,
      label,
      type: newFieldType,
      options,
      required: newFieldRequired,
    }

    setConfig((prev) => ({
      ...prev,
      custom_fields: [...prev.custom_fields, field],
    }))

    setNewFieldLabel("")
    setNewFieldOptions("")
    setNewFieldRequired(false)
  }

  function removeCustomField(id: string) {
    setConfig((prev) => ({
      ...prev,
      custom_fields: prev.custom_fields.filter((f) => f.id !== id),
    }))
  }

  async function handleSave() {
    setSaving(true)
    try {
      const res = await fetch("/api/form-config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(config),
      })
      if (!res.ok) throw new Error("Failed to save")
      toast.success("WhatsApp Loan Application Form customized successfully!")
      onSaved?.()
      onClose()
    } catch {
      toast.error("Could not save form settings")
    } finally {
      setSaving(false)
    }
  }

  return (
    <div style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,0.65)", backdropFilter: "blur(4px)",
      display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100, padding: 16,
    }}>
      <div style={{
        background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 16,
        maxWidth: 680, width: "100%", maxHeight: "90vh", display: "flex", flexDirection: "column",
        boxShadow: "0 24px 48px rgba(0,0,0,0.4)", overflow: "hidden",
      }}>
        {/* Header */}
        <div style={{ padding: "18px 24px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ width: 32, height: 32, borderRadius: 8, background: "rgba(91,124,250,0.15)", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--accent-violet)" }}>
              <Settings2 size={16} strokeWidth={2.2} />
            </span>
            <div>
              <div style={{ fontSize: 16, fontWeight: 700 }}>Customize WhatsApp Loan Form</div>
              <div style={{ fontSize: 12, color: "var(--text-muted)" }}>Configure loan products, questions, and fields sent to customers</div>
            </div>
          </div>
          <button onClick={onClose} style={{ background: "transparent", border: "none", color: "var(--text-muted)", cursor: "pointer" }}>
            <X size={18} />
          </button>
        </div>

        {/* Body scrollable */}
        <div style={{ flex: 1, overflowY: "auto", padding: "20px 24px", display: "flex", flexDirection: "column", gap: 22 }}>
          {loading ? (
            <div style={{ padding: 40, textAlign: "center", color: "var(--text-muted)" }}>Loading form configuration…</div>
          ) : (
            <>
              {/* Section 1: Form Heading */}
              <div>
                <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 10, color: "var(--text-primary)" }}>1. Form Title & Subtitle</div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                  <div>
                    <label style={{ fontSize: 11, fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase", display: "block", marginBottom: 4 }}>Header Title</label>
                    <input
                      value={config.title}
                      onChange={(e) => setConfig({ ...config, title: e.target.value })}
                      style={{ width: "100%", height: 36 }}
                    />
                  </div>
                  <div>
                    <label style={{ fontSize: 11, fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase", display: "block", marginBottom: 4 }}>Subtitle</label>
                    <input
                      value={config.subtitle}
                      onChange={(e) => setConfig({ ...config, subtitle: e.target.value })}
                      style={{ width: "100%", height: 36 }}
                    />
                  </div>
                </div>
              </div>

              {/* Section 2: Available Loan Types */}
              <div>
                <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 4, color: "var(--text-primary)" }}>2. Available Loan Types</div>
                <div style={{ fontSize: 11.5, color: "var(--text-muted)", marginBottom: 10 }}>These appear in the loan product dropdown on the application form.</div>
                
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 12 }}>
                  {config.loan_types.map((type, idx) => (
                    <div key={idx} style={{
                      display: "inline-flex", alignItems: "center", gap: 6,
                      background: "var(--bg-secondary)", border: "1px solid var(--border)",
                      borderRadius: 8, padding: "5px 10px", fontSize: 12.5, fontWeight: 500,
                    }}>
                      <span>{type}</span>
                      <button
                        onClick={() => removeLoanType(idx)}
                        style={{ background: "transparent", border: "none", color: "var(--text-muted)", cursor: "pointer", padding: 0, display: "flex" }}
                        title="Remove loan type"
                      >
                        <X size={13} />
                      </button>
                    </div>
                  ))}
                </div>

                <div style={{ display: "flex", gap: 8 }}>
                  <input
                    type="text"
                    value={newLoanType}
                    onChange={(e) => setNewLoanType(e.target.value)}
                    placeholder="Add new loan type (e.g. Doctor Loan, Gold Loan)..."
                    style={{ flex: 1, height: 36 }}
                    onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addLoanType() } }}
                  />
                  <button onClick={addLoanType} className="btn-ghost" style={{ height: 36, display: "inline-flex", alignItems: "center", gap: 6 }}>
                    <Plus size={14} /> Add Loan +
                  </button>
                </div>
              </div>

              {/* Section 3: Standard Fields */}
              <div>
                <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 4, color: "var(--text-primary)" }}>3. Form Fields & Requirements</div>
                <div style={{ fontSize: 11.5, color: "var(--text-muted)", marginBottom: 10 }}>Toggle which fields are visible and required for customers.</div>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                  {Object.entries(STANDARD_FIELD_LABELS).map(([key, label]) => {
                    const enabled = config.enabled_fields[key] !== false
                    const required = !!config.required_fields[key]
                    return (
                      <div key={key} style={{
                        padding: "10px 14px", borderRadius: 10,
                        border: "1px solid var(--border)", background: "var(--bg-secondary)",
                        display: "flex", alignItems: "center", justifyContent: "space-between",
                      }}>
                        <div>
                          <div style={{ fontSize: 12.5, fontWeight: 600 }}>{label}</div>
                          <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
                            {enabled ? (required ? "Required" : "Optional") : "Hidden"}
                          </div>
                        </div>
                        <div style={{ display: "flex", gap: 6 }}>
                          <button
                            type="button"
                            onClick={() => toggleFieldEnabled(key)}
                            style={{
                              fontSize: 11, fontWeight: 600, padding: "3px 8px", borderRadius: 6,
                              border: "1px solid var(--border)",
                              background: enabled ? "rgba(34,197,94,0.15)" : "transparent",
                              color: enabled ? "var(--accent-green)" : "var(--text-muted)",
                              cursor: "pointer",
                            }}
                          >
                            {enabled ? "Visible" : "Hidden"}
                          </button>
                          {enabled && (
                            <button
                              type="button"
                              onClick={() => toggleFieldRequired(key)}
                              style={{
                                fontSize: 11, fontWeight: 600, padding: "3px 8px", borderRadius: 6,
                                border: "1px solid var(--border)",
                                background: required ? "rgba(91,124,250,0.15)" : "transparent",
                                color: required ? "var(--accent-violet)" : "var(--text-muted)",
                                cursor: "pointer",
                              }}
                            >
                              {required ? "Required" : "Optional"}
                            </button>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>

              {/* Section 4: Custom Extra Questions */}
              <div>
                <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 4, color: "var(--text-primary)" }}>4. Custom Questions / Extra Fields</div>
                <div style={{ fontSize: 11.5, color: "var(--text-muted)", marginBottom: 10 }}>Add custom questions to gather specific information during application.</div>

                {config.custom_fields && config.custom_fields.length > 0 && (
                  <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 12 }}>
                    {config.custom_fields.map((f) => (
                      <div key={f.id} style={{
                        padding: "10px 14px", borderRadius: 8, border: "1px solid var(--border)",
                        background: "var(--bg-secondary)", display: "flex", alignItems: "center", justifyContent: "space-between",
                      }}>
                        <div>
                          <div style={{ fontSize: 12.5, fontWeight: 600 }}>{f.label}</div>
                          <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
                            Type: {f.type} {f.options ? `(${f.options.join(", ")})` : ""} · {f.required ? "Required" : "Optional"}
                          </div>
                        </div>
                        <button
                          onClick={() => removeCustomField(f.id)}
                          style={{ background: "transparent", border: "none", color: "var(--accent-red)", cursor: "pointer" }}
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                <div style={{ background: "var(--bg-secondary)", border: "1px dashed var(--border)", borderRadius: 10, padding: 14 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 8 }}>Add New Question +</div>
                  <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr", gap: 8, marginBottom: 8 }}>
                    <input
                      placeholder="Question / Field label (e.g. Existing EMIs)"
                      value={newFieldLabel}
                      onChange={(e) => setNewFieldLabel(e.target.value)}
                      style={{ height: 36 }}
                    />
                    <select value={newFieldType} onChange={(e) => setNewFieldType(e.target.value as any)} style={{ height: 36 }}>
                      <option value="text">Text Input</option>
                      <option value="number">Number</option>
                      <option value="select">Dropdown</option>
                    </select>
                    <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, cursor: "pointer" }}>
                      <input
                        type="checkbox"
                        checked={newFieldRequired}
                        onChange={(e) => setNewFieldRequired(e.target.checked)}
                      />
                      Required
                    </label>
                  </div>
                  {newFieldType === "select" && (
                    <input
                      placeholder="Comma-separated options (e.g. Yes, No, Under 10k)"
                      value={newFieldOptions}
                      onChange={(e) => setNewFieldOptions(e.target.value)}
                      style={{ width: "100%", height: 36, marginBottom: 8 }}
                    />
                  )}
                  <button onClick={addCustomField} className="btn-ghost" style={{ height: 32, fontSize: 12 }}>
                    <Plus size={13} /> Add Question
                  </button>
                </div>
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div style={{ padding: "16px 24px", borderTop: "1px solid var(--border)", display: "flex", justifyContent: "flex-end", gap: 10 }}>
          <button onClick={onClose} className="btn-ghost" style={{ height: 38, padding: "0 18px" }}>
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving || loading}
            className="btn-primary"
            style={{ height: 38, padding: "0 22px", display: "inline-flex", alignItems: "center", gap: 7 }}
          >
            <Save size={14} /> {saving ? "Saving..." : "Save Custom Form"}
          </button>
        </div>
      </div>
    </div>
  )
}
