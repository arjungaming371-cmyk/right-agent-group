// Outbound email — OPTIONAL. If SMTP is not configured in .env the system
// works exactly as before; emails are simply skipped (never throws).
//
// Recommended for Gmail: create an App Password at
// https://myaccount.google.com/apppasswords and set:
//   SMTP_HOST=smtp.gmail.com
//   SMTP_PORT=465
//   SMTP_USER=yourbusiness@gmail.com
//   SMTP_PASS=your-16-char-app-password
//   SMTP_FROM="Right Agent Group <yourbusiness@gmail.com>"

import nodemailer from "nodemailer"
import { escapeHtml } from "./utils"

const HOST = process.env.SMTP_HOST || ""
const PORT = parseInt(process.env.SMTP_PORT || "465")
const USER = process.env.SMTP_USER || ""
const PASS = process.env.SMTP_PASS || ""
const FROM = process.env.SMTP_FROM || USER

export function isMailConfigured(): boolean {
  return Boolean(HOST && USER && PASS)
}

let transporter: nodemailer.Transporter | null = null
function getTransporter() {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: HOST,
      port: PORT,
      secure: PORT === 465,
      auth: { user: USER, pass: PASS },
    })
  }
  return transporter
}

export async function sendMail(opts: {
  to: string
  subject: string
  html: string
}): Promise<{ ok: boolean; error?: string }> {
  if (!isMailConfigured()) return { ok: false, error: "SMTP_NOT_CONFIGURED" }
  try {
    await getTransporter().sendMail({ from: FROM, to: opts.to, subject: opts.subject, html: opts.html })
    return { ok: true }
  } catch (e: any) {
    console.error("sendMail error:", e.message)
    return { ok: false, error: e.message }
  }
}

/** Confirmation email after a loan application is submitted. Fire-and-forget safe. */
export async function sendApplicationConfirmation(opts: {
  to: string
  name: string
  loanType: string
  applicationId: string
}): Promise<{ ok: boolean; error?: string }> {
  const { to, name, loanType, applicationId } = opts
  const shortId = applicationId.slice(0, 8).toUpperCase()
  // name/loanType come from the public application form — escaped so a
  // "name" of <a href=...> or <script> renders as text in the applicant's
  // and admin's mail clients, never as markup (phishing vector otherwise).
  const safeName = escapeHtml(name)
  const safeLoanType = escapeHtml(loanType)
  return sendMail({
    to,
    subject: `Application received — Right Agent Group (Ref: ${shortId})`,
    html: `
<div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:0 auto;color:#1f2937">
  <div style="background:linear-gradient(135deg,#3b82f6,#1d4ed8);border-radius:12px 12px 0 0;padding:24px;text-align:center">
    <div style="font-size:22px;font-weight:700;color:#ffffff">Right Agent Group</div>
    <div style="font-size:13px;color:#dbeafe;margin-top:4px">LS Right Agent Services, Hyderabad</div>
  </div>
  <div style="border:1px solid #e5e7eb;border-top:none;border-radius:0 0 12px 12px;padding:28px">
    <p style="font-size:16px;margin:0 0 12px">Dear ${safeName},</p>
    <p style="font-size:14px;line-height:1.6;margin:0 0 16px">
      Thank you! We have received your <strong>${safeLoanType} loan</strong> application.
      Your reference number is:
    </p>
    <div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:8px;padding:14px;text-align:center;font-size:20px;font-weight:700;color:#1d4ed8;letter-spacing:2px;margin:0 0 16px">
      ${shortId}
    </div>
    <p style="font-size:14px;line-height:1.6;margin:0 0 16px">
      Our loan officer will review your details and contact you on WhatsApp or by phone
      within <strong>1 business day</strong> with your best offer.
    </p>
    <p style="font-size:13px;line-height:1.6;color:#6b7280;margin:0">
      <strong>Important:</strong> Right Agent Group never asks for OTP, PIN, card details,
      or any payment to process your application. Please keep this reference number for your records.
    </p>
  </div>
</div>`,
  })
}
