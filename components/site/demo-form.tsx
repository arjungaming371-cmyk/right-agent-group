"use client"

// "Book a Demo" form island. Client-side validation mirrors the server's
// rules (+91 10-digit Indian mobile); the server (app/api/demo/route.ts)
// re-validates everything, rate-limits and drops bots via the hidden
// `website` honeypot field.
import { useState } from "react"
import { CheckCircle2, Loader2, Send } from "lucide-react"

const TIMES = ["Morning", "Afternoon", "Evening"]

/** Accepts 10-digit Indian mobiles (with optional 0/91 prefix) → last 10 digits, or null. */
function validIndianPhone(raw: string): string | null {
  let d = raw.replace(/\D/g, "")
  if (d.length === 11 && d.startsWith("0")) d = d.slice(1)
  if (d.length === 12 && d.startsWith("91")) d = d.slice(2)
  return /^[6-9]\d{9}$/.test(d) ? d : null
}

type Status = "idle" | "sending" | "success" | "error"

export default function DemoForm() {
  const [name, setName] = useState("")
  const [phone, setPhone] = useState("")
  const [email, setEmail] = useState("")
  const [company, setCompany] = useState("")
  const [preferredTime, setPreferredTime] = useState("Morning")
  const [message, setMessage] = useState("")
  const [website, setWebsite] = useState("") // honeypot — real users never see this
  const [status, setStatus] = useState<Status>("idle")
  const [errorMsg, setErrorMsg] = useState("")

  function fail(msg: string) {
    setStatus("error")
    setErrorMsg(msg)
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (status === "sending") return

    if (!name.trim()) return fail("Please enter your name.")
    const digits = validIndianPhone(phone)
    if (!digits) return fail("Please enter a valid 10-digit Indian mobile number.")

    setStatus("sending")
    setErrorMsg("")

    try {
      const res = await fetch("/api/demo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          phone: `+91${digits}`,
          email: email.trim(),
          company: company.trim(),
          preferredTime,
          message: message.trim(),
          website,
        }),
      })

      if (res.status === 429) {
        return fail("Too many requests — please wait a minute and try again.")
      }

      const data = await res.json().catch(() => null)
      if (!res.ok) {
        return fail(data?.error || "Something went wrong. Please try again.")
      }

      setStatus("success")
    } catch {
      fail("Network error — please check your connection and try again.")
    }
  }

  function reset() {
    setName("")
    setPhone("")
    setEmail("")
    setCompany("")
    setPreferredTime("Morning")
    setMessage("")
    setWebsite("")
    setStatus("idle")
    setErrorMsg("")
  }

  if (status === "success") {
    return (
      <div className="rg-glass rgf-card">
        <div className="rgf-success" role="status">
          <div className="rgf-success-icon">
            <CheckCircle2 size={26} strokeWidth={2} />
          </div>
          <h3>Request received — our team will call you to schedule your demo.</h3>
          <p>
            Keep your phone nearby. We&apos;ll call on the number you left, walk you through a
            live qualification call, and answer your questions.
          </p>
          <button type="button" className="rg-btn rg-btn-ghost" onClick={reset}>
            Submit another request
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="rg-glass rgf-card">
      <form onSubmit={submit} noValidate>
        <div className="rgf-grid">
          <div className="rgf-field">
            <label className="rgf-label" htmlFor="dmo-name">
              Name <span className="rgf-req">*</span>
            </label>
            <input
              id="dmo-name"
              className="rgf-input"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Your full name"
              autoComplete="name"
              required
            />
          </div>

          <div className="rgf-field">
            <label className="rgf-label" htmlFor="dmo-phone">
              Phone <span className="rgf-req">*</span>
            </label>
            <input
              id="dmo-phone"
              className="rgf-input"
              type="tel"
              inputMode="numeric"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="+91 98765 43210"
              autoComplete="tel"
              required
            />
          </div>

          <div className="rgf-field">
            <label className="rgf-label" htmlFor="dmo-email">
              Email
            </label>
            <input
              id="dmo-email"
              className="rgf-input"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@company.com"
              autoComplete="email"
            />
          </div>

          <div className="rgf-field">
            <label className="rgf-label" htmlFor="dmo-company">
              Company
            </label>
            <input
              id="dmo-company"
              className="rgf-input"
              type="text"
              value={company}
              onChange={(e) => setCompany(e.target.value)}
              placeholder="Your firm or branch"
              autoComplete="organization"
            />
          </div>

          <div className="rgf-field rgf-full">
            <label className="rgf-label" htmlFor="dmo-time">
              Preferred time to call
            </label>
            <select
              id="dmo-time"
              className="rgf-select"
              value={preferredTime}
              onChange={(e) => setPreferredTime(e.target.value)}
            >
              {TIMES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>

          <div className="rgf-field rgf-full">
            <label className="rgf-label" htmlFor="dmo-message">
              Message
            </label>
            <textarea
              id="dmo-message"
              className="rgf-text"
              rows={4}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Branches, team size, languages your customers speak — anything that helps us prepare."
            />
          </div>
        </div>

        {/* Honeypot: hidden from humans, autofill bots love it. */}
        <div className="rgf-hp" aria-hidden="true">
          <label htmlFor="dmo-website">
            Website
            <input
              id="dmo-website"
              type="text"
              tabIndex={-1}
              autoComplete="off"
              value={website}
              onChange={(e) => setWebsite(e.target.value)}
            />
          </label>
        </div>

        <div className="rgf-actions">
          <button type="submit" className="rg-btn rg-btn-primary" disabled={status === "sending"}>
            {status === "sending" ? (
              <>
                <Loader2 size={15} className="spin" strokeWidth={2.2} /> Sending…
              </>
            ) : (
              <>
                <Send size={15} strokeWidth={2.1} /> Book a Demo
              </>
            )}
          </button>
          {status === "error" && errorMsg && (
            <p className="rgf-error" role="alert">
              {errorMsg}
            </p>
          )}
        </div>

        <p className="rgf-hint">
          We use your details only to schedule and run your demo — see the Privacy page.
        </p>
      </form>
    </div>
  )
}
