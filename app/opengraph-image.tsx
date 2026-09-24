import { ImageResponse } from "next/og"

// Auto-generated social card (1200×630) served at /opengraph-image — picked
// up by the RootLayout metadata automatically. Drawn with next/og so there
// is no binary asset to keep in sync with the brand.

export const size = { width: 1200, height: 630 }
export const contentType = "image/png"
export const alt = "Right Agent Group — AI Voice & WhatsApp for Lending Teams"

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "flex-start",
          justifyContent: "center",
          padding: "0 90px",
          // Satori: no multi-layer `background` shorthand — color and image
          // must be separate properties, and only one gradient layer is safe.
          backgroundColor: "#05070c",
          backgroundImage:
            "linear-gradient(135deg, rgba(139,124,255,0.22) 0%, rgba(5,7,12,0) 45%, rgba(56,189,248,0.16) 100%)",
          color: "#fff",
          fontFamily: "sans-serif",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 18,
            fontSize: 26,
            letterSpacing: 4,
            color: "#a5b0ff",
            textTransform: "uppercase",
          }}
        >
          Right Agent Group
        </div>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            fontSize: 76,
            fontWeight: 800,
            lineHeight: 1.1,
            marginTop: 28,
            letterSpacing: -2,
          }}
        >
          <span>Every lead answered.</span>
          <span
            style={{
              backgroundImage: "linear-gradient(135deg, #a5b0ff, #5b7cfa 50%, #38bdf8)",
              backgroundClip: "text",
              color: "transparent",
            }}
          >
            Every call handled.
          </span>
        </div>
        <div style={{ display: "flex", fontSize: 28, color: "#9aa5bd", marginTop: 34 }}>
          AI voice · WhatsApp · Instagram — one console, three languages, 24/7.
        </div>
        <div
          style={{
            display: "flex",
            marginTop: 44,
            padding: "12px 28px",
            borderRadius: 999,
            border: "1px solid rgba(139,124,255,0.4)",
            background: "rgba(139,124,255,0.12)",
            fontSize: 22,
            color: "#c3caff",
          }}
        >
          Meet Priya →
        </div>
      </div>
    ),
    size
  )
}
