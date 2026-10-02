import Link from "next/link"

// Public site footer — server component, zero client JS. Three link columns
// (Product / Company / Trust) plus the AI-disclosure line the platform is
// honest about everywhere.
const PRODUCT_LINKS = [
  { href: "/product", label: "Product" },
  { href: "/#how", label: "How It Works" },
  { href: "/ai-employees", label: "AI Employees" },
  { href: "/integrations", label: "Integrations" },
  { href: "/pricing", label: "Pricing" },
]

const COMPANY_LINKS = [
  { href: "/about", label: "About" },
  { href: "/demo", label: "Book a Demo" },
  { href: "/help", label: "Help Center" },
  { href: "/login", label: "Login" },
]

const TRUST_LINKS = [
  { href: "/security", label: "Security" },
  { href: "/privacy", label: "Privacy" },
  { href: "/terms", label: "Terms" },
]

export default function SiteFooter() {
  const year = new Date().getFullYear()
  return (
    <footer className="rg-footer">
      <div className="rg-footer-inner">
        <div className="rg-footer-brand">
          <span className="rg-brand-mark" aria-hidden="true">
            R
          </span>
          <span className="rg-footer-brand-name">Right Agent Group</span>
          <span className="rg-footer-tag">AI loan calling &amp; lead management</span>
        </div>

        <nav className="rg-footer-grid" aria-label="Footer">
          <div className="rg-footer-col">
            <h3>Product</h3>
            <ul>
              {PRODUCT_LINKS.map((l) => (
                <li key={l.href}>
                  <Link href={l.href}>{l.label}</Link>
                </li>
              ))}
            </ul>
          </div>
          <div className="rg-footer-col">
            <h3>Company</h3>
            <ul>
              {COMPANY_LINKS.map((l) => (
                <li key={l.href}>
                  <Link href={l.href}>{l.label}</Link>
                </li>
              ))}
            </ul>
          </div>
          <div className="rg-footer-col">
            <h3>Trust</h3>
            <ul>
              {TRUST_LINKS.map((l) => (
                <li key={l.href}>
                  <Link href={l.href}>{l.label}</Link>
                </li>
              ))}
            </ul>
          </div>
        </nav>

        <div className="rg-footer-bottom">
          <span>© {year} Right Agent Group. AI loan calling &amp; lead management.</span>
          <span>Priya is an AI employee — conversations are disclosed as AI-generated.</span>
        </div>
      </div>
    </footer>
  )
}
