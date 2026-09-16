"use client"

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
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
