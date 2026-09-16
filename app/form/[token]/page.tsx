"use client"
import { useEffect, useState } from "react"
import { useParams } from "next/navigation"

const EMPLOYMENT_TYPES = ["Salaried", "Self-Employed", "Business Owner", "Retired", "Other"]

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
  subtitle: "Right Agent Group — fill in your details below",
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

export default function ApplicationFormPage() {
  const params = useParams()
  const token = params?.token as string

  const [loading, setLoading] = useState(true)
  const [valid, setValid] = useState(false)
  const [networkFailed, setNetworkFailed] = useState(false)
  const [alreadyUsed, setAlreadyUsed] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState("")
  const [config, setConfig] = useState<FormConfig>(DEFAULT_CONFIG)

  const [form, setForm] = useState<Record<string, any>>({
    customer_name: "", city: "", loan_type: "Home Loan", loan_amount: "",
    loan_tenure: "", email: "", address: "", whatsapp_number: "",
    employment_type: "Salaried", monthly_income: "", pan_number: "",
  })

  async function checkToken() {
    setLoading(true)
    setNetworkFailed(false)
    try {
      // Fetch token status and dynamic form configuration in parallel
      const [tokenRes, configRes] = await Promise.all([
        fetch(`/api/form/${token}`),
        fetch("/api/form-config").catch(() => null),
      ])

      if (configRes && configRes.ok) {
        const confData = await configRes.json().catch(() => null)
        if (confData && confData.loan_types) {
          setConfig(confData)
        }
      }

      if (tokenRes.status === 404 || tokenRes.status === 410) {
        setValid(false)
        return
      }
      if (!tokenRes.ok) {
        setNetworkFailed(true)
        return
      }
      const data = await tokenRes.json()
      if (!data.valid) {
        setValid(false)
        return
      }
      setValid(true)
      setAlreadyUsed(!!data.used)
      if (data.lead) {
        setForm((f) => ({
          ...f,
          customer_name: data.lead.name || "",
          address: data.lead.address || "",
          whatsapp_number: data.lead.phone || "",
          loan_type: data.lead.product_interest || f.loan_type,
        }))
      }
    } catch {
      setNetworkFailed(true)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (!token) return
    checkToken()
  }, [token])

  async function submit() {
    // Validate standard required fields based on admin config
    if (!form.customer_name?.trim()) return setError("Please enter your full name")
    if (!form.whatsapp_number?.trim()) return setError("Please enter your WhatsApp number")
    
    if (config.required_fields?.loan_amount && !form.loan_amount) return setError("Please enter the loan amount")
    if (config.required_fields?.loan_tenure && !form.loan_tenure) return setError("Please enter the loan tenure")
    if (config.required_fields?.employment_type && !form.employment_type) return setError("Please select your employment type")
    if (config.required_fields?.monthly_income && !form.monthly_income) return setError("Please enter your monthly income")
    if (config.required_fields?.city && !form.city?.trim()) return setError("Please enter your city")
    if (config.required_fields?.pan_number && !form.pan_number?.trim()) return setError("Please enter your PAN number")
    if (config.required_fields?.address && !form.address?.trim()) return setError("Please enter your address")

    // Validate custom fields
    if (config.custom_fields) {
      for (const cf of config.custom_fields) {
        if (cf.required && (!form[cf.id] || String(form[cf.id]).trim() === "")) {
          return setError(`Please provide ${cf.label}`)
        }
      }
    }

    setSubmitting(true)
    setError("")
    try {
      const res = await fetch(`/api/form/${token}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || "Submission failed")
      setSubmitted(true)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setSubmitting(false)
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    submit()
  }

  const wrap: React.CSSProperties = {
    minHeight: "100vh", background: "#0a0f1e", color: "#f1f5f9",
    display: "flex", alignItems: "center", justifyContent: "center", padding: 20,
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
  }
  const card: React.CSSProperties = {
    background: "#111827", border: "1px solid #1e2d40", borderRadius: 16, padding: 32, width: "100%", maxWidth: 480,
  }
  const label: React.CSSProperties = { fontSize: 12, color: "#94a3b8", marginBottom: 4, display: "block" }
  const input: React.CSSProperties = {
    width: "100%", background: "#0d1422", border: "1px solid #1e2d40", color: "#f1f5f9",
    borderRadius: 8, padding: "10px 12px", fontSize: 14, marginBottom: 14, outline: "none",
  }

  if (loading) return <div style={wrap}><div style={card}>Loading…</div></div>

  if (networkFailed) {
    return (
      <div style={wrap}>
        <div style={card}>
          <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 8 }}>Connection problem</div>
          <div style={{ fontSize: 14, color: "#94a3b8", marginBottom: 20 }}>We couldn't reach the server — please check your connection and try again.</div>
          <button
            onClick={checkToken}
            style={{
              width: "100%", padding: 12, background: "#1d4ed8", border: "none", borderRadius: 8,
              color: "white", fontWeight: 600, fontSize: 14, cursor: "pointer",
            }}
          >
            Try again
          </button>
        </div>
      </div>
    )
  }

  if (!valid) {
    return (
      <div style={wrap}>
        <div style={card}>
          <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 8 }}>Link not valid</div>
          <div style={{ fontSize: 14, color: "#94a3b8" }}>This application link is invalid or has expired. Please contact Right Agent Group for a new link.</div>
        </div>
      </div>
    )
  }

  if (submitted || (alreadyUsed && !submitting)) {
    return (
      <div style={wrap}>
        <div style={card}>
          <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 8 }}>✅ {submitted ? "Application submitted!" : "Already submitted"}</div>
          <div style={{ fontSize: 14, color: "#94a3b8" }}>
            {submitted ? "Thank you — our team will review your application and get in touch shortly." : "This link has already been used. Contact us if you need to make changes."}
          </div>
        </div>
      </div>
    )
  }

  const enabled = config.enabled_fields || {}
  const required = config.required_fields || {}

  return (
    <div style={wrap}>
      <div style={card}>
        <div style={{ fontSize: 20, fontWeight: 700, marginBottom: 4 }}>{config.title || "Loan Application"}</div>
        <div style={{ fontSize: 13, color: "#94a3b8", marginBottom: 4 }}>{config.subtitle || "Right Agent Group — fill in your details below"}</div>
        <div style={{ fontSize: 11, color: "#64748b", marginBottom: 24 }}>Fields marked <span style={{ color: "#f87171" }}>*</span> are required</div>

        <form onSubmit={handleSubmit}>
          {/* Customer Name */}
          <label htmlFor="customer_name" style={label}>Full Name <span style={{ color: "#f87171" }}>*</span></label>
          <input id="customer_name" style={input} placeholder="Your full name" autoComplete="name" maxLength={120} value={form.customer_name} onChange={(e) => setForm({ ...form, customer_name: e.target.value })} />

          {/* WhatsApp Number */}
          <label htmlFor="whatsapp_number" style={label}>WhatsApp Number <span style={{ color: "#f87171" }}>*</span></label>
          <input id="whatsapp_number" style={input} placeholder="e.g. 9876543210" autoComplete="tel" value={form.whatsapp_number} onChange={(e) => setForm({ ...form, whatsapp_number: e.target.value })} />

          {/* Email */}
          {enabled.email !== false && (
            <>
              <label htmlFor="email" style={label}>Email {required.email && <span style={{ color: "#f87171" }}>*</span>}</label>
              <input id="email" style={input} type="email" placeholder="you@example.com" autoComplete="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
            </>
          )}

          {/* Address */}
          {enabled.address !== false && (
            <>
              <label htmlFor="address" style={label}>Address {required.address && <span style={{ color: "#f87171" }}>*</span>}</label>
              <input id="address" style={input} placeholder="Your home/office address" autoComplete="street-address" maxLength={400} value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
            </>
          )}

          {/* City */}
          {enabled.city !== false && (
            <>
              <label htmlFor="city" style={label}>City {required.city && <span style={{ color: "#f87171" }}>*</span>}</label>
              <input id="city" style={input} placeholder="e.g. Hyderabad" autoComplete="address-level2" maxLength={80} value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} />
            </>
          )}

          {/* Loan Type (Dynamic based on admin customizer) */}
          <label htmlFor="loan_type" style={label}>Loan Product <span style={{ color: "#f87171" }}>*</span></label>
          <select id="loan_type" style={input} value={form.loan_type} onChange={(e) => setForm({ ...form, loan_type: e.target.value })}>
            {(config.loan_types || DEFAULT_CONFIG.loan_types).map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>

          {/* Loan Amount */}
          {enabled.loan_amount !== false && (
            <>
              <label htmlFor="loan_amount" style={label}>Loan Amount (₹) {required.loan_amount && <span style={{ color: "#f87171" }}>*</span>}</label>
              <input id="loan_amount" style={input} type="number" placeholder="e.g. 2500000" value={form.loan_amount} onChange={(e) => setForm({ ...form, loan_amount: e.target.value })} />
            </>
          )}

          {/* Loan Tenure */}
          {enabled.loan_tenure !== false && (
            <>
              <label htmlFor="loan_tenure" style={label}>Loan Tenure (months) {required.loan_tenure && <span style={{ color: "#f87171" }}>*</span>}</label>
              <input id="loan_tenure" style={input} type="number" placeholder="e.g. 120 (10 years)" min="1" max="360" value={form.loan_tenure} onChange={(e) => setForm({ ...form, loan_tenure: e.target.value })} />
            </>
          )}

          {/* Employment Type */}
          {enabled.employment_type !== false && (
            <>
              <label htmlFor="employment_type" style={label}>Employment Type {required.employment_type && <span style={{ color: "#f87171" }}>*</span>}</label>
              <select id="employment_type" style={input} value={form.employment_type} onChange={(e) => setForm({ ...form, employment_type: e.target.value })}>
                {EMPLOYMENT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </>
          )}

          {/* Monthly Income */}
          {enabled.monthly_income !== false && (
            <>
              <label htmlFor="monthly_income" style={label}>Monthly Income (₹) {required.monthly_income && <span style={{ color: "#f87171" }}>*</span>}</label>
              <input id="monthly_income" style={input} type="number" placeholder="e.g. 75000" value={form.monthly_income} onChange={(e) => setForm({ ...form, monthly_income: e.target.value })} />
            </>
          )}

          {/* PAN Number */}
          {enabled.pan_number !== false && (
            <>
              <label htmlFor="pan_number" style={label}>PAN Number {required.pan_number && <span style={{ color: "#f87171" }}>*</span>}</label>
              <input id="pan_number" style={input} placeholder="e.g. ABCDE1234F" autoComplete="off" maxLength={10} value={form.pan_number} onChange={(e) => setForm({ ...form, pan_number: e.target.value.toUpperCase() })} />
            </>
          )}

          {/* Custom Questions / Extra Fields defined by Admin */}
          {config.custom_fields && config.custom_fields.map((cf) => (
            <div key={cf.id}>
              <label htmlFor={cf.id} style={label}>
                {cf.label} {cf.required && <span style={{ color: "#f87171" }}>*</span>}
              </label>
              {cf.type === "select" ? (
                <select
                  id={cf.id}
                  style={input}
                  value={form[cf.id] || ""}
                  onChange={(e) => setForm({ ...form, [cf.id]: e.target.value })}
                >
                  <option value="">Select an option…</option>
                  {(cf.options || []).map((opt) => (
                    <option key={opt} value={opt}>{opt}</option>
                  ))}
                </select>
              ) : (
                <input
                  id={cf.id}
                  style={input}
                  type={cf.type === "number" ? "number" : "text"}
                  placeholder={`Enter ${cf.label.toLowerCase()}`}
                  value={form[cf.id] || ""}
                  onChange={(e) => setForm({ ...form, [cf.id]: e.target.value })}
                />
              )}
            </div>
          ))}

          {error && <div role="alert" style={{ color: "#f87171", fontSize: 13, marginBottom: 12 }}>{error}</div>}

          <button
            type="submit"
            disabled={submitting}
            style={{
              width: "100%", padding: 12, background: "#1d4ed8", border: "none", borderRadius: 8,
              color: "white", fontWeight: 600, fontSize: 14, opacity: submitting ? 0.6 : 1, marginTop: 8, cursor: "pointer",
            }}
          >
            {submitting ? "Submitting…" : "Submit Application"}
          </button>
        </form>
      </div>
    </div>
  )
}
