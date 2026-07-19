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
  const [alreadyUsed, setAlreadyUsed] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState("")

  const [form, setForm] = useState({
    customer_name: "", city: "", loan_type: "Home Loan", loan_amount: "",
    email: "", address: "", whatsapp_number: "", employment_type: "Salaried", monthly_income: "",
  })

  useEffect(() => {
    if (!token) return
    fetch(`/api/form/${token}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.valid) {
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
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [token])

  async function submit() {
    if (!form.customer_name.trim()) return setError("Please enter your name")
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
    }
    setSubmitting(false)
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
        <div style={{ fontSize: 13, color: "#94a3b8", marginBottom: 24 }}>Right Agent Group — fill in your details below</div>

        <label style={label}>Full Name *</label>
        <input style={input} value={form.customer_name} onChange={(e) => setForm({ ...form, customer_name: e.target.value })} />

        <label style={label}>WhatsApp Number</label>
        <input style={input} value={form.whatsapp_number} onChange={(e) => setForm({ ...form, whatsapp_number: e.target.value })} />

        <label style={label}>Email</label>
        <input style={input} value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />

        <label style={label}>Address</label>
        <input style={input} value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />

        <label style={label}>City</label>
        <input style={input} value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} />

        <label style={label}>Loan Type</label>
        <select style={input} value={form.loan_type} onChange={(e) => setForm({ ...form, loan_type: e.target.value })}>
          {PRODUCT_GROUPS.map((g) => (
            <optgroup key={g.label} label={g.label}>
              {g.products.map((t) => <option key={t}>{t}</option>)}
            </optgroup>
          ))}
        </select>

        <label style={label}>Loan Amount (₹)</label>
        <input style={input} type="number" value={form.loan_amount} onChange={(e) => setForm({ ...form, loan_amount: e.target.value })} />

        <label style={label}>Employment Type</label>
        <select style={input} value={form.employment_type} onChange={(e) => setForm({ ...form, employment_type: e.target.value })}>
          {EMPLOYMENT_TYPES.map((t) => <option key={t}>{t}</option>)}
        </select>

        <label style={label}>Monthly Income (₹)</label>
        <input style={input} type="number" value={form.monthly_income} onChange={(e) => setForm({ ...form, monthly_income: e.target.value })} />

        {error && <div style={{ color: "#f87171", fontSize: 13, marginBottom: 12 }}>{error}</div>}

        <button
          onClick={submit}
          disabled={submitting}
          style={{
            width: "100%", padding: 12, background: "#1d4ed8", border: "none", borderRadius: 8,
            color: "white", fontWeight: 600, fontSize: 14, opacity: submitting ? 0.6 : 1, marginTop: 8,
          }}
        >
          {submitting ? "Submitting…" : "Submit Application"}
        </button>
      </div>
    </div>
  )
}
