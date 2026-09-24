import { NextRequest, NextResponse } from "next/server"
import { getBranding } from "@/lib/branches"
import { withRoute, queryString } from "@/lib/api-route"

export const dynamic = "force-dynamic"

// Public white-label branding for customer-facing pages (promo site, loan
// form). Resolves by ?branch=<branchId> when the page knows its branch;
// unbranded deployments get the env-level defaults, so existing pages render
// byte-identically when multi-branch is not in use.
//
// Only public-safe fields are exposed — no numbers, no credentials, no quotas.

export const GET = withRoute("branding", async (req: NextRequest) => {
  const branchId = queryString(req, "branch", 64)
  const branding = await getBranding(branchId)
  return NextResponse.json(branding)
})
