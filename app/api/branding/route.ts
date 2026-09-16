import { NextRequest, NextResponse } from "next/server"
import { getBranding } from "@/lib/branches"

export const dynamic = "force-dynamic"

// Public white-label branding for customer-facing pages (promo site, loan
// form). Resolves by ?branch=<branchId> when the page knows its branch;
// unbranded deployments get the env-level defaults, so existing pages render
// byte-identically when multi-branch is not in use.
//
// Only public-safe fields are exposed — no numbers, no credentials, no quotas.

export async function GET(req: NextRequest) {
  const branchId = req.nextUrl.searchParams.get("branch")
  const branding = await getBranding(branchId)
  return NextResponse.json(branding)
}
