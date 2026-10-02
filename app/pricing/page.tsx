import Link from "next/link"
import { CheckCircle2, ArrowRight, BarChart3 } from "lucide-react"
import SiteShell from "@/components/site/site-shell"

// Pricing — the owner's real published tiers (mirrors the #pricing section
// on /apply). No invented discounts, no fake "was/now" pricing, no annual
// math we can't back up.
const PLANS = [
  {
    name: "Starter",
    price: "₹24,999",
    period: "/month",
    tagline: "For small teams",
    features: [
      "Up to 2,000 calls / month",
      "1 language",
      "WhatsApp follow-up",
      "Dashboard access",
      "Email support",
    ],
    highlight: false,
  },
  {
    name: "Growth",
    price: "₹59,999",
    period: "/month",
    tagline: "For growing loan operations",
    features: [
      "Up to 10,000 calls / month",
      "English, Hindi & Telugu",
      "Sentiment analytics",
      "Lead pipeline + scoring",
      "Priority support",
    ],
    highlight: true,
  },
  {
    name: "Scale",
    price: "Custom",
    period: "",
    tagline: "For multi-branch organizations",
    features: [
      "Unlimited call volume",
      "Dedicated infrastructure",
      "Custom integrations & CRM sync",
      "Onboarding manager",
      "SLA-backed uptime",
    ],
    highlight: false,
  },
]

const PRICE_FACTORS = [
  "AI call usage",
  "WhatsApp usage",
  "Number of branches",
  "Number of users",
  "AI employees",
  "Integrations",
  "Support",
]

export default function PricingPage() {
  return (
    <SiteShell>
      <div className="rgpage">
        <span className="rg-eyebrow">
          <BarChart3 size={12} strokeWidth={2} /> Simple monthly pricing
        </span>
        <h1>
          Pricing that scales <span className="rg-grad">with your call volume</span>
        </h1>
        <p className="rg-lead">
          Pick a plan by how many leads your team works. We&apos;ll confirm the final number for
          your volume on a quick call before anything is signed.
        </p>
      </div>

      <section className="rg-section" style={{ paddingTop: 20 }}>
        <div className="rgp-grid">
          {PLANS.map((p) => (
            <div key={p.name} className={`rg-glass rgp-tier ${p.highlight ? "rgp-highlight" : ""}`}>
              {p.highlight && <div className="rgp-badge">MOST POPULAR</div>}
              <div className="rgp-name">{p.name}</div>
              <div className="rgp-price">
                <b>{p.price}</b>
                {p.period && <span>{p.period}</span>}
              </div>
              <div className="rgp-tag">{p.tagline}</div>
              <ul className="rgp-features">
                {p.features.map((f) => (
                  <li key={f}>
                    <CheckCircle2 size={15} strokeWidth={2} />
                    {f}
                  </li>
                ))}
              </ul>
              <Link
                href="/demo"
                className={`rg-btn ${p.highlight ? "rg-btn-primary" : "rg-btn-ghost"}`}
                style={{ width: "100%" }}
              >
                {p.highlight ? "Book a Demo" : p.name === "Scale" ? "Contact Sales" : "Book a Demo"}
                <ArrowRight size={14} strokeWidth={2.2} />
              </Link>
            </div>
          ))}
        </div>

        <div className="rg-center" style={{ marginTop: 64 }}>
          <h2 className="rg-h3">What affects your price</h2>
          <div className="rgp-factors">
            {PRICE_FACTORS.map((f) => (
              <div key={f} className="rgp-factor">
                <CheckCircle2 size={14} strokeWidth={2} />
                {f}
              </div>
            ))}
          </div>
          <p className="rgp-note" style={{ marginLeft: "auto", marginRight: "auto" }}>
            <b>A note on third-party usage:</b> telephony minutes, WhatsApp/Meta charges and AI
            provider credits are billed by those providers at their own rates — we help you
            estimate them before launch so there are no surprises on your first provider invoice.
          </p>
        </div>

        <div className="rg-cta" style={{ paddingBottom: 0 }}>
          <div className="rg-glass">
            <h2 className="rg-h3" style={{ marginTop: 0 }}>
              Not sure which plan fits?
            </h2>
            <p className="rg-lead" style={{ margin: "0 auto 24px" }}>
              Book a demo and we&apos;ll map your current lead flow to the right tier — including
              what your providers will charge at your volume.
            </p>
            <div className="rg-cta-actions" style={{ marginTop: 0 }}>
              <Link href="/demo" className="rg-btn rg-btn-primary rg-btn-lg">
                Book a Demo <ArrowRight size={16} strokeWidth={2.2} />
              </Link>
            </div>
          </div>
        </div>
      </section>
    </SiteShell>
  )
}
