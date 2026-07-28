export default function NotFound() {
  return (
    <div style={{
      minHeight: "100vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
      gap: 16, padding: 24, textAlign: "center", background: "var(--bg-primary, #0a0e1a)", color: "var(--text-primary, #e2e8f0)",
    }}>
      <div style={{ fontSize: 40, fontWeight: 700 }}>R</div>
      <div style={{ fontSize: 18, fontWeight: 600 }}>Page not found</div>
      <div style={{ fontSize: 13, color: "var(--text-muted, #94a3b8)", maxWidth: 420 }}>
        The page you're looking for doesn't exist or may have moved.
      </div>
      <a href="/" className="btn-primary" style={{ height: 38, padding: "0 22px", marginTop: 8, display: "inline-flex", alignItems: "center", textDecoration: "none" }}>
        Back to home
      </a>
    </div>
  )
}
