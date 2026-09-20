"use client"
// Step 2 of an admin sign-in when Two-Factor Authentication is enabled:
// the emailed 6-digit code is verified by /api/auth/otp, which then issues
// the real session cookie and tells us where to go.
import { useState } from "react"
import { KeyRound } from "lucide-react"

export default function OtpForm() {
  const [code, setCode] = useState("")
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (busy) return
    setBusy(true)
    setError("")
    try {
      const res = await fetch("/api/auth/otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: code.trim() }),
      })
      const data = await res.json().catch(() => ({}))
      if (res.ok) {
        // Defense in depth: the server validates `next`, but never assign a
        // non-relative value (or a backslash form) to location.href here.
        const target = typeof data.next === "string" && /^\/(?!\/|\\)/.test(data.next) ? data.next : "/"
        window.location.href = target
        return
      }
      setError(data.error || "Verification failed — try again")
    } catch {
      setError("Network error — try again")
    }
    setBusy(false)
  }

  return (
    <form onSubmit={submit} className="mt-7">
      <div className="mb-4 flex items-center gap-2.5 text-[13px] text-[#9aa5bd]">
        <KeyRound size={15} strokeWidth={2} className="text-[#8b7cff]" />
        A 6-digit code was emailed to you. Enter it to finish signing in.
      </div>
      {error && (
        <div className="mb-4 rounded-[10px] border border-[#fb5670]/30 bg-[#fb5670]/[0.08] px-4 py-3 text-[13px] text-[#ff8fa0]">
          {error}
        </div>
      )}
      {/* Visually-hidden label — the input was placeholder-only, which
          screen readers announce as just "••••••". Appearance unchanged. */}
      <label htmlFor="otp-code" className="sr-only">6-digit verification code</label>
      <input
        id="otp-code"
        autoFocus
        inputMode="numeric"
        maxLength={6}
        placeholder="••••••"
        value={code}
        onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
        className="w-full rounded-[11px] border border-white/10 bg-black/30 px-4 py-[13px] text-center text-[22px] font-bold tracking-[10px] text-white outline-none focus:border-[#8b7cff]/60"
      />
      <button
        type="submit"
        disabled={busy || code.length !== 6}
        className="mt-4 w-full rounded-[11px] bg-white px-4 py-[13px] text-[14px] font-semibold text-[#1a1d24] transition hover:bg-[#e8eaef] disabled:opacity-40"
      >
        {busy ? "Verifying…" : "Verify code"}
      </button>
      <a href="/login" className="mt-4 block text-center text-[12px] text-[#64708c] hover:text-[#9aa5bd]">
        Start over
      </a>
    </form>
  )
}
