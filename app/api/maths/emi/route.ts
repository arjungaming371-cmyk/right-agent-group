import { NextRequest, NextResponse } from "next/server"
import { amortizationSchedule, calculateEMI, flatToReducingAPR, formatINR, totalInterest } from "@/lib/finance"
import { clientIp, rateLimit } from "@/lib/rate-limit"

export const dynamic = "force-dynamic"

/**
 * PUBLIC loan-math endpoint — the one API behind the website's EMI
 * calculator and any WhatsApp "send me the calculation" bot flow. Same
 * lib/finance.ts the call AI uses, so a number quoted on a live call and a
 * number shown on the website can never disagree.
 *
 * GET /api/maths/emi?amount=2000000&rate=7.25&years=20[&flat=12]
 *   → { emi, totalInterest, totalPayable, yearly[], flatEquivalentReducing? }
 *
 * No auth (marketing surface), but rate-limited and every input clamped —
 * a ?amount=999999999999999 crawler request just gets the clamped math.
 */
export async function GET(req: NextRequest) {
  // 40/min per IP: far above any human clicking sliders (the widget computes
  // locally — this endpoint is for shares/links and third-party embeds).
  if (!rateLimit(`emi:${clientIp(req)}`, 40, 60_000)) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 })
  }

  const sp = req.nextUrl.searchParams
  const amount = Number(sp.get("amount"))
  const rate = Number(sp.get("rate"))
  const years = Number(sp.get("years"))
  const flat = sp.get("flat")

  // Same clamps as lib/finance amortizationSchedule — kept in sync so the
  // API answers identically for raw and clamped inputs.
  const p = Number.isFinite(amount) ? Math.min(Math.max(amount, 10_000), 100_000_000) : 2_000_000
  const r = Number.isFinite(rate) ? Math.min(Math.max(rate, 0.1), 36) : 7.25
  const n = Number.isFinite(years) ? Math.round(Math.min(Math.max(years, 0.25), 30) * 12) : 240

  const sched = amortizationSchedule(p, r, n)
  const emi = calculateEMI(p, r, n)

  return NextResponse.json(
    {
      input: { amount: p, ratePct: r, tenureMonths: n },
      emi,
      emiFormatted: formatINR(emi),
      totalInterest: totalInterest(p, emi, n),
      totalPayable: sched.totalPayable,
      yearly: sched.yearly,
      // Optional cross-check: "the bank quoted 12% flat — what reducing rate
      // is that actually?" → flat=<flatRatePct>
      flatEquivalentReducing: flat !== null && flat !== "" && Number.isFinite(Number(flat)) ? flatToReducingAPR(Number(flat), n) : null,
    },
    { headers: { "Cache-Control": "public, max-age=300" } }
  )
}
