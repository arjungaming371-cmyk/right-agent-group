// lib/meta-templates.ts
// Standardized Meta WhatsApp Cloud API templates library
// Contains pre-approved test templates, official utility/marketing templates,
// and copy-paste ready formats for Meta WhatsApp Business Manager.

export interface MetaTemplateDefinition {
  name: string
  displayName: string
  category: "UTILITY" | "MARKETING"
  pricing: string
  languages: { code: string; label: string }[]
  header?: string
  body: string
  bodyVariables: string[]
  footer?: string
  button?: {
    type: "URL" | "QUICK_REPLY"
    text: string
    urlType?: "DYNAMIC" | "STATIC"
    exampleUrl?: string
  }
  description: string
  isPreApproved?: boolean
  samplePreview: string
  copyTextForMeta: string
}

export const META_TEMPLATES_CATALOG: MetaTemplateDefinition[] = [
  {
    name: "hello_world",
    displayName: "Default Meta Test Template",
    category: "UTILITY",
    pricing: "Free / Utility (Sandbox Ready)",
    languages: [{ code: "en_US", label: "English US (en_US)" }],
    body: "Hello World",
    bodyVariables: [],
    description: "Meta's official default template. Pre-approved for instant testing on any verified phone number without manual approval.",
    isPreApproved: true,
    samplePreview: "Hello World",
    copyTextForMeta: "Template Name: hello_world\nCategory: Utility\nLanguage: English (US)\nBody: Hello World",
  },
  {
    name: "loan_application_form",
    displayName: "NIAT Admissions Application Form Link",
    category: "UTILITY",
    pricing: "Utility (~₹0.115/msg)",
    languages: [
      { code: "en", label: "English (en)" },
      { code: "en_US", label: "English US (en_US)" },
      { code: "te", label: "Telugu (te)" },
      { code: "hi", label: "Hindi (hi)" },
    ],
    header: "NIAT Admissions - Technology Programmes",
    body: "Hello {{1}}, thank you for inquiring about NIAT. Your online admissions application link is ready. Please click the button below to review programme options and submit your details in just 2 minutes.",
    bodyVariables: ["Student Name"],
    footer: "NIAT • NxtWave Innovation in Advanced Technologies",
    button: {
      type: "URL",
      text: "Complete Application",
      urlType: "DYNAMIC",
      exampleUrl: "https://13.201.0.111.sslip.io/l/{{1}}",
    },
    description: "Utility template to send one-time secure admissions application links to leads. The CRM dynamically maps {{1}} to student name and button URL to their personalized application token.",
    samplePreview: "Hello Rajesh,\n\nThank you for inquiring about NIAT. Your online admissions application link is ready. Please click the button below to review programme options and submit your details in just 2 minutes.\n\n[Button: Complete Application]",
    copyTextForMeta: `Template Name: loan_application_form
Category: Utility
Language: English (en)

Header (Text):
NIAT Admissions - Technology Programmes

Body:
Hello {{1}}, thank you for inquiring about NIAT. Your online admissions application link is ready. Please click the button below to review programme options and submit your details in just 2 minutes.

Footer:
NIAT • NxtWave Innovation in Advanced Technologies

Button (URL - Dynamic):
Button Text: Complete Application
URL Type: Dynamic
Website URL: https://13.201.0.111.sslip.io/l/{{1}}`,
  },
  {
    name: "call_followup",
    displayName: "Call Follow-up & Admissions Summary",
    category: "UTILITY",
    pricing: "Utility (~₹0.115/msg)",
    languages: [
      { code: "en", label: "English (en)" },
      { code: "en_US", label: "English US (en_US)" },
      { code: "te", label: "Telugu (te)" },
      { code: "hi", label: "Hindi (hi)" },
    ],
    header: "Admissions Discussion Summary",
    body: "Hello {{1}}, thank you for speaking with our admissions counsellor regarding NIAT undergraduate technology programmes. Along with the university B.Tech degree, our practical curriculum covers AI, robotics and real-world projects. Click below to explore the official programme.",
    bodyVariables: ["Student Name"],
    footer: "NIAT Admissions • NxtWave Innovation",
    button: {
      type: "URL",
      text: "View Programme Details",
      urlType: "STATIC",
      exampleUrl: "https://13.201.0.111.sslip.io/apply",
    },
    description: "Utility template sent after an AI voice call or telecaller discussion summarizing loan options and keeping the lead engaged.",
    samplePreview: "Hello Priya,\n\nThank you for speaking with our loan advisor regarding your loan inquiry. As discussed, our 20+ partner banks offer competitive interest rates starting at 8.5% p.a. with fast-track processing. Click below if you would like to proceed with your application.\n\n[Button: View Loan Details]",
    copyTextForMeta: `Template Name: call_followup
Category: Utility
Language: English (en)

Header (Text):
Loan Discussion Summary

Body:
Hello {{1}}, thank you for speaking with our loan advisor regarding your loan inquiry. As discussed, our 20+ partner banks offer competitive interest rates starting at 8.5% p.a. with fast-track processing. Click below if you would like to proceed with your application.

Footer:
Right Agent Group • Banking Assistance

Button (URL - Static):
Button Text: View Loan Details
Website URL: https://13.201.0.111.sslip.io/apply`,
  },
  {
    name: "missed_call_followup",
    displayName: "Missed Call Alert & Callback",
    category: "UTILITY",
    pricing: "Utility (~₹0.115/msg)",
    languages: [
      { code: "en", label: "English (en)" },
      { code: "en_US", label: "English US (en_US)" },
      { code: "te", label: "Telugu (te)" },
      { code: "hi", label: "Hindi (hi)" },
    ],
    header: "Right Agent Group",
    body: "Hello {{1}}, we tried reaching you earlier regarding your loan inquiry but could not connect. We assist with Home, Personal, and Business Loan approvals across top banks. Please reply to this message or tap below to let us know a convenient time to call.",
    bodyVariables: ["Customer Name"],
    footer: "Zero Advance Fees • Prompt Support",
    button: {
      type: "QUICK_REPLY",
      text: "Call Me Now",
    },
    description: "Utility template triggered automatically when a dialer call goes unanswered or busy.",
    samplePreview: "Hello Suresh,\n\nWe tried reaching you earlier regarding your loan inquiry but could not connect. We assist with Home, Personal, and Business Loan approvals across top banks. Please reply to this message or tap below to let us know a convenient time to call.\n\n[Button: Call Me Now]",
    copyTextForMeta: `Template Name: missed_call_followup
Category: Utility
Language: English (en)

Header (Text):
Right Agent Group

Body:
Hello {{1}}, we tried reaching you earlier regarding your loan inquiry but could not connect. We assist with Home, Personal, and Business Loan approvals across top banks. Please reply to this message or tap below to let us know a convenient time to call.

Footer:
Zero Advance Fees • Prompt Support

Button (Quick Reply):
Button Text: Call Me Now`,
  },
  {
    name: "loan_eligibility_offer",
    displayName: "Pre-Approved Loan Eligibility",
    category: "MARKETING",
    pricing: "Marketing (~₹0.78/msg)",
    languages: [
      { code: "en", label: "English (en)" },
      { code: "en_US", label: "English US (en_US)" },
      { code: "te", label: "Telugu (te)" },
      { code: "hi", label: "Hindi (hi)" },
    ],
    header: "Exclusive Pre-Approved Offer",
    body: "Hello {{1}}, great news! Based on your inquiry, you are eligible for fast-track loan approvals up to ₹50 Lakhs with attractive interest rates and flexible repayment tenure up to 7 years. Minimal documentation with same-day sanction assistance.",
    bodyVariables: ["Customer Name"],
    footer: "Right Agent Group • Hyderabad Financial Hub",
    button: {
      type: "URL",
      text: "Check My Eligibility",
      urlType: "STATIC",
      exampleUrl: "https://13.201.0.111.sslip.io/apply",
    },
    description: "Marketing template for cold prospecting and re-engaging past leads with high-converting eligibility messaging.",
    samplePreview: "Hello Vikram,\n\nGreat news! Based on your inquiry, you are eligible for fast-track loan approvals up to ₹50 Lakhs with attractive interest rates and flexible repayment tenure up to 7 years. Minimal documentation with same-day sanction assistance.\n\n[Button: Check My Eligibility]",
    copyTextForMeta: `Template Name: loan_eligibility_offer
Category: Marketing
Language: English (en)

Header (Text):
Exclusive Pre-Approved Offer

Body:
Hello {{1}}, great news! Based on your inquiry, you are eligible for fast-track loan approvals up to ₹50 Lakhs with attractive interest rates and flexible repayment tenure up to 7 years. Minimal documentation with same-day sanction assistance.

Footer:
Right Agent Group • Hyderabad Financial Hub

Button (URL - Static):
Button Text: Check My Eligibility
Website URL: https://13.201.0.111.sslip.io/apply`,
  },
  {
    name: "document_collection",
    displayName: "Document Checklist for Fast Approval",
    category: "UTILITY",
    pricing: "Utility (~₹0.115/msg)",
    languages: [
      { code: "en", label: "English (en)" },
      { code: "en_US", label: "English US (en_US)" },
      { code: "te", label: "Telugu (te)" },
    ],
    header: "Document Verification",
    body: "Hello {{1}}, to fast-track your loan sanction with our partner banks, please have these documents ready: 1) PAN & Aadhaar Card, 2) Latest 6 months bank statement, 3) Income proof / 3 months salary slips. You can submit them online via our secure link.",
    bodyVariables: ["Customer Name"],
    footer: "Confidential & Safe • Right Agent Group",
    button: {
      type: "URL",
      text: "Submit Documents",
      urlType: "STATIC",
      exampleUrl: "https://13.201.0.111.sslip.io/apply",
    },
    description: "Utility template sent to warm prospects to gather KYC and income documents swiftly.",
    samplePreview: "Hello Anita,\n\nTo fast-track your loan sanction with our partner banks, please have these documents ready: 1) PAN & Aadhaar Card, 2) Latest 6 months bank statement, 3) Income proof / 3 months salary slips. You can submit them online via our secure link.\n\n[Button: Submit Documents]",
    copyTextForMeta: `Template Name: document_collection
Category: Utility
Language: English (en)

Header (Text):
Document Verification

Body:
Hello {{1}}, to fast-track your loan sanction with our partner banks, please have these documents ready: 1) PAN & Aadhaar Card, 2) Latest 6 months bank statement, 3) Income proof / 3 months salary slips. You can submit them online via our secure link.

Footer:
Confidential & Safe • Right Agent Group

Button (URL - Static):
Button Text: Submit Documents
Website URL: https://13.201.0.111.sslip.io/apply`,
  },
  {
    name: "festival_interest_discount",
    displayName: "Festive Low-Interest Loan Scheme",
    category: "MARKETING",
    pricing: "Marketing (~₹0.78/msg)",
    languages: [
      { code: "en", label: "English (en)" },
      { code: "en_US", label: "English US (en_US)" },
      { code: "te", label: "Telugu (te)" },
    ],
    header: "Special Festive Loan Offer",
    body: "Hello {{1}}, celebrate this festive season with Right Agent Group! Benefit from discounted interest rates starting from 7.15% p.a. on Home Loans and fast approvals on Business Loans with zero processing fee offers from select banks.",
    bodyVariables: ["Customer Name"],
    footer: "Limited Time Offer • Right Agent Group",
    button: {
      type: "URL",
      text: "Avail Offer Now",
      urlType: "STATIC",
      exampleUrl: "https://13.201.0.111.sslip.io/apply",
    },
    description: "Marketing campaign template for festive loan promotions and seasonal rate cuts.",
    samplePreview: "Hello Ramesh,\n\nCelebrate this festive season with Right Agent Group! Benefit from discounted interest rates starting from 7.15% p.a. on Home Loans and fast approvals on Business Loans with zero processing fee offers from select banks.\n\n[Button: Avail Offer Now]",
    copyTextForMeta: `Template Name: festival_interest_discount
Category: Marketing
Language: English (en)

Header (Text):
Special Festive Loan Offer

Body:
Hello {{1}}, celebrate this festive season with Right Agent Group! Benefit from discounted interest rates starting from 7.15% p.a. on Home Loans and fast approvals on Business Loans with zero processing fee offers from select banks.

Footer:
Limited Time Offer • Right Agent Group

Button (URL - Static):
Button Text: Avail Offer Now
Website URL: https://13.201.0.111.sslip.io/apply`,
  },
  {
    name: "emi_payment_reminder",
    displayName: "EMI Due Date Reminder",
    category: "UTILITY",
    pricing: "Utility (~₹0.115/msg)",
    languages: [
      { code: "en", label: "English (en)" },
      { code: "en_US", label: "English US (en_US)" },
      { code: "te", label: "Telugu (te)" },
    ],
    header: "Loan Servicing Update",
    body: "Hello {{1}}, this is a friendly reminder that your upcoming loan installment is scheduled for auto-debit on {{2}}. Please ensure adequate balance in your account to avoid bounce charges and protect your credit score.",
    bodyVariables: ["Customer Name", "Due Date"],
    footer: "Right Agent Group • Borrower Support",
    button: {
      type: "QUICK_REPLY",
      text: "Payment Done",
    },
    description: "Utility reminder template to ensure timely borrower payments and zero defaults.",
    samplePreview: "Hello Manoj,\n\nThis is a friendly reminder that your upcoming loan installment is scheduled for auto-debit on 5th of this month. Please ensure adequate balance in your account to avoid bounce charges and protect your credit score.\n\n[Button: Payment Done]",
    copyTextForMeta: `Template Name: emi_payment_reminder
Category: Utility
Language: English (en)

Header (Text):
Loan Servicing Update

Body:
Hello {{1}}, this is a friendly reminder that your upcoming loan installment is scheduled for auto-debit on {{2}}. Please ensure adequate balance in your account to avoid bounce charges and protect your credit score.

Footer:
Right Agent Group • Borrower Support

Button (Quick Reply):
Button Text: Payment Done`,
  },
]

