import { redirect } from "next/navigation"
import { cookies } from "next/headers"
import { SESSION_COOKIE, verifySessionToken } from "@/lib/session-token"

export const dynamic = "force-dynamic"

export default async function HomePage() {
  const cookieStore = await cookies()
  const token = cookieStore.get(SESSION_COOKIE)?.value
  const session = await verifySessionToken(token)

  if (session) {
    redirect("/dashboard")
  } else {
    redirect("/login")
  }
}
