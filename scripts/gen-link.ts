import "dotenv/config"
import { query } from "../lib/db"
import { randomUUID } from "crypto"

async function main() {
  const token = randomUUID()
  await query("INSERT INTO form_links (token) VALUES ($1)", [token])
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"
  console.log("========================================")
  console.log("YOUR TEST FORM LINKS:")
  console.log(`Local  : http://localhost:3000/form/${token}`)
  console.log(`Public : ${appUrl}/form/${token}`)
  console.log("========================================")
  process.exit(0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
