import { NextResponse } from "next/server"
import { getSecurityFlags } from "@/lib/security"

export const dynamic = "force-dynamic"

// PUBLIC (read by the Edge middleware, which cannot query Postgres):
// exposes ONLY the one boolean the middleware needs to enforce the IP
// allowlist. Never add anything sensitive here.
export async function GET() {
  const flags = await getSecurityFlags()
  return NextResponse.json({ ip_allowlist: !!flags.ip_allowlist })
}
