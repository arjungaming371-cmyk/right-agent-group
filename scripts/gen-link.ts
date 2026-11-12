import "dotenv/config"
import { query } from "../lib/db"
import { randomUUID } from "crypto"

async function main() {
  const token = randomUUID().slice(0, 8)
  await query("INSERT INTO link_sends (token, bank, product, apply_url, status) VALUES ($1, 'SBI', 'Home Loan', 'https://homeloans.sbi', 'sent')", [token])
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"
  console.log("========================================")
  console.log("YOUR TEST BANK REDIRECT LINKS:")
  console.log(`Local  : http://localhost:3000/l/${token}`)
  console.log(`Public : ${appUrl}/l/${token}`)
  console.log("========================================")
  process.exit(0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
