export default function NotFound() {
  return (
    <div style={{
      minHeight: "100vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
      gap: 16, padding: 24, textAlign: "center", background: "var(--bg-primary, #0a0e1a)", color: "var(--text-primary, var(--text-primary))",
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <div style={{ width: 44, height: 44, borderRadius: 12, background: "linear-gradient(135deg, #2563eb, #06b6d4)", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 900, color: "#fff", fontSize: 22, boxShadow: "0 0 20px rgba(37,99,235,0.4)" }}>
          N
        </div>
        <div style={{ textAlign: "left" }}>
          <div style={{ fontSize: 20, fontWeight: 800, color: "#fff" }}>NIAT</div>
          <div style={{ fontSize: 11, color: "var(--text-muted)" }}>Admissions AI</div>
        </div>
      </div>
      <div style={{ fontSize: 18, fontWeight: 600 }}>Page not found</div>
      <div style={{ fontSize: 13, color: "var(--text-muted, var(--text-secondary))", maxWidth: 420 }}>
        The page you're looking for doesn't exist or may have moved.
      </div>
      <a href="/" className="btn-primary" style={{ height: 38, padding: "0 22px", marginTop: 8, display: "inline-flex", alignItems: "center", textDecoration: "none" }}>
        Back to home
      </a>
    </div>
  )
}
