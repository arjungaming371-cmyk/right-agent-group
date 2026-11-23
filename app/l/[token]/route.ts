import { NextRequest, NextResponse } from "next/server"
import { query } from "@/lib/db"

export const dynamic = "force-dynamic"

function getBaseUrl(req: NextRequest): string {
  const envUrl = process.env.NEXT_PUBLIC_APP_URL
  if (envUrl && /^https?:\/\//.test(envUrl)) return envUrl
  const proto = req.headers.get("x-forwarded-proto") || "https"
  const host = req.headers.get("x-forwarded-host") || req.headers.get("host") || "13.201.0.111.sslip.io"
  return `${proto}://${host}`
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params
  const baseUrl = getBaseUrl(req)

  if (!token) {
    return NextResponse.redirect(`${baseUrl}/apply`)
  }

  try {
    const res = await query(
      `SELECT s.id, s.token, s.lead_id, s.product, s.bank, l.name, l.phone, l.loan_amount, l.product_interest
       FROM link_sends s
       LEFT JOIN leads l ON s.lead_id = l.id
       WHERE s.token = $1
       LIMIT 1`,
      [token]
    )

    if (res.rows.length > 0) {
      const row = res.rows[0]
      await query(
        `UPDATE link_sends
         SET clicked_at = COALESCE(clicked_at, now()),
             status = CASE WHEN status = 'sent' THEN 'opened' ELSE status END
         WHERE id = $1`,
        [row.id]
      )

      const productType = row.product || row.product_interest || "Home Loan"

      // Check if a custom application link has been configured in the library for this Loan Type
      const libRes = await query(
        `SELECT url FROM link_library
         WHERE lower(product) = lower($1) AND active = true
         ORDER BY created_at DESC LIMIT 1`,
        [productType]
      )

      if (libRes.rows.length > 0 && libRes.rows[0].url) {
        let destination = libRes.rows[0].url.trim()
        if (destination.startsWith("/")) {
          destination = `${baseUrl}${destination}`
        }
        // Append tracking ref if not already present
        const separator = destination.includes("?") ? "&" : "?"
        if (!destination.includes("ref=")) {
          destination = `${destination}${separator}ref=${encodeURIComponent(token)}`
        }
        return NextResponse.redirect(destination, 302)
      }

      // Default: Direct customer to Right Agent Group's own application form (/apply) with prefilled details
      const searchParams = new URLSearchParams()
      searchParams.set("ref", token)
      if (row.name) searchParams.set("name", row.name)
      if (row.phone) searchParams.set("phone", row.phone)
      if (productType) searchParams.set("type", productType)
      if (row.loan_amount) searchParams.set("amount", String(row.loan_amount))

      return NextResponse.redirect(`${baseUrl}/apply?${searchParams.toString()}`, 302)
    }

    return NextResponse.redirect(`${baseUrl}/apply?ref=${encodeURIComponent(token)}`, 302)
  } catch (e) {
    console.error("Link redirect error:", e)
    return NextResponse.redirect(`${baseUrl}/apply`)
  }
}
