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

const DEFAULT_BANK_URLS: Record<string, string> = {
  sbi: "https://onlineapply.sbi.bank.in/personal-banking/education-loan",
  "state bank of india": "https://onlineapply.sbi.bank.in/personal-banking/education-loan",
  hdfc: "https://www.hdfcbank.com/personal/borrow/popular-loans/educational-loan",
  "hdfc bank": "https://www.hdfcbank.com/personal/borrow/popular-loans/educational-loan",
  icici: "https://www.icicibank.com/personal-banking/loans/education-loan",
  "icici bank": "https://www.icicibank.com/personal-banking/loans/education-loan",
  axis: "https://www.axisbank.com/retail/loans/education-loan",
  "axis bank": "https://www.axisbank.com/retail/loans/education-loan",
  "idfc first": "https://www.idfcfirstbank.com/personal-banking/loans/personal-loan",
  idfc: "https://www.idfcfirstbank.com/personal-banking/loans/personal-loan",
  "bajaj finserv": "https://www.bajajfinserv.in/business-loan",
  bajaj: "https://www.bajajfinserv.in/business-loan",
  "iifl home": "https://www.iiflhomeloans.com/loan-against-property",
  iifl: "https://www.iiflhomeloans.com/loan-against-property",
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params
  const baseUrl = getBaseUrl(req)

  if (!token) {
    return NextResponse.redirect(`${baseUrl}/`)
  }

  try {
    // Look up token in link_sends + get bank URL from link_library.
    // Check direct library_id first, then exact bank + product match, then any bank match
    const res = await query(
      `SELECT s.id, s.bank, s.product, s.status, s.clicked_at, s.library_id,
              COALESCE(l_direct.url, l_match.url, l_bank.url) AS lib_url,
              COALESCE(l_direct.active, l_match.active, l_bank.active, true) AS is_active
       FROM link_sends s
       LEFT JOIN link_library l_direct ON s.library_id = l_direct.id
       LEFT JOIN link_library l_match ON (lower(l_match.bank) = lower(s.bank) AND lower(l_match.product) = lower(s.product) AND l_match.active = true)
       LEFT JOIN link_library l_bank ON (lower(l_bank.bank) = lower(s.bank) AND l_bank.active = true)
       WHERE s.token = $1
       LIMIT 1`,
      [token]
    )

    if (!res.rows || res.rows.length === 0) {
      return NextResponse.redirect(`${baseUrl}/help?msg=link_not_found`)
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

    const bankKey = (row.bank || "").toLowerCase().trim()
    const fallbackBankUrl = DEFAULT_BANK_URLS[bankKey] || (bankKey.includes("sbi") ? DEFAULT_BANK_URLS.sbi : null)
    const targetUrl = row.lib_url || fallbackBankUrl

    if (!targetUrl || row.is_active === false) {
      console.warn(`[BankLink] Target URL not found or inactive for bank="${row.bank}", product="${row.product}", token="${token}"`)
      return NextResponse.redirect(`${baseUrl}/help?msg=link_unavailable`)
    }

    return NextResponse.redirect(targetUrl, 302)
  } catch (e) {
    console.error("Link redirect error:", e)
    return NextResponse.redirect(`${baseUrl}/`)
  }
}
