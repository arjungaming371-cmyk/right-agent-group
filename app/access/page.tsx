"use client"

// Access control page — add or remove the Gmail accounts that can log in.
// Available to any logged-in staff member at /access.

import { useCallback, useEffect, useState } from "react"

type AllowedEmail = { email: string; added_by: string | null; created_at: string }

export default function AccessPage() {
  const [emails, setEmails] = useState<AllowedEmail[]>([])
  const [you, setYou] = useState("")
  const [newEmail, setNewEmail] = useState("")
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/allowed-emails")
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      setEmails(data.emails || [])
      setYou(data.you || "")
    } catch {
      setMsg({ kind: "err", text: "Could not load the access list." })
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  async function addEmail(e: React.FormEvent) {
    e.preventDefault()
    const email = newEmail.trim().toLowerCase()
    if (!email) return
    setBusy(true)
    setMsg(null)
    try {
      const res = await fetch("/api/allowed-emails", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || "Failed")
      setNewEmail("")
      setMsg({ kind: "ok", text: `${email} can now log in.` })
      await load()
    } catch (err: any) {
      setMsg({ kind: "err", text: err.message })
    } finally {
      setBusy(false)
    }
  }

  async function removeEmail(email: string) {
    if (!confirm(`Remove login access for ${email}?`)) return
    setBusy(true)
    setMsg(null)
    try {
      const res = await fetch(`/api/allowed-emails?email=${encodeURIComponent(email)}`, { method: "DELETE" })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || "Failed")
      setMsg({ kind: "ok", text: `${email} removed.` })
      await load()
    } catch (err: any) {
      setMsg({ kind: "err", text: err.message })
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="min-h-screen bg-black px-4 py-10 text-white">
      <div className="mx-auto max-w-2xl">
        <div className="mb-8 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">Login Access</h1>
            <p className="mt-1 text-sm text-zinc-400">
              Only these Gmail accounts can sign in to the console.
              {you && <span className="ml-1 text-zinc-500">Signed in as {you}.</span>}
            </p>
          </div>
          <form action="/api/auth/logout" method="POST">
            <button className="rounded-lg border border-zinc-700 px-4 py-2 text-sm text-zinc-300 hover:bg-zinc-900">
              Log out
            </button>
          </form>
        </div>

        <form onSubmit={addEmail} className="mb-6 flex gap-3">
          <input
            type="email"
            required
            value={newEmail}
            onChange={(e) => setNewEmail(e.target.value)}
            placeholder="teammate@gmail.com"
            className="flex-1 rounded-lg border border-zinc-700 bg-zinc-950 px-4 py-3 text-white placeholder-zinc-500 outline-none focus:border-red-600"
          />
          <button
            type="submit"
            disabled={busy}
            className="rounded-lg bg-red-600 px-6 py-3 font-medium text-white transition hover:bg-red-500 disabled:opacity-50"
          >
            Add
          </button>
        </form>

        {msg && (
          <div
            className={`mb-6 rounded-lg border px-4 py-3 text-sm ${
              msg.kind === "ok" ? "border-green-800 bg-green-950/50 text-green-300" : "border-red-800 bg-red-950/50 text-red-300"
            }`}
          >
            {msg.text}
          </div>
        )}

        <div className="overflow-hidden rounded-xl border border-zinc-800">
          {emails.length === 0 ? (
            <p className="px-4 py-6 text-sm text-zinc-500">
              No emails added yet. The ADMIN_EMAIL from .env can always log in.
            </p>
          ) : (
            <table className="w-full text-left text-sm">
              <thead className="bg-zinc-950 text-zinc-400">
                <tr>
                  <th className="px-4 py-3 font-medium">Email</th>
                  <th className="px-4 py-3 font-medium">Added by</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody>
                {emails.map((e) => (
                  <tr key={e.email} className="border-t border-zinc-800">
                    <td className="px-4 py-3">{e.email}</td>
                    <td className="px-4 py-3 text-zinc-500">{e.added_by || "—"}</td>
                    <td className="px-4 py-3 text-right">
                      <button
                        onClick={() => removeEmail(e.email)}
                        disabled={busy || e.email === you}
                        className="text-red-400 hover:text-red-300 disabled:cursor-not-allowed disabled:opacity-40"
                        title={e.email === you ? "You cannot remove yourself" : "Remove access"}
                      >
                        Remove
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </main>
  )
}