// Canned Quick Reply Templates for 1-click insertion in WhatsApp Live Chat
export interface QuickChatTemplate {
  id: string
  label: string
  category: "Application" | "Documents" | "Rates" | "Company" | "Telugu" | "Hindi"
  text: string
}

export const WHATSAPP_QUICK_CHAT_TEMPLATES: QuickChatTemplate[] = [
  {
    id: "wa-quick-1",
    label: "📄 Send Application Form",
    category: "Application",
    text: "Hello {name}, you can complete your instant loan application online through our secure portal: https://13.201.0.111.sslip.io/apply — It only takes 2 minutes and no advance fees are required.",
  },
  {
    id: "wa-quick-2",
    label: "📋 Required Documents",
    category: "Documents",
    text: "Dear {name}, here are the required documents for your loan verification:\n1. PAN Card & Aadhaar Card\n2. Latest 6 Months Bank Statement\n3. Latest 3 Months Salary Slips or 2 Years ITR\n4. Property Documents / Electricity Bill\n\nYou can reply with photos/PDFs here directly.",
  },
  {
    id: "wa-quick-3",
    label: "🏠 Home Loan Rates",
    category: "Rates",
    text: "Home loans with Right Agent Group start from 7.25% p.a. through 20+ top banks (SBI, HDFC, ICICI, Axis). Tenure up to 30 years with fast-track processing in Hyderabad.",
  },
  {
    id: "wa-quick-4",
    label: "💼 Business Loan Rates",
    category: "Rates",
    text: "Business loans up to ₹75 Lakhs available without collateral from partner NBFCs and banks. Approval within 24-48 hours with minimal documentation.",
  },
  {
    id: "wa-quick-5",
    label: "📍 Office Address & Hours",
    category: "Company",
    text: "Right Agent Group Head Office:\nOpp. Gandimaisamma Temple, Gandimaisamma, Hyderabad, Telangana 500043.\nWorking Hours: Monday to Saturday, 9:30 AM to 6:30 PM.\nNote: We never ask for OTP or advance charges.",
  },
  {
    id: "wa-quick-6",
    label: "🇮🇳 Telugu Greeting",
    category: "Telugu",
    text: "నమస్కారం {name} గారు, రైట్ ఏజెంట్ గ్రూప్ నుండి మాట్లాడుతున్నాము. మీకు హోమ్ లోన్ లేదా పర్సనల్ లోన్ అవసరమా? మా వద్ద తక్కువ వడ్డీ రేట్లతో 20+ బ్యాంకుల నుండి లోన్స్ ప్రాసెస్ చేయబడతాయి.",
  },
  {
    id: "wa-quick-7",
    label: "🇮🇳 Hindi Greeting",
    category: "Hindi",
    text: "नमस्ते {name} जी, राइट एजेंट ग्रुप की तरफ से नमस्कार। हमारे पास होम लोन, पर्सनल लोन और बिजनेस लोन न्यूनतम ब्याज दरों पर उपलब्ध हैं। अधिक जानकारी के लिए कृपया बताएं।",
  },
  {
    id: "wa-quick-8",
    label: "🔒 Safety & No-OTP Notice",
    category: "Company",
    text: "Security Alert: Right Agent Group never charges any upfront processing fees and our team will NEVER ask for your OTP, Net Banking password, or ATM PIN. Please stay alert against fraud.",
  },
]
