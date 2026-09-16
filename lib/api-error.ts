import { NextResponse } from "next/server"

// Route handlers used to forward raw error.message (Postgres error text,
// stack details, connection info) straight to the client on every 500.
// Log the real error server-side and return a generic message instead —
// nothing here changes behavior for callers that only check response.ok.
export function apiError(e: any, status = 500) {
  console.error("API error:", e?.message || e)
  return NextResponse.json({ error: "Something went wrong. Please try again." }, { status })
}
