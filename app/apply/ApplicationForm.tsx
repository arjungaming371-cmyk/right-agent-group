"use client"
import { useState } from "react"
import { CheckCircle2, Loader2, Send } from "lucide-react"

const PLANS = ["Starter", "Growth", "Scale", "Not sure yet"]

export function ApplicationForm() {
  const [status, setStatus] = useState<"idle" | "sending" | "done" | "error">("idle")
  const [error, setError] = useState("")

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = e.currentTarget
    const data = new FormData(form)
    setStatus("sending")
    setError("")
    try {
      const res = await fetch("/api/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: data.get("name"),
          phone: data.get("phone"),
          email: data.get("email"),
          company: data.get("company"),
          plan: data.get("plan"),
          message: data.get("message"),
          website: data.get("website"), // honeypot
        }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || "Something went wrong")
      setStatus("done")
      form.reset()
    } catch (err: any) {
      setStatus("error")
      setError(err.message || "Something went wrong")
    }
  }

  if (status === "done") {
    return (
      <div className="card" style={{ padding: 40, textAlign: "center" }}>
        <CheckCircle2 size={40} style={{ color: "var(--accent-green)", margin: "0 auto 16px" }} />
        <div style={{ fontSize: 20, fontWeight: 700, color: "var(--text-primary)", marginBottom: 8 }}>
          Application received
        </div>
        <div style={{ fontSize: 14, color: "var(--text-secondary)", maxWidth: 420, margin: "0 auto" }}>
          Thanks — our team will reach out shortly to walk through pricing and get Priya calling for you.
        </div>
      </div>
    )
  }

  return (
    <form onSubmit={onSubmit} className="card" style={{ padding: 28 }}>
      {/* Honeypot — hidden from real users, catches bots that autofill every field */}
      <input
        type="text"
        name="website"
        tabIndex={-1}
        autoComplete="off"
        style={{ position: "absolute", left: "-9999px", width: 1, height: 1, opacity: 0 }}
        aria-hidden="true"
      />

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div>
          <label style={{ fontSize: 12, fontWeight: 600, color: "var(--text-secondary)", display: "block", marginBottom: 6 }}>
            Full name *
          </label>
          <input name="name" required placeholder="Your name" />
        </div>
        <div>
          <label style={{ fontSize: 12, fontWeight: 600, color: "var(--text-secondary)", display: "block", marginBottom: 6 }}>
            Phone number *
          </label>
          <input name="phone" required placeholder="98765 43210" />
        </div>
        <div>
          <label style={{ fontSize: 12, fontWeight: 600, color: "var(--text-secondary)", display: "block", marginBottom: 6 }}>
            Work email
          </label>
          <input name="email" type="email" placeholder="you@company.com" />
        </div>
        <div>
          <label style={{ fontSize: 12, fontWeight: 600, color: "var(--text-secondary)", display: "block", marginBottom: 6 }}>
            Company / brand
          </label>
          <input name="company" placeholder="Your company" />
        </div>
      </div>

      <div style={{ marginTop: 16 }}>
        <label style={{ fontSize: 12, fontWeight: 600, color: "var(--text-secondary)", display: "block", marginBottom: 6 }}>
          Which plan interests you?
        </label>
        <select name="plan" defaultValue={PLANS[3]}>
          {PLANS.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
      </div>

      <div style={{ marginTop: 16 }}>
        <label style={{ fontSize: 12, fontWeight: 600, color: "var(--text-secondary)", display: "block", marginBottom: 6 }}>
          Tell us about your call volume / use case
        </label>
        <textarea name="message" rows={4} placeholder="e.g. ~500 home loan leads/month, need Telugu + Hindi calling" />
      </div>

      {status === "error" && (
        <div style={{ marginTop: 14, fontSize: 13, color: "var(--accent-red)" }}>{error}</div>
      )}

      <button type="submit" className="btn-primary" disabled={status === "sending"} style={{ width: "100%", marginTop: 20, height: 44 }}>
        {status === "sending" ? <Loader2 size={16} className="spin" /> : <Send size={16} />}
        {status === "sending" ? "Submitting..." : "Apply now"}
      </button>
      <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 10, textAlign: "center" }}>
        No spam. We'll only use this to get in touch about Priya.
      </div>
    </form>
  )
}
