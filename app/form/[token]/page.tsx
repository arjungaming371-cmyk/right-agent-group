"use client"
import { useEffect, useState } from "react"
import { useParams } from "next/navigation"

import { PRODUCT_GROUPS } from "@/lib/products"

const EMPLOYMENT_TYPES = ["Salaried", "Self-Employed", "Business Owner", "Retired", "Other"]

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

  const [form, setForm] = useState({
    customer_name: "", city: "", loan_type: "Home Loan", loan_amount: "",
    loan_tenure: "", email: "", address: "", whatsapp_number: "",
    employment_type: "Salaried", monthly_income: "", pan_number: "",
  })

  async function checkToken() {
    setLoading(true)
    setNetworkFailed(false)
    try {
      const res = await fetch(`/api/form/${token}`)
      if (res.status === 404 || res.status === 410) {
        // Definitive server rejection — only THIS means the link is truly
        // invalid or expired.
        setValid(false)
        return
      }
      if (!res.ok) {
        // 5xx / rate-limit / anything else: the server may be fine and the
        // link perfectly valid — don't claim it is bad.
        setNetworkFailed(true)
        return
      }
      const data = await res.json()
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
      // Fetch threw (offline, DNS, aborted) — a network blip must never
      // render as "link invalid" for a valid link.
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
    if (!form.customer_name.trim()) return setError("Please enter your full name")
    if (!form.whatsapp_number.trim()) return setError("Please enter your WhatsApp number")
    if (!form.loan_amount) return setError("Please enter the loan amount")
    if (!form.loan_tenure) return setError("Please enter the loan tenure")
    if (!form.employment_type) return setError("Please select your employment type")
    if (!form.monthly_income) return setError("Please enter your monthly income")
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

  // Network failure — distinct from an invalid link, with a way to retry.
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

  return (
    <div style={wrap}>
      <div style={card}>
        <div style={{ fontSize: 20, fontWeight: 700, marginBottom: 4 }}>Loan Application</div>
        <div style={{ fontSize: 13, color: "#94a3b8", marginBottom: 4 }}>Right Agent Group — fill in your details below</div>
        <div style={{ fontSize: 11, color: "#64748b", marginBottom: 24 }}>Fields marked <span style={{ color: "#f87171" }}>*</span> are required</div>

        <form onSubmit={handleSubmit}>
          <label htmlFor="customer_name" style={label}>Full Name <span style={{ color: "#f87171" }}>*</span></label>
          <input id="customer_name" style={input} placeholder="Your full name" autoComplete="name" maxLength={120} value={form.customer_name} onChange={(e) => setForm({ ...form, customer_name: e.target.value })} />

          <label htmlFor="whatsapp_number" style={label}>WhatsApp Number <span style={{ color: "#f87171" }}>*</span></label>
          <input id="whatsapp_number" style={input} placeholder="e.g. 9876543210" autoComplete="tel" value={form.whatsapp_number} onChange={(e) => setForm({ ...form, whatsapp_number: e.target.value })} />

          <label htmlFor="email" style={label}>Email</label>
          <input id="email" style={input} type="email" placeholder="you@example.com" autoComplete="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />

          <label htmlFor="address" style={label}>Address</label>
          <input id="address" style={input} placeholder="Your home/office address" autoComplete="street-address" maxLength={400} value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />

          <label htmlFor="city" style={label}>City <span style={{ color: "#f87171" }}>*</span></label>
          <input id="city" style={input} placeholder="e.g. Hyderabad" autoComplete="address-level2" maxLength={80} value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} />

          <label htmlFor="loan_type" style={label}>Loan Type <span style={{ color: "#f87171" }}>*</span></label>
          <select id="loan_type" style={input} value={form.loan_type} onChange={(e) => setForm({ ...form, loan_type: e.target.value })}>
            {PRODUCT_GROUPS.map((g) => (
              <optgroup key={g.label} label={g.label}>
                {g.products.map((t) => <option key={t}>{t}</option>)}
              </optgroup>
            ))}
          </select>

          <label htmlFor="loan_amount" style={label}>Loan Amount (₹) <span style={{ color: "#f87171" }}>*</span></label>
          <input id="loan_amount" style={input} type="number" placeholder="e.g. 2500000" value={form.loan_amount} onChange={(e) => setForm({ ...form, loan_amount: e.target.value })} />

          <label htmlFor="loan_tenure" style={label}>Loan Tenure (months) <span style={{ color: "#f87171" }}>*</span></label>
          <input id="loan_tenure" style={input} type="number" placeholder="e.g. 240 (20 years)" min="1" max="360" value={form.loan_tenure} onChange={(e) => setForm({ ...form, loan_tenure: e.target.value })} />

          <label htmlFor="employment_type" style={label}>Employment Type <span style={{ color: "#f87171" }}>*</span></label>
          <select id="employment_type" style={input} value={form.employment_type} onChange={(e) => setForm({ ...form, employment_type: e.target.value })}>
            {EMPLOYMENT_TYPES.map((t) => <option key={t}>{t}</option>)}
          </select>

          <label htmlFor="monthly_income" style={label}>Monthly Income (₹) <span style={{ color: "#f87171" }}>*</span></label>
          <input id="monthly_income" style={input} type="number" placeholder="e.g. 75000" value={form.monthly_income} onChange={(e) => setForm({ ...form, monthly_income: e.target.value })} />

          <label htmlFor="pan_number" style={label}>PAN Number</label>
          <input id="pan_number" style={input} placeholder="e.g. ABCDE1234F" autoComplete="off" maxLength={10} value={form.pan_number} onChange={(e) => setForm({ ...form, pan_number: e.target.value.toUpperCase() })} />

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
