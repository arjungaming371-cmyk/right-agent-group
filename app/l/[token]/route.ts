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
    // Look up token in link_sends + get bank URL from link_library.
    // Check direct library_id first, fallback to active bank + product match
    const res = await query(
      `SELECT s.id, s.bank, s.product, s.status, s.clicked_at, s.library_id,
              COALESCE(l_direct.url, l_match.url) AS lib_url,
              COALESCE(l_direct.active, l_match.active, true) AS is_active
       FROM link_sends s
       LEFT JOIN link_library l_direct ON s.library_id = l_direct.id
       LEFT JOIN link_library l_match ON (lower(l_match.bank) = lower(s.bank) AND lower(l_match.product) = lower(s.product) AND l_match.active = true)
       WHERE s.token = $1
       LIMIT 1`,
      [token]
    )

    if (!res.rows || res.rows.length === 0) {
      return NextResponse.redirect(new URL("/help?msg=link_not_found", req.url))
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

    const targetUrl = row.lib_url
    if (!targetUrl || row.is_active === false) {
      console.warn(`[BankLink] Target URL not found or inactive for bank="${row.bank}", product="${row.product}", token="${token}"`)
      return NextResponse.redirect(new URL("/help?msg=link_unavailable", req.url))
    }

    return NextResponse.redirect(targetUrl, 302)
  } catch (e) {
    console.error("Link redirect error:", e)
    return NextResponse.redirect(new URL("/", req.url))
  }
}
