import { NextResponse } from "next/server"
import { getSecurityFlags } from "@/lib/security"
import { withRoute } from "@/lib/api-route"

export const dynamic = "force-dynamic"

// PUBLIC (read by the Edge middleware, which cannot query Postgres):
// exposes ONLY the one boolean the middleware needs to enforce the IP
// allowlist. Never add anything sensitive here.
export const GET = withRoute("security/flags", async () => {
  const flags = await getSecurityFlags()
  return NextResponse.json({ ip_allowlist: !!flags.ip_allowlist })
})
