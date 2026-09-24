"use client"

import { useEffect } from "react"

// Client-side error boundary for the whole app tree. React 19 calls render
// side-effect free — the actual error report happens in useEffect (twice in
// dev Strict Mode is fine; it's idempotent logging). The digest is surfaced
// so an ops user can quote the exact server-side log line.
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    // Structured single-line JSON keeps browser console filtering greppable
    // and matches the server's lib/logger.ts shape.
    console.error(
      JSON.stringify({
        ts: new Date().toISOString(),
        level: "error",
        scope: "client/error-boundary",
        event: "render_error",
        message: error?.message,
        digest: error?.digest,
        stack: error?.stack?.split("\n").slice(0, 5).join("\n"),
      })
    )
  }, [error])

  return (
    <div style={{
      minHeight: "100vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
      gap: 16, padding: 24, textAlign: "center", background: "var(--bg-primary, #0a0e1a)", color: "var(--text-primary, var(--text-primary))",
    }}>
      <div style={{ fontSize: 40, fontWeight: 700 }}>R</div>
      <div style={{ fontSize: 18, fontWeight: 600 }}>Something went wrong</div>
      <div style={{ fontSize: 13, color: "var(--text-muted, var(--text-secondary))", maxWidth: 420 }}>
        Right Agent Group hit an unexpected error. Try again, and if it keeps happening, contact your administrator.
      </div>
      {error?.digest && (
        <div style={{ fontSize: 11, fontFamily: "var(--font-mono, monospace)", color: "var(--text-muted)" }}>
          Error ID: {error.digest}
        </div>
      )}
      <button
        onClick={() => reset()}
        className="btn-primary"
        style={{ height: 38, padding: "0 22px", marginTop: 8 }}
      >
        Try again
      </button>
    </div>
  )
}
