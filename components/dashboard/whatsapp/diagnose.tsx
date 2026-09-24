"use client"

// WhatsApp connection diagnostic — answers "why are messages not reaching
// my phone?" in one click. Pings Meta with the live sender credentials and
// shows the raw result plus human hints for the common failures.

import { useState } from "react"
import { WA, WA_FONT } from "./palette"

export type DiagResult = {
  ok?: boolean
  token_valid?: boolean | null
  phone?: string
  verified_name?: string
  quality_rating?: string
  platform_type?: string
  code_verification_status?: string
  error?: string | null
  code?: number
}

export async function runDiagnostic(branchId?: string | null): Promise<DiagResult> {
  try {
    const res = await fetch(`/api/whatsapp/diagnose${branchId ? `?branchId=${branchId}` : ""}`)
    return await res.json()
  } catch (e: any) {
    return { ok: false, error: `Diagnostic request failed: ${e.message}` }
  }
}

const HINTS: Array<{ match: (d: DiagResult) => boolean; text: string }> = [
  {
    match: (d) => d.token_valid === false || d.code === 190,
    text: "The WHATSAPP_TOKEN is expired or revoked. Create a PERMANENT token: Meta Business Settings → System users → generate token with whatsapp_business_messaging + whatsapp_business_management (temporary tokens die in 24h).",
  },
  {
    match: (d) => !!(d.code === 100 || (d.error || "").toLowerCase().includes("phone_number_id")),
    text: "The WHATSAPP_PHONE_NUMBER_ID looks wrong. Copy the PHONE NUMBER ID (not the WABA ID or business ID) from Meta → WhatsApp → API Setup.",
  },
  {
    match: (d) => !!(d.error || "").toLowerCase().includes("not configured"),
    text: "No credentials at all — set WHATSAPP_TOKEN + WHATSAPP_PHONE_NUMBER_ID in .env, restart the app, and re-run the diagnostic.",
  },
  {
    match: (d) => (d.quality_rating || "").toLowerCase() === "red",
    text: "The number's quality rating is RED — Meta throttles sends. Stop bulk sends for 7 days and keep replies inside the 24h window.",
  },
  {
    match: (d) => (d.code_verification_status || "").toLowerCase() !== "verified" && !!d.ok,
    text: "The number itself is not verified on Meta yet — finish code verification in WhatsApp Manager, or inbound webhook events may not arrive.",
  },
]

export function DiagnoseModal({ onClose }: { onClose: () => void }) {
  const [result, setResult] = useState<DiagResult | null>(null)
  const [busy, setBusy] = useState(true)

  if (result === null && busy) {
    runDiagnostic().then((r) => { setResult(r); setBusy(false) })
  }

  const hints = result ? HINTS.filter((h) => h.match(result)) : []

  return (
    <div onClick={onClose} style={{
      position: "fixed", inset: 0, zIndex: 90, background: WA.overlay,
      display: "flex", alignItems: "center", justifyContent: "center", padding: 20, fontFamily: WA_FONT,
    }}>
      <div onClick={(e) => e.stopPropagation()} style={{
        width: 520, maxWidth: "94vw", maxHeight: "80vh", overflowY: "auto",
        background: WA.panelBg, border: `1px solid ${WA.hairline}`, borderRadius: 14, padding: 20,
      }}>
        <div style={{ fontSize: 16.5, color: WA.textPrimary, fontWeight: 600, marginBottom: 4 }}>
          WhatsApp connection diagnostic
        </div>
        <div style={{ fontSize: 12.5, color: WA.textSecondary, marginBottom: 14 }}>
          Live check against Meta with your current credentials — nothing is sent to customers.
        </div>

        {busy && <div style={{ color: WA.textSecondary, fontSize: 13 }}>Pinging Meta Graph API…</div>}

        {result && !busy && (
          <>
            <div style={{
              background: result.ok ? WA.chipActiveBg : "#49272c", color: result.ok ? "#d6f8e3" : "#ffd7d7",
              borderRadius: 10, padding: "12px 14px", fontSize: 13, marginBottom: 12, whiteSpace: "pre-wrap",
            }}>
              {result.ok
                ? `✓ Credentials are LIVE — Meta accepted the token and knows the number as ${result.verified_name || "(unnamed)"} <${result.phone || "?"}>`
                : `✗ ${result.error || "Unknown failure"}`}
            </div>

            {result.ok && (
              <div style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "6px 14px", fontSize: 12.5, color: WA.textSecondary, marginBottom: 12 }}>
                <span>Number</span><span style={{ color: WA.textPrimary }}>{result.phone || "—"}</span>
                <span>Verified name</span><span style={{ color: WA.textPrimary }}>{result.verified_name || "—"}</span>
                <span>Quality rating</span><span style={{ color: WA.textPrimary }}>{result.quality_rating || "—"}</span>
                <span>Verified</span><span style={{ color: WA.textPrimary }}>{result.code_verification_status || "—"}</span>
              </div>
            )}

            {hints.length > 0 && (
              <div style={{ marginBottom: 6 }}>
                {hints.map((h, i) => (
                  <div key={i} style={{ background: WA.pill, borderRadius: 10, padding: "10px 12px", fontSize: 12.5, color: WA.textPrimary, marginBottom: 8, lineHeight: 1.45 }}>
                    💡 {h.text}
                  </div>
                ))}
              </div>
            )}

            {result.ok && (
              <div style={{ fontSize: 12.5, color: WA.textSecondary, lineHeight: 1.5 }}>
                Credentials are healthy. If messages still don't arrive, check:
                <br />• The 24-hour window — free-form replies only work if the customer messaged you within 24h; outside it you must send an approved TEMPLATE (error 131047).
                <br />• The webhook is subscribed to the <b>messages</b> field and points at /api/whatsapp with the same verify token.
                <br />• Failed sends carry the exact Meta reason into Comm Logs ("reply_failed") and pm2 logs.
              </div>
            )}

            <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 14 }}>
              <button onClick={onClose} style={{
                background: WA.teal, color: "#fff", border: 0, borderRadius: 999,
                padding: "8px 22px", fontSize: 13, fontWeight: 600, cursor: "pointer",
              }}>Close</button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
