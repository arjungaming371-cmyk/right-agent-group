import { NextRequest, NextResponse } from "next/server"
import { query } from "@/lib/db"

export const dynamic = "force-dynamic"

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params
  if (!token) {
    return NextResponse.redirect(new URL("/", req.url))
  }

  try {
    // Look up token in link_sends + get bank URL from link_library
    const res = await query(
      `SELECT s.id, s.bank, s.product, s.status, s.clicked_at, l.url AS lib_url
       FROM link_sends s
       LEFT JOIN link_library l ON (lower(l.bank) = lower(s.bank) AND lower(l.product) = lower(s.product))
       WHERE s.token = $1
       LIMIT 1`,
      [token]
    )

    if (!res.rows || res.rows.length === 0) {
      return NextResponse.redirect(new URL("/help", req.url))
    }

    const row = res.rows[0]

    // Record clicked_at & update status to 'opened' if it was 'sent'
    await query(
      `UPDATE link_sends
       SET clicked_at = COALESCE(clicked_at, now()),
           status = CASE WHEN status = 'sent' THEN 'opened' ELSE status END
       WHERE id = $1`,
      [row.id]
    )

    // Fallback if the link wasn't in library: direct bank search or standard portal
    let targetUrl = row.lib_url
    if (!targetUrl) {
      targetUrl = `https://www.google.com/search?q=${encodeURIComponent(row.bank + " " + row.product + " official loan application")}`
    }

    return NextResponse.redirect(targetUrl, 302)
  } catch (e) {
    console.error("Link redirect error:", e)
    return NextResponse.redirect(new URL("/", req.url))
  }
}
